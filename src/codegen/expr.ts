// Expression compilation: HIR Expr -> LLVM IR values

import {
  Expr, ExprKind, BinaryOp, UnaryOp, CompareOp, LogicalOp,
  NumberExpr, StringExpr, BoolExpr, UndefinedExpr, NullExpr,
  BinaryExpr, UnaryExpr, CompareExpr, LogicalExpr,
  LocalGetExpr, LocalSetExpr, CallExpr, FuncRefExpr, IfExpr,
  ArrayExpr, ArrayGetExpr, ArraySetExpr,
  ObjectLitExpr, FieldGetExpr, FieldSetExpr,
  MethodCallExpr, Int32Expr,
} from "../hir/ir";
import { TypeKind, isDynamic, isNumber, isString, isBoolean, Type } from "../hir/types";
import { LLBlock } from "../llvm/block";
import { DOUBLE, I64, I32, I1, PTR } from "../llvm/types";
import {
  TAG_UNDEFINED, TAG_NULL, TAG_FALSE, TAG_TRUE, STRING_TAG, POINTER_TAG,
  i64Literal, doubleLiteral,
} from "./nanbox";
import { CompilerContext } from "./compiler";

// Compile an expression, returning an LLVM value string (register or constant)
export function compileExpr(ctx: CompilerContext, block: LLBlock, expr: Expr): [LLBlock, string] {
  if (expr.kind === ExprKind.Number) {
    const e = expr as NumberExpr;
    return [block, doubleLiteral(e.value)];
  }

  if (expr.kind === ExprKind.Int32) {
    const e = expr as Int32Expr;
    // NaN-box the i32: bitcast (INT32_TAG | value) to double
    const tagVal = 0x7FFE_0000_0000_0000n | BigInt(e.value);
    const i64Val = block.bitcastI64ToDouble(i64Literal(tagVal));
    return [block, i64Val];
  }

  if (expr.kind === ExprKind.String) {
    const e = expr as StringExpr;
    const strInfo = ctx.addStringConstant(e.value);
    const strName = strInfo[0];
    const strLen = strInfo[1];
    const strPtr = block.gep("i8", "@" + strName, [[I32, "0"]]);
    const strHandle = block.call(I64, "js_string_from_bytes", [[PTR, strPtr], [I64, strLen.toString()]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, strHandle]]);
    return [block, boxed];
  }

  if (expr.kind === ExprKind.Bool) {
    const e = expr as BoolExpr;
    if (e.value) {
      const val = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
      return [block, val];
    } else {
      const val = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
      return [block, val];
    }
  }

  if (expr.kind === ExprKind.Undefined) {
    const val = block.bitcastI64ToDouble(i64Literal(TAG_UNDEFINED));
    return [block, val];
  }

  if (expr.kind === ExprKind.Null) {
    const val = block.bitcastI64ToDouble(i64Literal(TAG_NULL));
    return [block, val];
  }

  if (expr.kind === ExprKind.Binary) {
    return compileBinary(ctx, block, expr as BinaryExpr);
  }

  if (expr.kind === ExprKind.Unary) {
    return compileUnary(ctx, block, expr as UnaryExpr);
  }

  if (expr.kind === ExprKind.Compare) {
    return compileCompare(ctx, block, expr as CompareExpr);
  }

  if (expr.kind === ExprKind.Logical) {
    return compileLogical(ctx, block, expr as LogicalExpr);
  }

  if (expr.kind === ExprKind.LocalGet) {
    const e = expr as LocalGetExpr;
    const ptr = ctx.getLocal(e.localId);
    const val = block.load(DOUBLE, ptr);
    return [block, val];
  }

  if (expr.kind === ExprKind.LocalSet) {
    const e = expr as LocalSetExpr;
    const result = compileExpr(ctx, block, e.value);
    block = result[0];
    const val = result[1];
    const ptr = ctx.getLocal(e.localId);
    block.store(DOUBLE, val, ptr);
    return [block, val];
  }

  if (expr.kind === ExprKind.Call) {
    return compileCall(ctx, block, expr as CallExpr);
  }

  if (expr.kind === ExprKind.FuncRef) {
    const e = expr as FuncRefExpr;
    return [block, "@" + ctx.getFuncName(e.funcId)];
  }

  if (expr.kind === ExprKind.If) {
    return compileIfExpr(ctx, block, expr as IfExpr);
  }

  if (expr.kind === ExprKind.Array) {
    return compileArray(ctx, block, expr as ArrayExpr);
  }

  if (expr.kind === ExprKind.ArrayGet) {
    return compileArrayGet(ctx, block, expr as ArrayGetExpr);
  }

  if (expr.kind === ExprKind.ArraySet) {
    return compileArraySet(ctx, block, expr as ArraySetExpr);
  }

  if (expr.kind === ExprKind.ObjectLit) {
    return compileObjectLit(ctx, block, expr as ObjectLitExpr);
  }

  if (expr.kind === ExprKind.FieldGet) {
    return compileFieldGet(ctx, block, expr as FieldGetExpr);
  }

  if (expr.kind === ExprKind.FieldSet) {
    return compileFieldSet(ctx, block, expr as FieldSetExpr);
  }

  if (expr.kind === ExprKind.MethodCall) {
    return compileMethodCall(ctx, block, expr as MethodCallExpr);
  }

  throw new Error("Unsupported expr kind: " + expr.kind);
}

