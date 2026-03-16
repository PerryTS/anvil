// AST node types for the TypeScript subset parser

// --- Type annotations ---

export const enum TypeNodeKind {
  Named = 0,       // number, string, boolean, void, any, etc.
  Array = 1,       // T[]  or Array<T>
  Function = 2,    // (a: T, b: U) => R
  Union = 3,       // T | U
  Generic = 4,     // Map<K, V>, Array<T>
  Literal = 5,     // string literal types
  Tuple = 6,       // [T, U]
  TypeOf = 7,      // typeof x
  Nullable = 8,    // T | null | undefined
  ObjectLiteral = 9, // { name: string; age: number }
}

export interface TypeNode {
  kind: TypeNodeKind;
}

export interface NamedTypeNode extends TypeNode {
  kind: TypeNodeKind.Named;
  name: string;
}

export interface ArrayTypeNode extends TypeNode {
  kind: TypeNodeKind.Array;
  elementType: TypeNode;
}

export interface FunctionTypeNode extends TypeNode {
  kind: TypeNodeKind.Function;
  params: Array<[string, TypeNode]>;
  returnType: TypeNode;
}

export interface UnionTypeNode extends TypeNode {
  kind: TypeNodeKind.Union;
  members: Array<TypeNode>;
}

export interface GenericTypeNode extends TypeNode {
  kind: TypeNodeKind.Generic;
  name: string;
  typeArgs: Array<TypeNode>;
}

export interface ObjectLiteralTypeNode extends TypeNode {
  kind: TypeNodeKind.ObjectLiteral;
  members: Array<[string, TypeNode]>;  // field name -> type
}

// --- Expressions ---

export const enum AstExprKind {
  Number = 0,
  String = 1,
  Bool = 2,
  Null = 3,
  Undefined = 4,
  Identifier = 5,
  Binary = 6,
  Unary = 7,
  UnaryPostfix = 8,
  Call = 9,
  Member = 10,      // a.b
  Index = 11,        // a[b]
  Assign = 12,
  Conditional = 13,  // a ? b : c
  Arrow = 14,        // (x) => expr
  Array = 15,        // [a, b, c]
  Object = 16,       // { a: 1, b: 2 }
  New = 17,
  Template = 18,
  TypeAs = 19,       // x as T
  Typeof = 20,
  Void = 21,
  Spread = 22,       // ...x
  This = 23,
  Super = 24,
  Paren = 25,        // (expr)
  CompoundAssign = 26, // +=, -=, etc.
  Await = 27,
  Yield = 28,
}

export interface AstExpr {
  kind: AstExprKind;
  line: number;
  col: number;
}

export interface NumberLitExpr extends AstExpr {
  kind: AstExprKind.Number;
  value: number;
  raw: string;
}

export interface StringLitExpr extends AstExpr {
  kind: AstExprKind.String;
  value: string;
}

export interface BoolLitExpr extends AstExpr {
  kind: AstExprKind.Bool;
  value: boolean;
}

export interface NullLitExpr extends AstExpr {
  kind: AstExprKind.Null;
}

export interface UndefinedLitExpr extends AstExpr {
  kind: AstExprKind.Undefined;
}

export interface IdentifierExpr extends AstExpr {
  kind: AstExprKind.Identifier;
  name: string;
}

export interface BinaryExprAst extends AstExpr {
  kind: AstExprKind.Binary;
  op: string;
  left: AstExpr;
  right: AstExpr;
}

export interface UnaryExprAst extends AstExpr {
  kind: AstExprKind.Unary;
  op: string;
  operand: AstExpr;
}

export interface UnaryPostfixExprAst extends AstExpr {
  kind: AstExprKind.UnaryPostfix;
  op: string;
  operand: AstExpr;
}

export interface CallExprAst extends AstExpr {
  kind: AstExprKind.Call;
  callee: AstExpr;
  args: Array<AstExpr>;
  typeArgs: Array<TypeNode> | null;
}

export interface MemberExprAst extends AstExpr {
  kind: AstExprKind.Member;
  object: AstExpr;
  property: string;
  optional: boolean;  // true for ?. access
}

