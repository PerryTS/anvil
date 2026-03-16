// Generator function AST-level transformation
// Transforms function* declarations into regular functions that return { next: <closure> }
// The closure implements a state machine using a while(true) loop with if-chains.

import {
  SourceFile, AstStmt, AstStmtKind, AstExpr, AstExprKind,
  FunctionDeclAst, VarDeclAst, ForStmtAst, WhileStmtAst, BlockStmtAst,
  IfStmtAst, ExprStmtAst, ReturnStmtAst,
  NumberLitExpr, BoolLitExpr, IdentifierExpr, BinaryExprAst,
  AssignExprAst, UnaryExprAst, ArrowExprAst,
  ObjectExprAst, ObjectProperty, UndefinedLitExpr,
  YieldExprAst, ExportDeclAst,
} from "./ast";

// --- AST node constructors ---

function mkNum(n: number): NumberLitExpr {
  return { kind: AstExprKind.Number, line: 0, col: 0, value: n, raw: "" + n };
}

function mkBool(b: boolean): BoolLitExpr {
  return { kind: AstExprKind.Bool, line: 0, col: 0, value: b };
}

function mkIdent(name: string): IdentifierExpr {
  return { kind: AstExprKind.Identifier, line: 0, col: 0, name: name };
}

function mkUndefined(): UndefinedLitExpr {
  return { kind: AstExprKind.Undefined, line: 0, col: 0 };
}

function mkAssignExpr(name: string, value: AstExpr): AssignExprAst {
  return { kind: AstExprKind.Assign, line: 0, col: 0, target: mkIdent(name), value: value };
}

function mkExprStmt(expr: AstExpr): ExprStmtAst {
  return { kind: AstStmtKind.Expr, line: 0, col: 0, expr: expr };
}

function mkReturn(value: AstExpr | null): ReturnStmtAst {
  return { kind: AstStmtKind.Return, line: 0, col: 0, value: value };
}

function mkContinue(): AstStmt {
  return { kind: AstStmtKind.Continue, line: 0, col: 0 };
}

function mkBlock(stmts: Array<AstStmt>): BlockStmtAst {
  return { kind: AstStmtKind.Block, line: 0, col: 0, body: stmts };
}

function mkIf(condition: AstExpr, consequent: AstStmt): IfStmtAst {
  return { kind: AstStmtKind.If, line: 0, col: 0, condition: condition, consequent: consequent, alternate: null };
}

function mkStrictEq(left: AstExpr, right: AstExpr): BinaryExprAst {
  return { kind: AstExprKind.Binary, line: 0, col: 0, op: "===", left: left, right: right };
}

function mkNot(operand: AstExpr): UnaryExprAst {
  return { kind: AstExprKind.Unary, line: 0, col: 0, op: "!", operand: operand };
}

function mkIterResult(value: AstExpr, done: boolean): ObjectExprAst {
  return {
    kind: AstExprKind.Object, line: 0, col: 0,
    properties: [
      { key: "value", value: value, computed: false, shorthand: false },
      { key: "done", value: mkBool(done), computed: false, shorthand: false },
    ],
  };
}

function mkVarDecl(name: string, init: AstExpr | null): VarDeclAst {
  return { kind: AstStmtKind.VarDecl, line: 0, col: 0, declKind: "let", name: name, typeAnnotation: null, init: init };
}

// --- State machine types ---

interface State {
  num: number;
  body: Array<AstStmt>;
  exit: StateExit;
}

interface YieldExit { kind: "yield"; value: AstExpr; nextState: number; }
interface GotoExit { kind: "goto"; nextState: number; }
interface DoneExit { kind: "done"; }

type StateExit = YieldExit | GotoExit | DoneExit;

// --- Linearizer ---

function bodyContainsYield(stmts: Array<AstStmt>): boolean {
  for (let i = 0; i < stmts.length; i = i + 1) {
    if (stmtContainsYield(stmts[i])) return true;
  }
  return false;
}

