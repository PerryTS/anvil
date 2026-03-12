// Recursive descent parser for the TypeScript subset
// Uses Pratt parsing for expressions

import { Scanner } from "./scanner";
import { Token, TokenKind } from "./token";
import {
  SourceFile, AstStmt, AstStmtKind, AstExpr, AstExprKind,
  TypeNode, TypeNodeKind, ParamDecl,
  ExprStmtAst, VarDeclAst, FunctionDeclAst, ReturnStmtAst,
  IfStmtAst, WhileStmtAst, ForStmtAst, DoWhileStmtAst,
  BreakStmtAst, ContinueStmtAst, BlockStmtAst,
  SwitchStmtAst, SwitchCase, ThrowStmtAst, TryCatchStmtAst,
  ClassDeclAst, ClassMemberAst, EnumDeclAst, EnumMemberAst,
  ImportDeclAst, ImportSpecifier, ExportDeclAst,
  InterfaceDeclAst, InterfaceMemberAst, TypeAliasDeclAst,
  NumberLitExpr, StringLitExpr, BoolLitExpr, NullLitExpr, UndefinedLitExpr,
  IdentifierExpr, BinaryExprAst, UnaryExprAst, UnaryPostfixExprAst,
  CallExprAst, MemberExprAst, IndexExprAst, AssignExprAst, CompoundAssignExprAst,
  ConditionalExprAst, ArrowExprAst, ArrayExprAst, ObjectExprAst, ObjectProperty,
  NewExprAst, TypeAsExprAst, TypeofExprAst, SpreadExprAst,
  ThisExprAst, SuperExprAst, ParenExprAst,
  NamedTypeNode, ArrayTypeNode, FunctionTypeNode, UnionTypeNode, GenericTypeNode,
} from "./ast";

export class Parser {
  private scanner: Scanner;
  private current: Token;
  private fileName: string;

  constructor(source: string, fileName: string) {
    this.scanner = new Scanner(source);
    this.current = this.scanner.scan();
    this.fileName = fileName;
  }

  parse(): SourceFile {
    const stmts: Array<AstStmt> = [];
    while (this.current.kind !== TokenKind.EOF) {
      stmts.push(this.parseStatement());
    }
    return { statements: stmts, fileName: this.fileName };
  }

  // --- Token helpers ---

  private advance(): Token {
    const prev = this.current;
    this.current = this.scanner.scan();
    return prev;
  }

  private expect(kind: TokenKind): Token {
    if (this.current.kind !== kind) {
      throw this.error("Expected " + tokenKindName(kind) + " but got " + tokenKindName(this.current.kind) + " '" + this.current.value + "'");
    }
    return this.advance();
  }

  private eat(kind: TokenKind): boolean {
    if (this.current.kind === kind) {
      this.advance();
      return true;
    }
    return false;
  }

  private at(kind: TokenKind): boolean {
    return this.current.kind === kind;
  }

  private error(msg: string): Error {
    return new Error(this.fileName + ":" + this.current.line + ":" + this.current.col + ": " + msg);
  }

  // --- Statements ---

  private parseStatement(): AstStmt {
    const kind = this.current.kind;

    if (kind === TokenKind.Const && this.scanner.peek().kind === TokenKind.Enum) {
      this.advance(); // consume 'const'
      return this.parseEnumDecl(true);
    }
    if (kind === TokenKind.Let || kind === TokenKind.Const || kind === TokenKind.Var) {
      return this.parseVarDecl();
    }
    if (kind === TokenKind.Function) {
      return this.parseFunctionDecl();
    }
    if (kind === TokenKind.Return) {
      return this.parseReturn();
    }
    if (kind === TokenKind.If) {
      return this.parseIf();
    }
    if (kind === TokenKind.While) {
      return this.parseWhile();
    }
    if (kind === TokenKind.For) {
      return this.parseFor();
    }
    if (kind === TokenKind.Do) {
      return this.parseDoWhile();
    }
    if (kind === TokenKind.Break) {
      return this.parseBreak();
    }
    if (kind === TokenKind.Continue) {
      return this.parseContinue();
    }
    if (kind === TokenKind.LeftBrace) {
      return this.parseBlock();
    }
    if (kind === TokenKind.Switch) {
      return this.parseSwitch();
    }
    if (kind === TokenKind.Throw) {
      return this.parseThrow();
    }
    if (kind === TokenKind.Try) {
      return this.parseTryCatch();
    }
    if (kind === TokenKind.Class) {
      return this.parseClassDecl();
    }
    if (kind === TokenKind.Enum) {
      return this.parseEnumDecl(false);
    }
    if (kind === TokenKind.Import) {
      return this.parseImport();
    }
    if (kind === TokenKind.Export) {
      return this.parseExport();
    }
    if (kind === TokenKind.Interface) {
      return this.parseInterface();
    }
    if (kind === TokenKind.Type) {
      // Could be type alias or expression starting with identifier "type"
      const next = this.scanner.peek();
      if (next.kind === TokenKind.Identifier) {
        return this.parseTypeAlias();
      }
    }
    if (kind === TokenKind.Declare) {
      // Skip 'declare' keyword and parse the declaration
      this.advance();
      return this.parseStatement();
    }
    if (kind === TokenKind.Semicolon) {
      const tok = this.advance();
      return { kind: AstStmtKind.Empty, line: tok.line, col: tok.col } as AstStmt;
    }

    return this.parseExprStmt();
  }

  private parseVarDecl(): VarDeclAst {
    const tok = this.advance();
    const declKind = tok.value;
    const name = this.expect(TokenKind.Identifier).value;

    let typeAnnotation: TypeNode | null = null;
    if (this.eat(TokenKind.Colon)) {
      typeAnnotation = this.parseTypeAnnotation();
    }

    let init: AstExpr | null = null;
    if (this.eat(TokenKind.Equal)) {
      init = this.parseExpression();
    }

    this.eat(TokenKind.Semicolon);
    return {
      kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col,
      declKind: declKind, name: name, typeAnnotation: typeAnnotation, init: init,
    };
  }

  private parseFunctionDecl(): FunctionDeclAst {
    const tok = this.expect(TokenKind.Function);
    const name = this.expect(TokenKind.Identifier).value;

    let typeParams: Array<string> | null = null;
    if (this.at(TokenKind.LessThan)) {
      typeParams = this.parseTypeParams();
    }

    this.expect(TokenKind.LeftParen);
    const params = this.parseParamList();
    this.expect(TokenKind.RightParen);

    let returnType: TypeNode | null = null;
    if (this.eat(TokenKind.Colon)) {
      returnType = this.parseTypeAnnotation();
    }

    const body = this.parseBlockBody();
    return {
      kind: AstStmtKind.FunctionDecl, line: tok.line, col: tok.col,
      name: name, params: params, returnType: returnType, typeParams: typeParams, body: body,
    };
  }

