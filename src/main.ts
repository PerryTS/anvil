// anvil: TypeScript-to-native compiler with LLVM backend
// CLI entry point

import * as path from "path";
import * as fs from "fs";
import {
  HirModule, HirFunction, Stmt, StmtKind, Expr, ExprKind,
  ExprStmt, LetStmt, ReturnStmt, IfStmt, WhileStmt, ForStmt,
  NumberExpr, StringExpr, BoolExpr, CallExpr, FuncRefExpr,
  BinaryExpr, BinaryOp, CompareExpr, CompareOp,
  LocalGetExpr, LocalSetExpr,
} from "./hir/ir";
import { Type, TypeKind, makeFunctionType } from "./hir/types";
const NUMBER_TYPE: Type = { kind: TypeKind.Number };
const STRING_TYPE: Type = { kind: TypeKind.String };
const BOOLEAN_TYPE: Type = { kind: TypeKind.Boolean };
const VOID_TYPE: Type = { kind: TypeKind.Void };
const ANY_TYPE: Type = { kind: TypeKind.Any };
import { compile, compileFromHIR, compileMultiFile, CompileOptions } from "./driver/compile";

function main(): void {
  const args = process.argv.slice(2);

  let outputFile = "output";
  let runtimePath = "";
  let emitLL = false;
  let testMode = "";
  let inputFile = "";

  let i = 0;
  while (i < args.length) {
    if (args[i] === "-o" && i + 1 < args.length) {
      outputFile = args[i + 1];
      i = i + 2;
    } else if (args[i] === "--runtime" && i + 1 < args.length) {
      runtimePath = args[i + 1];
      i = i + 2;
    } else if (args[i] === "--emit-ll") {
      emitLL = true;
      i = i + 1;
    } else if (args[i] === "--test" && i + 1 < args.length) {
      testMode = args[i + 1];
      i = i + 2;
    } else if (args[i].charAt(0) !== "-" && inputFile === "") {
      inputFile = args[i];
      i = i + 1;
    } else {
      i = i + 1;
    }
  }

  // Default runtime path: look in perry project (try multiple locations)
  if (runtimePath === "") {
    const candidates: Array<string> = [
      path.resolve(__dirname, "../../perry/target/release/libperry_runtime.a"),
      path.resolve(process.cwd(), "../perry/target/release/libperry_runtime.a"),
      "/Users/amlug/projects/perry/target/release/libperry_runtime.a",
    ];
    runtimePath = candidates[0];
    for (let j = 0; j < candidates.length; j = j + 1) {
      if (fs.existsSync(candidates[j])) {
        runtimePath = candidates[j];
        break;
      }
    }
  }

  if (!fs.existsSync(runtimePath)) {
    console.error("Error: Cannot find libperry_runtime.a at " + runtimePath);
    console.error("Build it with: cd ../perry && cargo build --release -p perry-runtime");
    process.exit(1);
  }

  const options: CompileOptions = {
    inputFile: "",
    outputFile: outputFile,
    runtimePath: runtimePath,
    emitLL: emitLL,
  };

  if (inputFile !== "") {
    // Compile a real .ts file (multi-file if imports are found)
    options.inputFile = inputFile;
    compileMultiFile(options);
  } else if (testMode === "hello") {
    // Phase 0: console.log(42)
    compileFromHIR(buildHelloWorld(), options);
  } else if (testMode === "arithmetic") {
    // Phase 1 test: arithmetic
    compileFromHIR(buildArithmeticTest(), options);
  } else if (testMode === "strings") {
    // Phase 1 test: strings
    compileFromHIR(buildStringTest(), options);
  } else if (testMode === "functions") {
    // Phase 1 test: functions
    compileFromHIR(buildFunctionTest(), options);
  } else if (testMode === "control") {
    // Phase 1 test: control flow
    compileFromHIR(buildControlFlowTest(), options);
  } else {
    console.log("anvil - TypeScript-to-native compiler");
    console.log("");
    console.log("Usage: npx ts-node src/main.ts [options]");
    console.log("  --test hello        Phase 0: console.log(42)");
    console.log("  --test arithmetic   Phase 1: arithmetic ops");
    console.log("  --test strings      Phase 1: string operations");
    console.log("  --test functions    Phase 1: function calls");
    console.log("  --test control      Phase 1: control flow");
    console.log("  -o <file>           Output file (default: output)");
    console.log("  --runtime <path>    Path to libperry_runtime.a");
    console.log("  --emit-ll           Keep .ll file");
  }
}

// ---- Phase 0: console.log(42) ----