// --- Helper: call a runtime function that takes/returns JSValue (i64 ABI) ---
function callJSValueBinaryOp(block: LLBlock, funcName: string, left: string, right: string): string {
  const leftI64 = block.bitcastDoubleToI64(left);
  const rightI64 = block.bitcastDoubleToI64(right);
  const resultI64 = block.call(I64, funcName, [[I64, leftI64], [I64, rightI64]]);
  return block.bitcastI64ToDouble(resultI64);
}

// --- Helper: extract raw pointer from a NaN-boxed pointer value ---
function unboxPointer(block: LLBlock, val: string): string {
  const i64Val = block.call(I64, "js_nanbox_get_pointer", [[DOUBLE, val]]);
  return block.inttoptr(I64, i64Val);
}

// --- Helper: NaN-box a raw pointer into a double ---
function boxPointer(block: LLBlock, ptr: string): string {
  const i64Val = block.ptrtoint(ptr, I64);
  return block.call(DOUBLE, "js_nanbox_pointer", [[I64, i64Val]]);
}

// --- Array ---

function compileArray(ctx: CompilerContext, block: LLBlock, expr: ArrayExpr): [LLBlock, string] {
  const count = expr.elements.length;
  // Allocate array with capacity
  const arrPtr = block.call(PTR, "js_array_alloc", [[I32, count.toString()]]);

  // Push each element
  let currentPtr = arrPtr;
  for (let i = 0; i < count; i = i + 1) {
    const elemResult = compileExpr(ctx, block, expr.elements[i]);
    block = elemResult[0];
    const elemVal = elemResult[1];
    currentPtr = block.call(PTR, "js_array_push_f64", [[PTR, currentPtr], [DOUBLE, elemVal]]);
  }

  // NaN-box the pointer
  const boxed = boxPointer(block, currentPtr);
  return [block, boxed];
}

function compileArrayGet(ctx: CompilerContext, block: LLBlock, expr: ArrayGetExpr): [LLBlock, string] {
  // Compile array expression
  const arrResult = compileExpr(ctx, block, expr.array);
  block = arrResult[0];
  const arrVal = arrResult[1];

  // Compile index expression
  const idxResult = compileExpr(ctx, block, expr.index);
  block = idxResult[0];
  const idxVal = idxResult[1];

  // Extract raw pointer from NaN-boxed value
  const arrPtr = unboxPointer(block, arrVal);

  // Convert index from f64 to i32
  const idx = block.fptosi(DOUBLE, idxVal, I32);

  // Call js_array_get_f64
  const result = block.call(DOUBLE, "js_array_get_f64", [[PTR, arrPtr], [I32, idx]]);
  return [block, result];
}