  private parseParamList(): Array<ParamDecl> {
    const params: Array<ParamDecl> = [];
    while (!this.at(TokenKind.RightParen) && !this.at(TokenKind.EOF)) {
      let rest = false;
      if (this.eat(TokenKind.DotDotDot)) {
        rest = true;
      }

      // Handle accessibility modifiers in constructor params
      if (this.at(TokenKind.Public) || this.at(TokenKind.Private) || this.at(TokenKind.Protected) || this.at(TokenKind.Readonly)) {
        this.advance();
        // May have multiple modifiers
        if (this.at(TokenKind.Readonly)) {
          this.advance();
        }
      }

      const name = this.expect(TokenKind.Identifier).value;
      let optional = false;
      if (this.eat(TokenKind.Question)) {
        optional = true;
      }

      let typeAnnotation: TypeNode | null = null;
      if (this.eat(TokenKind.Colon)) {
        typeAnnotation = this.parseTypeAnnotation();
      }

      let defaultValue: AstExpr | null = null;
      if (this.eat(TokenKind.Equal)) {
        defaultValue = this.parseAssignmentExpr();
      }

      params.push({ name: name, typeAnnotation: typeAnnotation, defaultValue: defaultValue, rest: rest });

      if (!this.eat(TokenKind.Comma)) {
        break;
      }
    }
    return params;
  }