export interface IndexExprAst extends AstExpr {
  kind: AstExprKind.Index;
  object: AstExpr;
  index: AstExpr;
}

export interface AssignExprAst extends AstExpr {
  kind: AstExprKind.Assign;
  target: AstExpr;
  value: AstExpr;
}

export interface CompoundAssignExprAst extends AstExpr {
  kind: AstExprKind.CompoundAssign;
  op: string;  // +=, -=, *=, /=, %=
  target: AstExpr;
  value: AstExpr;
}

export interface ConditionalExprAst extends AstExpr {
  kind: AstExprKind.Conditional;
  condition: AstExpr;
  consequent: AstExpr;
  alternate: AstExpr;
}

export interface ArrowExprAst extends AstExpr {
  kind: AstExprKind.Arrow;
  params: Array<ParamDecl>;
  returnType: TypeNode | null;
  body: AstExpr | Array<AstStmt>;  // expression or block
  async: boolean;
}

export interface ArrayExprAst extends AstExpr {
  kind: AstExprKind.Array;
  elements: Array<AstExpr>;
}

export interface ObjectExprAst extends AstExpr {
  kind: AstExprKind.Object;
  properties: Array<ObjectProperty>;
}

export interface ObjectProperty {
  key: string;
  value: AstExpr;
  computed: boolean;
  shorthand: boolean;
}

export interface TemplateExprAst extends AstExpr {
  kind: AstExprKind.Template;
  parts: Array<string>;       // string parts (n+1 items)
  expressions: Array<AstExpr>; // expression parts (n items)
}

export interface NewExprAst extends AstExpr {
  kind: AstExprKind.New;
  callee: AstExpr;
  args: Array<AstExpr>;
}

export interface TypeAsExprAst extends AstExpr {
  kind: AstExprKind.TypeAs;
  expr: AstExpr;
  typeNode: TypeNode;
}

export interface TypeofExprAst extends AstExpr {
  kind: AstExprKind.Typeof;
  operand: AstExpr;
}

export interface SpreadExprAst extends AstExpr {
  kind: AstExprKind.Spread;
  argument: AstExpr;
}

export interface ThisExprAst extends AstExpr {
  kind: AstExprKind.This;
}

export interface SuperExprAst extends AstExpr {
  kind: AstExprKind.Super;
}

export interface ParenExprAst extends AstExpr {
  kind: AstExprKind.Paren;
  expr: AstExpr;
}

export interface AwaitExprAst extends AstExpr {
  kind: AstExprKind.Await;
  operand: AstExpr;
}

export interface YieldExprAst extends AstExpr {
  kind: AstExprKind.Yield;
  operand: AstExpr | null;
}

// --- Statements ---

export const enum AstStmtKind {
  Expr = 0,
  VarDecl = 1,
  FunctionDecl = 2,
  Return = 3,
  If = 4,
  While = 5,
  For = 6,
  DoWhile = 7,
  Break = 8,
  Continue = 9,
  Block = 10,
  Switch = 11,
  Throw = 12,
  TryCatch = 13,
  ClassDecl = 14,
  EnumDecl = 15,
  ImportDecl = 16,
  ExportDecl = 17,
  InterfaceDecl = 18,
  TypeAliasDecl = 19,
  Empty = 20,
  ForIn = 21,
}

export interface AstStmt {
  kind: AstStmtKind;
  line: number;
  col: number;
}

export interface ExprStmtAst extends AstStmt {
  kind: AstStmtKind.Expr;
  expr: AstExpr;
}

export interface VarDeclAst extends AstStmt {
  kind: AstStmtKind.VarDecl;
  declKind: string;  // "let" | "const" | "var"
  name: string;
  typeAnnotation: TypeNode | null;
  init: AstExpr | null;
}

export interface ParamDecl {
  name: string;
  typeAnnotation: TypeNode | null;
  defaultValue: AstExpr | null;
  rest: boolean;
  accessibility: string | null;  // "public" | "private" | "protected" | null
}

export interface FunctionDeclAst extends AstStmt {
  kind: AstStmtKind.FunctionDecl;
  name: string;
  params: Array<ParamDecl>;
  returnType: TypeNode | null;
  typeParams: Array<string> | null;
  body: Array<AstStmt>;
  async: boolean;
  generator: boolean;
}