function compileArraySet(ctx: CompilerContext, block: LLBlock, expr: ArraySetExpr): [LLBlock, string] {
  // Compile array expression
  const arrResult = compileExpr(ctx, block, expr.array);
  block = arrResult[0];
  const arrVal = arrResult[1];

  // Compile index expression
  const idxResult = compileExpr(ctx, block, expr.index);
  block = idxResult[0];
  const idxVal = idxResult[1];

  // Compile value expression
  const valResult = compileExpr(ctx, block, expr.value);
  block = valResult[0];
  const val = valResult[1];

  // Extract raw pointer from NaN-boxed value
  const arrPtr = unboxPointer(block, arrVal);

  // Convert index from f64 to i32
  const idx = block.fptosi(DOUBLE, idxVal, I32);

  // Call js_array_set_f64
  block.callVoid("js_array_set_f64", [[PTR, arrPtr], [I32, idx], [DOUBLE, val]]);
  return [block, val];
}

// --- Object ---

function compileObjectLit(ctx: CompilerContext, block: LLBlock, expr: ObjectLitExpr): [LLBlock, string] {
  const fieldCount = expr.fields.length;
  // Allocate object with class_id=0 (anonymous object) and field_count
  const objPtr = block.call(PTR, "js_object_alloc", [[I32, "0"], [I32, fieldCount.toString()]]);

  // Set each field
  for (let i = 0; i < fieldCount; i = i + 1) {
    const field = expr.fields[i];
    const valResult = compileExpr(ctx, block, field[1]);
    block = valResult[0];
    const val = valResult[1];
    block.callVoid("js_object_set_field_f64", [[PTR, objPtr], [I32, i.toString()], [DOUBLE, val]]);
  }

  // NaN-box the pointer
  const boxed = boxPointer(block, objPtr);
  return [block, boxed];
}

function compileFieldGet(ctx: CompilerContext, block: LLBlock, expr: FieldGetExpr): [LLBlock, string] {
  // Compile object expression
  const objResult = compileExpr(ctx, block, expr.object);
  block = objResult[0];
  const objVal = objResult[1];

  // Extract raw pointer
  const objPtr = unboxPointer(block, objVal);

  // Call js_object_get_field_f64
  const result = block.call(DOUBLE, "js_object_get_field_f64", [[PTR, objPtr], [I32, expr.fieldIndex.toString()]]);
  return [block, result];
}

function compileFieldSet(ctx: CompilerContext, block: LLBlock, expr: FieldSetExpr): [LLBlock, string] {
  // Compile object expression
  const objResult = compileExpr(ctx, block, expr.object);
  block = objResult[0];
  const objVal = objResult[1];

  // Compile value expression
  const valResult = compileExpr(ctx, block, expr.value);
  block = valResult[0];
  const val = valResult[1];

  // Extract raw pointer
  const objPtr = unboxPointer(block, objVal);

  // Call js_object_set_field_f64
  block.callVoid("js_object_set_field_f64", [[PTR, objPtr], [I32, expr.fieldIndex.toString()], [DOUBLE, val]]);
  return [block, val];
}

// --- Method calls ---