  private parseBlockBody(): Array<AstStmt> {
    this.expect(TokenKind.LeftBrace);
    const stmts: Array<AstStmt> = [];
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      stmts.push(this.parseStatement());
    }
    this.expect(TokenKind.RightBrace);
    return stmts;
  }

  private parseReturn(): ReturnStmtAst {
    const tok = this.expect(TokenKind.Return);
    let value: AstExpr | null = null;
    if (!this.at(TokenKind.Semicolon) && !this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      value = this.parseExpression();
    }
    this.eat(TokenKind.Semicolon);
    return { kind: AstStmtKind.Return, line: tok.line, col: tok.col, value: value };
  }

  private parseIf(): IfStmtAst {
    const tok = this.expect(TokenKind.If);
    this.expect(TokenKind.LeftParen);
    const condition = this.parseExpression();
    this.expect(TokenKind.RightParen);
    const consequent = this.parseStatementOrBlock();
    let alternate: AstStmt | null = null;
    if (this.eat(TokenKind.Else)) {
      alternate = this.parseStatementOrBlock();
    }
    return {
      kind: AstStmtKind.If, line: tok.line, col: tok.col,
      condition: condition, consequent: consequent, alternate: alternate,
    };
  }

  private parseWhile(): WhileStmtAst {
    const tok = this.expect(TokenKind.While);
    this.expect(TokenKind.LeftParen);
    const condition = this.parseExpression();
    this.expect(TokenKind.RightParen);
    const body = this.parseStatementOrBlock();
    return { kind: AstStmtKind.While, line: tok.line, col: tok.col, condition: condition, body: body };
  }

  private parseFor(): AstStmt {
    const tok = this.expect(TokenKind.For);
    this.expect(TokenKind.LeftParen);

    // Check for for..in / for..of (we need basic for..in support at least)
    let init: AstStmt | null = null;
    if (this.at(TokenKind.Let) || this.at(TokenKind.Const) || this.at(TokenKind.Var)) {
      init = this.parseVarDecl();
      // Note: parseVarDecl consumed the semicolon. But for regular for loops
      // we need to check if this was actually a for..in/of
    } else if (!this.at(TokenKind.Semicolon)) {
      const expr = this.parseExpression();
      init = { kind: AstStmtKind.Expr, line: expr.line, col: expr.col, expr: expr } as ExprStmtAst;
      this.eat(TokenKind.Semicolon);
    } else {
      this.eat(TokenKind.Semicolon);
    }

    let condition: AstExpr | null = null;
    if (!this.at(TokenKind.Semicolon)) {
      condition = this.parseExpression();
    }
    this.expect(TokenKind.Semicolon);

    let update: AstExpr | null = null;
    if (!this.at(TokenKind.RightParen)) {
      update = this.parseExpression();
    }
    this.expect(TokenKind.RightParen);

    const body = this.parseStatementOrBlock();
    return {
      kind: AstStmtKind.For, line: tok.line, col: tok.col,
      init: init, condition: condition, update: update, body: body,
    } as ForStmtAst;
  }

  private parseDoWhile(): DoWhileStmtAst {
    const tok = this.expect(TokenKind.Do);
    const body = this.parseStatementOrBlock();
    this.expect(TokenKind.While);
    this.expect(TokenKind.LeftParen);
    const condition = this.parseExpression();
    this.expect(TokenKind.RightParen);
    this.eat(TokenKind.Semicolon);
    return { kind: AstStmtKind.DoWhile, line: tok.line, col: tok.col, condition: condition, body: body };
  }

  private parseBreak(): BreakStmtAst {
    const tok = this.expect(TokenKind.Break);
    this.eat(TokenKind.Semicolon);
    return { kind: AstStmtKind.Break, line: tok.line, col: tok.col };
  }

  private parseContinue(): ContinueStmtAst {
    const tok = this.expect(TokenKind.Continue);
    this.eat(TokenKind.Semicolon);
    return { kind: AstStmtKind.Continue, line: tok.line, col: tok.col };
  }

  private parseBlock(): BlockStmtAst {
    const tok = this.current;
    const body = this.parseBlockBody();
    return { kind: AstStmtKind.Block, line: tok.line, col: tok.col, body: body };
  }

  private parseStatementOrBlock(): AstStmt {
    if (this.at(TokenKind.LeftBrace)) {
      return this.parseBlock();
    }
    return this.parseStatement();
  }

  private parseSwitch(): SwitchStmtAst {
    const tok = this.expect(TokenKind.Switch);
    this.expect(TokenKind.LeftParen);
    const discriminant = this.parseExpression();
    this.expect(TokenKind.RightParen);
    this.expect(TokenKind.LeftBrace);

    const cases: Array<SwitchCase> = [];
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      let test: AstExpr | null = null;
      if (this.eat(TokenKind.Case)) {
        test = this.parseExpression();
      } else {
        this.expect(TokenKind.Default);
      }
      this.expect(TokenKind.Colon);

      const body: Array<AstStmt> = [];
      while (!this.at(TokenKind.Case) && !this.at(TokenKind.Default) && !this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
        body.push(this.parseStatement());
      }
      cases.push({ test: test, body: body });
    }

    this.expect(TokenKind.RightBrace);
    return { kind: AstStmtKind.Switch, line: tok.line, col: tok.col, discriminant: discriminant, cases: cases };
  }

  private parseThrow(): ThrowStmtAst {
    const tok = this.expect(TokenKind.Throw);
    const argument = this.parseExpression();
    this.eat(TokenKind.Semicolon);
    return { kind: AstStmtKind.Throw, line: tok.line, col: tok.col, argument: argument };
  }

  private parseTryCatch(): TryCatchStmtAst {
    const tok = this.expect(TokenKind.Try);
    const tryBody = this.parseBlockBody();

    let catchParam: string | null = null;
    let catchBody: Array<AstStmt> | null = null;
    if (this.eat(TokenKind.Catch)) {
      if (this.eat(TokenKind.LeftParen)) {
        catchParam = this.expect(TokenKind.Identifier).value;
        // Optional type annotation on catch param
        if (this.eat(TokenKind.Colon)) {
          this.parseTypeAnnotation(); // consume but ignore
        }
        this.expect(TokenKind.RightParen);
      }
      catchBody = this.parseBlockBody();
    }

    let finallyBody: Array<AstStmt> | null = null;
    if (this.eat(TokenKind.Finally)) {
      finallyBody = this.parseBlockBody();
    }

    return {
      kind: AstStmtKind.TryCatch, line: tok.line, col: tok.col,
      tryBody: tryBody, catchParam: catchParam, catchBody: catchBody, finallyBody: finallyBody,
    };
  }

  private parseClassDecl(): ClassDeclAst {
    const tok = this.expect(TokenKind.Class);
    const name = this.expect(TokenKind.Identifier).value;

    let typeParams: Array<string> | null = null;
    if (this.at(TokenKind.LessThan)) {
      typeParams = this.parseTypeParams();
    }

    let superClass: string | null = null;
    if (this.eat(TokenKind.Extends)) {
      superClass = this.expect(TokenKind.Identifier).value;
      // Skip type arguments on super class
      if (this.at(TokenKind.LessThan)) {
        this.skipTypeArgs();
      }
    }

    // Skip 'implements'
    if (this.eat(TokenKind.Implements)) {
      this.expect(TokenKind.Identifier); // interface name
      while (this.eat(TokenKind.Comma)) {
        this.expect(TokenKind.Identifier);
      }
    }

    this.expect(TokenKind.LeftBrace);
    const members: Array<ClassMemberAst> = [];
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      members.push(this.parseClassMember());
    }
    this.expect(TokenKind.RightBrace);

    return {
      kind: AstStmtKind.ClassDecl, line: tok.line, col: tok.col,
      name: name, superClass: superClass, typeParams: typeParams, members: members,
    };
  }

  private parseClassMember(): ClassMemberAst {
    let isStatic = false;
    let accessibility: string | null = null;
    let isReadonly = false;
    let isAbstract = false;

    // Parse modifiers
    while (true) {
      if (this.at(TokenKind.Public)) { accessibility = "public"; this.advance(); }
      else if (this.at(TokenKind.Private)) { accessibility = "private"; this.advance(); }
      else if (this.at(TokenKind.Protected)) { accessibility = "protected"; this.advance(); }
      else if (this.at(TokenKind.Static)) { isStatic = true; this.advance(); }
      else if (this.at(TokenKind.Readonly)) { isReadonly = true; this.advance(); }
      else if (this.at(TokenKind.Abstract)) { isAbstract = true; this.advance(); }
      else { break; }
    }

    // Check for getter/setter
    if (this.current.value === "get" && this.scanner.peek().kind === TokenKind.Identifier) {
      this.advance(); // consume 'get'
      const name = this.advance().value;
      this.expect(TokenKind.LeftParen);
      this.expect(TokenKind.RightParen);
      let returnType: TypeNode | null = null;
      if (this.eat(TokenKind.Colon)) { returnType = this.parseTypeAnnotation(); }
      const body = this.parseBlockBody();
      return {
        name: name, kind: "getter", isStatic: isStatic, accessibility: accessibility,
        readonly: isReadonly, params: [], returnType: returnType, typeAnnotation: null,
        body: body, initializer: null,
      };
    }
    if (this.current.value === "set" && this.scanner.peek().kind === TokenKind.Identifier) {
      this.advance(); // consume 'set'
      const name = this.advance().value;
      this.expect(TokenKind.LeftParen);
      const params = this.parseParamList();
      this.expect(TokenKind.RightParen);
      const body = this.parseBlockBody();
      return {
        name: name, kind: "setter", isStatic: isStatic, accessibility: accessibility,
        readonly: isReadonly, params: params, returnType: null, typeAnnotation: null,
        body: body, initializer: null,
      };
    }

    // Constructor
    if (this.current.value === "constructor") {
      this.advance();
      this.expect(TokenKind.LeftParen);
      const params = this.parseParamList();
      this.expect(TokenKind.RightParen);
      const body = this.parseBlockBody();
      return {
        name: "constructor", kind: "constructor", isStatic: false, accessibility: null,
        readonly: false, params: params, returnType: null, typeAnnotation: null,
        body: body, initializer: null,
      };
    }

    // Property or method
    let name: string;
    if (this.at(TokenKind.LeftBracket)) {
      // Computed property - skip for now
      this.advance();
      name = this.expect(TokenKind.Identifier).value;
      this.expect(TokenKind.RightBracket);
    } else {
      name = this.advance().value;
    }

    // Skip optional marker
    this.eat(TokenKind.Question);

    // Method (has parenthesis or type params)
    if (this.at(TokenKind.LeftParen) || this.at(TokenKind.LessThan)) {
      // Skip type params
      if (this.at(TokenKind.LessThan)) {
        this.skipTypeArgs();
      }
      this.expect(TokenKind.LeftParen);
      const params = this.parseParamList();
      this.expect(TokenKind.RightParen);
      let returnType: TypeNode | null = null;
      if (this.eat(TokenKind.Colon)) {
        returnType = this.parseTypeAnnotation();
      }
      let body: Array<AstStmt> | null = null;
      if (this.at(TokenKind.LeftBrace)) {
        body = this.parseBlockBody();
      } else {
        this.eat(TokenKind.Semicolon);
      }
      return {
        name: name, kind: "method", isStatic: isStatic, accessibility: accessibility,
        readonly: isReadonly, params: params, returnType: returnType, typeAnnotation: null,
        body: body, initializer: null,
      };
    }

    // Property
    let typeAnnotation: TypeNode | null = null;
    if (this.eat(TokenKind.Colon)) {
      typeAnnotation = this.parseTypeAnnotation();
    }
    let initializer: AstExpr | null = null;
    if (this.eat(TokenKind.Equal)) {
      initializer = this.parseAssignmentExpr();
    }
    this.eat(TokenKind.Semicolon);
    return {
      name: name, kind: "property", isStatic: isStatic, accessibility: accessibility,
      readonly: isReadonly, params: null, returnType: null, typeAnnotation: typeAnnotation,
      body: null, initializer: initializer,
    };
  }

  private parseEnumDecl(isConst: boolean): EnumDeclAst {
    const tok = this.expect(TokenKind.Enum);
    const name = this.expect(TokenKind.Identifier).value;
    this.expect(TokenKind.LeftBrace);

    const members: Array<EnumMemberAst> = [];
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      const memberName = this.advance().value;
      let initializer: AstExpr | null = null;
      if (this.eat(TokenKind.Equal)) {
        initializer = this.parseAssignmentExpr();
      }
      members.push({ name: memberName, initializer: initializer });
      this.eat(TokenKind.Comma);
    }

    this.expect(TokenKind.RightBrace);
    return {
      kind: AstStmtKind.EnumDecl, line: tok.line, col: tok.col,
      name: name, isConst: isConst, members: members,
    };
  }

  private parseImport(): ImportDeclAst {
    const tok = this.expect(TokenKind.Import);
    const specifiers: Array<ImportSpecifier> = [];
    let defaultImport: string | null = null;
    let namespaceImport: string | null = null;

    if (this.at(TokenKind.StringLiteral)) {
      // Side-effect import: import "module"
      const source = this.advance().value;
      this.eat(TokenKind.Semicolon);
      return {
        kind: AstStmtKind.ImportDecl, line: tok.line, col: tok.col,
        specifiers: [], source: source, defaultImport: null, namespaceImport: null,
      };
    }

    if (this.at(TokenKind.Identifier)) {
      // Default import or named import
      defaultImport = this.advance().value;
      if (this.eat(TokenKind.Comma)) {
        // import default, { ... } from
        if (this.at(TokenKind.LeftBrace)) {
          this.parseNamedImports(specifiers);
        } else if (this.eat(TokenKind.Star)) {
          this.expect(TokenKind.As);
          namespaceImport = this.expect(TokenKind.Identifier).value;
        }
      }
    } else if (this.at(TokenKind.LeftBrace)) {
      this.parseNamedImports(specifiers);
    } else if (this.eat(TokenKind.Star)) {
      this.expect(TokenKind.As);
      namespaceImport = this.expect(TokenKind.Identifier).value;
    }

    // Handle type-only imports: `import type { ... } from`
    // If defaultImport is "type" and we see { or an identifier, it's a type import
    if (defaultImport === "type") {
      if (this.at(TokenKind.LeftBrace)) {
        defaultImport = null;
        this.parseNamedImports(specifiers);
      } else if (this.at(TokenKind.Identifier)) {
        defaultImport = this.advance().value;
        if (this.eat(TokenKind.Comma)) {
          if (this.at(TokenKind.LeftBrace)) {
            this.parseNamedImports(specifiers);
          }
        }
      }
    }

    this.expect(TokenKind.From);
    const source = this.expect(TokenKind.StringLiteral).value;
    this.eat(TokenKind.Semicolon);

    return {
      kind: AstStmtKind.ImportDecl, line: tok.line, col: tok.col,
      specifiers: specifiers, source: source, defaultImport: defaultImport, namespaceImport: namespaceImport,
    };
  }

  private parseNamedImports(specifiers: Array<ImportSpecifier>): void {
    this.expect(TokenKind.LeftBrace);
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      // Skip 'type' keyword in imports like: import { type Foo } from
      if (this.current.kind === TokenKind.Type) {
        this.advance();
      }
      const imported = this.advance().value;
      let local = imported;
      if (this.eat(TokenKind.As)) {
        local = this.expect(TokenKind.Identifier).value;
      }
      specifiers.push({ imported: imported, local: local });
      if (!this.eat(TokenKind.Comma)) {
        break;
      }
    }
    this.expect(TokenKind.RightBrace);
  }

  private parseExport(): ExportDeclAst {
    const tok = this.expect(TokenKind.Export);
    let isDefault = false;

    if (this.eat(TokenKind.Default)) {
      isDefault = true;
    }

    // Handle 'export type' - skip the 'type' keyword
    if (this.at(TokenKind.Type) && !isDefault) {
      const next = this.scanner.peek();
      if (next.kind === TokenKind.Identifier) {
        // This is 'export type Name = ...'
        // Fall through to parse as declaration
      } else if (next.kind === TokenKind.LeftBrace) {
        // This is 'export type { ... }' - skip entirely
        this.advance(); // consume 'type'
        this.advance(); // consume '{'
        while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
          this.advance();
        }
        this.eat(TokenKind.RightBrace);
        if (this.eat(TokenKind.From)) {
          this.advance(); // consume module path
        }
        this.eat(TokenKind.Semicolon);
        return { kind: AstStmtKind.ExportDecl, line: tok.line, col: tok.col, declaration: null, isDefault: false };
      }
    }

    let declaration: AstStmt | null = null;
    if (!isDefault) {
      declaration = this.parseStatement();
    } else {
      // export default expr;
      if (this.at(TokenKind.Function)) {
        declaration = this.parseFunctionDecl();
      } else if (this.at(TokenKind.Class)) {
        declaration = this.parseClassDecl();
      } else {
        const expr = this.parseExpression();
        this.eat(TokenKind.Semicolon);
        declaration = { kind: AstStmtKind.Expr, line: expr.line, col: expr.col, expr: expr } as ExprStmtAst;
      }
    }

    return { kind: AstStmtKind.ExportDecl, line: tok.line, col: tok.col, declaration: declaration, isDefault: isDefault };
  }

  private parseInterface(): InterfaceDeclAst {
    const tok = this.expect(TokenKind.Interface);
    const name = this.expect(TokenKind.Identifier).value;

    let typeParams: Array<string> | null = null;
    if (this.at(TokenKind.LessThan)) {
      typeParams = this.parseTypeParams();
    }

    let extendsNames: Array<string> | null = null;
    if (this.eat(TokenKind.Extends)) {
      extendsNames = [];
      extendsNames.push(this.expect(TokenKind.Identifier).value);
      while (this.eat(TokenKind.Comma)) {
        extendsNames.push(this.expect(TokenKind.Identifier).value);
      }
    }

    this.expect(TokenKind.LeftBrace);
    const members: Array<InterfaceMemberAst> = [];
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      // Skip 'readonly'
      if (this.at(TokenKind.Readonly)) {
        this.advance();
      }

      // Index signature: [key: string]: Type
      if (this.at(TokenKind.LeftBracket)) {
        this.advance();
        const indexName = this.expect(TokenKind.Identifier).value;
        this.expect(TokenKind.Colon);
        this.parseTypeAnnotation(); // index type
        this.expect(TokenKind.RightBracket);
        this.expect(TokenKind.Colon);
        const valType = this.parseTypeAnnotation();
        members.push({
          name: indexName, typeAnnotation: valType, optional: false,
          kind: "index", params: null, returnType: null,
        });
        this.eat(TokenKind.Semicolon);
        this.eat(TokenKind.Comma);
        continue;
      }

      const memberName = this.advance().value;
      let optional = this.eat(TokenKind.Question);

      if (this.at(TokenKind.LeftParen) || this.at(TokenKind.LessThan)) {
        // Method signature
        if (this.at(TokenKind.LessThan)) { this.skipTypeArgs(); }
        this.expect(TokenKind.LeftParen);
        const params = this.parseParamList();
        this.expect(TokenKind.RightParen);
        let returnType: TypeNode | null = null;
        if (this.eat(TokenKind.Colon)) {
          returnType = this.parseTypeAnnotation();
        }
        members.push({
          name: memberName, typeAnnotation: null, optional: optional,
          kind: "method", params: params, returnType: returnType,
        });
      } else {
        // Property signature
        let typeAnnotation: TypeNode | null = null;
        if (this.eat(TokenKind.Colon)) {
          typeAnnotation = this.parseTypeAnnotation();
        }
        members.push({
          name: memberName, typeAnnotation: typeAnnotation, optional: optional,
          kind: "property", params: null, returnType: null,
        });
      }

      this.eat(TokenKind.Semicolon);
      this.eat(TokenKind.Comma);
    }

    this.expect(TokenKind.RightBrace);
    return {
      kind: AstStmtKind.InterfaceDecl, line: tok.line, col: tok.col,
      name: name, typeParams: typeParams, extends: extendsNames, members: members,
    };
  }

  private parseTypeAlias(): TypeAliasDeclAst {
    const tok = this.expect(TokenKind.Type);
    const name = this.expect(TokenKind.Identifier).value;

    let typeParams: Array<string> | null = null;
    if (this.at(TokenKind.LessThan)) {
      typeParams = this.parseTypeParams();
    }

    this.expect(TokenKind.Equal);
    const type = this.parseTypeAnnotation();
    this.eat(TokenKind.Semicolon);

    return {
      kind: AstStmtKind.TypeAliasDecl, line: tok.line, col: tok.col,
      name: name, typeParams: typeParams, type: type,
    };
  }

  private parseExprStmt(): ExprStmtAst {
    const expr = this.parseExpression();
    this.eat(TokenKind.Semicolon);
    return { kind: AstStmtKind.Expr, line: expr.line, col: expr.col, expr: expr };
  }

  // --- Type annotations ---

  private parseTypeAnnotation(): TypeNode {
    let ty = this.parsePrimaryType();

    // Union type: T | U
    if (this.at(TokenKind.Pipe)) {
      const members: Array<TypeNode> = [ty];
      while (this.eat(TokenKind.Pipe)) {
        members.push(this.parsePrimaryType());
      }
      ty = { kind: TypeNodeKind.Union, members: members } as UnionTypeNode;
    }

    return ty;
  }

  private parsePrimaryType(): TypeNode {
    let ty: TypeNode;

    // Function type: (params) => ReturnType
    if (this.at(TokenKind.LeftParen)) {
      // Could be function type or parenthesized type
      // Try to detect function type by looking for => after )
      const saved = this.saveState();
      try {
        ty = this.parseFunctionType();
        return this.parseTypePostfix(ty);
      } catch (_e) {
        this.restoreState(saved);
        // Parenthesized type
        this.expect(TokenKind.LeftParen);
        ty = this.parseTypeAnnotation();
        this.expect(TokenKind.RightParen);
        return this.parseTypePostfix(ty);
      }
    }

    // typeof
    if (this.at(TokenKind.Typeof)) {
      this.advance();
      const name = this.expect(TokenKind.Identifier).value;
      ty = { kind: TypeNodeKind.TypeOf, name: name } as TypeNode & { name: string };
      return this.parseTypePostfix(ty);
    }

    // void
    if (this.at(TokenKind.Void)) {
      this.advance();
      return { kind: TypeNodeKind.Named, name: "void" } as NamedTypeNode;
    }

    // Named type
    if (this.at(TokenKind.Identifier) || this.at(TokenKind.Null) || this.at(TokenKind.Undefined)) {
      const name = this.advance().value;

      // Generic type: Name<T, U>
      if (this.at(TokenKind.LessThan)) {
        const typeArgs = this.parseTypeArguments();
        ty = { kind: TypeNodeKind.Generic, name: name, typeArgs: typeArgs } as GenericTypeNode;
      } else {
        ty = { kind: TypeNodeKind.Named, name: name } as NamedTypeNode;
      }
    } else if (this.at(TokenKind.LeftBrace)) {
      // Object type literal - parse minimally
      ty = this.parseObjectTypeLiteral();
    } else if (this.at(TokenKind.LeftBracket)) {
      // Tuple type
      this.advance();
      const elements: Array<TypeNode> = [];
      while (!this.at(TokenKind.RightBracket) && !this.at(TokenKind.EOF)) {
        elements.push(this.parseTypeAnnotation());
        if (!this.eat(TokenKind.Comma)) break;
      }
      this.expect(TokenKind.RightBracket);
      ty = { kind: TypeNodeKind.Tuple } as TypeNode;
    } else if (this.at(TokenKind.StringLiteral)) {
      const val = this.advance().value;
      ty = { kind: TypeNodeKind.Literal, value: val } as TypeNode & { value: string };
    } else if (this.at(TokenKind.NumberLiteral)) {
      this.advance();
      ty = { kind: TypeNodeKind.Named, name: "number" } as NamedTypeNode;
    } else {
      throw this.error("Expected type but got " + tokenKindName(this.current.kind));
    }

    return this.parseTypePostfix(ty);
  }

  private parseTypePostfix(ty: TypeNode): TypeNode {
    // Array postfix: T[]
    while (this.at(TokenKind.LeftBracket) && this.scanner.peek().kind === TokenKind.RightBracket) {
      this.advance(); // [
      this.advance(); // ]
      ty = { kind: TypeNodeKind.Array, elementType: ty } as ArrayTypeNode;
    }
    return ty;
  }

  private parseFunctionType(): TypeNode {
    this.expect(TokenKind.LeftParen);
    const params: Array<[string, TypeNode]> = [];
    while (!this.at(TokenKind.RightParen) && !this.at(TokenKind.EOF)) {
      if (this.eat(TokenKind.DotDotDot)) {
        // rest param in type
      }
      const paramName = this.expect(TokenKind.Identifier).value;
      this.eat(TokenKind.Question);
      this.expect(TokenKind.Colon);
      const paramType = this.parseTypeAnnotation();
      params.push([paramName, paramType]);
      if (!this.eat(TokenKind.Comma)) break;
    }
    this.expect(TokenKind.RightParen);
    this.expect(TokenKind.Arrow);
    const returnType = this.parseTypeAnnotation();
    return { kind: TypeNodeKind.Function, params: params, returnType: returnType } as FunctionTypeNode;
  }

  private parseObjectTypeLiteral(): TypeNode {
    // Minimal: just skip the contents
    this.expect(TokenKind.LeftBrace);
    let depth = 1;
    while (depth > 0 && !this.at(TokenKind.EOF)) {
      if (this.at(TokenKind.LeftBrace)) depth = depth + 1;
      if (this.at(TokenKind.RightBrace)) depth = depth - 1;
      if (depth > 0) this.advance();
    }
    this.expect(TokenKind.RightBrace);
    return { kind: TypeNodeKind.Named, name: "object" } as NamedTypeNode;
  }

  private parseTypeArguments(): Array<TypeNode> {
    this.expect(TokenKind.LessThan);
    const args: Array<TypeNode> = [];
    while (!this.at(TokenKind.GreaterThan) && !this.at(TokenKind.EOF)) {
      args.push(this.parseTypeAnnotation());
      if (!this.eat(TokenKind.Comma)) break;
    }
    this.expect(TokenKind.GreaterThan);
    return args;
  }

  private parseTypeParams(): Array<string> {
    this.expect(TokenKind.LessThan);
    const params: Array<string> = [];
    while (!this.at(TokenKind.GreaterThan) && !this.at(TokenKind.EOF)) {
      params.push(this.expect(TokenKind.Identifier).value);
      // Skip extends clause in type params
      if (this.eat(TokenKind.Extends)) {
        this.parseTypeAnnotation();
      }
      // Skip default type
      if (this.eat(TokenKind.Equal)) {
        this.parseTypeAnnotation();
      }
      if (!this.eat(TokenKind.Comma)) break;
    }
    this.expect(TokenKind.GreaterThan);
    return params;
  }

  private skipTypeArgs(): void {
    if (!this.at(TokenKind.LessThan)) return;
    this.advance();
    let depth = 1;
    while (depth > 0 && !this.at(TokenKind.EOF)) {
      if (this.at(TokenKind.LessThan)) depth = depth + 1;
      if (this.at(TokenKind.GreaterThan)) depth = depth - 1;
      this.advance();
    }
  }

  // --- Expressions (Pratt parsing) ---

  private parseExpression(): AstExpr {
    return this.parseCommaExpr();
  }

  private parseCommaExpr(): AstExpr {
    // For now, comma expressions are rare in TS; just parse assignment
    return this.parseAssignmentExpr();
  }

  private parseAssignmentExpr(): AstExpr {
    const left = this.parseConditionalExpr();

    if (this.at(TokenKind.Equal)) {
      this.advance();
      const right = this.parseAssignmentExpr();
      return { kind: AstExprKind.Assign, line: left.line, col: left.col, target: left, value: right } as AssignExprAst;
    }

    if (this.at(TokenKind.PlusEqual) || this.at(TokenKind.MinusEqual) ||
        this.at(TokenKind.StarEqual) || this.at(TokenKind.SlashEqual) ||
        this.at(TokenKind.PercentEqual) || this.at(TokenKind.AmpersandEqual) ||
        this.at(TokenKind.PipeEqual) || this.at(TokenKind.CaretEqual)) {
      const op = this.advance().value;
      const right = this.parseAssignmentExpr();
      return { kind: AstExprKind.CompoundAssign, line: left.line, col: left.col, op: op, target: left, value: right } as CompoundAssignExprAst;
    }

    return left;
  }

  private parseConditionalExpr(): AstExpr {
    const expr = this.parseLogicalOr();
    if (this.eat(TokenKind.Question)) {
      const consequent = this.parseAssignmentExpr();
      this.expect(TokenKind.Colon);
      const alternate = this.parseAssignmentExpr();
      return {
        kind: AstExprKind.Conditional, line: expr.line, col: expr.col,
        condition: expr, consequent: consequent, alternate: alternate,
      } as ConditionalExprAst;
    }
    return expr;
  }

  private parseLogicalOr(): AstExpr {
    let left = this.parseLogicalAnd();
    while (this.at(TokenKind.PipePipe)) {
      const op = this.advance().value;
      const right = this.parseLogicalAnd();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseLogicalAnd(): AstExpr {
    let left = this.parseBitwiseOr();
    while (this.at(TokenKind.AmpersandAmpersand)) {
      const op = this.advance().value;
      const right = this.parseBitwiseOr();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseBitwiseOr(): AstExpr {
    let left = this.parseBitwiseXor();
    while (this.at(TokenKind.Pipe)) {
      const op = this.advance().value;
      const right = this.parseBitwiseXor();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseBitwiseXor(): AstExpr {
    let left = this.parseBitwiseAnd();
    while (this.at(TokenKind.Caret)) {
      const op = this.advance().value;
      const right = this.parseBitwiseAnd();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseBitwiseAnd(): AstExpr {
    let left = this.parseEquality();
    while (this.at(TokenKind.Ampersand)) {
      const op = this.advance().value;
      const right = this.parseEquality();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseEquality(): AstExpr {
    let left = this.parseRelational();
    while (this.at(TokenKind.EqualEqual) || this.at(TokenKind.ExclaimEqual) ||
           this.at(TokenKind.EqualEqualEqual) || this.at(TokenKind.ExclaimEqualEqual)) {
      const op = this.advance().value;
      const right = this.parseRelational();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseRelational(): AstExpr {
    let left = this.parseShift();
    while (this.at(TokenKind.LessThan) || this.at(TokenKind.GreaterThan) ||
           this.at(TokenKind.LessEqual) || this.at(TokenKind.GreaterEqual) ||
           this.at(TokenKind.Instanceof) || this.at(TokenKind.In)) {

      // Disambiguate < from type arguments
      if (this.at(TokenKind.LessThan)) {
        // If left is an identifier and this looks like a type argument, skip
        // For now, treat < as comparison in expression context
      }

      const op = this.advance().value;
      const right = this.parseShift();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }

    // Handle 'as' type assertion
    if (this.at(TokenKind.As)) {
      this.advance();
      const typeNode = this.parseTypeAnnotation();
      left = { kind: AstExprKind.TypeAs, line: left.line, col: left.col, expr: left, typeNode: typeNode } as TypeAsExprAst;
    }

    return left;
  }

  private parseShift(): AstExpr {
    let left = this.parseAdditive();
    while (this.at(TokenKind.LessLess) || this.at(TokenKind.GreaterGreater) || this.at(TokenKind.GreaterGreaterGreater)) {
      const op = this.advance().value;
      const right = this.parseAdditive();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseAdditive(): AstExpr {
    let left = this.parseMultiplicative();
    while (this.at(TokenKind.Plus) || this.at(TokenKind.Minus)) {
      const op = this.advance().value;
      const right = this.parseMultiplicative();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseMultiplicative(): AstExpr {
    let left = this.parseExponential();
    while (this.at(TokenKind.Star) || this.at(TokenKind.Slash) || this.at(TokenKind.Percent)) {
      const op = this.advance().value;
      const right = this.parseExponential();
      left = { kind: AstExprKind.Binary, line: left.line, col: left.col, op: op, left: left, right: right } as BinaryExprAst;
    }
    return left;
  }

  private parseExponential(): AstExpr {
    const expr = this.parseUnary();
    if (this.at(TokenKind.StarStar)) {
      const op = this.advance().value;
      const right = this.parseExponential(); // right-associative
      return { kind: AstExprKind.Binary, line: expr.line, col: expr.col, op: op, left: expr, right: right } as BinaryExprAst;
    }
    return expr;
  }

  private parseUnary(): AstExpr {
    if (this.at(TokenKind.Minus) || this.at(TokenKind.Plus) || this.at(TokenKind.Exclaim) || this.at(TokenKind.Tilde)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { kind: AstExprKind.Unary, line: tok.line, col: tok.col, op: tok.value, operand: operand } as UnaryExprAst;
    }
    if (this.at(TokenKind.Typeof)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { kind: AstExprKind.Typeof, line: tok.line, col: tok.col, operand: operand } as TypeofExprAst;
    }
    if (this.at(TokenKind.Void)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { kind: AstExprKind.Void, line: tok.line, col: tok.col, operand: operand } as AstExpr & { operand: AstExpr };
    }
    if (this.at(TokenKind.PlusPlus) || this.at(TokenKind.MinusMinus)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { kind: AstExprKind.Unary, line: tok.line, col: tok.col, op: tok.value, operand: operand } as UnaryExprAst;
    }
    if (this.at(TokenKind.DotDotDot)) {
      const tok = this.advance();
      const argument = this.parseAssignmentExpr();
      return { kind: AstExprKind.Spread, line: tok.line, col: tok.col, argument: argument } as SpreadExprAst;
    }
    if (this.at(TokenKind.New)) {
      return this.parseNew();
    }
    if (this.at(TokenKind.Delete)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { kind: AstExprKind.Unary, line: tok.line, col: tok.col, op: "delete", operand: operand } as UnaryExprAst;
    }
    return this.parsePostfix();
  }

  private parseNew(): NewExprAst {
    const tok = this.expect(TokenKind.New);
    let callee = this.parsePrimary();

    // Handle member access on new target: new Foo.Bar()
    while (this.at(TokenKind.Dot)) {
      this.advance();
      const prop = this.advance().value;
      callee = { kind: AstExprKind.Member, line: callee.line, col: callee.col, object: callee, property: prop } as MemberExprAst;
    }

    // Skip type args
    if (this.at(TokenKind.LessThan)) {
      this.skipTypeArgs();
    }

    const args: Array<AstExpr> = [];
    if (this.eat(TokenKind.LeftParen)) {
      while (!this.at(TokenKind.RightParen) && !this.at(TokenKind.EOF)) {
        args.push(this.parseAssignmentExpr());
        if (!this.eat(TokenKind.Comma)) break;
      }
      this.expect(TokenKind.RightParen);
    }
    return { kind: AstExprKind.New, line: tok.line, col: tok.col, callee: callee, args: args };
  }

  private parsePostfix(): AstExpr {
    let expr = this.parseCallMember();

    // Postfix ++ / --
    if (this.at(TokenKind.PlusPlus) || this.at(TokenKind.MinusMinus)) {
      const op = this.advance().value;
      expr = { kind: AstExprKind.UnaryPostfix, line: expr.line, col: expr.col, op: op, operand: expr } as UnaryPostfixExprAst;
    }

    // Non-null assertion: expr!
    if (this.at(TokenKind.Exclaim)) {
      // Only treat as non-null assertion if next token is . or [ or ( or ;
      const next = this.scanner.peek();
      if (next.kind === TokenKind.Dot || next.kind === TokenKind.LeftBracket ||
          next.kind === TokenKind.LeftParen || next.kind === TokenKind.Semicolon) {
        this.advance(); // consume !
        // No-op, just strip the assertion
      }
    }

    return expr;
  }

  private parseCallMember(): AstExpr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.at(TokenKind.Dot)) {
        this.advance();
        const prop = this.advance().value;
        expr = { kind: AstExprKind.Member, line: expr.line, col: expr.col, object: expr, property: prop } as MemberExprAst;
      } else if (this.at(TokenKind.LeftBracket)) {
        this.advance();
        const index = this.parseExpression();
        this.expect(TokenKind.RightBracket);
        expr = { kind: AstExprKind.Index, line: expr.line, col: expr.col, object: expr, index: index } as IndexExprAst;
      } else if (this.at(TokenKind.LeftParen)) {
        this.advance();
        const args: Array<AstExpr> = [];
        while (!this.at(TokenKind.RightParen) && !this.at(TokenKind.EOF)) {
          args.push(this.parseAssignmentExpr());
          if (!this.eat(TokenKind.Comma)) break;
        }
        this.expect(TokenKind.RightParen);
        expr = { kind: AstExprKind.Call, line: expr.line, col: expr.col, callee: expr, args: args, typeArgs: null } as CallExprAst;
      } else if (this.at(TokenKind.LessThan)) {
        // Could be type arguments for a generic call: fn<T>(...)
        // Try to parse as type args; if it fails, it's a comparison
        const saved = this.saveState();
        try {
          const typeArgs = this.parseTypeArguments();
          if (this.at(TokenKind.LeftParen)) {
            this.advance();
            const args: Array<AstExpr> = [];
            while (!this.at(TokenKind.RightParen) && !this.at(TokenKind.EOF)) {
              args.push(this.parseAssignmentExpr());
              if (!this.eat(TokenKind.Comma)) break;
            }
            this.expect(TokenKind.RightParen);
            expr = { kind: AstExprKind.Call, line: expr.line, col: expr.col, callee: expr, args: args, typeArgs: typeArgs } as CallExprAst;
          } else {
            // Not a generic call, restore
            this.restoreState(saved);
            break;
          }
        } catch (_e) {
          this.restoreState(saved);
          break;
        }
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): AstExpr {
    const tok = this.current;

    if (tok.kind === TokenKind.NumberLiteral) {
      this.advance();
      let raw = tok.value;
      // Remove underscores and bigint suffix
      raw = raw.split("_").join("");
      if (raw.charAt(raw.length - 1) === "n") {
        raw = raw.substring(0, raw.length - 1);
      }
      return { kind: AstExprKind.Number, line: tok.line, col: tok.col, value: Number(raw), raw: tok.value } as NumberLitExpr;
    }

    if (tok.kind === TokenKind.StringLiteral || tok.kind === TokenKind.TemplateLiteral) {
      this.advance();
      return { kind: AstExprKind.String, line: tok.line, col: tok.col, value: tok.value } as StringLitExpr;
    }

    if (tok.kind === TokenKind.True) {
      this.advance();
      return { kind: AstExprKind.Bool, line: tok.line, col: tok.col, value: true } as BoolLitExpr;
    }

    if (tok.kind === TokenKind.False) {
      this.advance();
      return { kind: AstExprKind.Bool, line: tok.line, col: tok.col, value: false } as BoolLitExpr;
    }

    if (tok.kind === TokenKind.Null) {
      this.advance();
      return { kind: AstExprKind.Null, line: tok.line, col: tok.col } as NullLitExpr;
    }

    if (tok.kind === TokenKind.Undefined) {
      this.advance();
      return { kind: AstExprKind.Undefined, line: tok.line, col: tok.col } as UndefinedLitExpr;
    }

    if (tok.kind === TokenKind.This) {
      this.advance();
      return { kind: AstExprKind.This, line: tok.line, col: tok.col } as ThisExprAst;
    }

    if (tok.kind === TokenKind.Super) {
      this.advance();
      return { kind: AstExprKind.Super, line: tok.line, col: tok.col } as SuperExprAst;
    }

    if (tok.kind === TokenKind.Identifier) {
      this.advance();

      // Check for arrow function: ident => expr
      if (this.at(TokenKind.Arrow)) {
        this.advance();
        const param: ParamDecl = { name: tok.value, typeAnnotation: null, defaultValue: null, rest: false };
        if (this.at(TokenKind.LeftBrace)) {
          const body = this.parseBlockBody();
          return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: [param], returnType: null, body: body } as ArrowExprAst;
        }
        const bodyExpr = this.parseAssignmentExpr();
        return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: [param], returnType: null, body: bodyExpr } as ArrowExprAst;
      }

      return { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tok.value } as IdentifierExpr;
    }

    if (tok.kind === TokenKind.LeftParen) {
      return this.parseParenOrArrow();
    }

    if (tok.kind === TokenKind.LeftBracket) {
      return this.parseArrayLiteral();
    }

    if (tok.kind === TokenKind.LeftBrace) {
      return this.parseObjectLiteral();
    }

    if (tok.kind === TokenKind.Function) {
      return this.parseFunctionExpr();
    }

    throw this.error("Unexpected token: " + tokenKindName(tok.kind) + " '" + tok.value + "'");
  }

  private parseParenOrArrow(): AstExpr {
    const tok = this.current;
    // Try to parse as arrow function params
    const saved = this.saveState();
    try {
      this.expect(TokenKind.LeftParen);
      const params = this.parseParamList();
      this.expect(TokenKind.RightParen);

      // Return type annotation
      let returnType: TypeNode | null = null;
      if (this.eat(TokenKind.Colon)) {
        returnType = this.parseTypeAnnotation();
      }

      if (this.at(TokenKind.Arrow)) {
        this.advance();
        if (this.at(TokenKind.LeftBrace)) {
          const body = this.parseBlockBody();
          return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: params, returnType: returnType, body: body } as ArrowExprAst;
        }
        const bodyExpr = this.parseAssignmentExpr();
        return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: params, returnType: returnType, body: bodyExpr } as ArrowExprAst;
      }

      // Not an arrow, restore and parse as parenthesized expression
      this.restoreState(saved);
    } catch (_e) {
      this.restoreState(saved);
    }

    // Parenthesized expression
    this.expect(TokenKind.LeftParen);
    const expr = this.parseExpression();
    this.expect(TokenKind.RightParen);
    return { kind: AstExprKind.Paren, line: tok.line, col: tok.col, expr: expr } as ParenExprAst;
  }

  private parseArrayLiteral(): ArrayExprAst {
    const tok = this.expect(TokenKind.LeftBracket);
    const elements: Array<AstExpr> = [];
    while (!this.at(TokenKind.RightBracket) && !this.at(TokenKind.EOF)) {
      elements.push(this.parseAssignmentExpr());
      if (!this.eat(TokenKind.Comma)) break;
    }
    this.expect(TokenKind.RightBracket);
    return { kind: AstExprKind.Array, line: tok.line, col: tok.col, elements: elements };
  }

  private parseObjectLiteral(): ObjectExprAst {
    const tok = this.expect(TokenKind.LeftBrace);
    const properties: Array<ObjectProperty> = [];
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      if (this.at(TokenKind.DotDotDot)) {
        // Spread property
        const spread = this.advance();
        const arg = this.parseAssignmentExpr();
        properties.push({ key: "...", value: arg, computed: false, shorthand: false });
        this.eat(TokenKind.Comma);
        continue;
      }

      let key: string;
      let computed = false;
      if (this.at(TokenKind.LeftBracket)) {
        computed = true;
        this.advance();
        const keyExpr = this.parseExpression();
        this.expect(TokenKind.RightBracket);
        key = "[computed]";
        // For computed, store the expression as the value
        this.expect(TokenKind.Colon);
        const value = this.parseAssignmentExpr();
        properties.push({ key: key, value: value, computed: true, shorthand: false });
        this.eat(TokenKind.Comma);
        continue;
      }

      key = this.advance().value;

      // Method shorthand: { foo() {} }
      if (this.at(TokenKind.LeftParen) || this.at(TokenKind.LessThan)) {
        if (this.at(TokenKind.LessThan)) { this.skipTypeArgs(); }
        this.expect(TokenKind.LeftParen);
        const params = this.parseParamList();
        this.expect(TokenKind.RightParen);
        let returnType: TypeNode | null = null;
        if (this.eat(TokenKind.Colon)) { returnType = this.parseTypeAnnotation(); }
        const body = this.parseBlockBody();
        const arrowExpr: ArrowExprAst = {
          kind: AstExprKind.Arrow, line: tok.line, col: tok.col,
          params: params, returnType: returnType, body: body,
        };
        properties.push({ key: key, value: arrowExpr, computed: false, shorthand: false });
        this.eat(TokenKind.Comma);
        continue;
      }

      if (this.eat(TokenKind.Colon)) {
        const value = this.parseAssignmentExpr();
        properties.push({ key: key, value: value, computed: false, shorthand: false });
      } else {
        // Shorthand: { foo } means { foo: foo }
        const ident: IdentifierExpr = { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: key };
        properties.push({ key: key, value: ident, computed: false, shorthand: true });
      }
      this.eat(TokenKind.Comma);
    }
    this.expect(TokenKind.RightBrace);
    return { kind: AstExprKind.Object, line: tok.line, col: tok.col, properties: properties };
  }

  private parseFunctionExpr(): ArrowExprAst {
    const tok = this.expect(TokenKind.Function);
    // Optional function name
    if (this.at(TokenKind.Identifier)) {
      this.advance();
    }
    if (this.at(TokenKind.LessThan)) {
      this.skipTypeArgs();
    }
    this.expect(TokenKind.LeftParen);
    const params = this.parseParamList();
    this.expect(TokenKind.RightParen);
    let returnType: TypeNode | null = null;
    if (this.eat(TokenKind.Colon)) {
      returnType = this.parseTypeAnnotation();
    }
    const body = this.parseBlockBody();
    return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: params, returnType: returnType, body: body };
  }

  // --- Save/restore for backtracking ---

  private saveState(): [number, number, number, Token] {
    return [
      (this.scanner as any).pos,
      (this.scanner as any).line,
      (this.scanner as any).col,
      this.current,
    ];
  }

  private restoreState(state: [number, number, number, Token]): void {
    (this.scanner as any).pos = state[0];
    (this.scanner as any).line = state[1];
    (this.scanner as any).col = state[2];
    this.current = state[3];
  }
}

function tokenKindName(kind: TokenKind): string {
  if (kind === TokenKind.EOF) return "EOF";
  if (kind === TokenKind.NumberLiteral) return "number";
  if (kind === TokenKind.StringLiteral) return "string";
  if (kind === TokenKind.Identifier) return "identifier";
  if (kind === TokenKind.LeftParen) return "(";
  if (kind === TokenKind.RightParen) return ")";
  if (kind === TokenKind.LeftBrace) return "{";
  if (kind === TokenKind.RightBrace) return "}";
  if (kind === TokenKind.LeftBracket) return "[";
  if (kind === TokenKind.RightBracket) return "]";
  if (kind === TokenKind.Semicolon) return ";";
  if (kind === TokenKind.Comma) return ",";
  if (kind === TokenKind.Colon) return ":";
  if (kind === TokenKind.Dot) return ".";
  if (kind === TokenKind.Equal) return "=";
  if (kind === TokenKind.Arrow) return "=>";
  if (kind === TokenKind.LessThan) return "<";
  if (kind === TokenKind.GreaterThan) return ">";
  return "token(" + kind + ")";
}
