// Expression compilation: HIR Expr -> LLVM IR values

import {
  Expr, ExprKind, BinaryOp, UnaryOp, CompareOp, LogicalOp,
  NumberExpr, StringExpr, BoolExpr, UndefinedExpr, NullExpr,
  BinaryExpr, UnaryExpr, CompareExpr, LogicalExpr,
  LocalGetExpr, LocalSetExpr, CallExpr, FuncRefExpr, IfExpr,
  ArrayExpr, ArrayGetExpr, ArraySetExpr,
  ObjectLitExpr, FieldGetExpr, FieldSetExpr,
  MethodCallExpr, Int32Expr, ClosureExpr, CaptureGetExpr,
  GlobalGetExpr, GlobalSetExpr,
} from "../hir/ir";
import { TypeKind, isDynamic, isNumber, isString, isBoolean, Type, FunctionType } from "../hir/types";
import { LLBlock } from "../llvm/block";
const DOUBLE: string = "double";
const I64: string = "i64";
const I32: string = "i32";
const I1: string = "i1";
const PTR: string = "ptr";
import { i64Literal, doubleLiteral, TAG_UNDEFINED_I64, TAG_NULL_I64, TAG_FALSE_I64, TAG_TRUE_I64, POINTER_TAG, POINTER_MASK, STRING_TAG, POINTER_TAG_I64, POINTER_MASK_I64, STRING_TAG_I64, INT32_TAG_I64 } from "./nanbox";
const TAG_UNDEFINED = 0x7FFC_0000_0000_0001n;
const TAG_NULL = 0x7FFC_0000_0000_0002n;
const TAG_FALSE = 0x7FFC_0000_0000_0003n;
const TAG_TRUE = 0x7FFC_0000_0000_0004n;
import { CompilerContext } from "./compiler";