function compileMethodCall(ctx: CompilerContext, block: LLBlock, expr: MethodCallExpr): [LLBlock, string] {
  // Compile object expression
  const objResult = compileExpr(ctx, block, expr.object);
  block = objResult[0];
  const objVal = objResult[1];

  // Compile all arguments
  const argVals: Array<string> = [];
  for (let i = 0; i < expr.args.length; i = i + 1) {
    const argResult = compileExpr(ctx, block, expr.args[i]);
    block = argResult[0];
    argVals.push(argResult[1]);
  }

  const method = expr.method;

  // --- Array methods ---
  if (method === "push") {
    const arrPtr = unboxPointer(block, objVal);
    const newPtr = block.call(PTR, "js_array_push_f64", [[PTR, arrPtr], [DOUBLE, argVals[0]]]);
    // Update the local if the object is a LocalGet (push may reallocate)
    const newBoxed = boxPointer(block, newPtr);
    if (expr.object.kind === ExprKind.LocalGet) {
      const localId = (expr.object as LocalGetExpr).localId;
      const localPtr = ctx.getLocal(localId);
      block.store(DOUBLE, newBoxed, localPtr);
    }
    // push returns the new length, but we approximate with undefined for now
    const undef = block.bitcastI64ToDouble(i64Literal(TAG_UNDEFINED));
    return [block, undef];
  }

  if (method === "pop") {
    const arrPtr = unboxPointer(block, objVal);
    const result = block.call(DOUBLE, "js_array_pop_f64", [[PTR, arrPtr]]);
    return [block, result];
  }

  if (method === "shift") {
    const arrPtr = unboxPointer(block, objVal);
    const result = block.call(DOUBLE, "js_array_shift_f64", [[PTR, arrPtr]]);
    return [block, result];
  }

  if (method === "length") {
    // .length is lowered as a method call with 0 args
    const arrPtr = unboxPointer(block, objVal);
    const len = block.call(I32, "js_array_length", [[PTR, arrPtr]]);
    const lenF64 = block.sitofp(I32, len, DOUBLE);
    return [block, lenF64];
  }

  if (method === "indexOf") {
    const arrPtr = unboxPointer(block, objVal);
    const idx = block.call(I32, "js_array_indexOf_f64", [[PTR, arrPtr], [DOUBLE, argVals[0]]]);
    const idxF64 = block.sitofp(I32, idx, DOUBLE);
    return [block, idxF64];
  }

  if (method === "includes") {
    const arrPtr = unboxPointer(block, objVal);
    const result = block.call(I32, "js_array_includes_f64", [[PTR, arrPtr], [DOUBLE, argVals[0]]]);
    const isTrue = block.icmpNe(I32, result, "0");
    const trueVal = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
    const falseVal = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }

  if (method === "slice") {
    const arrPtr = unboxPointer(block, objVal);
    const start = block.fptosi(DOUBLE, argVals[0], I32);
    let end: string;
    if (argVals.length > 1) {
      end = block.fptosi(DOUBLE, argVals[1], I32);
    } else {
      // Default end = array length
      end = block.call(I32, "js_array_length", [[PTR, arrPtr]]);
    }
    const newPtr = block.call(PTR, "js_array_slice", [[PTR, arrPtr], [I32, start], [I32, end]]);
    return [block, boxPointer(block, newPtr)];
  }

  if (method === "splice") {
    const arrPtr = unboxPointer(block, objVal);
    const start = block.fptosi(DOUBLE, argVals[0], I32);
    const deleteCount = argVals.length > 1 ? block.fptosi(DOUBLE, argVals[1], I32) : "0";
    const newPtr = block.call(PTR, "js_array_splice", [[PTR, arrPtr], [I32, start], [I32, deleteCount]]);
    return [block, boxPointer(block, newPtr)];
  }

  if (method === "concat") {
    const arrPtr = unboxPointer(block, objVal);
    const otherPtr = unboxPointer(block, argVals[0]);
    const newPtr = block.call(PTR, "js_array_concat", [[PTR, arrPtr], [PTR, otherPtr]]);
    return [block, boxPointer(block, newPtr)];
  }

  // --- Map methods ---
  if (method === "set") {
    const mapPtr = unboxPointer(block, objVal);
    const newPtr = block.call(PTR, "js_map_set", [[PTR, mapPtr], [DOUBLE, argVals[0]], [DOUBLE, argVals[1]]]);
    // Update the local if the object is a LocalGet (set may reallocate)
    const newBoxed = boxPointer(block, newPtr);
    if (expr.object.kind === ExprKind.LocalGet) {
      const localId = (expr.object as LocalGetExpr).localId;
      const localPtr = ctx.getLocal(localId);
      block.store(DOUBLE, newBoxed, localPtr);
    }
    // Return the map itself (for chaining)
    return [block, newBoxed];
  }

  if (method === "get") {
    const mapPtr = unboxPointer(block, objVal);
    const result = block.call(DOUBLE, "js_map_get", [[PTR, mapPtr], [DOUBLE, argVals[0]]]);
    return [block, result];
  }

  if (method === "has") {
    const mapPtr = unboxPointer(block, objVal);
    const result = block.call(I32, "js_map_has", [[PTR, mapPtr], [DOUBLE, argVals[0]]]);
    const isTrue = block.icmpNe(I32, result, "0");
    const trueVal = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
    const falseVal = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }

  if (method === "delete") {
    const mapPtr = unboxPointer(block, objVal);
    const result = block.call(I32, "js_map_delete", [[PTR, mapPtr], [DOUBLE, argVals[0]]]);
    const isTrue = block.icmpNe(I32, result, "0");
    const trueVal = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
    const falseVal = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }

  if (method === "size") {
    const mapPtr = unboxPointer(block, objVal);
    const size = block.call(I32, "js_map_size", [[PTR, mapPtr]]);
    const sizeF64 = block.sitofp(I32, size, DOUBLE);
    return [block, sizeF64];
  }

  throw new Error("Unsupported method call: " + method);
}