export interface ReturnStmtAst extends AstStmt {
  kind: AstStmtKind.Return;
  value: AstExpr | null;
}

export interface IfStmtAst extends AstStmt {
  kind: AstStmtKind.If;
  condition: AstExpr;
  consequent: AstStmt;
  alternate: AstStmt | null;
}

export interface WhileStmtAst extends AstStmt {
  kind: AstStmtKind.While;
  condition: AstExpr;
  body: AstStmt;
}

export interface ForStmtAst extends AstStmt {
  kind: AstStmtKind.For;
  init: AstStmt | null;
  condition: AstExpr | null;
  update: AstExpr | null;
  body: AstStmt;
}

export interface DoWhileStmtAst extends AstStmt {
  kind: AstStmtKind.DoWhile;
  condition: AstExpr;
  body: AstStmt;
}

export interface BreakStmtAst extends AstStmt {
  kind: AstStmtKind.Break;
}

export interface ContinueStmtAst extends AstStmt {
  kind: AstStmtKind.Continue;
}

export interface BlockStmtAst extends AstStmt {
  kind: AstStmtKind.Block;
  body: Array<AstStmt>;
}

export interface SwitchStmtAst extends AstStmt {
  kind: AstStmtKind.Switch;
  discriminant: AstExpr;
  cases: Array<SwitchCase>;
}

export interface SwitchCase {
  test: AstExpr | null;  // null for default
  body: Array<AstStmt>;
}

export interface ThrowStmtAst extends AstStmt {
  kind: AstStmtKind.Throw;
  argument: AstExpr;
}

export interface TryCatchStmtAst extends AstStmt {
  kind: AstStmtKind.TryCatch;
  tryBody: Array<AstStmt>;
  catchParam: string | null;
  catchBody: Array<AstStmt> | null;
  finallyBody: Array<AstStmt> | null;
}

export interface ClassMemberAst {
  name: string;
  kind: string;  // "method" | "property" | "constructor" | "getter" | "setter"
  isStatic: boolean;
  accessibility: string | null;  // "public" | "private" | "protected" | null
  isReadonly: boolean;
  params: Array<ParamDecl> | null;  // for methods
  returnType: TypeNode | null;
  typeAnnotation: TypeNode | null;  // for properties
  body: Array<AstStmt> | null;
  initializer: AstExpr | null;
  decorator: string | null;
}

export interface ClassDeclAst extends AstStmt {
  kind: AstStmtKind.ClassDecl;
  name: string;
  superClass: string | null;
  typeParams: Array<string> | null;
  members: Array<ClassMemberAst>;
}

export interface EnumMemberAst {
  name: string;
  initializer: AstExpr | null;
}

export interface EnumDeclAst extends AstStmt {
  kind: AstStmtKind.EnumDecl;
  name: string;
  isConst: boolean;
  members: Array<EnumMemberAst>;
}

export interface ImportSpecifier {
  imported: string;
  local: string;
}

export interface ImportDeclAst extends AstStmt {
  kind: AstStmtKind.ImportDecl;
  specifiers: Array<ImportSpecifier>;
  source: string;
  defaultImport: string | null;
  namespaceImport: string | null;
}

export interface ExportDeclAst extends AstStmt {
  kind: AstStmtKind.ExportDecl;
  declaration: AstStmt | null;
  isDefault: boolean;
}

export interface InterfaceDeclAst extends AstStmt {
  kind: AstStmtKind.InterfaceDecl;
  name: string;
  typeParams: Array<string> | null;
  extends: Array<string> | null;
  members: Array<InterfaceMemberAst>;
}

export interface InterfaceMemberAst {
  name: string;
  typeAnnotation: TypeNode | null;
  optional: boolean;
  kind: string;  // "property" | "method" | "index"
  params: Array<ParamDecl> | null;
  returnType: TypeNode | null;
}

export interface TypeAliasDeclAst extends AstStmt {
  kind: AstStmtKind.TypeAliasDecl;
  name: string;
  typeParams: Array<string> | null;
  type: TypeNode;
}

// --- Source file ---

export interface SourceFile {
  statements: Array<AstStmt>;
  fileName: string;
}
