// AST -> HIR lowering
// Converts parsed AST nodes into HIR (High-level IR) for codegen

import {
  SourceFile, AstStmt, AstStmtKind, AstExpr, AstExprKind,
  TypeNode, TypeNodeKind, ParamDecl,
  ExprStmtAst, VarDeclAst, FunctionDeclAst, ReturnStmtAst,
  IfStmtAst, WhileStmtAst, ForStmtAst, DoWhileStmtAst,
  BreakStmtAst, ContinueStmtAst, BlockStmtAst,
  SwitchStmtAst, ThrowStmtAst, TryCatchStmtAst,
  NumberLitExpr, StringLitExpr, BoolLitExpr,
  IdentifierExpr, BinaryExprAst, UnaryExprAst, UnaryPostfixExprAst,
  CallExprAst, MemberExprAst, IndexExprAst,
  AssignExprAst, CompoundAssignExprAst, ConditionalExprAst,
  ArrowExprAst, ArrayExprAst, ObjectExprAst,
  NewExprAst, TypeAsExprAst, TypeofExprAst,
  ParenExprAst, NamedTypeNode, ArrayTypeNode, GenericTypeNode, UnionTypeNode,
} from "../parser/ast";
import {
  HirModule, HirFunction, Stmt, StmtKind, Expr, ExprKind,
  ExprStmt as HirExprStmt, LetStmt, ReturnStmt as HirReturnStmt,
  IfStmt as HirIfStmt, WhileStmt as HirWhileStmt, ForStmt as HirForStmt,
  BreakStmt as HirBreakStmt, ContinueStmt as HirContinueStmt,
  BlockStmt as HirBlockStmt,
  NumberExpr, StringExpr, BoolExpr, UndefinedExpr, NullExpr,
  BinaryExpr, BinaryOp, UnaryExpr, UnaryOp,
  CompareExpr, CompareOp, LogicalExpr, LogicalOp,
  LocalGetExpr, LocalSetExpr, CallExpr, FuncRefExpr,
  IfExpr, ArrayExpr, ArrayGetExpr, ArraySetExpr,
  ObjectLitExpr, FieldGetExpr, FieldSetExpr,
} from "../hir/ir";
import {
  Type, TypeKind, NUMBER_TYPE, STRING_TYPE, BOOLEAN_TYPE,
  VOID_TYPE, ANY_TYPE, UNDEFINED_TYPE, NULL_TYPE,
  makeFunctionType, makeArrayType, makeUnionType,
} from "../hir/types";

interface Scope {
  locals: Map<string, number>;     // name -> localId
  localTypes: Map<string, Type>;   // name -> type
  functions: Map<string, number>;  // name -> funcId
  funcReturnTypes: Map<string, Type>;  // name -> return type
  parent: Scope | null;
}

export class Lowerer {
  private nextLocalId: number;
  private nextFuncId: number;
  private functions: Array<HirFunction>;
  private scope: Scope;

  // Well-known runtime function names that map to direct FFI calls
  private runtimeFuncs: Map<string, string>;

  constructor() {
    this.nextLocalId = 0;
    this.nextFuncId = 1;  // 0 is reserved for runtime
    this.functions = [];
    this.scope = { locals: new Map(), localTypes: new Map(), functions: new Map(), funcReturnTypes: new Map(), parent: null };

    // Map known global functions/methods to runtime FFI names
    this.runtimeFuncs = new Map();
  }

