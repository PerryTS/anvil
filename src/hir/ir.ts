// HIR node types (mirrors perry-hir/ir.rs)

import { Type } from "./types";

// --- Expressions ---

export const enum ExprKind {
  Number = 0,
  String = 1,
  Bool = 2,
  Undefined = 3,
  Null = 4,
  Binary = 5,
  Unary = 6,
  Compare = 7,
  Logical = 8,
  LocalGet = 9,
  LocalSet = 10,
  Call = 11,
  FuncRef = 12,
  If = 13,
  Array = 14,
  ArrayGet = 15,
  ArraySet = 16,
  ObjectLit = 17,
  FieldGet = 18,
  FieldSet = 19,
  Typeof = 20,
  Assign = 21,
  TypeCoerce = 22,
  New = 23,
  MethodCall = 24,
  Closure = 25,
  CaptureGet = 26,
  CaptureSet = 27,
  Int32 = 28,
  GlobalGet = 29,
  GlobalSet = 30,
  Await = 31,
}

export interface Expr {
  kind: ExprKind;
  ty: Type;
}

export interface NumberExpr extends Expr {
  kind: ExprKind.Number;
  value: number;
}

export interface StringExpr extends Expr {
  kind: ExprKind.String;
  value: string;
}

export interface BoolExpr extends Expr {
  kind: ExprKind.Bool;
  value: boolean;
}

export interface UndefinedExpr extends Expr {
  kind: ExprKind.Undefined;
}

export interface NullExpr extends Expr {
  kind: ExprKind.Null;
}

export const enum BinaryOp {
  Add = 0,
  Sub = 1,
  Mul = 2,
  Div = 3,
  Mod = 4,
  BitAnd = 5,
  BitOr = 6,
  BitXor = 7,
  Shl = 8,
  Shr = 9,
  UShr = 10,
}