// Compile an expression, returning an LLVM value string (register or constant)
export function compileExpr(ctx: CompilerContext, block: LLBlock, expr: Expr): [LLBlock, string] {
  if (expr.kind === ExprKind.Number) {
    const e: NumberExpr = expr as NumberExpr;
    return [block, doubleLiteral(e.value)];
  }

  if (expr.kind === ExprKind.Int32) {
    const e: Int32Expr = expr as Int32Expr;
    // NaN-box the i32: OR INT32_TAG with value, then bitcast to double
    const tag = INT32_TAG_I64;
    const valI64 = block.zext(I32, "" + e.value, I64);
    const combined = block.or(I64, tag, valI64);
    const i64Val = block.bitcastI64ToDouble(combined);
    return [block, i64Val];
  }

  if (expr.kind === ExprKind.String) {
    const e: StringExpr = expr as StringExpr;
    const strInfo = ctx.addStringConstant(e.value);
    const strName = strInfo[0];
    const strLen = strInfo[1];
    const strPtr = block.gep("i8", "@" + strName, [[I32, "0"]]);
    const strHandle = block.call(I64, "js_string_from_bytes", [[PTR, strPtr], [I32, strLen.toString()]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, strHandle]]);
    return [block, boxed];
  }

  if (expr.kind === ExprKind.Bool) {
    const e: BoolExpr = expr as BoolExpr;
    if (e.value) {
      const val = block.bitcastI64ToDouble(TAG_TRUE_I64);
      return [block, val];
    } else {
      const val = block.bitcastI64ToDouble(TAG_FALSE_I64);
      return [block, val];
    }
  }

  if (expr.kind === ExprKind.Undefined) {
    const val = block.bitcastI64ToDouble(TAG_UNDEFINED_I64);
    return [block, val];
  }

  if (expr.kind === ExprKind.Null) {
    const val = block.bitcastI64ToDouble(TAG_NULL_I64);
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
    const e: LocalGetExpr = expr as LocalGetExpr;
    const ptr = ctx.getLocal(e.localId);
    const val = block.load(DOUBLE, ptr);
    return [block, val];
  }

  if (expr.kind === ExprKind.LocalSet) {
    const e: LocalSetExpr = expr as LocalSetExpr;
    const result = compileExpr(ctx, block, e.value);
    block = result[0];
    const val = result[1];
    const ptr = ctx.getLocal(e.localId);
    block.store(DOUBLE, val, ptr);
    return [block, val];
  }

  if (expr.kind === ExprKind.GlobalGet) {
    const e: GlobalGetExpr = expr as GlobalGetExpr;
    const globalName = ctx.getGlobalName(e.name);
    const val = block.load(DOUBLE, globalName);
    return [block, val];
  }

  if (expr.kind === ExprKind.GlobalSet) {
    const e: GlobalSetExpr = expr as GlobalSetExpr;
    const result = compileExpr(ctx, block, e.value);
    block = result[0];
    const val = result[1];
    const globalName = ctx.getGlobalName(e.name);
    block.store(DOUBLE, val, globalName);
    return [block, val];
  }

  if (expr.kind === ExprKind.Call) {
    return compileCall(ctx, block, expr as CallExpr);
  }

  if (expr.kind === ExprKind.FuncRef) {
    const e: FuncRefExpr = expr as FuncRefExpr;
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

  if (expr.kind === ExprKind.Closure) {
    return compileClosure(ctx, block, expr as ClosureExpr);
  }

  if (expr.kind === ExprKind.CaptureGet) {
    return compileCaptureGet(ctx, block, expr as CaptureGetExpr);
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
      const objLocalGet: LocalGetExpr = expr.object as LocalGetExpr;
      const localPtr = ctx.getLocal(objLocalGet.localId);
      block.store(DOUBLE, newBoxed, localPtr);
    }
    // push returns the new length, but we approximate with undefined for now
    const undef = block.bitcastI64ToDouble(TAG_UNDEFINED_I64);
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
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
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
      const objLocalGet2: LocalGetExpr = expr.object as LocalGetExpr;
      const localPtr = ctx.getLocal(objLocalGet2.localId);
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
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }

  if (method === "delete") {
    const mapPtr = unboxPointer(block, objVal);
    const result = block.call(I32, "js_map_delete", [[PTR, mapPtr], [DOUBLE, argVals[0]]]);
    const isTrue = block.icmpNe(I32, result, "0");
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }

  if (method === "size") {
    const mapPtr = unboxPointer(block, objVal);
    const size = block.call(I32, "js_map_size", [[PTR, mapPtr]]);
    const sizeF64 = block.sitofp(I32, size, DOUBLE);
    return [block, sizeF64];
  }

  // --- String methods ---
  // String values are NaN-boxed: bitcast double->i64, AND with POINTER_MASK to get raw string handle
  if (method === "str_length") {
    const strHandle = unboxString(block, objVal);
    const len = block.call(I32, "js_string_length", [[I64, strHandle]]);
    const lenF64 = block.sitofp(I32, len, DOUBLE);
    return [block, lenF64];
  }

  if (method === "str_indexOf") {
    const strHandle = unboxString(block, objVal);
    const searchHandle = unboxString(block, argVals[0]);
    const idx = block.call(I32, "js_string_index_of", [[I64, strHandle], [I64, searchHandle]]);
    const idxF64 = block.sitofp(I32, idx, DOUBLE);
    return [block, idxF64];
  }

  if (method === "str_includes") {
    const strHandle = unboxString(block, objVal);
    const searchHandle = unboxString(block, argVals[0]);
    // No js_string_includes in runtime; use index_of >= 0
    const idx = block.call(I32, "js_string_index_of", [[I64, strHandle], [I64, searchHandle]]);
    const isTrue = block.icmpSge(I32, idx, "0");
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }

  if (method === "str_startsWith") {
    const strHandle = unboxString(block, objVal);
    const searchHandle = unboxString(block, argVals[0]);
    const result = block.call(I32, "js_string_starts_with", [[I64, strHandle], [I64, searchHandle]]);
    const isTrue = block.icmpNe(I32, result, "0");
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }

  if (method === "str_endsWith") {
    const strHandle = unboxString(block, objVal);
    const searchHandle = unboxString(block, argVals[0]);
    const result = block.call(I32, "js_string_ends_with", [[I64, strHandle], [I64, searchHandle]]);
    const isTrue = block.icmpNe(I32, result, "0");
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }

  if (method === "str_slice" || method === "str_substring") {
    const strHandle = unboxString(block, objVal);
    const start = block.fptosi(DOUBLE, argVals[0], I32);
    let end: string;
    if (argVals.length > 1) {
      end = block.fptosi(DOUBLE, argVals[1], I32);
    } else {
      // Default end = string length
      end = block.call(I32, "js_string_length", [[I64, strHandle]]);
    }
    const resultHandle = block.call(I64, "js_string_slice", [[I64, strHandle], [I32, start], [I32, end]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, resultHandle]]);
    return [block, boxed];
  }

  if (method === "str_trim") {
    const strHandle = unboxString(block, objVal);
    const resultHandle = block.call(I64, "js_string_trim", [[I64, strHandle]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, resultHandle]]);
    return [block, boxed];
  }

  if (method === "str_charAt") {
    const strHandle = unboxString(block, objVal);
    const idx = block.fptosi(DOUBLE, argVals[0], I32);
    const resultHandle = block.call(I64, "js_string_char_at", [[I64, strHandle], [I32, idx]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, resultHandle]]);
    return [block, boxed];
  }

  if (method === "str_charCodeAt") {
    const strHandle = unboxString(block, objVal);
    const idx = block.fptosi(DOUBLE, argVals[0], I32);
    const codeF64 = block.call(DOUBLE, "js_string_char_code_at", [[I64, strHandle], [I32, idx]]);
    return [block, codeF64];
  }

  if (method === "str_split") {
    const strHandle = unboxString(block, objVal);
    const sepHandle = unboxString(block, argVals[0]);
    const resultHandle = block.call(I64, "js_string_split", [[I64, strHandle], [I64, sepHandle]]);
    // js_string_split returns a raw pointer to ArrayHeader
    const resultPtr = block.inttoptr(I64, resultHandle);
    return [block, boxPointer(block, resultPtr)];
  }

  if (method === "join") {
    // Array join: arr.join(separator) -> string
    const arrPtr = unboxPointer(block, objVal);
    let sepPtr: string;
    if (argVals.length > 0) {
      // Separator is a NaN-boxed string
      const sepHandle = unboxString(block, argVals[0]);
      sepPtr = block.inttoptr(I64, sepHandle);
    } else {
      // Default separator: ","
      const sepInfo = ctx.addStringConstant(",");
      const sepStrHandle = block.call(I64, "js_string_from_bytes",
        [[PTR, "@" + sepInfo[0]], [I64, "" + sepInfo[1]]]);
      sepPtr = block.inttoptr(I64, sepStrHandle);
    }
    const resultPtr = block.call(PTR, "js_array_join", [[PTR, arrPtr], [PTR, sepPtr]]);
    const resultI64 = block.ptrtoint(resultPtr, I64);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, resultI64]]);
    return [block, boxed];
  }

  if (method === "str_replace") {
    const strHandle = unboxString(block, objVal);
    const searchHandle = unboxString(block, argVals[0]);
    const replaceHandle = unboxString(block, argVals[1]);
    const resultHandle = block.call(I64, "js_string_replace_string", [[I64, strHandle], [I64, searchHandle], [I64, replaceHandle]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, resultHandle]]);
    return [block, boxed];
  }

  if (method === "str_toUpperCase") {
    const strHandle = unboxString(block, objVal);
    const resultHandle = block.call(I64, "js_string_to_upper_case", [[I64, strHandle]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, resultHandle]]);
    return [block, boxed];
  }

  if (method === "str_toLowerCase") {
    const strHandle = unboxString(block, objVal);
    const resultHandle = block.call(I64, "js_string_to_lower_case", [[I64, strHandle]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, resultHandle]]);
    return [block, boxed];
  }

  if (method === "toString") {
    // Convert any value to string via js_jsvalue_to_string
    const strHandle = block.call(I64, "js_jsvalue_to_string", [[DOUBLE, objVal]]);
    const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, strHandle]]);
    return [block, boxed];
  }

  throw new Error("Unsupported method call: " + method);
}