  lower(sourceFile: SourceFile): HirModule {
    const stmts: Array<Stmt> = [];

    // First pass: register all top-level function declarations with return types
    for (let i = 0; i < sourceFile.statements.length; i = i + 1) {
      const stmt = sourceFile.statements[i];
      if (stmt.kind === AstStmtKind.FunctionDecl) {
        const funcDecl = stmt as FunctionDeclAst;
        const funcId = this.nextFuncId;
        this.nextFuncId = this.nextFuncId + 1;
        this.scope.functions.set(funcDecl.name, funcId);
        const retType = funcDecl.returnType !== null ? this.resolveType(funcDecl.returnType) : ANY_TYPE;
        this.scope.funcReturnTypes.set(funcDecl.name, retType);
      }
      if (stmt.kind === AstStmtKind.ExportDecl) {
        const exportDecl = stmt as any;
        if (exportDecl.declaration !== null && exportDecl.declaration.kind === AstStmtKind.FunctionDecl) {
          const funcDecl = exportDecl.declaration as FunctionDeclAst;
          const funcId = this.nextFuncId;
          this.nextFuncId = this.nextFuncId + 1;
          this.scope.functions.set(funcDecl.name, funcId);
          const retType = funcDecl.returnType !== null ? this.resolveType(funcDecl.returnType) : ANY_TYPE;
          this.scope.funcReturnTypes.set(funcDecl.name, retType);
        }
      }
    }

    // Second pass: lower all statements
    for (let i = 0; i < sourceFile.statements.length; i = i + 1) {
      const stmt = sourceFile.statements[i];
      // Skip type-only declarations
      if (stmt.kind === AstStmtKind.InterfaceDecl || stmt.kind === AstStmtKind.TypeAliasDecl) {
        continue;
      }
      if (stmt.kind === AstStmtKind.ImportDecl) {
        // TODO: handle imports in Phase 4
        continue;
      }
      if (stmt.kind === AstStmtKind.ExportDecl) {
        const exportDecl = stmt as any;
        if (exportDecl.declaration !== null) {
          const lowered = this.lowerStmt(exportDecl.declaration);
          if (lowered !== null) {
            stmts.push(lowered);
          }
        }
        continue;
      }
      const lowered = this.lowerStmt(stmt);
      if (lowered !== null) {
        stmts.push(lowered);
      }
    }

    return {
      name: sourceFile.fileName,
      functions: this.functions,
      init: stmts,
    };
  }

  // --- Statements ---

  private lowerStmt(stmt: AstStmt): Stmt | null {
    if (stmt.kind === AstStmtKind.VarDecl) {
      return this.lowerVarDecl(stmt as VarDeclAst);
    }
    if (stmt.kind === AstStmtKind.FunctionDecl) {
      this.lowerFunctionDecl(stmt as FunctionDeclAst);
      return null; // functions are hoisted into the functions array
    }
    if (stmt.kind === AstStmtKind.Expr) {
      const exprStmt = stmt as ExprStmtAst;
      return { kind: StmtKind.Expr, expr: this.lowerExpr(exprStmt.expr) } as HirExprStmt;
    }
    if (stmt.kind === AstStmtKind.Return) {
      const ret = stmt as ReturnStmtAst;
      return {
        kind: StmtKind.Return,
        value: ret.value !== null ? this.lowerExpr(ret.value) : null,
      } as HirReturnStmt;
    }
    if (stmt.kind === AstStmtKind.If) {
      return this.lowerIf(stmt as IfStmtAst);
    }
    if (stmt.kind === AstStmtKind.While) {
      const w = stmt as WhileStmtAst;
      return {
        kind: StmtKind.While,
        condition: this.lowerExpr(w.condition),
        body: this.lowerBody(w.body),
      } as HirWhileStmt;
    }
    if (stmt.kind === AstStmtKind.For) {
      return this.lowerFor(stmt as ForStmtAst);
    }
    if (stmt.kind === AstStmtKind.DoWhile) {
      const dw = stmt as DoWhileStmtAst;
      // Lower do..while as: { body; while(cond) { body; } }
      // Simpler: emit the body, then a while loop
      const body = this.lowerBody(dw.body);
      const cond = this.lowerExpr(dw.condition);
      const allStmts: Array<Stmt> = [];
      for (let i = 0; i < body.length; i = i + 1) {
        allStmts.push(body[i]);
      }
      allStmts.push({ kind: StmtKind.While, condition: cond, body: body } as HirWhileStmt);
      return { kind: StmtKind.Block, stmts: allStmts } as HirBlockStmt;
    }
    if (stmt.kind === AstStmtKind.Break) {
      return { kind: StmtKind.Break } as HirBreakStmt;
    }
    if (stmt.kind === AstStmtKind.Continue) {
      return { kind: StmtKind.Continue } as HirContinueStmt;
    }
    if (stmt.kind === AstStmtKind.Block) {
      const block = stmt as BlockStmtAst;
      const stmts: Array<Stmt> = [];
      for (let i = 0; i < block.body.length; i = i + 1) {
        const s = this.lowerStmt(block.body[i]);
        if (s !== null) stmts.push(s);
      }
      return { kind: StmtKind.Block, stmts: stmts } as HirBlockStmt;
    }
    if (stmt.kind === AstStmtKind.Switch) {
      return this.lowerSwitch(stmt as SwitchStmtAst);
    }
    if (stmt.kind === AstStmtKind.Throw) {
      const t = stmt as ThrowStmtAst;
      return { kind: StmtKind.Expr, expr: this.lowerExpr(t.argument) } as HirExprStmt;
      // TODO: emit js_throw call
    }
    if (stmt.kind === AstStmtKind.TryCatch) {
      // TODO: implement try/catch lowering
      const tc = stmt as TryCatchStmtAst;
      const tryStmts: Array<Stmt> = [];
      for (let i = 0; i < tc.tryBody.length; i = i + 1) {
        const s = this.lowerStmt(tc.tryBody[i]);
        if (s !== null) tryStmts.push(s);
      }
      return { kind: StmtKind.Block, stmts: tryStmts } as HirBlockStmt;
    }
    if (stmt.kind === AstStmtKind.Empty) {
      return null;
    }
    if (stmt.kind === AstStmtKind.EnumDecl) {
      // TODO: lower enums
      return null;
    }
    if (stmt.kind === AstStmtKind.ClassDecl) {
      // TODO: lower classes
      return null;
    }
    if (stmt.kind === AstStmtKind.InterfaceDecl || stmt.kind === AstStmtKind.TypeAliasDecl) {
      return null;
    }

    throw new Error("Cannot lower statement kind: " + stmt.kind + " at line " + stmt.line);
  }

