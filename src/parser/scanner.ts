// Scanner/Lexer for the TypeScript subset
// Tokenizes source text into a stream of tokens

import { Token, TokenKind, lookupKeyword } from "./token";

export class Scanner {
  private source: string;
  private pos: number;
  private line: number;
  private col: number;
  private tokenStart: number;
  private tokenLine: number;
  private tokenCol: number;
  private templateDepth: number;

  constructor(source: string) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokenStart = 0;
    this.tokenLine = 1;
    this.tokenCol = 1;
    this.templateDepth = 0;
  }

  getPos(): number { return this.pos; }
  setPos(v: number): void { this.pos = v; }
  getLine(): number { return this.line; }
  setLine(v: number): void { this.line = v; }
  getCol(): number { return this.col; }
  setCol(v: number): void { this.col = v; }

  // Scan a regex literal: /pattern/flags
  // Called by the parser when it knows a / should be a regex (not division)
  scanRegex(): Token {
    this.skipWhitespaceAndComments();
    this.tokenStart = this.pos;
    this.tokenLine = this.line;
    this.tokenCol = this.col;
    if (this.pos >= this.source.length || this.source.charCodeAt(this.pos) !== 47) {
      return this.makeToken(TokenKind.Slash, "/");
    }
    this.advance(); // consume opening /
    let pattern = "";
    let inCharClass = false;
    while (this.pos < this.source.length) {
      const c = this.source.charCodeAt(this.pos);
      if (c === 92) { // backslash escape
        pattern = pattern + this.source.charAt(this.pos);
        this.advance();
        if (this.pos < this.source.length) {
          pattern = pattern + this.source.charAt(this.pos);
          this.advance();
        }
        continue;
      }
      if (c === 91) { inCharClass = true; } // [
      if (c === 93) { inCharClass = false; } // ]
      if (c === 47 && !inCharClass) { // closing /
        this.advance(); // consume closing /
        break;
      }
      pattern = pattern + this.source.charAt(this.pos);
      this.advance();
    }
    // Scan flags (g, i, m, s, u, y)
    let flags = "";
    while (this.pos < this.source.length) {
      const fc = this.source.charCodeAt(this.pos);
      if ((fc >= 97 && fc <= 122) || (fc >= 65 && fc <= 90)) { // a-z, A-Z
        flags = flags + this.source.charAt(this.pos);
        this.advance();
      } else {
        break;
      }
    }
    // Return as string literal with special format: pattern + "\0" + flags
    return { kind: TokenKind.StringLiteral, value: pattern + "\0" + flags, line: this.tokenLine, col: this.tokenCol };
  }

  scan(): Token {
    this.skipWhitespaceAndComments();

    this.tokenStart = this.pos;
    this.tokenLine = this.line;
    this.tokenCol = this.col;

    if (this.pos >= this.source.length) {
      return this.makeToken(TokenKind.EOF, "");
    }

    const ch = this.source.charCodeAt(this.pos);

    // Numbers
    if (ch >= 48 && ch <= 57) {
      return this.scanNumber();
    }

    // Private fields: #name
    if (ch === 35) { // #
      // Check if next char is an identifier start
      if (this.pos + 1 < this.source.length && isIdentStart(this.source.charCodeAt(this.pos + 1))) {
        this.advance(); // consume #
        const ident = this.scanIdentifier();
        // Prepend # to the identifier value — treat as regular identifier
        return { kind: TokenKind.Identifier, value: "#" + ident.value, line: ident.line, col: ident.col - 1 };
      }
    }

    // Identifiers and keywords
    if (isIdentStart(ch)) {
      return this.scanIdentifier();
    }

    // Strings
    if (ch === 34 || ch === 39) { // " or '
      return this.scanString(ch);
    }

    // Template literals
    if (ch === 96) { // `
      return this.scanTemplateLiteral();
    }

    // Template continuation: when we see } while inside a template expression
    if (ch === 125 && this.templateDepth > 0) { // }
      return this.scanTemplateContinuation();
    }

    // Operators and delimiters
    return this.scanOperator();
  }

  // Peek at the next token without consuming it
  peek(): Token {
    const savedPos = this.pos;
    const savedLine = this.line;
    const savedCol = this.col;
    const tok = this.scan();
    this.pos = savedPos;
    this.line = savedLine;
    this.col = savedCol;
    return tok;
  }

  private advance(): number {
    const ch = this.source.charCodeAt(this.pos);
    this.pos = this.pos + 1;
    if (ch === 10) { // \n
      this.line = this.line + 1;
      this.col = 1;
    } else {
      this.col = this.col + 1;
    }
    return ch;
  }

  private current(): number {
    if (this.pos >= this.source.length) return 0;
    return this.source.charCodeAt(this.pos);
  }

  private lookAhead(offset: number): number {
    const idx = this.pos + offset;
    if (idx >= this.source.length) return 0;
    return this.source.charCodeAt(idx);
  }

  private makeToken(kind: number, value: string): Token {
    return { kind: kind, value: value, line: this.tokenLine, col: this.tokenCol };
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.current();

      // Whitespace
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        this.advance();
        continue;
      }

      // Single-line comment
      if (ch === 47 && this.lookAhead(1) === 47) { // //
        this.advance(); // skip /
        this.advance(); // skip /
        while (this.pos < this.source.length && this.current() !== 10) {
          this.advance();
        }
        continue;
      }

      // Multi-line comment
      if (ch === 47 && this.lookAhead(1) === 42) { // /*
        this.advance(); // skip /
        this.advance(); // skip *
        while (this.pos < this.source.length) {
          if (this.current() === 42 && this.lookAhead(1) === 47) {
            this.advance(); // skip *
            this.advance(); // skip /
            break;
          }
          this.advance();
        }
        continue;
      }

      break;
    }
  }

  private scanNumber(): Token {
    const start = this.pos;

    // Check for hex: 0x or 0X
    if (this.current() === 48 && (this.lookAhead(1) === 120 || this.lookAhead(1) === 88)) {
      this.advance(); // 0
      this.advance(); // x
      while (this.pos < this.source.length && (isHexDigit(this.current()) || this.current() === 95)) {
        this.advance();
      }
      // Check for bigint suffix 'n'
      if (this.current() === 110) { // 'n'
        this.advance();
      }
      return this.makeToken(TokenKind.NumberLiteral, this.source.substring(start, this.pos));
    }

    // Check for binary: 0b or 0B
    if (this.current() === 48 && (this.lookAhead(1) === 98 || this.lookAhead(1) === 66)) {
      this.advance(); // 0
      this.advance(); // b
      while (this.pos < this.source.length && (this.current() === 48 || this.current() === 49)) {
        this.advance();
      }
      return this.makeToken(TokenKind.NumberLiteral, this.source.substring(start, this.pos));
    }

    // Decimal with optional underscores
    while (this.pos < this.source.length && (isDigit(this.current()) || this.current() === 95)) {
      this.advance();
    }

    // Decimal point
    if (this.current() === 46 && isDigit(this.lookAhead(1))) {
      this.advance(); // .
      while (this.pos < this.source.length && (isDigit(this.current()) || this.current() === 95)) {
        this.advance();
      }
    }

    // Exponent
    if (this.current() === 101 || this.current() === 69) { // e or E
      this.advance();
      if (this.current() === 43 || this.current() === 45) { // + or -
        this.advance();
      }
      while (this.pos < this.source.length && isDigit(this.current())) {
        this.advance();
      }
    }

    // Bigint suffix
    if (this.current() === 110) { // 'n'
      this.advance();
    }

    return this.makeToken(TokenKind.NumberLiteral, this.source.substring(start, this.pos));
  }

  private scanIdentifier(): Token {
    const start = this.pos;
    this.advance();
    while (this.pos < this.source.length && isIdentPart(this.current())) {
      this.advance();
    }
    const text = this.source.substring(start, this.pos);
    const keyword = lookupKeyword(text);
    if (keyword !== undefined) {
      return this.makeToken(keyword, text);
    }
    return this.makeToken(TokenKind.Identifier, text);
  }

  private scanString(quote: number): Token {
    this.advance(); // opening quote
    let value = "";
    while (this.pos < this.source.length && this.current() !== quote) {
      if (this.current() === 92) { // backslash
        this.advance();
        const esc = this.current();
        this.advance();
        if (esc === 110) { value = value + "\n"; }       // \n
        else if (esc === 116) { value = value + "\t"; }   // \t
        else if (esc === 114) { value = value + "\r"; }   // \r
        else if (esc === 92) { value = value + "\\"; }     // \\
        else if (esc === 39) { value = value + "'"; }      // \'
        else if (esc === 34) { value = value + "\""; }     // \"
        else if (esc === 96) { value = value + "`"; }      // \`
        else if (esc === 48) { value = value + "\0"; }     // \0
        else { value = value + String.fromCharCode(esc); }
      } else {
        value = value + String.fromCharCode(this.current());
        this.advance();
      }
    }
    if (this.pos < this.source.length) {
      this.advance(); // closing quote
    }
    return this.makeToken(TokenKind.StringLiteral, value);
  }

  private scanTemplateLiteral(): Token {
    this.advance(); // opening backtick
    let value = "";
    while (this.pos < this.source.length && this.current() !== 96) {
      if (this.current() === 92) { // backslash
        this.advance();
        const esc = this.current();
        this.advance();
        if (esc === 110) { value = value + "\n"; }
        else if (esc === 116) { value = value + "\t"; }
        else { value = value + String.fromCharCode(esc); }
      } else if (this.current() === 36 && this.lookAhead(1) === 123) { // ${
        // Template expression found - return TemplateHead
        this.advance(); // skip $
        this.advance(); // skip {
        this.templateDepth = this.templateDepth + 1;
        return this.makeToken(TokenKind.TemplateHead, value);
      } else {
        value = value + String.fromCharCode(this.current());
        this.advance();
      }
    }
    if (this.pos < this.source.length) {
      this.advance(); // closing backtick
    }
    // No expressions found - simple template literal
    return this.makeToken(TokenKind.TemplateLiteral, value);
  }

  private scanTemplateContinuation(): Token {
    this.advance(); // skip closing }
    let value = "";
    while (this.pos < this.source.length && this.current() !== 96) {
      if (this.current() === 92) { // backslash
        this.advance();
        const esc = this.current();
        this.advance();
        if (esc === 110) { value = value + "\n"; }
        else if (esc === 116) { value = value + "\t"; }
        else { value = value + String.fromCharCode(esc); }
      } else if (this.current() === 36 && this.lookAhead(1) === 123) { // ${
        // Another template expression - return TemplateMiddle
        this.advance(); // skip $
        this.advance(); // skip {
        return this.makeToken(TokenKind.TemplateMiddle, value);
      } else {
        value = value + String.fromCharCode(this.current());
        this.advance();
      }
    }
    if (this.pos < this.source.length) {
      this.advance(); // closing backtick
    }
    this.templateDepth = this.templateDepth - 1;
    return this.makeToken(TokenKind.TemplateTail, value);
  }

  private scanOperator(): Token {
    const ch = this.advance();

    // Single char tokens
    if (ch === 40) return this.makeToken(TokenKind.LeftParen, "(");
    if (ch === 41) return this.makeToken(TokenKind.RightParen, ")");
    if (ch === 91) return this.makeToken(TokenKind.LeftBracket, "[");
    if (ch === 93) return this.makeToken(TokenKind.RightBracket, "]");
    if (ch === 123) return this.makeToken(TokenKind.LeftBrace, "{");
    if (ch === 125) return this.makeToken(TokenKind.RightBrace, "}");
    if (ch === 59) return this.makeToken(TokenKind.Semicolon, ";");
    if (ch === 44) return this.makeToken(TokenKind.Comma, ",");
    if (ch === 64) return this.makeToken(TokenKind.At, "@");  // @
    if (ch === 126) return this.makeToken(TokenKind.Tilde, "~");
    if (ch === 63) { // ?
      if (this.pos < this.source.length && this.current() === 63) {
        this.advance(); // consume second ?
        if (this.pos < this.source.length && this.current() === 61) { // ??=
          this.advance();
          return this.makeToken(TokenKind.QuestionQuestionEqual, "??=");
        }
        return this.makeToken(TokenKind.QuestionQuestion, "??");
      }
      if (this.pos < this.source.length && this.current() === 46) { // ?.
        this.advance(); // consume .
        return this.makeToken(TokenKind.QuestionDot, "?.");
      }
      return this.makeToken(TokenKind.Question, "?");
    }
    if (ch === 58) return this.makeToken(TokenKind.Colon, ":");

    // Dot / ...
    if (ch === 46) {
      if (this.current() === 46 && this.lookAhead(1) === 46) {
        this.advance();
        this.advance();
        return this.makeToken(TokenKind.DotDotDot, "...");
      }
      return this.makeToken(TokenKind.Dot, ".");
    }

    // + ++ +=
    if (ch === 43) {
      if (this.current() === 43) { this.advance(); return this.makeToken(TokenKind.PlusPlus, "++"); }
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.PlusEqual, "+="); }
      return this.makeToken(TokenKind.Plus, "+");
    }

    // - -- -=
    if (ch === 45) {
      if (this.current() === 45) { this.advance(); return this.makeToken(TokenKind.MinusMinus, "--"); }
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.MinusEqual, "-="); }
      return this.makeToken(TokenKind.Minus, "-");
    }

    // * ** *= **=
    if (ch === 42) {
      if (this.current() === 42) {
        this.advance();
        if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.StarEqual, "**="); }
        return this.makeToken(TokenKind.StarStar, "**");
      }
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.StarEqual, "*="); }
      return this.makeToken(TokenKind.Star, "*");
    }

    // / /=
    if (ch === 47) {
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.SlashEqual, "/="); }
      return this.makeToken(TokenKind.Slash, "/");
    }

    // % %=
    if (ch === 37) {
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.PercentEqual, "%="); }
      return this.makeToken(TokenKind.Percent, "%");
    }

    // = == === =>
    if (ch === 61) {
      if (this.current() === 61) {
        this.advance();
        if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.EqualEqualEqual, "==="); }
        return this.makeToken(TokenKind.EqualEqual, "==");
      }
      if (this.current() === 62) { this.advance(); return this.makeToken(TokenKind.Arrow, "=>"); }
      return this.makeToken(TokenKind.Equal, "=");
    }

    // ! != !==
    if (ch === 33) {
      if (this.current() === 61) {
        this.advance();
        if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.ExclaimEqualEqual, "!=="); }
        return this.makeToken(TokenKind.ExclaimEqual, "!=");
      }
      return this.makeToken(TokenKind.Exclaim, "!");
    }

    // < << <<= <=
    if (ch === 60) {
      if (this.current() === 60) {
        this.advance();
        if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.LessLessEqual, "<<="); }
        return this.makeToken(TokenKind.LessLess, "<<");
      }
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.LessEqual, "<="); }
      return this.makeToken(TokenKind.LessThan, "<");
    }

    // > >> >>= >>> >>>= >=
    if (ch === 62) {
      if (this.current() === 62) {
        this.advance();
        if (this.current() === 62) {
          this.advance();
          if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.GreaterGreaterGreaterEqual, ">>>="); }
          return this.makeToken(TokenKind.GreaterGreaterGreater, ">>>");
        }
        if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.GreaterGreaterEqual, ">>="); }
        return this.makeToken(TokenKind.GreaterGreater, ">>");
      }
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.GreaterEqual, ">="); }
      return this.makeToken(TokenKind.GreaterThan, ">");
    }

    // & && &=
    if (ch === 38) {
      if (this.current() === 38) { this.advance(); return this.makeToken(TokenKind.AmpersandAmpersand, "&&"); }
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.AmpersandEqual, "&="); }
      return this.makeToken(TokenKind.Ampersand, "&");
    }

    // | || |=
    if (ch === 124) {
      if (this.current() === 124) { this.advance(); return this.makeToken(TokenKind.PipePipe, "||"); }
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.PipeEqual, "|="); }
      return this.makeToken(TokenKind.Pipe, "|");
    }

    // ^ ^=
    if (ch === 94) {
      if (this.current() === 61) { this.advance(); return this.makeToken(TokenKind.CaretEqual, "^="); }
      return this.makeToken(TokenKind.Caret, "^");
    }

    throw new Error("Unexpected character: " + String.fromCharCode(ch) + " at line " + this.tokenLine + ":" + this.tokenCol);
  }
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57;
}

function isHexDigit(ch: number): boolean {
  return (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 70) || (ch >= 97 && ch <= 102);
}

function isIdentStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 36;
}

function isIdentPart(ch: number): boolean {
  return isIdentStart(ch) || isDigit(ch);
}