// --- Helper: extract raw string handle from a NaN-boxed string value ---
function unboxString(block: LLBlock, val: string): string {
  const i64Val = block.bitcastDoubleToI64(val);
  return block.and(I64, i64Val, "281474976710655"); // POINTER_MASK = 0x0000_FFFF_FFFF_FFFF
}

// --- Closure ---

function compileClosure(ctx: CompilerContext, block: LLBlock, expr: ClosureExpr): [LLBlock, string] {
  const funcName = ctx.getFuncName(expr.funcId);
  const captureCount = expr.captures.length;

  // Allocate closure: js_closure_alloc(func_ptr, capture_count)
  const closurePtr = block.call(PTR, "js_closure_alloc", [[PTR, "@" + funcName], [I32, captureCount.toString()]]);

  // Set captures
  for (let i = 0; i < captureCount; i = i + 1) {
    const capResult = compileExpr(ctx, block, expr.captures[i]);
    block = capResult[0];
    const capVal = capResult[1];
    block.callVoid("js_closure_set_capture_f64", [[PTR, closurePtr], [I32, i.toString()], [DOUBLE, capVal]]);
  }

  // NaN-box the closure pointer
  const boxed = boxPointer(block, closurePtr);
  return [block, boxed];
}

function compileCaptureGet(ctx: CompilerContext, block: LLBlock, expr: CaptureGetExpr): [LLBlock, string] {
  // Load closure pointer from the first param (closurePtrLocalId)
  const closurePtrSlot = ctx.getLocal(expr.closurePtrLocalId);
  const closurePtrBoxed = block.load(DOUBLE, closurePtrSlot);
  // The closure ptr param is passed as double (NaN-boxed pointer), but js_closure_get_capture_f64 needs raw ptr
  const closurePtr = unboxPointer(block, closurePtrBoxed);
  // Read the capture
  const result = block.call(DOUBLE, "js_closure_get_capture_f64", [[PTR, closurePtr], [I32, expr.captureIndex.toString()]]);
  return [block, result];
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

  // For string concat when at least one operand is a string
  if ((isString(expr.left.ty) || isString(expr.right.ty)) && expr.op === BinaryOp.Add) {
    // Convert both to string handles, then concat
    let leftHandle: string;
    let rightHandle: string;
    if (isString(expr.left.ty)) {
      const li = block.bitcastDoubleToI64(left);
      leftHandle = block.and(I64, li, "281474976710655"); // POINTER_MASK
    } else {
      leftHandle = block.call(I64, "js_jsvalue_to_string", [[DOUBLE, left]]);
    }
    if (isString(expr.right.ty)) {
      const ri = block.bitcastDoubleToI64(right);
      rightHandle = block.and(I64, ri, "281474976710655");
    } else {
      rightHandle = block.call(I64, "js_jsvalue_to_string", [[DOUBLE, right]]);
    }
    const resultPtr = block.call(I64, "js_string_concat", [[I64, leftHandle], [I64, rightHandle]]);
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
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
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
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
    const selected = block.select(I1, cmpResult, DOUBLE, trueVal, falseVal);
    return [block, selected];
  }

  // Dynamic comparison via runtime
  if (expr.op === CompareOp.Eq || expr.op === CompareOp.StrictEq) {
    const eqResult = block.call(I32, "js_jsvalue_equals", [[DOUBLE, left], [DOUBLE, right]]);
    const isTrue = block.icmpNe(I32, eqResult, "0");
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
    return [block, block.select(I1, isTrue, DOUBLE, trueVal, falseVal)];
  }
  if (expr.op === CompareOp.Ne || expr.op === CompareOp.StrictNe) {
    const eqResult = block.call(I32, "js_jsvalue_equals", [[DOUBLE, left], [DOUBLE, right]]);
    const isFalse = block.icmpEq(I32, eqResult, "0");
    const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
    const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
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
  const trueVal = block.bitcastI64ToDouble(TAG_TRUE_I64);
  const falseVal = block.bitcastI64ToDouble(TAG_FALSE_I64);
  return [block, block.select(I1, cond, DOUBLE, trueVal, falseVal)];
}

function compileLogical(ctx: CompilerContext, block: LLBlock, expr: LogicalExpr): [LLBlock, string] {
  // Short-circuit evaluation using blocks
  const leftResult = compileExpr(ctx, block, expr.left);
  block = leftResult[0];
  const leftVal = leftResult[1];

  const truthy = block.call(I32, "js_is_truthy", [[DOUBLE, leftVal]]);
  const isTruthy = block.icmpNe(I32, truthy, "0");

  const rightBlock: LLBlock = ctx.createBlock("logical.right");
  const mergeBlock: LLBlock = ctx.createBlock("logical.merge");

  if (expr.op === LogicalOp.And) {
    block.condBr(isTruthy, rightBlock.label, mergeBlock.label);
  } else {
    block.condBr(isTruthy, mergeBlock.label, rightBlock.label);
  }

  const rightResult = compileExpr(ctx, rightBlock, expr.right);
  const rightFinalBlock: LLBlock = rightResult[0] as LLBlock;
  const rightVal: string = rightResult[1] as string;
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
    const funcRef: FuncRefExpr = expr.callee as FuncRefExpr;

    // Handle $map_alloc pseudo-function
    if (funcRef.name === "$map_alloc") {
      const mapPtr = block.call(PTR, "js_map_alloc", [[I32, "0"]]);
      return [block, boxPointer(block, mapPtr)];
    }

    // Handle $object_alloc_N pseudo-function (class constructor object allocation)
    if (funcRef.name.startsWith("$object_alloc_")) {
      const fieldCount = funcRef.name.substring(14);  // extract N from "$object_alloc_N"
      const objPtr = block.call(PTR, "js_object_alloc", [[I32, "0"], [I32, fieldCount]]);
      return [block, boxPointer(block, objPtr)];
    }

    // Handle String.fromCharCode(code) -> NaN-boxed string
    if (funcRef.name === "js_string_from_char_code") {
      const codeI32 = block.fptosi(DOUBLE, argVals[0][0], I32);
      const strPtr = block.call(PTR, "js_string_from_char_code", [[I32, codeI32]]);
      const strI64 = block.ptrtoint(strPtr, I64);
      const boxed = block.call(DOUBLE, "js_nanbox_string", [[I64, strI64]]);
      return [block, boxed];
    }

    const funcInfo = ctx.getFuncInfo(funcRef.funcId);
    const funcName = funcInfo !== null ? funcInfo.name : funcRef.name;
    const args: Array<[string, string]> = [];
    for (let i = 0; i < argVals.length; i = i + 1) {
      args.push([DOUBLE, argVals[i][0]]);
    }

    // If this is an external/imported function (no HIR info), ensure it's declared
    if (funcInfo === null) {
      ctx.ensureExternalDeclared(funcName, argVals.length);
    }

    const retType = funcRef.ty;
    const isVoidReturn = (funcInfo !== null && (funcInfo.returnType.kind === TypeKind.Void || funcInfo.returnType.kind === TypeKind.Undefined))
      || (retType.kind === TypeKind.Function && ((retType as FunctionType).returnType.kind === TypeKind.Void || (retType as FunctionType).returnType.kind === TypeKind.Undefined))
      || isVoidRuntimeFunction(funcName);
    if (isVoidReturn) {
      block.callVoid(funcName, args);
      const undef = block.bitcastI64ToDouble(TAG_UNDEFINED_I64);
      return [block, undef];
    }
    const result = block.call(DOUBLE, funcName, args);
    return [block, result];
  }

  // Dynamic call - callee is a closure stored in a variable
  const calleeResult = compileExpr(ctx, block, expr.callee);
  block = calleeResult[0];
  const calleeVal = calleeResult[1];

  // Unbox the closure pointer
  const closurePtr = unboxPointer(block, calleeVal);

  // Build args: closure_ptr, then user args
  const closureArgs: Array<[string, string]> = [[PTR, closurePtr]];
  for (let i = 0; i < argVals.length; i = i + 1) {
    closureArgs.push([DOUBLE, argVals[i][0]]);
  }

  // Call js_closure_callN based on argument count
  const argCount = argVals.length;
  const closureCallName = "js_closure_call" + argCount;
  const result = block.call(DOUBLE, closureCallName, closureArgs);
  return [block, result];
}