  private lowerVarDecl(decl: VarDeclAst): LetStmt {
    const ty = decl.typeAnnotation !== null ? this.resolveType(decl.typeAnnotation) : ANY_TYPE;
    const localId = this.allocLocal(decl.name, ty);
    return {
      kind: StmtKind.Let,
      localId: localId,
      name: decl.name,
      ty: ty,
      init: decl.init !== null ? this.lowerExpr(decl.init) : null,
    };
  }

  private lowerFunctionDecl(decl: FunctionDeclAst): void {
    const funcId = this.scope.functions.get(decl.name);
    if (funcId === undefined) {
      throw new Error("Function not registered: " + decl.name);
    }

    this.pushScope();

    const params: Array<[number, string, Type]> = [];
    for (let i = 0; i < decl.params.length; i = i + 1) {
      const p = decl.params[i];
      const ty = p.typeAnnotation !== null ? this.resolveType(p.typeAnnotation) : ANY_TYPE;
      const localId = this.allocLocal(p.name, ty);
      params.push([localId, p.name, ty]);
    }

    const returnType = decl.returnType !== null ? this.resolveType(decl.returnType) : ANY_TYPE;

    const body: Array<Stmt> = [];
    for (let i = 0; i < decl.body.length; i = i + 1) {
      const s = this.lowerStmt(decl.body[i]);
      if (s !== null) body.push(s);
    }

    this.popScope();

    this.functions.push({
      id: funcId,
      name: decl.name,
      params: params,
      returnType: returnType,
      body: body,
      localCount: params.length,
    });
  }

  private lowerIf(stmt: IfStmtAst): HirIfStmt {
    const condition = this.lowerExpr(stmt.condition);
    const thenBody = this.lowerBody(stmt.consequent);
    let elseBody: Array<Stmt> = [];
    if (stmt.alternate !== null) {
      elseBody = this.lowerBody(stmt.alternate);
    }
    return {
      kind: StmtKind.If,
      condition: condition,
      thenBody: thenBody,
      elseBody: elseBody,
    };
  }

  private lowerFor(stmt: ForStmtAst): HirForStmt {
    let init: Stmt | null = null;
    if (stmt.init !== null) {
      init = this.lowerStmt(stmt.init);
    }
    let condition: Expr | null = null;
    if (stmt.condition !== null) {
      condition = this.lowerExpr(stmt.condition);
    }
    let update: Expr | null = null;
    if (stmt.update !== null) {
      update = this.lowerExpr(stmt.update);
    }
    const body = this.lowerBody(stmt.body);
    return {
      kind: StmtKind.For,
      init: init,
      condition: condition,
      update: update,
      body: body,
    } as HirForStmt;
  }

