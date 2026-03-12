// Statement compilation: HIR Stmt -> LLVM IR blocks

import {
  Stmt, StmtKind, Expr, ExprKind,
  ExprStmt, LetStmt, ReturnStmt, IfStmt, WhileStmt, ForStmt,
  BreakStmt, ContinueStmt, BlockStmt,
} from "../hir/ir";
import { TypeKind, isNumber, isBoolean } from "../hir/types";
import { LLBlock } from "../llvm/block";
import { DOUBLE, I64, I32, I1 } from "../llvm/types";
import { TAG_UNDEFINED, TAG_TRUE, i64Literal, doubleLiteral } from "./nanbox";
import { CompilerContext } from "./compiler";
import { compileExpr } from "./expr";

// Compile a statement, returns the current block (may change due to control flow)
export function compileStmt(ctx: CompilerContext, block: LLBlock, stmt: Stmt): LLBlock {
  if (stmt.kind === StmtKind.Expr) {
    const s = stmt as ExprStmt;
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
    const s = stmt as BlockStmt;
    for (let i = 0; i < s.stmts.length; i = i + 1) {
      if (block.isTerminated()) {
        break;
      }
      block = compileStmt(ctx, block, s.stmts[i]);
    }
    return block;
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
    const undef = block.bitcastI64ToDouble(i64Literal(TAG_UNDEFINED));
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
    const undef = block.bitcastI64ToDouble(i64Literal(TAG_UNDEFINED));
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
    const cond = block.icmpEq(I64, condI64, i64Literal(TAG_TRUE));
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

  const thenBlock = ctx.createBlock("if.then");
  const mergeBlock = ctx.createBlock("if.merge");

  if (stmt.elseBody.length > 0) {
    const elseBlock = ctx.createBlock("if.else");
    block.condBr(cond, thenBlock.label, elseBlock.label);

    // Compile then body
    let thenCurrent = thenBlock;
    for (let i = 0; i < stmt.thenBody.length; i = i + 1) {
      if (thenCurrent.isTerminated()) break;
      thenCurrent = compileStmt(ctx, thenCurrent, stmt.thenBody[i]);
    }
    if (!thenCurrent.isTerminated()) {
      thenCurrent.br(mergeBlock.label);
    }

    // Compile else body
    let elseCurrent = elseBlock;
    for (let i = 0; i < stmt.elseBody.length; i = i + 1) {
      if (elseCurrent.isTerminated()) break;
      elseCurrent = compileStmt(ctx, elseCurrent, stmt.elseBody[i]);
    }
    if (!elseCurrent.isTerminated()) {
      elseCurrent.br(mergeBlock.label);
    }
  } else {
    block.condBr(cond, thenBlock.label, mergeBlock.label);

    let thenCurrent = thenBlock;
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
  const condBlock = ctx.createBlock("while.cond");
  const bodyBlock = ctx.createBlock("while.body");
  const exitBlock = ctx.createBlock("while.exit");

  block.br(condBlock.label);

  // Compile condition
  const condResult = compileCondition(ctx, condBlock, stmt.condition);
  const condFinal = condResult[0];
  const cond = condResult[1];
  condFinal.condBr(cond, bodyBlock.label, exitBlock.label);

  // Compile body with break/continue targets
  ctx.pushLoop(exitBlock.label, condBlock.label);
  let bodyCurrent = bodyBlock;
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

  const condBlock = ctx.createBlock("for.cond");
  const bodyBlock = ctx.createBlock("for.body");
  const updateBlock = ctx.createBlock("for.update");
  const exitBlock = ctx.createBlock("for.exit");

  if (!block.isTerminated()) {
    block.br(condBlock.label);
  }

  // Compile condition
  if (stmt.condition !== null) {
    const condResult = compileCondition(ctx, condBlock, stmt.condition);
    const condFinal = condResult[0];
    const cond = condResult[1];
    condFinal.condBr(cond, bodyBlock.label, exitBlock.label);
  } else {
    condBlock.br(bodyBlock.label);
  }

  // Compile body
  ctx.pushLoop(exitBlock.label, updateBlock.label);
  let bodyCurrent = bodyBlock;
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
    const updateFinal = updateResult[0];
    if (!updateFinal.isTerminated()) {
      updateFinal.br(condBlock.label);
    }
  } else {
    updateBlock.br(condBlock.label);
  }

  return exitBlock;
}