function stmtContainsYield(stmt: AstStmt): boolean {
  if (stmt.kind === AstStmtKind.Expr) {
    const s = stmt as ExprStmtAst;
    if (s.expr.kind === AstExprKind.Yield) return true;
  }
  if (stmt.kind === AstStmtKind.If) {
    const s = stmt as IfStmtAst;
    if (s.consequent.kind === AstStmtKind.Block) {
      if (bodyContainsYield((s.consequent as BlockStmtAst).body)) return true;
    }
    if (s.alternate !== null && s.alternate.kind === AstStmtKind.Block) {
      if (bodyContainsYield((s.alternate as BlockStmtAst).body)) return true;
    }
  }
  if (stmt.kind === AstStmtKind.While) {
    const s = stmt as WhileStmtAst;
    if (s.body.kind === AstStmtKind.Block) {
      if (bodyContainsYield((s.body as BlockStmtAst).body)) return true;
    }
  }
  if (stmt.kind === AstStmtKind.For) {
    const s = stmt as ForStmtAst;
    if (s.body.kind === AstStmtKind.Block) {
      if (bodyContainsYield((s.body as BlockStmtAst).body)) return true;
    }
  }
  if (stmt.kind === AstStmtKind.Block) {
    if (bodyContainsYield((stmt as BlockStmtAst).body)) return true;
  }
  return false;
}

function getBlockBody(stmt: AstStmt): Array<AstStmt> {
  if (stmt.kind === AstStmtKind.Block) {
    return (stmt as BlockStmtAst).body;
  }
  return [stmt];
}

// Collect all variable declarations to hoist to the outer scope
function collectHoistedVars(stmts: Array<AstStmt>): Array<string> {
  const vars: Array<string> = [];
  for (let i = 0; i < stmts.length; i = i + 1) {
    collectVarsRecursive(stmts[i], vars);
  }
  return vars;
}

function collectVarsRecursive(stmt: AstStmt, vars: Array<string>): void {
  if (stmt.kind === AstStmtKind.VarDecl) {
    vars.push((stmt as VarDeclAst).name);
  }
  if (stmt.kind === AstStmtKind.If) {
    const s = stmt as IfStmtAst;
    collectVarsFromStmt(s.consequent, vars);
    if (s.alternate !== null) collectVarsFromStmt(s.alternate, vars);
  }
  if (stmt.kind === AstStmtKind.While) {
    collectVarsFromStmt((stmt as WhileStmtAst).body, vars);
  }
  if (stmt.kind === AstStmtKind.For) {
    const s = stmt as ForStmtAst;
    if (s.init !== null) collectVarsRecursive(s.init, vars);
    collectVarsFromStmt(s.body, vars);
  }
  if (stmt.kind === AstStmtKind.Block) {
    const body = (stmt as BlockStmtAst).body;
    for (let i = 0; i < body.length; i = i + 1) {
      collectVarsRecursive(body[i], vars);
    }
  }
}

function collectVarsFromStmt(stmt: AstStmt, vars: Array<string>): void {
  if (stmt.kind === AstStmtKind.Block) {
    const body = (stmt as BlockStmtAst).body;
    for (let i = 0; i < body.length; i = i + 1) {
      collectVarsRecursive(body[i], vars);
    }
  } else {
    collectVarsRecursive(stmt, vars);
  }
}

// Convert a VarDecl init to an assignment (for hoisted variables)
function varDeclToAssign(stmt: VarDeclAst): AstStmt {
  if (stmt.init !== null) {
    return mkExprStmt(mkAssignExpr(stmt.name, stmt.init));
  }
  // No init - no-op (the variable is already hoisted and initialized to undefined)
  return { kind: AstStmtKind.Empty, line: 0, col: 0 } as AstStmt;
}