  private lowerSwitch(stmt: SwitchStmtAst): Stmt {
    // Lower switch as chained if/else
    const disc = this.lowerExpr(stmt.discriminant);
    const discLocal = this.allocLocal("$switch");
    const allStmts: Array<Stmt> = [];
    allStmts.push({
      kind: StmtKind.Let,
      localId: discLocal,
      name: "$switch",
      ty: ANY_TYPE,
      init: disc,
    } as LetStmt);

    // Build chained if/else from cases
    for (let i = 0; i < stmt.cases.length; i = i + 1) {
      const c = stmt.cases[i];
      const body: Array<Stmt> = [];
      for (let j = 0; j < c.body.length; j = j + 1) {
        const s = this.lowerStmt(c.body[j]);
        if (s !== null) body.push(s);
      }
      if (c.test !== null) {
        const test = this.lowerExpr(c.test);
        const cond: CompareExpr = {
          kind: ExprKind.Compare,
          ty: BOOLEAN_TYPE,
          op: CompareOp.StrictEq,
          left: { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: discLocal, name: "$switch" } as LocalGetExpr,
          right: test,
        };
        allStmts.push({ kind: StmtKind.If, condition: cond, thenBody: body, elseBody: [] } as HirIfStmt);
      } else {
        // Default case
        for (let j = 0; j < body.length; j = j + 1) {
          allStmts.push(body[j]);
        }
      }
    }

    return { kind: StmtKind.Block, stmts: allStmts } as HirBlockStmt;
  }

  private lowerBody(stmt: AstStmt): Array<Stmt> {
    if (stmt.kind === AstStmtKind.Block) {
      const block = stmt as BlockStmtAst;
      const stmts: Array<Stmt> = [];
      for (let i = 0; i < block.body.length; i = i + 1) {
        const s = this.lowerStmt(block.body[i]);
        if (s !== null) stmts.push(s);
      }
      return stmts;
    }
    const s = this.lowerStmt(stmt);
    if (s !== null) return [s];
    return [];
  }

  // --- Expressions ---

