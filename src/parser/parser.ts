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
  NewExprAst, TemplateExprAst, TypeAsExprAst, TypeofExprAst, SpreadExprAst,
  ThisExprAst, SuperExprAst, ParenExprAst, AwaitExprAst, YieldExprAst,
  NamedTypeNode, ArrayTypeNode, FunctionTypeNode, UnionTypeNode, GenericTypeNode,
} from "./ast";

export class Parser {
  private scanner: Scanner;
  private current: Token;
  private fileName: string;
  private prevScanPos: number;
  private prevScanLine: number;
  private prevScanCol: number;

  constructor(source: string, fileName: string) {
    this.scanner = new Scanner(source);
    this.prevScanPos = this.scanner.getPos();
    this.prevScanLine = this.scanner.getLine();
    this.prevScanCol = this.scanner.getCol();
    this.current = this.scanner.scan();
    this.fileName = fileName;
  }

  parse(): SourceFile {
    console.error("[parse] start, current.kind=" + this.current.kind + " EOF=" + TokenKind.EOF);
    const stmts: Array<AstStmt> = [];
    while (this.current.kind !== TokenKind.EOF) {
      console.error("[parse] parseStatement, current.kind=" + this.current.kind + " value=" + this.current.value);
      stmts.push(this.parseStatement());
    }
    console.error("[parse] done, " + stmts.length + " stmts");
    return { statements: stmts, fileName: this.fileName };
  }

  // --- Token helpers ---

  private advance(): Token {
    const prev = this.current;
    this.prevScanPos = this.scanner.getPos();
    this.prevScanLine = this.scanner.getLine();
    this.prevScanCol = this.scanner.getCol();
    this.current = this.scanner.scan();
    return prev;
  }

  private expect(kind: number): Token {
    if (this.current.kind !== kind) {
      throw this.error("Expected " + tokenKindName(kind) + " but got " + tokenKindName(this.current.kind) + " '" + this.current.value + "'");
    }
    return this.advance();
  }

  private eat(kind: number): boolean {
    if (this.current.kind === kind) {
      this.advance();
      return true;
    }
    return false;
  }

  private at(kind: number): boolean {
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
      return this.parseFunctionDecl(false);
    }
    if (kind === TokenKind.Async) {
      const next = this.scanner.peek();
      if (next.kind === TokenKind.Function) {
        this.advance(); // consume 'async'
        return this.parseFunctionDecl(true);
      }
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

  private parseVarDecl(): AstStmt {
    const tok = this.advance();
    const declKind = tok.value;

    // Array destructuring: let [a, b, c] = expr
    if (this.at(TokenKind.LeftBracket)) {
      return this.parseArrayDestructuring(tok, declKind);
    }

    // Object destructuring: let { x, y } = expr
    if (this.at(TokenKind.LeftBrace)) {
      return this.parseObjectDestructuring(tok, declKind);
    }

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
    } as VarDeclAst;
  }

  private parseArrayDestructuring(tok: Token, declKind: string): AstStmt {
    this.expect(TokenKind.LeftBracket);
    const names: Array<string> = [];
    let restName: string | null = null;
    let restIndex = -1;
    while (!this.at(TokenKind.RightBracket) && !this.at(TokenKind.EOF)) {
      if (this.at(TokenKind.Comma)) {
        // Skip element (hole in destructuring)
        names.push("");
        this.advance();
        continue;
      }
      if (this.eat(TokenKind.DotDotDot)) {
        restName = this.expect(TokenKind.Identifier).value;
        restIndex = names.length;
        if (!this.at(TokenKind.RightBracket)) {
          this.eat(TokenKind.Comma);
        }
        break;
      }
      names.push(this.expect(TokenKind.Identifier).value);
      if (!this.at(TokenKind.RightBracket)) {
        this.expect(TokenKind.Comma);
      }
    }
    this.expect(TokenKind.RightBracket);

    // Skip optional type annotation
    if (this.eat(TokenKind.Colon)) {
      this.parseTypeAnnotation();
    }

    this.expect(TokenKind.Equal);
    const init = this.parseExpression();
    this.eat(TokenKind.Semicolon);

    // Desugar: let __tmp = init; let a = __tmp[0]; let b = __tmp[1]; ...
    const tmpName = "__destr_" + tok.line + "_" + tok.col;
    const stmts: Array<AstStmt> = [];
    stmts.push({
      kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col,
      declKind: declKind, name: tmpName, typeAnnotation: null, init: init,
    } as VarDeclAst);

    for (let i = 0; i < names.length; i = i + 1) {
      if (names[i] === "") continue; // skip holes
      const indexExpr: AstExpr = {
        kind: AstExprKind.Index, line: tok.line, col: tok.col,
        object: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpName } as IdentifierExpr,
        index: { kind: AstExprKind.Number, line: tok.line, col: tok.col, value: i, raw: "" + i } as NumberLitExpr,
      } as IndexExprAst;
      stmts.push({
        kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col,
        declKind: declKind, name: names[i], typeAnnotation: null, init: indexExpr,
      } as VarDeclAst);
    }