function buildHelloWorld(): HirModule {
  // console.log(42) as a direct call to js_console_log_number
  const logCall: ExprStmt = {
    kind: StmtKind.Expr,
    expr: {
      kind: ExprKind.Call,
      ty: VOID_TYPE,
      callee: {
        kind: ExprKind.FuncRef,
        ty: makeFunctionType([NUMBER_TYPE], VOID_TYPE),
        funcId: 0,
        name: "js_console_log_number",
      } as FuncRefExpr,
      args: [
        { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 42 } as NumberExpr,
      ],
    } as CallExpr,
  };

  return {
    name: "hello",
    functions: [],
    init: [logCall],
    globals: [], externalFuncs: [], importedGlobals: [],
  };
}

// ---- Phase 1 tests ----

function buildArithmeticTest(): HirModule {
  // let x = 10 + 20;
  // console.log(x);   // 30
  // let y = x * 2 - 5;
  // console.log(y);   // 55
  // let z = y / 11;
  // console.log(z);   // 5
  // console.log(z % 3);  // 2

  const stmts: Array<Stmt> = [];

  // let x = 10 + 20
  stmts.push({
    kind: StmtKind.Let,
    localId: 0,
    name: "x",
    ty: NUMBER_TYPE,
    init: {
      kind: ExprKind.Binary,
      ty: NUMBER_TYPE,
      op: BinaryOp.Add,
      left: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 10 } as NumberExpr,
      right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 20 } as NumberExpr,
    } as BinaryExpr,
  } as LetStmt);

  // console.log(x)
  stmts.push(makeLogLocal(0));

  // let y = x * 2 - 5
  stmts.push({
    kind: StmtKind.Let,
    localId: 1,
    name: "y",
    ty: NUMBER_TYPE,
    init: {
      kind: ExprKind.Binary,
      ty: NUMBER_TYPE,
      op: BinaryOp.Sub,
      left: {
        kind: ExprKind.Binary,
        ty: NUMBER_TYPE,
        op: BinaryOp.Mul,
        left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 0, name: "x" } as LocalGetExpr,
        right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 2 } as NumberExpr,
      } as BinaryExpr,
      right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 5 } as NumberExpr,
    } as BinaryExpr,
  } as LetStmt);

  stmts.push(makeLogLocal(1));

  // let z = y / 11
  stmts.push({
    kind: StmtKind.Let,
    localId: 2,
    name: "z",
    ty: NUMBER_TYPE,
    init: {
      kind: ExprKind.Binary,
      ty: NUMBER_TYPE,
      op: BinaryOp.Div,
      left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 1, name: "y" } as LocalGetExpr,
      right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 11 } as NumberExpr,
    } as BinaryExpr,
  } as LetStmt);

  stmts.push(makeLogLocal(2));

  // console.log(z % 3)
  stmts.push({
    kind: StmtKind.Expr,
    expr: {
      kind: ExprKind.Call,
      ty: VOID_TYPE,
      callee: {
        kind: ExprKind.FuncRef,
        ty: makeFunctionType([NUMBER_TYPE], VOID_TYPE),
        funcId: 0,
        name: "js_console_log_number",
      } as FuncRefExpr,
      args: [
        {
          kind: ExprKind.Binary,
          ty: NUMBER_TYPE,
          op: BinaryOp.Mod,
          left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 2, name: "z" } as LocalGetExpr,
          right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 3 } as NumberExpr,
        } as BinaryExpr,
      ],
    } as CallExpr,
  } as ExprStmt);

  return { name: "arithmetic", functions: [], init: stmts, globals: [], externalFuncs: [], importedGlobals: [] };
}

function buildStringTest(): HirModule {
  // console.log("hello world")
  const stmts: Array<Stmt> = [];

  stmts.push({
    kind: StmtKind.Expr,
    expr: {
      kind: ExprKind.Call,
      ty: VOID_TYPE,
      callee: {
        kind: ExprKind.FuncRef,
        ty: makeFunctionType([ANY_TYPE], VOID_TYPE),
        funcId: 0,
        name: "js_console_log_dynamic",
      } as FuncRefExpr,
      args: [
        { kind: ExprKind.String, ty: STRING_TYPE, value: "hello world" } as StringExpr,
      ],
    } as CallExpr,
  } as ExprStmt);

  // let a = "foo" + "bar"
  // console.log(a)
  stmts.push({
    kind: StmtKind.Let,
    localId: 0,
    name: "a",
    ty: STRING_TYPE,
    init: {
      kind: ExprKind.Binary,
      ty: STRING_TYPE,
      op: BinaryOp.Add,
      left: { kind: ExprKind.String, ty: STRING_TYPE, value: "foo" } as StringExpr,
      right: { kind: ExprKind.String, ty: STRING_TYPE, value: "bar" } as StringExpr,
    } as BinaryExpr,
  } as LetStmt);

  stmts.push({
    kind: StmtKind.Expr,
    expr: {
      kind: ExprKind.Call,
      ty: VOID_TYPE,
      callee: {
        kind: ExprKind.FuncRef,
        ty: makeFunctionType([ANY_TYPE], VOID_TYPE),
        funcId: 0,
        name: "js_console_log_dynamic",
      } as FuncRefExpr,
      args: [
        { kind: ExprKind.LocalGet, ty: STRING_TYPE, localId: 0, name: "a" } as LocalGetExpr,
      ],
    } as CallExpr,
  } as ExprStmt);

  return { name: "strings", functions: [], init: stmts, globals: [], externalFuncs: [], importedGlobals: [] };
}

