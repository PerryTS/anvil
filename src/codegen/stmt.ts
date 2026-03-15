// Statement compilation: HIR Stmt -> LLVM IR blocks

import {
  Stmt, StmtKind, Expr, ExprKind,
  ExprStmt, LetStmt, ReturnStmt, IfStmt, WhileStmt, ForStmt,
  BreakStmt, ContinueStmt, BlockStmt, TryCatchStmt,
} from "../hir/ir";
import { TypeKind, isNumber, isBoolean } from "../hir/types";
import { LLBlock } from "../llvm/block";
const DOUBLE: string = "double";
const I64: string = "i64";
const I32: string = "i32";
const I1: string = "i1";
import { i64Literal, doubleLiteral, TAG_UNDEFINED_I64, TAG_TRUE_I64 } from "./nanbox";
const TAG_UNDEFINED = 0x7FFC_0000_0000_0001n;
const TAG_TRUE = 0x7FFC_0000_0000_0004n;
import { CompilerContext } from "./compiler";
import { compileExpr } from "./expr";

// Compile a statement, returns the current block (may change due to control flow)
export function compileStmt(ctx: CompilerContext, block: LLBlock, stmt: Stmt): LLBlock {
  if (stmt.kind === StmtKind.Expr) {
    const s: ExprStmt = stmt as ExprStmt;
    const result = compileExpr(ctx, block, s.expr);
    return result[0];
  }

  if (stmt.kind === StmtKind.Let) {
    return compileLet(ctx, block, stmt as LetStmt);
  }

  if (stmt.kind === StmtKind.Return) {
    return compileReturn(ctx, block, stmt as ReturnStmt);
  }

  if (stmt.kind === StmtKind.If) {
    return compileIf(ctx, block, stmt as IfStmt);
  }

  if (stmt.kind === StmtKind.While) {
    return compileWhile(ctx, block, stmt as WhileStmt);
  }

  if (stmt.kind === StmtKind.For) {
    return compileFor(ctx, block, stmt as ForStmt);
  }

  if (stmt.kind === StmtKind.Break) {
    const breakTarget = ctx.getBreakTarget();
    if (breakTarget !== null) {
      block.br(breakTarget);
    }
    return block;
  }

  if (stmt.kind === StmtKind.Continue) {
    const continueTarget = ctx.getContinueTarget();
    if (continueTarget !== null) {
      block.br(continueTarget);
    }
    return block;
  }

  if (stmt.kind === StmtKind.Block) {
    const s: BlockStmt = stmt as BlockStmt;
    for (let i = 0; i < s.stmts.length; i = i + 1) {
      if (block.isTerminated()) {
        break;
      }
      block = compileStmt(ctx, block, s.stmts[i]);
    }
    return block;
  }

  if (stmt.kind === StmtKind.TryCatch) {
    return compileTryCatch(ctx, block, stmt as TryCatchStmt);
  }

  throw new Error("Unsupported stmt kind: " + stmt.kind);
}

function compileLet(ctx: CompilerContext, block: LLBlock, stmt: LetStmt): LLBlock {
  // Allocate stack space for the local variable
  const ptr = block.alloca(DOUBLE);
  ctx.setLocal(stmt.localId, ptr);

  if (stmt.init !== null) {
    const result = compileExpr(ctx, block, stmt.init);
    block = result[0];
    block.store(DOUBLE, result[1], ptr);
  } else {
    // Initialize to undefined
    const undef = block.bitcastI64ToDouble(TAG_UNDEFINED_I64);
    block.store(DOUBLE, undef, ptr);
  }

  return block;
}

function compileReturn(ctx: CompilerContext, block: LLBlock, stmt: ReturnStmt): LLBlock {
  if (stmt.value !== null) {
    const result = compileExpr(ctx, block, stmt.value);
    block = result[0];
    block.ret(DOUBLE, result[1]);
  } else {
    const undef = block.bitcastI64ToDouble(TAG_UNDEFINED_I64);
    block.ret(DOUBLE, undef);
  }
  return block;
}

function compileCondition(ctx: CompilerContext, block: LLBlock, condExpr: Expr): [LLBlock, string] {
  const result = compileExpr(ctx, block, condExpr);
  block = result[0];
  const condVal = result[1];

  if (isBoolean(condExpr.ty)) {
    const condI64 = block.bitcastDoubleToI64(condVal);
    const cond = block.icmpEq(I64, condI64, TAG_TRUE_I64);
    return [block, cond];
  }
  if (isNumber(condExpr.ty)) {
    const cond = block.fcmp("one", condVal, "0.0");
    return [block, cond];
  }
  // Dynamic truthiness
  const truthy = block.call(I32, "js_is_truthy", [[DOUBLE, condVal]]);
  const cond = block.icmpNe(I32, truthy, "0");
  return [block, cond];
}