// Linearize the generator body into a sequence of states
function linearizeBody(
  stmts: Array<AstStmt>,
  states: Array<State>,
  current: Array<AstStmt>,
  stateNum: { value: number },
): void {
  for (let i = 0; i < stmts.length; i = i + 1) {
    const stmt = stmts[i];

    // yield expr at statement level
    if (stmt.kind === AstStmtKind.Expr && (stmt as ExprStmtAst).expr.kind === AstExprKind.Yield) {
      const yieldExpr = (stmt as ExprStmtAst).expr as YieldExprAst;
      const yieldVal: AstExpr = yieldExpr.operand !== null ? yieldExpr.operand : mkUndefined();
      const thisState = stateNum.value;
      stateNum.value = stateNum.value + 1;
      states.push({
        num: thisState,
        body: current.slice(),
        exit: { kind: "yield", value: yieldVal, nextState: stateNum.value },
      });
      // Reset current
      current.length = 0;
      continue;
    }

    // return statement (terminal)
    if (stmt.kind === AstStmtKind.Return) {
      const retStmt = stmt as ReturnStmtAst;
      const retVal: AstExpr = retStmt.value !== null ? retStmt.value : mkUndefined();
      current.push(mkReturn(mkIterResult(retVal, true)));
      const thisState = stateNum.value;
      stateNum.value = stateNum.value + 1;
      states.push({
        num: thisState,
        body: current.slice(),
        exit: { kind: "done" },
      });
      current.length = 0;
      continue;
    }

    // For-loop containing yield(s)
    if (stmt.kind === AstStmtKind.For) {
      const forStmt = stmt as ForStmtAst;
      const forBody = getBlockBody(forStmt.body);
      if (bodyContainsYield(forBody)) {
        // State N: pre-loop code + init, goto condition check
        const initState = stateNum.value;
        stateNum.value = stateNum.value + 1;
        const initBody: Array<AstStmt> = current.slice();
        current.length = 0;
        // Convert for-loop init to assignment (var is hoisted)
        if (forStmt.init !== null) {
          if (forStmt.init.kind === AstStmtKind.VarDecl) {
            initBody.push(varDeclToAssign(forStmt.init as VarDeclAst));
          } else {
            initBody.push(forStmt.init);
          }
        }
        const condState = stateNum.value;
        states.push({
          num: initState,
          body: initBody,
          exit: { kind: "goto", nextState: condState },
        });

        // State N+1: condition check
        stateNum.value = stateNum.value + 1;
        const bodyState = stateNum.value;
        let condBody: Array<AstStmt> = [];
        if (forStmt.condition !== null) {
          // if (!condition) { __gen_state = afterLoop; continue; }
          // We use a placeholder 0 for afterLoop, fixed up later
          condBody = [
            mkIf(mkNot(forStmt.condition), mkBlock([
              mkExprStmt(mkAssignExpr("__gen_state", mkNum(0))), // placeholder
              mkContinue(),
            ])),
          ];
        }
        states.push({
          num: condState,
          body: condBody,
          exit: { kind: "goto", nextState: bodyState },
        });

        // Process loop body (may contain yields)
        linearizeBody(forBody, states, current, stateNum);

        // State for update
        const updateState = stateNum.value;
        stateNum.value = stateNum.value + 1;
        const updateBody: Array<AstStmt> = current.slice();
        current.length = 0;
        if (forStmt.update !== null) {
          updateBody.push(mkExprStmt(forStmt.update));
        }
        states.push({
          num: updateState,
          body: updateBody,
          exit: { kind: "goto", nextState: condState },
        });

        // Fix up the condition state's placeholder to point to after-loop state
        const afterLoopState = stateNum.value;
        fixPlaceholderState(states, condState, afterLoopState);
        continue;
      }
    }

    // Regular statement - accumulate
    current.push(stmt);
  }
}

// Fix the placeholder state number (0) in condition-false branches
function fixPlaceholderState(states: Array<State>, condStateNum: number, targetState: number): void {
  for (let i = 0; i < states.length; i = i + 1) {
    if (states[i].num === condStateNum) {
      const body = states[i].body;
      for (let j = 0; j < body.length; j = j + 1) {
        const stmt = body[j];
        if (stmt.kind === AstStmtKind.If) {
          const ifStmt = stmt as IfStmtAst;
          const thenBody = getBlockBody(ifStmt.consequent);
          for (let k = 0; k < thenBody.length; k = k + 1) {
            const inner = thenBody[k];
            if (inner.kind === AstStmtKind.Expr) {
              const exprStmt = inner as ExprStmtAst;
              if (exprStmt.expr.kind === AstExprKind.Assign) {
                const assign = exprStmt.expr as AssignExprAst;
                if (assign.target.kind === AstExprKind.Identifier &&
                    (assign.target as IdentifierExpr).name === "__gen_state" &&
                    assign.value.kind === AstExprKind.Number &&
                    (assign.value as NumberLitExpr).value === 0) {
                  (assign.value as any).value = targetState;
                  (assign.value as any).raw = "" + targetState;
                }
              }
            }
          }
        }
      }
    }
  }
}

// --- Main transform ---