function buildFunctionTest(): HirModule {
  // function add(a, b) { return a + b; }
  // console.log(add(3, 4));  // 7
  // function double(x) { return x * 2; }
  // console.log(double(21));  // 42

  const addFunc: HirFunction = {
    id: 1,
    name: "add",
    params: [[0, "a", NUMBER_TYPE], [1, "b", NUMBER_TYPE]],
    returnType: NUMBER_TYPE,
    body: [
      {
        kind: StmtKind.Return,
        value: {
          kind: ExprKind.Binary,
          ty: NUMBER_TYPE,
          op: BinaryOp.Add,
          left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 0, name: "a" } as LocalGetExpr,
          right: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 1, name: "b" } as LocalGetExpr,
        } as BinaryExpr,
      } as ReturnStmt,
    ],
    localCount: 2,
    isAsync: false,
  };

  const doubleFunc: HirFunction = {
    id: 2,
    name: "double_num",
    params: [[0, "x", NUMBER_TYPE]],
    returnType: NUMBER_TYPE,
    body: [
      {
        kind: StmtKind.Return,
        value: {
          kind: ExprKind.Binary,
          ty: NUMBER_TYPE,
          op: BinaryOp.Mul,
          left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 0, name: "x" } as LocalGetExpr,
          right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 2 } as NumberExpr,
        } as BinaryExpr,
      } as ReturnStmt,
    ],
    localCount: 1,
    isAsync: false,
  };

  const stmts: Array<Stmt> = [];

  // console.log(add(3, 4))
  stmts.push({
    kind: StmtKind.Expr,
    expr: {
      kind: ExprKind.Call,
      ty: VOID_TYPE,
      callee: {
        kind: ExprKind.FuncRef,
        ty: makeFunctionType([NUMBER_TYPE], VOID_TYPE),
        funcId: 0,
        name: "js_console_log_number",
      } as FuncRefExpr,
      args: [
        {
          kind: ExprKind.Call,
          ty: NUMBER_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: makeFunctionType([NUMBER_TYPE, NUMBER_TYPE], NUMBER_TYPE), funcId: 1, name: "add" } as FuncRefExpr,
          args: [
            { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 3 } as NumberExpr,
            { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 4 } as NumberExpr,
          ],
        } as CallExpr,
      ],
    } as CallExpr,
  } as ExprStmt);

  // console.log(double(21))
  stmts.push({
    kind: StmtKind.Expr,
    expr: {
      kind: ExprKind.Call,
      ty: VOID_TYPE,
      callee: {
        kind: ExprKind.FuncRef,
        ty: makeFunctionType([NUMBER_TYPE], VOID_TYPE),
        funcId: 0,
        name: "js_console_log_number",
      } as FuncRefExpr,
      args: [
        {
          kind: ExprKind.Call,
          ty: NUMBER_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: makeFunctionType([NUMBER_TYPE], NUMBER_TYPE), funcId: 2, name: "double_num" } as FuncRefExpr,
          args: [
            { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 21 } as NumberExpr,
          ],
        } as CallExpr,
      ],
    } as CallExpr,
  } as ExprStmt);

  return {
    name: "functions",
    functions: [addFunc, doubleFunc],
    init: stmts,
    globals: [], externalFuncs: [], importedGlobals: [],
  };
}