function compileIf(ctx: CompilerContext, block: LLBlock, stmt: IfStmt): LLBlock {
  const condResult = compileCondition(ctx, block, stmt.condition);
  block = condResult[0];
  const cond = condResult[1];

  const thenBlock: LLBlock = ctx.createBlock("if.then");
  const mergeBlock: LLBlock = ctx.createBlock("if.merge");

  if (stmt.elseBody.length > 0) {
    const elseBlock: LLBlock = ctx.createBlock("if.else");
    block.condBr(cond, thenBlock.label, elseBlock.label);

    // Compile then body
    let thenCurrent: LLBlock = thenBlock;
    for (let i = 0; i < stmt.thenBody.length; i = i + 1) {
      if (thenCurrent.isTerminated()) break;
      thenCurrent = compileStmt(ctx, thenCurrent, stmt.thenBody[i]);
    }
    if (!thenCurrent.isTerminated()) {
      thenCurrent.br(mergeBlock.label);
    }

    // Compile else body
    let elseCurrent: LLBlock = elseBlock;
    for (let i = 0; i < stmt.elseBody.length; i = i + 1) {
      if (elseCurrent.isTerminated()) break;
      elseCurrent = compileStmt(ctx, elseCurrent, stmt.elseBody[i]);
    }
    if (!elseCurrent.isTerminated()) {
      elseCurrent.br(mergeBlock.label);
    }
  } else {
    block.condBr(cond, thenBlock.label, mergeBlock.label);

    let thenCurrent: LLBlock = thenBlock;
    for (let i = 0; i < stmt.thenBody.length; i = i + 1) {
      if (thenCurrent.isTerminated()) break;
      thenCurrent = compileStmt(ctx, thenCurrent, stmt.thenBody[i]);
    }
    if (!thenCurrent.isTerminated()) {
      thenCurrent.br(mergeBlock.label);
    }
  }

  return mergeBlock;
}

function compileWhile(ctx: CompilerContext, block: LLBlock, stmt: WhileStmt): LLBlock {
  const condBlock: LLBlock = ctx.createBlock("while.cond");
  const bodyBlock: LLBlock = ctx.createBlock("while.body");
  const exitBlock: LLBlock = ctx.createBlock("while.exit");

  block.br(condBlock.label);

  // Compile condition
  const condResult = compileCondition(ctx, condBlock, stmt.condition);
  const condFinal: LLBlock = condResult[0] as LLBlock;
  const cond: string = condResult[1] as string;
  condFinal.condBr(cond, bodyBlock.label, exitBlock.label);

  // Compile body with break/continue targets
  ctx.pushLoop(exitBlock.label, condBlock.label);
  let bodyCurrent: LLBlock = bodyBlock;
  for (let i = 0; i < stmt.body.length; i = i + 1) {
    if (bodyCurrent.isTerminated()) break;
    bodyCurrent = compileStmt(ctx, bodyCurrent, stmt.body[i]);
  }
  if (!bodyCurrent.isTerminated()) {
    bodyCurrent.br(condBlock.label);
  }
  ctx.popLoop();

  return exitBlock;
}