export interface BinaryExpr extends Expr {
  kind: ExprKind.Binary;
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export const enum UnaryOp {
  Neg = 0,
  Not = 1,
  BitNot = 2,
  Plus = 3,
}

export interface UnaryExpr extends Expr {
  kind: ExprKind.Unary;
  op: UnaryOp;
  operand: Expr;
}

export const enum CompareOp {
  Eq = 0,
  Ne = 1,
  Lt = 2,
  Le = 3,
  Gt = 4,
  Ge = 5,
  StrictEq = 6,
  StrictNe = 7,
}

export interface CompareExpr extends Expr {
  kind: ExprKind.Compare;
  op: CompareOp;
  left: Expr;
  right: Expr;
}

export const enum LogicalOp {
  And = 0,
  Or = 1,
  NullishCoalesce = 2,
}

export interface LogicalExpr extends Expr {
  kind: ExprKind.Logical;
  op: LogicalOp;
  left: Expr;
  right: Expr;
}

export interface LocalGetExpr extends Expr {
  kind: ExprKind.LocalGet;
  localId: number;
  name: string;
}

export interface LocalSetExpr extends Expr {
  kind: ExprKind.LocalSet;
  localId: number;
  name: string;
  value: Expr;
}

export interface CallExpr extends Expr {
  kind: ExprKind.Call;
  callee: Expr;
  args: Array<Expr>;
}

export interface FuncRefExpr extends Expr {
  kind: ExprKind.FuncRef;
  funcId: number;
  name: string;
}

export interface IfExpr extends Expr {
  kind: ExprKind.If;
  condition: Expr;
  thenExpr: Expr;
  elseExpr: Expr;
}

export interface ArrayExpr extends Expr {
  kind: ExprKind.Array;
  elements: Array<Expr>;
}

export interface ArrayGetExpr extends Expr {
  kind: ExprKind.ArrayGet;
  array: Expr;
  index: Expr;
}

export interface ArraySetExpr extends Expr {
  kind: ExprKind.ArraySet;
  array: Expr;
  index: Expr;
  value: Expr;
}

export interface ObjectLitExpr extends Expr {
  kind: ExprKind.ObjectLit;
  fields: Array<[string, Expr]>;
}

export interface FieldGetExpr extends Expr {
  kind: ExprKind.FieldGet;
  object: Expr;
  field: string;
  fieldIndex: number;
}

export interface FieldSetExpr extends Expr {
  kind: ExprKind.FieldSet;
  object: Expr;
  field: string;
  fieldIndex: number;
  value: Expr;
}

export interface TypeofExpr extends Expr {
  kind: ExprKind.Typeof;
  operand: Expr;
}

export interface AssignExpr extends Expr {
  kind: ExprKind.Assign;
  target: Expr;
  value: Expr;
}

export interface TypeCoerceExpr extends Expr {
  kind: ExprKind.TypeCoerce;
  expr: Expr;
  fromType: Type;
  toType: Type;
}

export interface MethodCallExpr extends Expr {
  kind: ExprKind.MethodCall;
  object: Expr;
  method: string;
  args: Array<Expr>;
}

export interface Int32Expr extends Expr {
  kind: ExprKind.Int32;
  value: number;
}

export interface ClosureExpr extends Expr {
  kind: ExprKind.Closure;
  funcId: number;
  captures: Array<Expr>;
}

export interface CaptureGetExpr extends Expr {
  kind: ExprKind.CaptureGet;
  captureIndex: number;
  closurePtrLocalId: number;
}

export interface CaptureSetExpr extends Expr {
  kind: ExprKind.CaptureSet;
  captureIndex: number;
  closurePtrLocalId: number;
  value: Expr;
}

export interface GlobalGetExpr extends Expr {
  kind: ExprKind.GlobalGet;
  name: string;
}

export interface GlobalSetExpr extends Expr {
  kind: ExprKind.GlobalSet;
  name: string;
  value: Expr;
}

export interface AwaitExpr extends Expr {
  kind: ExprKind.Await;
  inner: Expr;
}

// --- Statements ---

export const enum StmtKind {
  Expr = 0,
  Let = 1,
  Return = 2,
  If = 3,
  While = 4,
  For = 5,
  Break = 6,
  Continue = 7,
  Block = 8,
  Switch = 9,
  Throw = 10,
  TryCatch = 11,
}

export interface Stmt {
  kind: StmtKind;
}

export interface ExprStmt extends Stmt {
  kind: StmtKind.Expr;
  expr: Expr;
}

export interface LetStmt extends Stmt {
  kind: StmtKind.Let;
  localId: number;
  name: string;
  ty: Type;
  init: Expr | null;
}

export interface ReturnStmt extends Stmt {
  kind: StmtKind.Return;
  value: Expr | null;
}

export interface IfStmt extends Stmt {
  kind: StmtKind.If;
  condition: Expr;
  thenBody: Array<Stmt>;
  elseBody: Array<Stmt>;
}

export interface WhileStmt extends Stmt {
  kind: StmtKind.While;
  condition: Expr;
  body: Array<Stmt>;
}

export interface ForStmt extends Stmt {
  kind: StmtKind.For;
  init: Stmt | null;
  condition: Expr | null;
  update: Expr | null;
  body: Array<Stmt>;
}

export interface BreakStmt extends Stmt {
  kind: StmtKind.Break;
}

export interface ContinueStmt extends Stmt {
  kind: StmtKind.Continue;
}

export interface BlockStmt extends Stmt {
  kind: StmtKind.Block;
  stmts: Array<Stmt>;
}

export interface TryCatchStmt extends Stmt {
  kind: StmtKind.TryCatch;
  tryBody: Array<Stmt>;
  catchParam: number;  // localId for catch variable (-1 if no catch)
  catchParamName: string;
  catchBody: Array<Stmt>;
  finallyBody: Array<Stmt>;
}

// --- Top-level ---

export interface HirFunction {
  id: number;
  name: string;
  params: Array<[number, string, Type]>;  // [localId, name, type]
  returnType: Type;
  body: Array<Stmt>;
  localCount: number;
  isAsync: boolean;
}

export interface HirModule {
  name: string;
  functions: Array<HirFunction>;
  init: Array<Stmt>;
  globals: Array<string>;  // names of module-level variables accessed from functions
  externalFuncs: Array<[number, string]>;  // [funcId, name] for imported functions
  importedGlobals: Array<[string, string]>;  // [localName, fullGlobalName] for imported variables
}