// --- Binary ---

function compileBinary(ctx: CompilerContext, block: LLBlock, expr: BinaryExpr): [LLBlock, string] {
  const leftResult = compileExpr(ctx, block, expr.left);
  block = leftResult[0];
  const left = leftResult[1];

  const rightResult = compileExpr(ctx, block, expr.right);
  block = rightResult[0];
  const right = rightResult[1];

  const leftIsNum = isNumber(expr.left.ty);
  const rightIsNum = isNumber(expr.right.ty);

  // If both operands are numbers, use direct f64 ops
  if (leftIsNum && rightIsNum) {
    if (expr.op === BinaryOp.Add) {
      return [block, block.fadd(left, right)];
    }
    if (expr.op === BinaryOp.Sub) {
      return [block, block.fsub(left, right)];
    }
    if (expr.op === BinaryOp.Mul) {
      return [block, block.fmul(left, right)];
    }
    if (expr.op === BinaryOp.Div) {
      return [block, block.fdiv(left, right)];
    }
    if (expr.op === BinaryOp.Mod) {
      return [block, block.frem(left, right)];
    }
  }

  // For string concat when both are strings
  if (isString(expr.left.ty) && isString(expr.right.ty) && expr.op === BinaryOp.Add) {
    // Unbox both strings, concat, rebox
    const leftI64 = block.bitcastDoubleToI64(left);
    const leftPtr = block.and(I64, leftI64, "281474976710655"); // POINTER_MASK
    const rightI64 = block.bitcastDoubleToI64(right);
    const rightPtr = block.and(I64, rightI64, "281474976710655");
    const resultPtr = block.call(I64, "js_string_concat", [[I64, leftPtr], [I64, rightPtr]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, resultPtr]]);
    return [block, boxed];
  }

  // Bitwise operations: convert to i32, operate, convert back
  if (expr.op === BinaryOp.BitAnd || expr.op === BinaryOp.BitOr ||
      expr.op === BinaryOp.BitXor || expr.op === BinaryOp.Shl ||
      expr.op === BinaryOp.Shr || expr.op === BinaryOp.UShr) {
    const li = block.fptosi(DOUBLE, left, I32);
    const ri = block.fptosi(DOUBLE, right, I32);
    let result: string;
    if (expr.op === BinaryOp.BitAnd) {
      result = block.and(I32, li, ri);
    } else if (expr.op === BinaryOp.BitOr) {
      result = block.or(I32, li, ri);
    } else if (expr.op === BinaryOp.BitXor) {
      result = block.xor(I32, li, ri);
    } else if (expr.op === BinaryOp.Shl) {
      result = block.shl(I32, li, ri);
    } else if (expr.op === BinaryOp.Shr) {
      result = block.ashr(I32, li, ri);
    } else {
      result = block.lshr(I32, li, ri);
    }
    const doubled = block.sitofp(I32, result, DOUBLE);
    return [block, doubled];
  }

  // Fallback: use runtime dynamic ops (JSValue is repr(transparent) u64 -> bitcast double<->i64)
  if (expr.op === BinaryOp.Add) {
    return [block, callJSValueBinaryOp(block, "js_add", left, right)];
  }
  if (expr.op === BinaryOp.Sub) {
    return [block, callJSValueBinaryOp(block, "js_sub", left, right)];
  }
  if (expr.op === BinaryOp.Mul) {
    return [block, callJSValueBinaryOp(block, "js_mul", left, right)];
  }
  if (expr.op === BinaryOp.Div) {
    return [block, callJSValueBinaryOp(block, "js_div", left, right)];
  }
  if (expr.op === BinaryOp.Mod) {
    return [block, callJSValueBinaryOp(block, "js_mod", left, right)];
  }

  throw new Error("Unsupported binary op: " + expr.op);
}