function compileIfExpr(ctx: CompilerContext, block: LLBlock, expr: IfExpr): [LLBlock, string] {
  const condResult = compileExpr(ctx, block, expr.condition);
  block = condResult[0];
  const condVal = condResult[1];

  let cond: string;
  if (isBoolean(expr.condition.ty)) {
    const condI64 = block.bitcastDoubleToI64(condVal);
    cond = block.icmpEq(I64, condI64, TAG_TRUE_I64);
  } else if (isNumber(expr.condition.ty)) {
    cond = block.fcmp("one", condVal, "0.0");
  } else {
    const truthy = block.call(I32, "js_is_truthy", [[DOUBLE, condVal]]);
    cond = block.icmpNe(I32, truthy, "0");
  }

  const thenBlock: LLBlock = ctx.createBlock("if.then");
  const elseBlock: LLBlock = ctx.createBlock("if.else");
  const mergeBlock: LLBlock = ctx.createBlock("if.merge");

  block.condBr(cond, thenBlock.label, elseBlock.label);

  const thenResult = compileExpr(ctx, thenBlock, expr.thenExpr);
  const thenFinal: LLBlock = thenResult[0] as LLBlock;
  const thenVal: string = thenResult[1] as string;
  if (!thenFinal.isTerminated()) {
    thenFinal.br(mergeBlock.label);
  }

  const elseResult = compileExpr(ctx, elseBlock, expr.elseExpr);
  const elseFinal: LLBlock = elseResult[0] as LLBlock;
  const elseVal: string = elseResult[1] as string;
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