function buildControlFlowTest(): HirModule {
  // let sum = 0;
  // for (let i = 1; i <= 10; i = i + 1) { sum = sum + i; }
  // console.log(sum);  // 55
  //
  // let n = 10;
  // while (n > 0) { n = n - 1; }
  // console.log(n);  // 0
  //
  // if (sum > 50) { console.log(1); } else { console.log(0); }  // 1

  const stmts: Array<Stmt> = [];

  // let sum = 0
  stmts.push({
    kind: StmtKind.Let,
    localId: 0,
    name: "sum",
    ty: NUMBER_TYPE,
    init: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 0 } as NumberExpr,
  } as LetStmt);

  // for (let i = 1; i <= 10; i = i + 1) { sum = sum + i; }
  stmts.push({
    kind: StmtKind.For,
    init: {
      kind: StmtKind.Let,
      localId: 1,
      name: "i",
      ty: NUMBER_TYPE,
      init: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 } as NumberExpr,
    } as LetStmt,
    condition: {
      kind: ExprKind.Compare,
      ty: BOOLEAN_TYPE,
      op: CompareOp.Le,
      left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 1, name: "i" } as LocalGetExpr,
      right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 10 } as NumberExpr,
    } as CompareExpr,
    update: {
      kind: ExprKind.LocalSet,
      ty: NUMBER_TYPE,
      localId: 1,
      name: "i",
      value: {
        kind: ExprKind.Binary,
        ty: NUMBER_TYPE,
        op: BinaryOp.Add,
        left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 1, name: "i" } as LocalGetExpr,
        right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 } as NumberExpr,
      } as BinaryExpr,
    } as LocalSetExpr,
    body: [
      {
        kind: StmtKind.Expr,
        expr: {
          kind: ExprKind.LocalSet,
          ty: NUMBER_TYPE,
          localId: 0,
          name: "sum",
          value: {
            kind: ExprKind.Binary,
            ty: NUMBER_TYPE,
            op: BinaryOp.Add,
            left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 0, name: "sum" } as LocalGetExpr,
            right: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 1, name: "i" } as LocalGetExpr,
          } as BinaryExpr,
        } as LocalSetExpr,
      } as ExprStmt,
    ],
  } as Stmt);

  stmts.push(makeLogLocal(0));

  // let n = 10
  stmts.push({
    kind: StmtKind.Let,
    localId: 2,
    name: "n",
    ty: NUMBER_TYPE,
    init: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 10 } as NumberExpr,
  } as LetStmt);

  // while (n > 0) { n = n - 1; }
  stmts.push({
    kind: StmtKind.While,
    condition: {
      kind: ExprKind.Compare,
      ty: BOOLEAN_TYPE,
      op: CompareOp.Gt,
      left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 2, name: "n" } as LocalGetExpr,
      right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 0 } as NumberExpr,
    } as CompareExpr,
    body: [
      {
        kind: StmtKind.Expr,
        expr: {
          kind: ExprKind.LocalSet,
          ty: NUMBER_TYPE,
          localId: 2,
          name: "n",
          value: {
            kind: ExprKind.Binary,
            ty: NUMBER_TYPE,
            op: BinaryOp.Sub,
            left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 2, name: "n" } as LocalGetExpr,
            right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 } as NumberExpr,
          } as BinaryExpr,
        } as LocalSetExpr,
      } as ExprStmt,
    ],
  } as Stmt);

  stmts.push(makeLogLocal(2));

  // if (sum > 50) { console.log(1); } else { console.log(0); }
  stmts.push({
    kind: StmtKind.If,
    condition: {
      kind: ExprKind.Compare,
      ty: BOOLEAN_TYPE,
      op: CompareOp.Gt,
      left: { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: 0, name: "sum" } as LocalGetExpr,
      right: { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 50 } as NumberExpr,
    } as CompareExpr,
    thenBody: [makeLogNumber(1)],
    elseBody: [makeLogNumber(0)],
  } as IfStmt);

  return { name: "control", functions: [], init: stmts, globals: [], externalFuncs: [], importedGlobals: [] };
}

// Helper: make console.log(localId) stmt
function makeLogLocal(localId: number): ExprStmt {
  return {
    kind: StmtKind.Expr,
    expr: {
      kind: ExprKind.Call,
      ty: VOID_TYPE,
      callee: {
        kind: ExprKind.FuncRef,
        ty: makeFunctionType([NUMBER_TYPE], VOID_TYPE),
        funcId: 0,
        name: "js_console_log_number",
      } as FuncRefExpr,
      args: [
        { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: localId, name: "local" + localId } as LocalGetExpr,
      ],
    } as CallExpr,
  };
}

// Helper: make console.log(number) stmt
function makeLogNumber(n: number): ExprStmt {
  return {
    kind: StmtKind.Expr,
    expr: {
      kind: ExprKind.Call,
      ty: VOID_TYPE,
      callee: {
        kind: ExprKind.FuncRef,
        ty: makeFunctionType([NUMBER_TYPE], VOID_TYPE),
        funcId: 0,
        name: "js_console_log_number",
      } as FuncRefExpr,
      args: [
        { kind: ExprKind.Number, ty: NUMBER_TYPE, value: n } as NumberExpr,
      ],
    } as CallExpr,
  };
}

main();