function compileUnary(ctx: CompilerContext, block: LLBlock, expr: UnaryExpr): [LLBlock, string] {
  const result = compileExpr(ctx, block, expr.operand);
  block = result[0];
  const val = result[1];

  if (expr.op === UnaryOp.Neg) {
    if (isNumber(expr.operand.ty)) {
      return [block, block.fneg(val)];
    }
    // Dynamic: negate via 0 - x
    const zero = doubleLiteral(0);
    return [block, block.call(DOUBLE, "js_sub", [[DOUBLE, zero], [DOUBLE, val]])];
  }

  if (expr.op === UnaryOp.Not) {
    // !x => is_truthy(x) ? false : true
    const truthy = block.call(I32, "js_is_truthy", [[DOUBLE, val]]);
    const isZero = block.icmpEq(I32, truthy, "0");
    const trueVal = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
    const falseVal = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
    const selected = block.select(I1, isZero, DOUBLE, trueVal, falseVal);
    return [block, selected];
  }

  if (expr.op === UnaryOp.BitNot) {
    const i = block.fptosi(DOUBLE, val, I32);
    const notted = block.xor(I32, i, "-1");
    const doubled = block.sitofp(I32, notted, DOUBLE);
    return [block, doubled];
  }

  if (expr.op === UnaryOp.Plus) {
    // +x is a no-op for numbers
    return [block, val];
  }

  throw new Error("Unsupported unary op: " + expr.op);
}