  private lowerExpr(expr: AstExpr): Expr {
    if (expr.kind === AstExprKind.Number) {
      const e = expr as NumberLitExpr;
      return { kind: ExprKind.Number, ty: NUMBER_TYPE, value: e.value } as NumberExpr;
    }

    if (expr.kind === AstExprKind.String) {
      const e = expr as StringLitExpr;
      return { kind: ExprKind.String, ty: STRING_TYPE, value: e.value } as StringExpr;
    }

    if (expr.kind === AstExprKind.Bool) {
      const e = expr as BoolLitExpr;
      return { kind: ExprKind.Bool, ty: BOOLEAN_TYPE, value: e.value } as BoolExpr;
    }

    if (expr.kind === AstExprKind.Null) {
      return { kind: ExprKind.Null, ty: NULL_TYPE } as NullExpr;
    }

    if (expr.kind === AstExprKind.Undefined) {
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    if (expr.kind === AstExprKind.Identifier) {
      const e = expr as IdentifierExpr;
      return this.lowerIdentifier(e);
    }

    if (expr.kind === AstExprKind.Binary) {
      return this.lowerBinary(expr as BinaryExprAst);
    }

    if (expr.kind === AstExprKind.Unary) {
      return this.lowerUnary(expr as UnaryExprAst);
    }

    if (expr.kind === AstExprKind.UnaryPostfix) {
      return this.lowerPostfix(expr as UnaryPostfixExprAst);
    }

    if (expr.kind === AstExprKind.Call) {
      return this.lowerCall(expr as CallExprAst);
    }

    if (expr.kind === AstExprKind.Member) {
      return this.lowerMember(expr as MemberExprAst);
    }

    if (expr.kind === AstExprKind.Index) {
      return this.lowerIndex(expr as IndexExprAst);
    }

    if (expr.kind === AstExprKind.Assign) {
      return this.lowerAssign(expr as AssignExprAst);
    }

    if (expr.kind === AstExprKind.CompoundAssign) {
      return this.lowerCompoundAssign(expr as CompoundAssignExprAst);
    }

    if (expr.kind === AstExprKind.Conditional) {
      const e = expr as ConditionalExprAst;
      return {
        kind: ExprKind.If,
        ty: ANY_TYPE,
        condition: this.lowerExpr(e.condition),
        thenExpr: this.lowerExpr(e.consequent),
        elseExpr: this.lowerExpr(e.alternate),
      } as IfExpr;
    }

    if (expr.kind === AstExprKind.Array) {
      const e = expr as ArrayExprAst;
      const elements: Array<Expr> = [];
      for (let i = 0; i < e.elements.length; i = i + 1) {
        elements.push(this.lowerExpr(e.elements[i]));
      }
      return { kind: ExprKind.Array, ty: ANY_TYPE, elements: elements } as ArrayExpr;
    }

    if (expr.kind === AstExprKind.Object) {
      const e = expr as ObjectExprAst;
      const fields: Array<[string, Expr]> = [];
      for (let i = 0; i < e.properties.length; i = i + 1) {
        const p = e.properties[i];
        fields.push([p.key, this.lowerExpr(p.value)]);
      }
      return { kind: ExprKind.ObjectLit, ty: ANY_TYPE, fields: fields } as ObjectLitExpr;
    }

    if (expr.kind === AstExprKind.Arrow) {
      // TODO: lower arrow functions to closures
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    if (expr.kind === AstExprKind.New) {
      // TODO: lower new expressions
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    if (expr.kind === AstExprKind.TypeAs) {
      // Type assertion - just lower the expression
      const e = expr as TypeAsExprAst;
      return this.lowerExpr(e.expr);
    }

    if (expr.kind === AstExprKind.Typeof) {
      const e = expr as TypeofExprAst;
      return { kind: ExprKind.Typeof, ty: STRING_TYPE, operand: this.lowerExpr(e.operand) } as any;
    }

    if (expr.kind === AstExprKind.Paren) {
      const e = expr as ParenExprAst;
      return this.lowerExpr(e.expr);
    }

    if (expr.kind === AstExprKind.This) {
      // TODO: handle 'this' in classes
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    if (expr.kind === AstExprKind.Void) {
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    throw new Error("Cannot lower expr kind: " + expr.kind + " at line " + expr.line);
  }

  private lowerIdentifier(expr: IdentifierExpr): Expr {
    // Check if it's a local variable
    const localId = this.lookupLocal(expr.name);
    if (localId !== null) {
      const ty = this.lookupLocalType(expr.name);
      return { kind: ExprKind.LocalGet, ty: ty, localId: localId, name: expr.name } as LocalGetExpr;
    }

    // Check if it's a function reference
    const funcId = this.lookupFunction(expr.name);
    if (funcId !== null) {
      return { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: funcId, name: expr.name } as FuncRefExpr;
    }

    // Unknown identifier - might be a global or will be resolved later
    // For now, treat as an unresolved reference (allocate a local for it)
    const id = this.allocLocal(expr.name);
    return { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: id, name: expr.name } as LocalGetExpr;
  }

  private lowerBinary(expr: BinaryExprAst): Expr {
    const left = this.lowerExpr(expr.left);
    const right = this.lowerExpr(expr.right);

    // Logical operators get their own node type
    if (expr.op === "&&") {
      return { kind: ExprKind.Logical, ty: ANY_TYPE, op: LogicalOp.And, left: left, right: right } as LogicalExpr;
    }
    if (expr.op === "||") {
      return { kind: ExprKind.Logical, ty: ANY_TYPE, op: LogicalOp.Or, left: left, right: right } as LogicalExpr;
    }

    // Comparison operators
    if (expr.op === "==") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Eq, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "!=") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Ne, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "===") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.StrictEq, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "!==") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.StrictNe, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "<") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Lt, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "<=") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Le, left: left, right: right } as CompareExpr;
    }
    if (expr.op === ">") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Gt, left: left, right: right } as CompareExpr;
    }
    if (expr.op === ">=") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Ge, left: left, right: right } as CompareExpr;
    }

    // Arithmetic operators
    let op: BinaryOp;
    if (expr.op === "+") { op = BinaryOp.Add; }
    else if (expr.op === "-") { op = BinaryOp.Sub; }
    else if (expr.op === "*") { op = BinaryOp.Mul; }
    else if (expr.op === "/") { op = BinaryOp.Div; }
    else if (expr.op === "%") { op = BinaryOp.Mod; }
    else if (expr.op === "&") { op = BinaryOp.BitAnd; }
    else if (expr.op === "|") { op = BinaryOp.BitOr; }
    else if (expr.op === "^") { op = BinaryOp.BitXor; }
    else if (expr.op === "<<") { op = BinaryOp.Shl; }
    else if (expr.op === ">>") { op = BinaryOp.Shr; }
    else if (expr.op === ">>>") { op = BinaryOp.UShr; }
    else if (expr.op === "**") {
      // Exponentiation: use Math.pow
      // TODO: emit runtime call
      op = BinaryOp.Mul; // placeholder
    }
    else {
      throw new Error("Unknown binary operator: " + expr.op);
    }

    // Infer result type from operand types
    let ty: Type = ANY_TYPE;
    if (left.ty.kind === TypeKind.Number && right.ty.kind === TypeKind.Number) {
      ty = NUMBER_TYPE;
    } else if (left.ty.kind === TypeKind.String && right.ty.kind === TypeKind.String && op === BinaryOp.Add) {
      ty = STRING_TYPE;
    } else if ((left.ty.kind === TypeKind.String || right.ty.kind === TypeKind.String) && op === BinaryOp.Add) {
      ty = STRING_TYPE;
    }

    return { kind: ExprKind.Binary, ty: ty, op: op, left: left, right: right } as BinaryExpr;
  }

  private lowerUnary(expr: UnaryExprAst): Expr {
    const operand = this.lowerExpr(expr.operand);
    let op: UnaryOp;
    if (expr.op === "-") { op = UnaryOp.Neg; }
    else if (expr.op === "!") { op = UnaryOp.Not; }
    else if (expr.op === "~") { op = UnaryOp.BitNot; }
    else if (expr.op === "+") { op = UnaryOp.Plus; }
    else if (expr.op === "++" || expr.op === "--") {
      // Pre-increment/decrement: lower to assignment
      return this.lowerPreIncDec(expr);
    }
    else {
      throw new Error("Unknown unary operator: " + expr.op);
    }
    return { kind: ExprKind.Unary, ty: operand.ty, op: op, operand: operand } as UnaryExpr;
  }

  private lowerPreIncDec(expr: UnaryExprAst): Expr {
    // ++x => x = x + 1
    const operand = expr.operand;
    if (operand.kind === AstExprKind.Identifier) {
      const ident = operand as IdentifierExpr;
      const localId = this.lookupLocal(ident.name);
      if (localId !== null) {
        const one: NumberExpr = { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 };
        const get: LocalGetExpr = { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: localId, name: ident.name };
        const binOp = expr.op === "++" ? BinaryOp.Add : BinaryOp.Sub;
        const add: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: binOp, left: get, right: one };
        return { kind: ExprKind.LocalSet, ty: NUMBER_TYPE, localId: localId, name: ident.name, value: add } as LocalSetExpr;
      }
    }
    // Fallback: just return the operand
    return this.lowerExpr(expr.operand);
  }

  private lowerPostfix(expr: UnaryPostfixExprAst): Expr {
    // x++ => (tmp = x, x = x + 1, tmp) -- simplified to just x = x + 1
    return this.lowerPreIncDec({ kind: AstExprKind.Unary, line: expr.line, col: expr.col, op: expr.op, operand: expr.operand } as UnaryExprAst);
  }

  private lowerCall(expr: CallExprAst): Expr {
    // Special case: console.log(x) -> js_console_log_dynamic(x) or js_console_log_number(x)
    if (expr.callee.kind === AstExprKind.Member) {
      const member = expr.callee as MemberExprAst;
      if (member.object.kind === AstExprKind.Identifier) {
        const obj = member.object as IdentifierExpr;
        const runtimeName = this.resolveBuiltinCall(obj.name, member.property, expr.args.length);
        if (runtimeName !== null) {
          const args: Array<Expr> = [];
          for (let i = 0; i < expr.args.length; i = i + 1) {
            args.push(this.lowerExpr(expr.args[i]));
          }
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: runtimeName } as FuncRefExpr,
            args: args,
          } as CallExpr;
        }
      }
    }

    // Regular function call
    const callee = this.lowerExpr(expr.callee);
    const args: Array<Expr> = [];
    for (let i = 0; i < expr.args.length; i = i + 1) {
      args.push(this.lowerExpr(expr.args[i]));
    }

    // Infer return type from the callee
    let callRetType: Type = ANY_TYPE;
    if (expr.callee.kind === AstExprKind.Identifier) {
      const name = (expr.callee as IdentifierExpr).name;
      callRetType = this.lookupFuncReturnType(name);
    }

    return { kind: ExprKind.Call, ty: callRetType, callee: callee, args: args } as CallExpr;
  }

  private resolveBuiltinCall(objName: string, methodName: string, argCount: number): string | null {
    if (objName === "console" && methodName === "log") {
      return "js_console_log_dynamic";
    }
    if (objName === "console" && methodName === "error") {
      return "js_console_error_dynamic";
    }
    if (objName === "console" && methodName === "warn") {
      return "js_console_warn_dynamic";
    }
    if (objName === "Math") {
      if (methodName === "floor") return "js_math_floor";
      if (methodName === "ceil") return "js_math_ceil";
      if (methodName === "round") return "js_math_round";
      if (methodName === "abs") return "js_math_abs";
      if (methodName === "sqrt") return "js_math_sqrt";
      if (methodName === "pow") return "js_math_pow";
      if (methodName === "min") return "js_math_min";
      if (methodName === "max") return "js_math_max";
      if (methodName === "random") return "js_math_random";
      if (methodName === "log") return "js_math_log";
    }
    if (objName === "process" && methodName === "exit") {
      return "js_process_exit";
    }
    return null;
  }

  private lowerMember(expr: MemberExprAst): Expr {
    const obj = this.lowerExpr(expr.object);
    // Property access -> field get with compile-time field index
    // For now, use a placeholder field index of 0
    return {
      kind: ExprKind.FieldGet,
      ty: ANY_TYPE,
      object: obj,
      field: expr.property,
      fieldIndex: 0,
    } as FieldGetExpr;
  }

  private lowerIndex(expr: IndexExprAst): Expr {
    const obj = this.lowerExpr(expr.object);
    const index = this.lowerExpr(expr.index);
    return { kind: ExprKind.ArrayGet, ty: ANY_TYPE, array: obj, index: index } as ArrayGetExpr;
  }

  private lowerAssign(expr: AssignExprAst): Expr {
    const value = this.lowerExpr(expr.value);

    // Simple local assignment: x = expr
    if (expr.target.kind === AstExprKind.Identifier) {
      const ident = expr.target as IdentifierExpr;
      const localId = this.lookupLocal(ident.name);
      if (localId !== null) {
        return { kind: ExprKind.LocalSet, ty: value.ty, localId: localId, name: ident.name, value: value } as LocalSetExpr;
      }
      // Create new local
      const newId = this.allocLocal(ident.name);
      return { kind: ExprKind.LocalSet, ty: value.ty, localId: newId, name: ident.name, value: value } as LocalSetExpr;
    }

    // Member assignment: obj.prop = expr
    if (expr.target.kind === AstExprKind.Member) {
      const member = expr.target as MemberExprAst;
      const obj = this.lowerExpr(member.object);
      return {
        kind: ExprKind.FieldSet,
        ty: value.ty,
        object: obj,
        field: member.property,
        fieldIndex: 0,
        value: value,
      } as FieldSetExpr;
    }

    // Index assignment: arr[i] = expr
    if (expr.target.kind === AstExprKind.Index) {
      const idx = expr.target as IndexExprAst;
      const arr = this.lowerExpr(idx.object);
      const index = this.lowerExpr(idx.index);
      return {
        kind: ExprKind.ArraySet,
        ty: value.ty,
        array: arr,
        index: index,
        value: value,
      } as ArraySetExpr;
    }

    throw new Error("Cannot assign to expression kind: " + expr.target.kind);
  }

  private lowerCompoundAssign(expr: CompoundAssignExprAst): Expr {
    // x += y => x = x + y
    let binOp: string;
    if (expr.op === "+=") binOp = "+";
    else if (expr.op === "-=") binOp = "-";
    else if (expr.op === "*=") binOp = "*";
    else if (expr.op === "/=") binOp = "/";
    else if (expr.op === "%=") binOp = "%";
    else if (expr.op === "&=") binOp = "&";
    else if (expr.op === "|=") binOp = "|";
    else if (expr.op === "^=") binOp = "^";
    else {
      throw new Error("Unknown compound assignment: " + expr.op);
    }

    const binExpr: BinaryExprAst = {
      kind: AstExprKind.Binary,
      line: expr.line,
      col: expr.col,
      op: binOp,
      left: expr.target,
      right: expr.value,
    };

    const assignExpr: AssignExprAst = {
      kind: AstExprKind.Assign,
      line: expr.line,
      col: expr.col,
      target: expr.target,
      value: binExpr,
    };

    return this.lowerAssign(assignExpr);
  }

  // --- Type resolution ---

  private resolveType(node: TypeNode): Type {
    if (node.kind === TypeNodeKind.Named) {
      const named = node as NamedTypeNode;
      if (named.name === "number") return NUMBER_TYPE;
      if (named.name === "string") return STRING_TYPE;
      if (named.name === "boolean") return BOOLEAN_TYPE;
      if (named.name === "void") return VOID_TYPE;
      if (named.name === "undefined") return UNDEFINED_TYPE;
      if (named.name === "null") return NULL_TYPE;
      if (named.name === "any") return ANY_TYPE;
      if (named.name === "never") return { kind: TypeKind.Never };
      // Unknown named type -> treat as any
      return ANY_TYPE;
    }
    if (node.kind === TypeNodeKind.Array) {
      const arr = node as ArrayTypeNode;
      return makeArrayType(this.resolveType(arr.elementType));
    }
    if (node.kind === TypeNodeKind.Generic) {
      const gen = node as GenericTypeNode;
      if (gen.name === "Array" && gen.typeArgs.length === 1) {
        return makeArrayType(this.resolveType(gen.typeArgs[0]));
      }
      if (gen.name === "Map") {
        return ANY_TYPE; // Maps are handled via runtime
      }
      return ANY_TYPE;
    }
    if (node.kind === TypeNodeKind.Union) {
      const union = node as UnionTypeNode;
      const members: Array<Type> = [];
      for (let i = 0; i < union.members.length; i = i + 1) {
        members.push(this.resolveType(union.members[i]));
      }
      return makeUnionType(members);
    }
    if (node.kind === TypeNodeKind.Function) {
      return ANY_TYPE; // Function types are complex, treat as any for now
    }
    return ANY_TYPE;
  }

  // --- Scope management ---

  private pushScope(): void {
    this.scope = { locals: new Map(), localTypes: new Map(), functions: new Map(), funcReturnTypes: new Map(), parent: this.scope };
  }

  private lookupFuncReturnType(name: string): Type {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const ty = scope.funcReturnTypes.get(name);
      if (ty !== undefined) return ty;
      scope = scope.parent;
    }
    return ANY_TYPE;
  }

  private popScope(): void {
    if (this.scope.parent !== null) {
      this.scope = this.scope.parent;
    }
  }

  private allocLocal(name: string, ty: Type = ANY_TYPE): number {
    const id = this.nextLocalId;
    this.nextLocalId = this.nextLocalId + 1;
    this.scope.locals.set(name, id);
    this.scope.localTypes.set(name, ty);
    return id;
  }

  private lookupLocal(name: string): number | null {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const id = scope.locals.get(name);
      if (id !== undefined) return id;
      scope = scope.parent;
    }
    return null;
  }

  private lookupLocalType(name: string): Type {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const ty = scope.localTypes.get(name);
      if (ty !== undefined) return ty;
      scope = scope.parent;
    }
    return ANY_TYPE;
  }

  private lookupFunction(name: string): number | null {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const id = scope.functions.get(name);
      if (id !== undefined) return id;
      scope = scope.parent;
    }
    return null;
  }
}