function transformGeneratorDecl(decl: FunctionDeclAst): FunctionDeclAst {
  // 1. Collect hoisted variables from the body
  const hoisted = collectHoistedVars(decl.body);

  // 2. Linearize body into states
  const states: Array<State> = [];
  const current: Array<AstStmt> = [];
  const stateNum = { value: 0 };
  linearizeBody(decl.body, states, current, stateNum);

  // Push final state (code after last yield / end of function)
  states.push({
    num: stateNum.value,
    body: current,
    exit: { kind: "done" },
  });

  // 3. Build the while(true) body with if-chain
  const whileBody: Array<AstStmt> = [];
  for (let i = 0; i < states.length; i = i + 1) {
    const state = states[i];
    const caseBody: Array<AstStmt> = state.body.slice();

    if (state.exit.kind === "yield") {
      const yieldExit = state.exit as YieldExit;
      caseBody.push(mkExprStmt(mkAssignExpr("__gen_state", mkNum(yieldExit.nextState))));
      caseBody.push(mkReturn(mkIterResult(yieldExit.value, false)));
    } else if (state.exit.kind === "goto") {
      const gotoExit = state.exit as GotoExit;
      caseBody.push(mkExprStmt(mkAssignExpr("__gen_state", mkNum(gotoExit.nextState))));
      caseBody.push(mkContinue());
    } else {
      // done
      const hasReturn = caseBody.length > 0 && caseBody[caseBody.length - 1].kind === AstStmtKind.Return;
      if (!hasReturn) {
        caseBody.push(mkExprStmt(mkAssignExpr("__gen_done", mkBool(true))));
        caseBody.push(mkReturn(mkIterResult(mkUndefined(), true)));
      }
    }

    whileBody.push(mkIf(
      mkStrictEq(mkIdent("__gen_state"), mkNum(state.num)),
      mkBlock(caseBody),
    ));
  }

  // Default: done
  whileBody.push(mkExprStmt(mkAssignExpr("__gen_done", mkBool(true))));
  whileBody.push(mkReturn(mkIterResult(mkUndefined(), true)));

  // 4. Build the next() function body
  const nextBody: Array<AstStmt> = [
    // if (__gen_done) return { value: undefined, done: true };
    mkIf(mkIdent("__gen_done"), mkBlock([
      mkReturn(mkIterResult(mkUndefined(), true)),
    ])),
    // while (true) { ... if-chain ... }
    {
      kind: AstStmtKind.While, line: 0, col: 0,
      condition: mkBool(true),
      body: mkBlock(whileBody),
    } as WhileStmtAst,
  ];

  // 5. Build the outer function body
  const newBody: Array<AstStmt> = [];

  // let __gen_state = 0;
  newBody.push(mkVarDecl("__gen_state", mkNum(0)));
  // let __gen_done = false;
  newBody.push(mkVarDecl("__gen_done", mkBool(false)));

  // Hoist variable declarations
  for (let i = 0; i < hoisted.length; i = i + 1) {
    newBody.push(mkVarDecl(hoisted[i], null));
  }

  // const __gen_next = () => { ... };
  const nextArrow: ArrowExprAst = {
    kind: AstExprKind.Arrow, line: 0, col: 0,
    params: [],
    returnType: null,
    body: nextBody,
    async: false,
  };
  newBody.push({
    kind: AstStmtKind.VarDecl, line: 0, col: 0,
    declKind: "const", name: "__gen_next", typeAnnotation: null, init: nextArrow,
  } as VarDeclAst);

  // return { next: __gen_next };
  newBody.push(mkReturn({
    kind: AstExprKind.Object, line: 0, col: 0,
    properties: [
      { key: "next", value: mkIdent("__gen_next"), computed: false, shorthand: false },
    ],
  } as ObjectExprAst));

  // 6. Return transformed function (no longer a generator)
  return {
    kind: AstStmtKind.FunctionDecl,
    line: decl.line,
    col: decl.col,
    name: decl.name,
    params: decl.params,
    returnType: null,
    typeParams: decl.typeParams,
    body: newBody,
    async: false,
    generator: false,
  };
}

// Transform all generator functions in a source file
export function transformGenerators(ast: SourceFile): void {
  for (let i = 0; i < ast.statements.length; i = i + 1) {
    const stmt = ast.statements[i];
    if (stmt.kind === AstStmtKind.FunctionDecl) {
      const funcDecl = stmt as FunctionDeclAst;
      if (funcDecl.generator) {
        ast.statements[i] = transformGeneratorDecl(funcDecl);
      }
    }
    // Also handle exported generator functions
    if (stmt.kind === AstStmtKind.ExportDecl) {
      const exportDecl = stmt as ExportDeclAst;
      if (exportDecl.declaration !== null && exportDecl.declaration.kind === AstStmtKind.FunctionDecl) {
        const funcDecl = exportDecl.declaration as FunctionDeclAst;
        if (funcDecl.generator) {
          (exportDecl as any).declaration = transformGeneratorDecl(funcDecl);
        }
      }
    }
  }
}