function compileCompare(ctx: CompilerContext, block: LLBlock, expr: CompareExpr): [LLBlock, string] {
  const leftResult = compileExpr(ctx, block, expr.left);
  block = leftResult[0];
  const left = leftResult[1];

  const rightResult = compileExpr(ctx, block, expr.right);
  block = rightResult[0];
  const right = rightResult[1];

  const bothNum = isNumber(expr.left.ty) && isNumber(expr.right.ty);

  if (bothNum) {
    let cmpResult: string;
    if (expr.op === CompareOp.Eq || expr.op === CompareOp.StrictEq) {
      cmpResult = block.fcmp("oeq", left, right);
    } else if (expr.op === CompareOp.Ne || expr.op === CompareOp.StrictNe) {
      cmpResult = block.fcmp("une", left, right);
    } else if (expr.op === CompareOp.Lt) {
      cmpResult = block.fcmp("olt", left, right);
    } else if (expr.op === CompareOp.Le) {
      cmpResult = block.fcmp("ole", left, right);
    } else if (expr.op === CompareOp.Gt) {
      cmpResult = block.fcmp("ogt", left, right);
    } else {
      cmpResult = block.fcmp("oge", left, right);
    }
    // Convert i1 to NaN-boxed boolean
    const trueVal = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
    const falseVal = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
    const selected = block.select(I1, cmpResult, DOUBLE, trueVal, falseVal);
    return [block, selected];
  }

  // Dynamic comparison via runtime
  if (expr.op === CompareOp.Eq || expr.op === CompareOp.StrictEq) {
    const eqResult = block.call(I32, "js_jsvalue_equals", [[DOUBLE, left], [DOUBLE, right]]);
    const isTrue = block.icmpNe(I32, eqResult, "0");
    const trueVal = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
    const falseVal = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }
  if (expr.op === CompareOp.Ne || expr.op === CompareOp.StrictNe) {
    const eqResult = block.call(I32, "js_jsvalue_equals", [[DOUBLE, left], [DOUBLE, right]]);
    const isFalse = block.icmpEq(I32, eqResult, "0");
    const trueVal = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
    const falseVal = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
    return [block, block.select(I1, isFalse, DOUBLE, trueVal, falseVal)];
  }

  // js_jsvalue_compare returns -1 (lt), 0 (eq), 1 (gt)
  const cmpResult = block.call(I32, "js_jsvalue_compare", [[DOUBLE, left], [DOUBLE, right]]);
  let cond: string;
  if (expr.op === CompareOp.Lt) {
    cond = block.icmpSlt(I32, cmpResult, "0");
  } else if (expr.op === CompareOp.Le) {
    cond = block.icmpSle(I32, cmpResult, "0");
  } else if (expr.op === CompareOp.Gt) {
    cond = block.icmpSgt(I32, cmpResult, "0");
  } else {
    cond = block.icmpSge(I32, cmpResult, "0");
  }
  const trueVal = block.bitcastI64ToDouble(i64Literal(TAG_TRUE));
  const falseVal = block.bitcastI64ToDouble(i64Literal(TAG_FALSE));
  return [block, block.select(I1, cond, DOUBLE, trueVal, falseVal)];
}

function compileLogical(ctx: CompilerContext, block: LLBlock, expr: LogicalExpr): [LLBlock, string] {
  // Short-circuit evaluation using blocks
  const leftResult = compileExpr(ctx, block, expr.left);
  block = leftResult[0];
  const leftVal = leftResult[1];

  const truthy = block.call(I32, "js_is_truthy", [[DOUBLE, leftVal]]);
  const isTruthy = block.icmpNe(I32, truthy, "0");

  const rightBlock = ctx.createBlock("logical.right");
  const mergeBlock = ctx.createBlock("logical.merge");

  if (expr.op === LogicalOp.And) {
    block.condBr(isTruthy, rightBlock.label, mergeBlock.label);
  } else {
    block.condBr(isTruthy, mergeBlock.label, rightBlock.label);
  }

  const rightResult = compileExpr(ctx, rightBlock, expr.right);
  const rightFinalBlock = rightResult[0];
  const rightVal = rightResult[1];
  if (!rightFinalBlock.isTerminated()) {
    rightFinalBlock.br(mergeBlock.label);
  }

  const phi = mergeBlock.phi(DOUBLE, [
    [leftVal, block.label],
    [rightVal, rightFinalBlock.label],
  ]);

  return [mergeBlock, phi];
}

function compileCall(ctx: CompilerContext, block: LLBlock, expr: CallExpr): [LLBlock, string] {
  // Compile arguments
  const argVals: Array<[string, string]> = [];
  for (let i = 0; i < expr.args.length; i = i + 1) {
    const argResult = compileExpr(ctx, block, expr.args[i]);
    block = argResult[0];
    argVals.push([argResult[1], ""]);
  }

  // If callee is a FuncRef, call the function directly
  if (expr.callee.kind === ExprKind.FuncRef) {
    const funcRef = expr.callee as FuncRefExpr;

    // Handle $map_alloc pseudo-function
    if (funcRef.name === "$map_alloc") {
      const mapPtr = block.call(PTR, "js_map_alloc", [[I32, "0"]]);
      return [block, boxPointer(block, mapPtr)];
    }

    const funcInfo = ctx.getFuncInfo(funcRef.funcId);
    const funcName = funcInfo !== null ? funcInfo.name : funcRef.name;
    const args: Array<[string, string]> = [];
    for (let i = 0; i < argVals.length; i = i + 1) {
      args.push([DOUBLE, argVals[i][0]]);
    }
    const retType = funcRef.ty;
    const isVoidReturn = (funcInfo !== null && (funcInfo.returnType.kind === TypeKind.Void || funcInfo.returnType.kind === TypeKind.Undefined))
      || (retType.kind === TypeKind.Function && ((retType as any).returnType.kind === TypeKind.Void || (retType as any).returnType.kind === TypeKind.Undefined))
      || isVoidRuntimeFunction(funcName);
    if (isVoidReturn) {
      block.callVoid(funcName, args);
      const undef = block.bitcastI64ToDouble(i64Literal(TAG_UNDEFINED));
      return [block, undef];
    }
    const result = block.call(DOUBLE, funcName, args);
    return [block, result];
  }

  // Dynamic call - not yet supported
  throw new Error("Dynamic function calls not yet supported");
}