function compileFor(ctx: CompilerContext, block: LLBlock, stmt: ForStmt): LLBlock {
  // Compile init
  if (stmt.init !== null) {
    block = compileStmt(ctx, block, stmt.init);
  }

  const condBlock: LLBlock = ctx.createBlock("for.cond");
  const bodyBlock: LLBlock = ctx.createBlock("for.body");
  const updateBlock: LLBlock = ctx.createBlock("for.update");
  const exitBlock: LLBlock = ctx.createBlock("for.exit");

  if (!block.isTerminated()) {
    block.br(condBlock.label);
  }

  // Compile condition
  if (stmt.condition !== null) {
    const condResult = compileCondition(ctx, condBlock, stmt.condition);
    const condFinal: LLBlock = condResult[0] as LLBlock;
    const cond: string = condResult[1] as string;
    condFinal.condBr(cond, bodyBlock.label, exitBlock.label);
  } else {
    condBlock.br(bodyBlock.label);
  }

  // Compile body
  ctx.pushLoop(exitBlock.label, updateBlock.label);
  let bodyCurrent: LLBlock = bodyBlock;
  for (let i = 0; i < stmt.body.length; i = i + 1) {
    if (bodyCurrent.isTerminated()) break;
    bodyCurrent = compileStmt(ctx, bodyCurrent, stmt.body[i]);
  }
  if (!bodyCurrent.isTerminated()) {
    bodyCurrent.br(updateBlock.label);
  }
  ctx.popLoop();

  // Compile update
  if (stmt.update !== null) {
    const updateResult = compileExpr(ctx, updateBlock, stmt.update);
    const updateFinal: LLBlock = updateResult[0] as LLBlock;
    if (!updateFinal.isTerminated()) {
      updateFinal.br(condBlock.label);
    }
  } else {
    updateBlock.br(condBlock.label);
  }

  return exitBlock;
}

const PTR: string = "ptr";

function compileTryCatch(ctx: CompilerContext, block: LLBlock, stmt: TryCatchStmt): LLBlock {
  // 1. Push a try frame and get the jmp_buf pointer
  const jmpbufPtr = block.call(PTR, "js_try_push", []);

  // 2. Call setjmp(jmpbuf) - returns 0 normally, non-zero on exception
  const setjmpResult = block.call(I32, "setjmp", [[PTR, jmpbufPtr]]);
  const isException = block.icmpNe(I32, setjmpResult, "0");

  const tryBlock: LLBlock = ctx.createBlock("try.body");
  const catchBlock: LLBlock = ctx.createBlock("try.catch");
  const mergeBlock: LLBlock = ctx.createBlock("try.merge");

  block.condBr(isException, catchBlock.label, tryBlock.label);

  // 3. Compile try body
  let tryCurrent: LLBlock = tryBlock;
  for (let i = 0; i < stmt.tryBody.length; i = i + 1) {
    if (tryCurrent.isTerminated()) break;
    tryCurrent = compileStmt(ctx, tryCurrent, stmt.tryBody[i]);
  }
  // End the try block
  if (!tryCurrent.isTerminated()) {
    tryCurrent.callVoid("js_try_end", []);
  }

  // 4. Handle finally for try path (if present)
  if (stmt.finallyBody.length > 0 && !tryCurrent.isTerminated()) {
    tryCurrent.callVoid("js_enter_finally", []);
    for (let i = 0; i < stmt.finallyBody.length; i = i + 1) {
      if (tryCurrent.isTerminated()) break;
      tryCurrent = compileStmt(ctx, tryCurrent, stmt.finallyBody[i]);
    }
    if (!tryCurrent.isTerminated()) {
      tryCurrent.callVoid("js_leave_finally", []);
    }
  }
  if (!tryCurrent.isTerminated()) {
    tryCurrent.br(mergeBlock.label);
  }

  // 5. Compile catch body
  let catchCurrent: LLBlock = catchBlock;
  // End the try frame
  catchCurrent.callVoid("js_try_end", []);

  if (stmt.catchParam >= 0) {
    // Get exception value and store to catch param local
    const excVal = catchCurrent.call(DOUBLE, "js_get_exception", []);
    const catchPtr = catchCurrent.alloca(DOUBLE);
    ctx.setLocal(stmt.catchParam, catchPtr);
    catchCurrent.store(DOUBLE, excVal, catchPtr);
  }
  catchCurrent.callVoid("js_clear_exception", []);

  for (let i = 0; i < stmt.catchBody.length; i = i + 1) {
    if (catchCurrent.isTerminated()) break;
    catchCurrent = compileStmt(ctx, catchCurrent, stmt.catchBody[i]);
  }

  // 6. Handle finally for catch path (if present)
  if (stmt.finallyBody.length > 0 && !catchCurrent.isTerminated()) {
    catchCurrent.callVoid("js_enter_finally", []);
    for (let i = 0; i < stmt.finallyBody.length; i = i + 1) {
      if (catchCurrent.isTerminated()) break;
      catchCurrent = compileStmt(ctx, catchCurrent, stmt.finallyBody[i]);
    }
    if (!catchCurrent.isTerminated()) {
      catchCurrent.callVoid("js_leave_finally", []);
    }
  }
  if (!catchCurrent.isTerminated()) {
    catchCurrent.br(mergeBlock.label);
  }

  return mergeBlock;
}
