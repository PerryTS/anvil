// Token types for the TypeScript subset parser

export const enum TokenKind {
  // Literals
  NumberLiteral = 0,
  StringLiteral = 1,
  TemplateLiteral = 2,

  // Identifiers and keywords
  Identifier = 10,
  Let = 11,
  Const = 12,
  Var = 13,
  Function = 14,
  Return = 15,
  If = 16,
  Else = 17,
  While = 18,
  For = 19,
  Break = 20,
  Continue = 21,
  True = 22,
  False = 23,
  Null = 24,
  Undefined = 25,
  New = 26,
  Class = 27,
  Extends = 28,
  Super = 29,
  This = 30,
  Import = 31,
  Export = 32,
  From = 33,
  As = 34,
  Typeof = 35,
  Void = 36,
  Switch = 37,
  Case = 38,
  Default = 39,
  Throw = 40,
  Try = 41,
  Catch = 42,
  Finally = 43,
  Enum = 44,
  Interface = 45,
  Type = 46,
  Implements = 47,
  Private = 48,
  Public = 49,
  Protected = 50,
  Readonly = 51,
  Static = 52,
  Abstract = 53,
  Declare = 54,
  Do = 55,
  In = 56,
  Of = 57,
  Instanceof = 58,
  Delete = 59,

  // Operators
  Plus = 100,
  Minus = 101,
  Star = 102,
  Slash = 103,
  Percent = 104,
  StarStar = 105,
  Ampersand = 106,
  Pipe = 107,
  Caret = 108,
  Tilde = 109,
  LessThan = 110,
  GreaterThan = 111,
  LessEqual = 112,
  GreaterEqual = 113,
  EqualEqual = 114,
  ExclaimEqual = 115,
  EqualEqualEqual = 116,
  ExclaimEqualEqual = 117,
  AmpersandAmpersand = 118,
  PipePipe = 119,
  Exclaim = 120,
  Equal = 121,
  PlusEqual = 122,
  MinusEqual = 123,
  StarEqual = 124,
  SlashEqual = 125,
  PercentEqual = 126,
  PlusPlus = 127,
  MinusMinus = 128,
  LessLess = 129,
  GreaterGreater = 130,
  GreaterGreaterGreater = 131,
  AmpersandEqual = 132,
  PipeEqual = 133,
  CaretEqual = 134,
  Arrow = 135,      // =>
  Question = 136,
  Colon = 137,
  Dot = 138,
  DotDotDot = 139,

  // Delimiters
  LeftParen = 200,
  RightParen = 201,
  LeftBracket = 202,
  RightBracket = 203,
  LeftBrace = 204,
  RightBrace = 205,
  Semicolon = 206,
  Comma = 207,

  // Special
  EOF = 300,
}

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

// Map keyword strings to token kinds
const KEYWORDS: Map<string, TokenKind> = new Map();
KEYWORDS.set("let", TokenKind.Let);
KEYWORDS.set("const", TokenKind.Const);
KEYWORDS.set("var", TokenKind.Var);
KEYWORDS.set("function", TokenKind.Function);
KEYWORDS.set("return", TokenKind.Return);
KEYWORDS.set("if", TokenKind.If);
KEYWORDS.set("else", TokenKind.Else);
KEYWORDS.set("while", TokenKind.While);
KEYWORDS.set("for", TokenKind.For);
KEYWORDS.set("break", TokenKind.Break);
KEYWORDS.set("continue", TokenKind.Continue);
KEYWORDS.set("true", TokenKind.True);
KEYWORDS.set("false", TokenKind.False);
KEYWORDS.set("null", TokenKind.Null);
KEYWORDS.set("undefined", TokenKind.Undefined);
KEYWORDS.set("new", TokenKind.New);
KEYWORDS.set("class", TokenKind.Class);
KEYWORDS.set("extends", TokenKind.Extends);
KEYWORDS.set("super", TokenKind.Super);
KEYWORDS.set("this", TokenKind.This);
KEYWORDS.set("import", TokenKind.Import);
KEYWORDS.set("export", TokenKind.Export);
KEYWORDS.set("from", TokenKind.From);
KEYWORDS.set("as", TokenKind.As);
KEYWORDS.set("typeof", TokenKind.Typeof);
KEYWORDS.set("void", TokenKind.Void);
KEYWORDS.set("switch", TokenKind.Switch);
KEYWORDS.set("case", TokenKind.Case);
KEYWORDS.set("default", TokenKind.Default);
KEYWORDS.set("throw", TokenKind.Throw);
KEYWORDS.set("try", TokenKind.Try);
KEYWORDS.set("catch", TokenKind.Catch);
KEYWORDS.set("finally", TokenKind.Finally);
KEYWORDS.set("enum", TokenKind.Enum);
KEYWORDS.set("interface", TokenKind.Interface);
KEYWORDS.set("type", TokenKind.Type);
KEYWORDS.set("implements", TokenKind.Implements);
KEYWORDS.set("private", TokenKind.Private);
KEYWORDS.set("public", TokenKind.Public);
KEYWORDS.set("protected", TokenKind.Protected);
KEYWORDS.set("readonly", TokenKind.Readonly);
KEYWORDS.set("static", TokenKind.Static);
KEYWORDS.set("abstract", TokenKind.Abstract);
KEYWORDS.set("declare", TokenKind.Declare);
KEYWORDS.set("do", TokenKind.Do);
KEYWORDS.set("in", TokenKind.In);
KEYWORDS.set("of", TokenKind.Of);
KEYWORDS.set("instanceof", TokenKind.Instanceof);
KEYWORDS.set("delete", TokenKind.Delete);

export function lookupKeyword(name: string): number | undefined {
  return KEYWORDS.get(name);
}