function compileIfExpr(ctx: CompilerContext, block: LLBlock, expr: IfExpr): [LLBlock, string] {
  const condResult = compileExpr(ctx, block, expr.condition);
  block = condResult[0];
  const condVal = condResult[1];

  let cond: string;
  if (isBoolean(expr.condition.ty)) {
    const condI64 = block.bitcastDoubleToI64(condVal);
    cond = block.icmpEq(I64, condI64, i64Literal(TAG_TRUE));
  } else if (isNumber(expr.condition.ty)) {
    cond = block.fcmp("one", condVal, "0.0");
  } else {
    const truthy = block.call(I32, "js_is_truthy", [[DOUBLE, condVal]]);
    cond = block.icmpNe(I32, truthy, "0");
  }

  const thenBlock = ctx.createBlock("if.then");
  const elseBlock = ctx.createBlock("if.else");
  const mergeBlock = ctx.createBlock("if.merge");

  block.condBr(cond, thenBlock.label, elseBlock.label);

  const thenResult = compileExpr(ctx, thenBlock, expr.thenExpr);
  const thenFinal = thenResult[0];
  const thenVal = thenResult[1];
  if (!thenFinal.isTerminated()) {
    thenFinal.br(mergeBlock.label);
  }

  const elseResult = compileExpr(ctx, elseBlock, expr.elseExpr);
  const elseFinal = elseResult[0];
  const elseVal = elseResult[1];
  if (!elseFinal.isTerminated()) {
    elseFinal.br(mergeBlock.label);
  }

  const phi = mergeBlock.phi(DOUBLE, [
    [thenVal, thenFinal.label],
    [elseVal, elseFinal.label],
  ]);

  return [mergeBlock, phi];
}

// Known void-returning runtime functions
const VOID_RUNTIME_FUNCTIONS: Map<string, boolean> = new Map();
VOID_RUNTIME_FUNCTIONS.set("js_console_log_number", true);
VOID_RUNTIME_FUNCTIONS.set("js_console_log_dynamic", true);
VOID_RUNTIME_FUNCTIONS.set("js_console_error_number", true);
VOID_RUNTIME_FUNCTIONS.set("js_console_error_dynamic", true);
VOID_RUNTIME_FUNCTIONS.set("js_console_warn_number", true);
VOID_RUNTIME_FUNCTIONS.set("js_console_warn_dynamic", true);
VOID_RUNTIME_FUNCTIONS.set("js_gc_init", true);
VOID_RUNTIME_FUNCTIONS.set("js_object_set_field_f64", true);
VOID_RUNTIME_FUNCTIONS.set("js_array_set_f64", true);
VOID_RUNTIME_FUNCTIONS.set("js_closure_set_capture_f64", true);
VOID_RUNTIME_FUNCTIONS.set("js_process_exit", true);
VOID_RUNTIME_FUNCTIONS.set("js_throw", true);
VOID_RUNTIME_FUNCTIONS.set("js_try_exit", true);
VOID_RUNTIME_FUNCTIONS.set("js_stdlib_init_dispatch", true);

function isVoidRuntimeFunction(name: string): boolean {
  return VOID_RUNTIME_FUNCTIONS.has(name);
}