    // Rest pattern: let rest = __tmp.slice(N)
    if (restName !== null) {
      const sliceExpr: AstExpr = {
        kind: AstExprKind.Call, line: tok.line, col: tok.col,
        callee: {
          kind: AstExprKind.Member, line: tok.line, col: tok.col,
          object: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpName } as IdentifierExpr,
          property: "slice", optional: false,
        } as MemberExprAst,
        args: [{ kind: AstExprKind.Number, line: tok.line, col: tok.col, value: restIndex, raw: "" + restIndex } as NumberLitExpr],
        typeArgs: null,
      } as CallExprAst;
      stmts.push({
        kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col,
        declKind: declKind, name: restName, typeAnnotation: null, init: sliceExpr,
      } as VarDeclAst);
    }

    return { kind: AstStmtKind.Block, line: tok.line, col: tok.col, body: stmts } as BlockStmtAst;
  }

  private parseObjectDestructuring(tok: Token, declKind: string): AstStmt {
    this.expect(TokenKind.LeftBrace);
    const bindings: Array<{ key: string; local: string; defaultVal: AstExpr | null; rest: boolean }> = [];
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      // Rest pattern: ...rest
      if (this.at(TokenKind.DotDotDot)) {
        this.advance();
        const restName = this.expect(TokenKind.Identifier).value;
        bindings.push({ key: restName, local: restName, defaultVal: null, rest: true });
        if (!this.at(TokenKind.RightBrace)) {
          this.eat(TokenKind.Comma);
        }
        continue;
      }
      const key = this.expect(TokenKind.Identifier).value;
      let local = key;
      if (this.eat(TokenKind.Colon)) {
        // Rename: { x: a }
        local = this.expect(TokenKind.Identifier).value;
      }
      let defaultVal: AstExpr | null = null;
      if (this.eat(TokenKind.Equal)) {
        defaultVal = this.parseExpression();
      }
      bindings.push({ key: key, local: local, defaultVal: defaultVal, rest: false });
      if (!this.at(TokenKind.RightBrace)) {
        this.expect(TokenKind.Comma);
      }
    }
    this.expect(TokenKind.RightBrace);

    // Skip type assertion (e.g., "as any")
    if (this.at(TokenKind.Colon)) {
      this.advance();
      this.parseTypeAnnotation();
    }

    this.expect(TokenKind.Equal);
    const init = this.parseExpression();
    // Handle "as any" after the init expression
    this.eat(TokenKind.Semicolon);

    // Desugar: let __tmp = init; let x = __tmp.x; let y = __tmp.y; ...
    const tmpName = "__destr_" + tok.line + "_" + tok.col;
    const stmts: Array<AstStmt> = [];
    stmts.push({
      kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col,
      declKind: declKind, name: tmpName, typeAnnotation: null, init: init,
    } as VarDeclAst);

    // Collect non-rest keys for the rest pattern
    const nonRestKeys: Array<string> = [];
    for (let i = 0; i < bindings.length; i = i + 1) {
      if (!bindings[i].rest) {
        nonRestKeys.push(bindings[i].key);
      }
    }

    for (let i = 0; i < bindings.length; i = i + 1) {
      const binding = bindings[i];
      if (binding.rest) {
        // Rest pattern: restObj = $object_rest(__tmp, [excluded_keys...])
        // Build array literal of excluded key strings
        const excludeElements: Array<AstExpr> = [];
        for (let k = 0; k < nonRestKeys.length; k = k + 1) {
          excludeElements.push({
            kind: AstExprKind.String, line: tok.line, col: tok.col,
            value: nonRestKeys[k],
          } as StringLitExpr);
        }
        const excludeArray: AstExpr = {
          kind: AstExprKind.Array, line: tok.line, col: tok.col,
          elements: excludeElements,
        } as ArrayExprAst;
        // $object_rest(src, excludeKeys)
        const restExpr: AstExpr = {
          kind: AstExprKind.Call, line: tok.line, col: tok.col,
          callee: {
            kind: AstExprKind.Identifier, line: tok.line, col: tok.col,
            name: "$object_rest",
          } as IdentifierExpr,
          args: [
            { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpName } as IdentifierExpr,
            excludeArray,
          ],
          typeArgs: null,
        } as CallExprAst;
        stmts.push({
          kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col,
          declKind: declKind, name: binding.local, typeAnnotation: null, init: restExpr,
        } as VarDeclAst);
        continue;
      }
      let accessExpr: AstExpr = {
        kind: AstExprKind.Member, line: tok.line, col: tok.col,
        object: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpName } as IdentifierExpr,
        property: binding.key, optional: false,
      } as MemberExprAst;
      if (binding.defaultVal !== null) {
        // x = __tmp.x !== undefined ? __tmp.x : defaultVal
        accessExpr = {
          kind: AstExprKind.Conditional, line: tok.line, col: tok.col,
          condition: {
            kind: AstExprKind.Binary, line: tok.line, col: tok.col,
            op: "!==", left: accessExpr,
            right: { kind: AstExprKind.Undefined, line: tok.line, col: tok.col } as UndefinedLitExpr,
          } as BinaryExprAst,
          consequent: {
            kind: AstExprKind.Member, line: tok.line, col: tok.col,
            object: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpName } as IdentifierExpr,
            property: binding.key, optional: false,
          } as MemberExprAst,
          alternate: binding.defaultVal,
        } as ConditionalExprAst;
      }
      stmts.push({
        kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col,
        declKind: declKind, name: binding.local, typeAnnotation: null, init: accessExpr,
      } as VarDeclAst);
    }

    return { kind: AstStmtKind.Block, line: tok.line, col: tok.col, body: stmts } as BlockStmtAst;
  }

  private parseFunctionDecl(isAsync: boolean): FunctionDeclAst {
    const tok = this.expect(TokenKind.Function);
    const isGenerator = this.eat(TokenKind.Star);
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

    // Function overload declaration (no body, ends with ;)
    if (this.eat(TokenKind.Semicolon)) {
      return {
        kind: AstStmtKind.FunctionDecl, line: tok.line, col: tok.col,
        name: name, params: params, returnType: returnType, typeParams: typeParams, body: [],
        async: isAsync, generator: isGenerator,
      };
    }

    const body = this.parseBlockBody();
    return {
      kind: AstStmtKind.FunctionDecl, line: tok.line, col: tok.col,
      name: name, params: params, returnType: returnType, typeParams: typeParams, body: body,
      async: isAsync, generator: isGenerator,
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
      let paramAccess: string | null = null;
      if (this.at(TokenKind.Public) || this.at(TokenKind.Private) || this.at(TokenKind.Protected)) {
        paramAccess = this.advance().value;
        // May have multiple modifiers
        if (this.at(TokenKind.Readonly)) {
          this.advance();
        }
      } else if (this.at(TokenKind.Readonly)) {
        this.advance();
      }

      // Handle 'this' parameter (TypeScript explicit this typing)
      let name: string;
      if (this.at(TokenKind.This)) {
        name = this.advance().value;
        // 'this' parameters are just type annotations, skip them
        if (this.eat(TokenKind.Colon)) {
          this.parseTypeAnnotation();
        }
        if (!this.eat(TokenKind.Comma)) break;
        continue;
      }
      name = this.expect(TokenKind.Identifier).value;
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

      params.push({ name: name, typeAnnotation: typeAnnotation, defaultValue: defaultValue, rest: rest, accessibility: paramAccess });

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

    // Check for for..in / for..of: for (let/const/var x in/of expr)
    if (this.at(TokenKind.Let) || this.at(TokenKind.Const) || this.at(TokenKind.Var)) {
      const declTok = this.advance();
      const declKind = declTok.value;

      // Check if next token after identifier is 'in' or 'of'
      if (this.at(TokenKind.Identifier)) {
        const varName = this.advance().value;

        if (this.at(TokenKind.In) || this.at(TokenKind.Of)) {
          const iterKind = this.advance().value; // "in" or "of"
          const iterExpr = this.parseExpression();
          this.expect(TokenKind.RightParen);
          const body = this.parseStatementOrBlock();
          return this.desugarForInOf(tok, declKind, varName, iterKind, iterExpr, body);
        }

        // Regular for loop — continue parsing as VarDecl
        let typeAnnotation: TypeNode | null = null;
        if (this.eat(TokenKind.Colon)) {
          typeAnnotation = this.parseTypeAnnotation();
        }
        let varInit: AstExpr | null = null;
        if (this.eat(TokenKind.Equal)) {
          varInit = this.parseExpression();
        }
        this.eat(TokenKind.Semicolon);
        const init: AstStmt = {
          kind: AstStmtKind.VarDecl, line: declTok.line, col: declTok.col,
          declKind: declKind, name: varName, typeAnnotation: typeAnnotation, init: varInit,
        } as VarDeclAst;
        return this.parseForRest(tok, init);
      } else {
        // Destructuring in for-loop init — parse as var decl
        // Put back the let/const/var by rewinding... actually just parse the rest
        const init = this.parseVarDeclContinuation(declTok, declKind);
        return this.parseForRest(tok, init);
      }
    }

    let init: AstStmt | null = null;
    if (!this.at(TokenKind.Semicolon)) {
      const expr = this.parseExpression();
      init = { kind: AstStmtKind.Expr, line: expr.line, col: expr.col, expr: expr } as ExprStmtAst;
      this.eat(TokenKind.Semicolon);
    } else {
      this.eat(TokenKind.Semicolon);
    }
    return this.parseForRest(tok, init);
  }

  private parseForRest(tok: Token, init: AstStmt | null): ForStmtAst {
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

  private parseVarDeclContinuation(declTok: Token, declKind: string): AstStmt {
    // Handle case where we've already consumed let/const/var but haven't seen an identifier
    // This handles destructuring patterns in for-loop inits
    if (this.at(TokenKind.LeftBracket)) {
      return this.parseArrayDestructuring(declTok, declKind);
    }
    if (this.at(TokenKind.LeftBrace)) {
      return this.parseObjectDestructuring(declTok, declKind);
    }
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
      kind: AstStmtKind.VarDecl, line: declTok.line, col: declTok.col,
      declKind: declKind, name: name, typeAnnotation: typeAnnotation, init: init,
    } as VarDeclAst;
  }

  private desugarForInOf(tok: Token, declKind: string, varName: string, iterKind: string, iterExpr: AstExpr, body: AstStmt): AstStmt {
    // Desugar for..in/of to a regular for loop
    const tmpArr = "__forin_" + tok.line + "_" + tok.col;
    const tmpIdx = "__forin_i_" + tok.line + "_" + tok.col;
    const tmpLen = "__forin_len_" + tok.line + "_" + tok.col;

    const stmts: Array<AstStmt> = [];

    if (iterKind === "in") {
      // for (let key in obj) -> let __keys = Object.keys(obj); for (let i=0; i<__keys.length; i++) { let key = __keys[i]; ... }
      // Emit as: let __keys = $object_keys(obj)
      const keysCall: AstExpr = {
        kind: AstExprKind.Call, line: tok.line, col: tok.col,
        callee: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: "$object_keys" } as IdentifierExpr,
        args: [iterExpr],
        typeArgs: null,
      } as CallExprAst;
      stmts.push({ kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col, declKind: "let", name: tmpArr, typeAnnotation: null, init: keysCall } as VarDeclAst);
    } else {
      // for (let x of arr) -> iterate over array directly
      stmts.push({ kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col, declKind: "let", name: tmpArr, typeAnnotation: null, init: iterExpr } as VarDeclAst);
    }

    // let __len = __arr.length
    const lenExpr: AstExpr = {
      kind: AstExprKind.Member, line: tok.line, col: tok.col,
      object: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpArr } as IdentifierExpr,
      property: "length", optional: false,
    } as MemberExprAst;
    stmts.push({ kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col, declKind: "let", name: tmpLen, typeAnnotation: null, init: lenExpr } as VarDeclAst);

    // let __i = 0
    const zeroExpr: AstExpr = { kind: AstExprKind.Number, line: tok.line, col: tok.col, value: 0, raw: "0" } as NumberLitExpr;
    const initStmt: AstStmt = { kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col, declKind: "let", name: tmpIdx, typeAnnotation: null, init: zeroExpr } as VarDeclAst;

    // __i < __len
    const condition: AstExpr = {
      kind: AstExprKind.Binary, line: tok.line, col: tok.col, op: "<",
      left: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpIdx } as IdentifierExpr,
      right: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpLen } as IdentifierExpr,
    } as BinaryExprAst;

    // __i = __i + 1
    const update: AstExpr = {
      kind: AstExprKind.Assign, line: tok.line, col: tok.col,
      target: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpIdx } as IdentifierExpr,
      value: {
        kind: AstExprKind.Binary, line: tok.line, col: tok.col, op: "+",
        left: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpIdx } as IdentifierExpr,
        right: { kind: AstExprKind.Number, line: tok.line, col: tok.col, value: 1, raw: "1" } as NumberLitExpr,
      } as BinaryExprAst,
    } as AssignExprAst;

    // let varName = __arr[__i]
    const elemAccess: AstExpr = {
      kind: AstExprKind.Index, line: tok.line, col: tok.col,
      object: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpArr } as IdentifierExpr,
      index: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: tmpIdx } as IdentifierExpr,
    } as IndexExprAst;
    const elemDecl: AstStmt = { kind: AstStmtKind.VarDecl, line: tok.line, col: tok.col, declKind: declKind, name: varName, typeAnnotation: null, init: elemAccess } as VarDeclAst;

    // Wrap body in block with elem decl prepended
    let bodyStmts: Array<AstStmt> = [];
    bodyStmts.push(elemDecl);
    if (body.kind === AstStmtKind.Block) {
      const blockBody = (body as BlockStmtAst).body;
      for (let i = 0; i < blockBody.length; i = i + 1) {
        bodyStmts.push(blockBody[i]);
      }
    } else {
      bodyStmts.push(body);
    }
    const forBody: AstStmt = { kind: AstStmtKind.Block, line: tok.line, col: tok.col, body: bodyStmts } as BlockStmtAst;

    const forStmt: ForStmtAst = {
      kind: AstStmtKind.For, line: tok.line, col: tok.col,
      init: initStmt, condition: condition, update: update, body: forBody,
    } as ForStmtAst;
    stmts.push(forStmt);

    return { kind: AstStmtKind.Block, line: tok.line, col: tok.col, body: stmts } as BlockStmtAst;
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

    // Parse 'implements' clause
    let implementsInterfaces: Array<string> | null = null;
    if (this.eat(TokenKind.Implements)) {
      implementsInterfaces = [];
      implementsInterfaces.push(this.expect(TokenKind.Identifier).value);
      while (this.eat(TokenKind.Comma)) {
        implementsInterfaces.push(this.expect(TokenKind.Identifier).value);
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
      implementsInterfaces: implementsInterfaces,
    };
  }

  private parseClassMember(): ClassMemberAst {
    let isStatic = false;
    let accessibility: string | null = null;
    let isReadonly = false;
    let isAbstract = false;
    let decorator: string | null = null;

    // Parse decorator (@name)
    if (this.at(TokenKind.At)) {
      this.advance();
      decorator = this.expect(TokenKind.Identifier).value;
    }

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
        isReadonly: isReadonly, params: [], returnType: returnType, typeAnnotation: null,
        body: body, initializer: null, decorator: decorator,
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
        isReadonly: isReadonly, params: params, returnType: null, typeAnnotation: null,
        body: body, initializer: null, decorator: decorator,
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
        isReadonly: false, params: params, returnType: null, typeAnnotation: null,
        body: body, initializer: null, decorator: decorator,
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
        isReadonly: isReadonly, params: params, returnType: returnType, typeAnnotation: null,
        body: body, initializer: null, decorator: decorator,
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
      isReadonly: isReadonly, params: null, returnType: null, typeAnnotation: typeAnnotation,
      body: null, initializer: initializer, decorator: decorator,
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
      if (this.at(TokenKind.Async) && this.scanner.peek().kind === TokenKind.Function) {
        this.advance(); // consume 'async'
        declaration = this.parseFunctionDecl(true);
      } else if (this.at(TokenKind.Function)) {
        declaration = this.parseFunctionDecl(false);
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
    const aliasType = this.parseTypeAnnotation();
    this.eat(TokenKind.Semicolon);

    return {
      kind: AstStmtKind.TypeAliasDecl, line: tok.line, col: tok.col,
      name: name, typeParams: typeParams, type: aliasType,
    };
  }

  private parseExprStmt(): ExprStmtAst {
    const expr = this.parseExpression();
    this.eat(TokenKind.Semicolon);
    return { kind: AstStmtKind.Expr, line: expr.line, col: expr.col, expr: expr };
  }

  // --- Type annotations ---

  private parseTypeAnnotation(): TypeNode {
    // Handle leading | for discriminated unions: type X = | A | B
    if (this.at(TokenKind.Pipe)) {
      const members: Array<TypeNode> = [];
      while (this.eat(TokenKind.Pipe)) {
        members.push(this.parsePrimaryType());
      }
      if (members.length === 1) return members[0];
      return { kind: TypeNodeKind.Union, members: members } as UnionTypeNode;
    }

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
      // Use lookahead to detect function type by checking for => after matching )
      if (this.looksLikeArrowParams()) {
        ty = this.parseFunctionType();
        return this.parseTypePostfix(ty);
      } else {
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
      ty = { kind: TypeNodeKind.TypeOf, name: name } as any;
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

      // Handle dotted type names (e.g., ExprKind.Number, StmtKind.Expr)
      let fullName = name;
      while (this.eat(TokenKind.Dot)) {
        fullName = fullName + "." + this.advance().value;
      }
      // Generic type: Name<T, U>
      if (this.at(TokenKind.LessThan)) {
        const typeArgs = this.parseTypeArguments();
        ty = { kind: TypeNodeKind.Generic, name: fullName, typeArgs: typeArgs } as GenericTypeNode;
      } else {
        ty = { kind: TypeNodeKind.Named, name: fullName } as NamedTypeNode;
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
      ty = { kind: TypeNodeKind.Literal, value: val } as any;
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
    this.expect(TokenKind.LeftBrace);
    const members: Array<[string, TypeNode]> = [];
    while (!this.at(TokenKind.RightBrace) && !this.at(TokenKind.EOF)) {
      // Skip readonly modifier (only if followed by identifier, not colon)
      if (this.at(TokenKind.Identifier) && this.current.value === "readonly") {
        // Save scanner state to check next token
        const savedPos = this.scanner.getPos();
        const savedLine = this.scanner.getLine();
        const savedCol = this.scanner.getCol();
        const savedCurrent = this.current;
        this.advance();
        if (this.at(TokenKind.Identifier) || this.at(TokenKind.LeftBracket)) {
          // "readonly" was a modifier, skip it
        } else {
          // "readonly" is actually the field name, restore
          this.scanner.setPos(savedPos);
          this.scanner.setLine(savedLine);
          this.scanner.setCol(savedCol);
          this.current = savedCurrent;
        }
      }
      if (this.at(TokenKind.LeftBracket)) {
        // Index signature like [key: string]: Type - skip it
        let depth = 1;
        this.advance();
        while (depth > 0 && !this.at(TokenKind.EOF)) {
          if (this.at(TokenKind.LeftBracket)) depth = depth + 1;
          if (this.at(TokenKind.RightBracket)) depth = depth - 1;
          if (depth > 0) this.advance();
        }
        this.expect(TokenKind.RightBracket);
        if (this.eat(TokenKind.Colon)) {
          this.parseTypeAnnotation();
        }
      } else if (this.at(TokenKind.Identifier) || this.at(TokenKind.StringLiteral)) {
        const name = this.advance().value;
        const optional = this.eat(TokenKind.Question);
        if (this.at(TokenKind.LeftParen) || this.at(TokenKind.LessThan)) {
          // Method signature: name(params): RetType - skip
          if (this.at(TokenKind.LessThan)) {
            this.parseTypeArguments();
          }
          this.expect(TokenKind.LeftParen);
          let pDepth = 1;
          while (pDepth > 0 && !this.at(TokenKind.EOF)) {
            if (this.at(TokenKind.LeftParen)) pDepth = pDepth + 1;
            if (this.at(TokenKind.RightParen)) pDepth = pDepth - 1;
            if (pDepth > 0) this.advance();
          }
          this.expect(TokenKind.RightParen);
          if (this.eat(TokenKind.Colon)) {
            this.parseTypeAnnotation();
          }
          members.push([name, { kind: TypeNodeKind.Named, name: "any" } as NamedTypeNode]);
        } else if (this.eat(TokenKind.Colon)) {
          const ty = this.parseTypeAnnotation();
          members.push([name, ty]);
        } else {
          members.push([name, { kind: TypeNodeKind.Named, name: "any" } as NamedTypeNode]);
        }
      } else {
        this.advance(); // skip unknown tokens
      }
      this.eat(TokenKind.Semicolon);
      this.eat(TokenKind.Comma);
    }
    this.expect(TokenKind.RightBrace);
    if (members.length > 0) {
      return { kind: TypeNodeKind.ObjectLiteral, members: members } as any;
    }
    return { kind: TypeNodeKind.Named, name: "object" } as NamedTypeNode;
  }

  private parseTypeArguments(): Array<TypeNode> {
    this.expect(TokenKind.LessThan);
    const args: Array<TypeNode> = [];
    while (!this.at(TokenKind.GreaterThan) && !this.at(TokenKind.GreaterGreater) && !this.at(TokenKind.EOF)) {
      args.push(this.parseTypeAnnotation());
      if (!this.eat(TokenKind.Comma)) break;
    }
    // Handle >> as two > tokens for nested generics like Map<string, Map<K, V>>
    if (this.at(TokenKind.GreaterGreater)) {
      // Consume >> but leave a > token by replacing current token
      this.current = { kind: TokenKind.GreaterThan, value: ">", line: this.current.line, col: this.current.col + 1 };
    } else {
      this.expect(TokenKind.GreaterThan);
    }
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
        this.at(TokenKind.PipeEqual) || this.at(TokenKind.CaretEqual) ||
        this.at(TokenKind.LessLessEqual) || this.at(TokenKind.GreaterGreaterEqual) ||
        this.at(TokenKind.GreaterGreaterGreaterEqual) || this.at(TokenKind.QuestionQuestionEqual)) {
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
    while (this.at(TokenKind.PipePipe) || this.at(TokenKind.QuestionQuestion)) {
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
      return { kind: AstExprKind.Void, line: tok.line, col: tok.col, operand: operand } as any;
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
      let newExpr: AstExpr = this.parseNew();
      // Allow chaining member access / calls after new: new Foo(5).bar()
      while (this.at(TokenKind.Dot) || this.at(TokenKind.LeftBracket) || this.at(TokenKind.LeftParen)) {
        if (this.at(TokenKind.Dot)) {
          this.advance();
          const prop = this.advance().value;
          newExpr = { kind: AstExprKind.Member, line: newExpr.line, col: newExpr.col, object: newExpr, property: prop, optional: false } as MemberExprAst;
        } else if (this.at(TokenKind.LeftBracket)) {
          this.advance();
          const idx = this.parseExpression();
          this.expect(TokenKind.RightBracket);
          newExpr = { kind: AstExprKind.Index, line: newExpr.line, col: newExpr.col, object: newExpr, index: idx } as IndexExprAst;
        } else if (this.at(TokenKind.LeftParen)) {
          this.advance();
          const callArgs: Array<AstExpr> = [];
          while (!this.at(TokenKind.RightParen) && !this.at(TokenKind.EOF)) {
            callArgs.push(this.parseAssignmentExpr());
            if (!this.eat(TokenKind.Comma)) break;
          }
          this.expect(TokenKind.RightParen);
          newExpr = { kind: AstExprKind.Call, line: newExpr.line, col: newExpr.col, callee: newExpr, args: callArgs, typeArgs: null } as CallExprAst;
        }
      }
      return newExpr;
    }
    if (this.at(TokenKind.Delete)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { kind: AstExprKind.Unary, line: tok.line, col: tok.col, op: "delete", operand: operand } as UnaryExprAst;
    }
    if (this.at(TokenKind.Await)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { kind: AstExprKind.Await, line: tok.line, col: tok.col, operand: operand } as AwaitExprAst;
    }
    if (this.at(TokenKind.Yield)) {
      const tok = this.advance();
      let operand: AstExpr | null = null;
      // yield has an optional operand; check if there's an expression following
      if (!this.at(TokenKind.Semicolon) && !this.at(TokenKind.RightBrace) && !this.at(TokenKind.RightParen) && !this.at(TokenKind.Comma) && !this.at(TokenKind.EOF)) {
        operand = this.parseAssignmentExpr();
      }
      return { kind: AstExprKind.Yield, line: tok.line, col: tok.col, operand: operand } as YieldExprAst;
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
      callee = { kind: AstExprKind.Member, line: callee.line, col: callee.col, object: callee, property: prop, optional: false } as MemberExprAst;
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
      if (this.at(TokenKind.Dot) || this.at(TokenKind.QuestionDot)) {
        const isOptional = this.at(TokenKind.QuestionDot);
        this.advance();
        // ?.[expr] — optional index access
        if (isOptional && this.at(TokenKind.LeftBracket)) {
          this.advance();
          const index = this.parseExpression();
          this.expect(TokenKind.RightBracket);
          expr = { kind: AstExprKind.Index, line: expr.line, col: expr.col, object: expr, index: index } as IndexExprAst;
        } else {
          const prop = this.advance().value;
          expr = { kind: AstExprKind.Member, line: expr.line, col: expr.col, object: expr, property: prop, optional: isOptional } as MemberExprAst;
        }
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
        // Use lookahead: scan to matching > and check if ( follows
        if (this.looksLikeTypeArgs()) {
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
            break;
          }
        } else {
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
      // Remove underscores and bigint suffix (avoid method chaining - Perry bug)
      let rawParts: Array<string> = raw.split("_");
      raw = rawParts.join("");
      if (raw.charAt(raw.length - 1) === "n") {
        raw = raw.substring(0, raw.length - 1);
      }
      const numVal = Number(raw);
      return { kind: AstExprKind.Number, line: tok.line, col: tok.col, value: numVal, raw: tok.value } as NumberLitExpr;
    }

    if (tok.kind === TokenKind.StringLiteral || tok.kind === TokenKind.TemplateLiteral) {
      this.advance();
      return { kind: AstExprKind.String, line: tok.line, col: tok.col, value: tok.value } as StringLitExpr;
    }

    if (tok.kind === TokenKind.TemplateHead) {
      return this.parseTemplateExpression();
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
        const param: ParamDecl = { name: tok.value, typeAnnotation: null, defaultValue: null, rest: false, accessibility: null };
        if (this.at(TokenKind.LeftBrace)) {
          const body = this.parseBlockBody();
          return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: [param], returnType: null, body: body, async: false } as ArrowExprAst;
        }
        const bodyExpr = this.parseAssignmentExpr();
        return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: [param], returnType: null, body: bodyExpr, async: false } as ArrowExprAst;
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

    if (tok.kind === TokenKind.Async) {
      // async function expr
      if (this.scanner.peek().kind === TokenKind.Function) {
        this.advance(); // consume 'async'
        return this.parseFunctionExpr(true);
      }
      // async (...) => ... or async x => ...
      if (this.scanner.peek().kind === TokenKind.LeftParen) {
        this.advance(); // consume 'async'
        return this.parseParenOrArrow(true);
      }
      if (this.scanner.peek().kind === TokenKind.Identifier) {
        this.advance(); // consume 'async'
        const idTok = this.advance();
        // Must be followed by =>
        if (this.at(TokenKind.Arrow)) {
          this.advance();
          const param: ParamDecl = { name: idTok.value, typeAnnotation: null, defaultValue: null, rest: false, accessibility: null };
          if (this.at(TokenKind.LeftBrace)) {
            const body = this.parseBlockBody();
            return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: [param], returnType: null, body: body, async: true } as ArrowExprAst;
          }
          const bodyExpr = this.parseAssignmentExpr();
          return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: [param], returnType: null, body: bodyExpr, async: true } as ArrowExprAst;
        }
      }
      // Fall through: treat 'async' as identifier
      this.advance();
      return { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: "async" } as IdentifierExpr;
    }

    if (tok.kind === TokenKind.Function) {
      return this.parseFunctionExpr(false);
    }

    // Regex literal: / at start of expression
    if (tok.kind === TokenKind.Slash) {
      // prevScanPos is the scanner state BEFORE `this.current` was scanned.
      // Restore scanner to that state and rescan as regex.
      this.scanner.setPos(this.prevScanPos);
      this.scanner.setLine(this.prevScanLine);
      this.scanner.setCol(this.prevScanCol);
      const regexTok = this.scanner.scanRegex();
      this.current = this.scanner.scan();
      const nulIdx = regexTok.value.indexOf("\0");
      const pattern = nulIdx >= 0 ? regexTok.value.substring(0, nulIdx) : regexTok.value;
      const flags = nulIdx >= 0 ? regexTok.value.substring(nulIdx + 1) : "";
      return {
        kind: AstExprKind.New, line: tok.line, col: tok.col,
        callee: { kind: AstExprKind.Identifier, line: tok.line, col: tok.col, name: "$regex" } as IdentifierExpr,
        args: [
          { kind: AstExprKind.String, line: tok.line, col: tok.col, value: pattern } as StringLitExpr,
          { kind: AstExprKind.String, line: tok.line, col: tok.col, value: flags } as StringLitExpr,
        ],
      } as NewExprAst;
    }

    throw this.error("Unexpected token: " + tokenKindName(tok.kind) + " '" + tok.value + "'");
  }

  private parseParenOrArrow(isAsync: boolean = false): AstExpr {
    const tok = this.current;
    // Heuristic: check if this looks like arrow function params
    // Arrow: () =>, (id) =>, (id: type) =>, (id, ...) =>
    // Use saveState to look ahead and find matching ), then check for =>
    if (this.looksLikeArrowParams()) {
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
          return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: params, returnType: returnType, body: body, async: isAsync } as ArrowExprAst;
        }
        const bodyExpr = this.parseAssignmentExpr();
        return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: params, returnType: returnType, body: bodyExpr, async: isAsync } as ArrowExprAst;
      }
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

  private parseTemplateExpression(): TemplateExprAst {
    const tok = this.advance(); // consume TemplateHead
    const parts: Array<string> = [tok.value];
    const expressions: Array<AstExpr> = [];
    // Parse expression after TemplateHead
    expressions.push(this.parseExpression());
    // Parse TemplateMiddle* TemplateTail
    while (this.at(TokenKind.TemplateMiddle)) {
      const mid = this.advance();
      parts.push(mid.value);
      expressions.push(this.parseExpression());
    }
    // Expect TemplateTail
    if (this.at(TokenKind.TemplateTail)) {
      const tail = this.advance();
      parts.push(tail.value);
    } else {
      parts.push("");
    }
    return { kind: AstExprKind.Template, line: tok.line, col: tok.col, parts: parts, expressions: expressions };
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
          params: params, returnType: returnType, body: body, async: false,
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

  private parseFunctionExpr(isAsync: boolean): ArrowExprAst {
    const tok = this.expect(TokenKind.Function);
    // Skip * for generator expressions (handled at transform level)
    this.eat(TokenKind.Star);
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
    return { kind: AstExprKind.Arrow, line: tok.line, col: tok.col, params: params, returnType: returnType, body: body, async: isAsync };
  }

  // Check if current < starts type arguments by scanning ahead to find matching >
  // followed by (. Returns false if it's a comparison operator.
  private looksLikeTypeArgs(): boolean {
    const saved = this.saveState();
    // Skip <
    this.advance();
    let depth = 1;
    while (depth > 0 && !this.at(TokenKind.EOF)) {
      if (this.at(TokenKind.LessThan)) {
        depth = depth + 1;
      } else if (this.at(TokenKind.GreaterThan)) {
        depth = depth - 1;
        if (depth === 0) break;
      } else if (this.at(TokenKind.Semicolon) || this.at(TokenKind.LeftBrace) ||
                 this.at(TokenKind.RightBrace) || this.at(TokenKind.RightParen)) {
        // Hit a token that can't appear in type args - it's a comparison
        this.restoreState(saved);
        return false;
      }
      this.advance();
    }
    if (depth !== 0) {
      this.restoreState(saved);
      return false;
    }
    // Skip the >
    this.advance();
    // Type args should be followed by (
    const result = this.at(TokenKind.LeftParen);
    this.restoreState(saved);
    return result;
  }

  // Check if current ( starts arrow function params by scanning ahead
  private looksLikeArrowParams(): boolean {
    const saved = this.saveState();
    // Skip past (
    this.advance();
    let depth = 1;
    while (depth > 0 && !this.at(TokenKind.EOF)) {
      if (this.at(TokenKind.LeftParen)) {
        depth = depth + 1;
      } else if (this.at(TokenKind.RightParen)) {
        depth = depth - 1;
      }
      this.advance();
    }
    // Now check if we see : (return type) or => (arrow)
    let isArrow = false;
    if (this.at(TokenKind.Arrow)) {
      isArrow = true;
    } else if (this.at(TokenKind.Colon)) {
      // Could be return type annotation: (...): Type =>
      // Scan past the type to check for =>
      this.advance();
      // Skip type tokens until we hit => or something clearly not a type
      let typeDepth = 0;
      while (!this.at(TokenKind.EOF)) {
        if (this.at(TokenKind.LessThan)) { typeDepth = typeDepth + 1; this.advance(); }
        else if (this.at(TokenKind.GreaterThan)) { typeDepth = typeDepth - 1; this.advance(); }
        else if (this.at(TokenKind.Arrow)) { isArrow = true; break; }
        else if (typeDepth === 0 && this.at(TokenKind.LeftBrace)) { break; }
        else if (typeDepth === 0 && this.at(TokenKind.Semicolon)) { break; }
        else { this.advance(); }
      }
    }
    this.restoreState(saved);
    return isArrow;
  }

  // --- Save/restore for backtracking ---

  private saveState(): [number, number, number, Token] {
    return [
      this.scanner.getPos(),
      this.scanner.getLine(),
      this.scanner.getCol(),
      this.current,
    ];
  }

  private restoreState(state: [number, number, number, Token]): void {
    this.scanner.setPos(state[0] as number);
    this.scanner.setLine(state[1] as number);
    this.scanner.setCol(state[2] as number);
    this.current = state[3] as Token;
  }
}

function tokenKindName(kind: number): string {
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
