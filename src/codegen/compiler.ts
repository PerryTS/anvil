// Main codegen driver: HIR Module -> LLVM IR string

import { HirModule, HirFunction, Stmt, LetStmt } from "../hir/ir";
import { Type, TypeKind } from "../hir/types";
const VOID_TYPE: Type = { kind: TypeKind.Void };
import { LLModule } from "../llvm/module";
import { LLFunction } from "../llvm/function";
import { LLBlock } from "../llvm/block";
const DOUBLE: string = "double";
const I32: string = "i32";
const I64: string = "i64";
const PTR: string = "ptr";
const VOID: string = "void";
const TAG_UNDEFINED = 0x7FFC_0000_0000_0001n;
import { i64Literal, TAG_UNDEFINED_I64 } from "./nanbox";
import { declareRuntimeFunctions } from "./runtime_decls";
import { compileStmt } from "./stmt";

// Context passed through compilation, tracks locals, functions, loop targets
export class CompilerContext {
  private mod: LLModule;
  private currentFunc: LLFunction | null;
  private locals: Map<number, string>;  // localId -> alloca ptr
  private funcNames: Map<number, string>;  // funcId -> LLVM function name
  private funcInfos: Map<number, HirFunction>;
  private loopStack: Array<[string, string]>;  // [breakLabel, continueLabel]
  public globalPrefix: string;  // prefix for global variable names (module isolation)
  private importedGlobalNames: Set<string>;  // full global names that are imported (no prefix needed)
  public asyncPromisePtr: string | null;  // alloca ptr for async function's promise (null if not async)

  constructor(mod: LLModule) {
    this.mod = mod;
    this.currentFunc = null;
    this.locals = new Map();
    this.funcNames = new Map();
    this.funcInfos = new Map();
    this.loopStack = [];
    this.globalPrefix = "";
    this.importedGlobalNames = new Set();
    this.asyncPromisePtr = null;
  }

  getGlobalName(name: string): string {
    // If this is an imported global (already has full cross-module name), use as-is
    if (this.importedGlobalNames.has(name)) {
      return "@" + name;
    }
    return "@__global_" + this.globalPrefix + name;
  }

  registerImportedGlobal(fullGlobalName: string): void {
    this.importedGlobalNames.add(fullGlobalName);
  }

  setCurrentFunc(func: LLFunction): void {
    this.currentFunc = func;
  }

  createBlock(name: string): LLBlock {
    if (this.currentFunc === null) {
      throw new Error("No current function");
    }
    return this.currentFunc.createBlock(name);
  }

  getLocal(id: number): string {
    const ptr = this.locals.get(id);
    if (ptr === undefined) {
      throw new Error("Unknown local: " + id + " in function " + (this.currentFunc !== null ? this.currentFunc.name : "?") + " (known: " + Array.from(this.locals.keys()).join(",") + ")");
    }
    return ptr;
  }

  setLocal(id: number, ptr: string): void {
    this.locals.set(id, ptr);
  }

  clearLocals(): void {
    this.locals = new Map();
  }

  registerFunc(id: number, name: string, info: HirFunction): void {
    this.funcNames.set(id, name);
    this.funcInfos.set(id, info);
  }

  getFuncName(id: number): string {
    const name = this.funcNames.get(id);
    if (name === undefined) {
      throw new Error("Unknown function: " + id);
    }
    return name;
  }

  getFuncInfo(id: number): HirFunction | null {
    const info = this.funcInfos.get(id);
    if (info === undefined) {
      return null;
    }
    return info;
  }

  pushLoop(breakLabel: string, continueLabel: string): void {
    let arr = this.loopStack;
    arr.push([breakLabel, continueLabel]);
    this.loopStack = arr;
  }

  popLoop(): void {
    this.loopStack.pop();
  }

  getBreakTarget(): string | null {
    if (this.loopStack.length === 0) return null;
    return this.loopStack[this.loopStack.length - 1][0];
  }

  getContinueTarget(): string | null {
    if (this.loopStack.length === 0) return null;
    return this.loopStack[this.loopStack.length - 1][1];
  }

  addStringConstant(value: string): [string, number] {
    return this.mod.addStringConstant(value);
  }

  // Ensure an external function is declared in the LLVM module
  ensureExternalDeclared(name: string, argCount: number): void {
    // Skip if already declared (e.g., runtime functions or previously declared externals)
    if (this.mod.isDeclared(name)) return;
    const paramTypes: Array<string> = [];
    for (let i = 0; i < argCount; i = i + 1) {
      paramTypes.push(DOUBLE);
    }
    this.mod.declareFunction(name, DOUBLE, paramTypes);
  }

  // Register an external function (imported, no HirFunction body)
  registerExternalFunc(id: number, name: string): void {
    this.funcNames.set(id, name);
  }
}

// Compile a full HIR module to LLVM IR text
// moduleName: if set, use module-prefixed globals
// depInits: init functions to call at start of entry module's main
// isEntry: if true, generate main() instead of _init_<moduleName>()
export function compileModule(hirModule: HirModule, moduleName: string | null, depInits: Array<string> | null, isEntry: boolean): string {
  const mod = new LLModule();
  const ctx = new CompilerContext(mod);

  // Set global prefix for module isolation
  if (moduleName !== null) {
    ctx.globalPrefix = moduleName + "__";
  }

  // Declare runtime FFI functions
  declareRuntimeFunctions(mod);

  // Declare LLVM globals for module-level variables accessed from functions
  for (let i = 0; i < hirModule.globals.length; i = i + 1) {
    mod.addGlobal("__global_" + ctx.globalPrefix + hirModule.globals[i], DOUBLE, "0.0");
  }

  // Register all functions first (for forward references)
  for (let i = 0; i < hirModule.functions.length; i = i + 1) {
    const func = hirModule.functions[i];
    ctx.registerFunc(func.id, func.name, func);
  }

  // Register external (imported) functions
  for (let i = 0; i < hirModule.externalFuncs.length; i = i + 1) {
    const extFunc = hirModule.externalFuncs[i];
    ctx.registerExternalFunc(extFunc[0], extFunc[1]);
  }

  // Declare imported globals from other modules as external
  for (let i = 0; i < hirModule.importedGlobals.length; i = i + 1) {
    const ig = hirModule.importedGlobals[i];
    const fullName = ig[1];  // e.g., "__global_codegen_nanbox__TAG_TRUE_I64"
    mod.addExternalGlobal(fullName, DOUBLE);
    ctx.registerImportedGlobal(fullName);
  }

  // Check if there's a user-defined "main" function (conflicts with init main)
  let hasUserMain = false;
  for (let i = 0; i < hirModule.functions.length; i = i + 1) {
    if (hirModule.functions[i].name === "main") {
      hirModule.functions[i].name = "__user_main";
      hasUserMain = true;
    }
  }

  // Compile each function
  for (let i = 0; i < hirModule.functions.length; i = i + 1) {
    compileFunction(ctx, mod, hirModule.functions[i]);
  }

  // Compile init statements
  if (moduleName !== null && !isEntry) {
    // Non-entry module: init function named _init_<moduleName>
    compileModuleInit(ctx, mod, hirModule.init, hirModule.globals, "_init_" + moduleName);
  } else {
    // Entry module: main() with optional dependency init calls
    compileInit(ctx, mod, hirModule.init, hirModule.globals, depInits);
  }

  return mod.toIR();
}

function compileFunction(ctx: CompilerContext, mod: LLModule, hirFunc: HirFunction): void {
  // Check if this is a closure function (first param named "$closure_ptr")
  const isClosure = hirFunc.params.length > 0 && hirFunc.params[0][1] === "$closure_ptr";

  // All params are double (NaN-boxed values), except closure ptr which is ptr
  const params: Array<[string, string]> = [];
  for (let i = 0; i < hirFunc.params.length; i = i + 1) {
    if (i === 0 && isClosure) {
      params.push([PTR, "%p" + i]);
    } else {
      params.push([DOUBLE, "%p" + i]);
    }
  }

  const func: LLFunction = mod.defineFunction(hirFunc.name, DOUBLE, params);
  ctx.setCurrentFunc(func);
  ctx.clearLocals();

  const entry: LLBlock = func.createBlock("entry");

  // For async functions, allocate a promise and store its pointer
  let asyncPromisePtr: string | null = null;
  if (hirFunc.isAsync) {
    const promise = entry.call(PTR, "js_promise_new", []);
    asyncPromisePtr = entry.alloca(PTR);
    entry.store(PTR, promise, asyncPromisePtr);
    ctx.asyncPromisePtr = asyncPromisePtr;
  } else {
    ctx.asyncPromisePtr = null;
  }

  // Allocate and store params into local slots
  for (let i = 0; i < hirFunc.params.length; i = i + 1) {
    const param = hirFunc.params[i];
    const localId = param[0];
    if (i === 0 && isClosure) {
      // Closure ptr: store as NaN-boxed pointer (double) so CaptureGet can unbox it
      const i64Val = entry.ptrtoint("%p" + i, I64);
      const boxed = entry.call(DOUBLE, "js_nanbox_pointer", [[I64, i64Val]]);
      const ptr = entry.alloca(DOUBLE);
      entry.store(DOUBLE, boxed, ptr);
      ctx.setLocal(localId, ptr);
    } else {
      const ptr = entry.alloca(DOUBLE);
      entry.store(DOUBLE, "%p" + i, ptr);
      ctx.setLocal(localId, ptr);
    }
  }

  // Compile body
  let currentBlock: LLBlock = entry;
  for (let i = 0; i < hirFunc.body.length; i = i + 1) {
    if (currentBlock.isTerminated()) break;
    currentBlock = compileStmt(ctx, currentBlock, hirFunc.body[i]);
  }

  // Add implicit return undefined if not terminated
  if (!currentBlock.isTerminated()) {
    if (hirFunc.isAsync && asyncPromisePtr !== null) {
      // Resolve promise with undefined and return the NaN-boxed promise
      const promise = currentBlock.load(PTR, asyncPromisePtr);
      const undef = currentBlock.bitcastI64ToDouble(TAG_UNDEFINED_I64);
      currentBlock.callVoid("js_promise_resolve", [[PTR, promise], [DOUBLE, undef]]);
      const promiseI64 = currentBlock.ptrtoint(promise, I64);
      const promiseBoxed = currentBlock.call(DOUBLE, "js_nanbox_pointer", [[I64, promiseI64]]);
      currentBlock.ret(DOUBLE, promiseBoxed);
    } else {
      const undef = currentBlock.bitcastI64ToDouble(TAG_UNDEFINED_I64);
      currentBlock.ret(DOUBLE, undef);
    }
  }
}

function compileInit(ctx: CompilerContext, mod: LLModule, stmts: Array<Stmt>, globals: Array<string>, depInits: Array<string> | null): void {
  const mainFunc: LLFunction = mod.defineFunction("main", I32, [[I32, "%argc"], [PTR, "%argv"]]);
  ctx.setCurrentFunc(mainFunc);
  ctx.clearLocals();

  const entry: LLBlock = mainFunc.createBlock("entry");

  // Initialize runtime and pass command-line args
  entry.callVoid("js_gc_init", []);

  // Define js_set_args inline (stores argc/argv in module-level globals)
  if (!mod.isDeclared("js_set_args")) {
    mod.addInternalGlobal("_pd_argc", I32, "0");
    mod.addInternalGlobal("_pd_argv", PTR, "null");
    const setArgsFunc: LLFunction = mod.defineFunction("js_set_args", VOID, [[I32, "%argc"], [PTR, "%argv"]]);
    setArgsFunc.linkage = "weak";
    const setArgsBlock: LLBlock = setArgsFunc.createBlock("entry");
    setArgsBlock.store(I32, "%argc", "@_pd_argc");
    setArgsBlock.store(PTR, "%argv", "@_pd_argv");
    setArgsBlock.retVoid();
  }
  entry.callVoid("js_set_args", [[I32, "%argc"], [PTR, "%argv"]]);

  // Call dependency init functions before our own init code
  if (depInits !== null) {
    for (let d = 0; d < depInits.length; d = d + 1) {
      mod.declareFunction(depInits[d], VOID, []);
      entry.callVoid(depInits[d], []);
    }
  }

  // Build a map of global names to their local IDs (populated as Let stmts are compiled)
  const globalLocalMap: Map<string, number> = new Map();
  const gp = ctx.globalPrefix;

  // Compile init statements
  let currentBlock: LLBlock = entry;
  for (let i = 0; i < stmts.length; i = i + 1) {
    if (currentBlock.isTerminated()) break;

    // Before each statement, store locals → globals (so functions see latest init values)
    for (let g = 0; g < globals.length; g = g + 1) {
      const localId = globalLocalMap.get(globals[g]);
      if (localId !== undefined) {
        const ptr = ctx.getLocal(localId);
        const val = currentBlock.load(DOUBLE, ptr);
        currentBlock.store(DOUBLE, val, "@__global_" + gp + globals[g]);
      }
    }

    currentBlock = compileStmt(ctx, currentBlock, stmts[i]);

    // If this was a Let statement for a global, track the local ID and store init value
    const stmt = stmts[i];
    if (stmt.kind === 1) { // StmtKind.Let
      const letStmt: LetStmt = stmt as LetStmt;
      for (let g = 0; g < globals.length; g = g + 1) {
        if (globals[g] === letStmt.name) {
          globalLocalMap.set(letStmt.name, letStmt.localId);
          // Store the just-initialized local value to the global
          const ptr = ctx.getLocal(letStmt.localId);
          const val = currentBlock.load(DOUBLE, ptr);
          currentBlock.store(DOUBLE, val, "@__global_" + gp + letStmt.name);
          break;
        }
      }
    }

    // After each statement, reload globals → locals (functions may have modified them)
    for (let g = 0; g < globals.length; g = g + 1) {
      const localId = globalLocalMap.get(globals[g]);
      if (localId !== undefined) {
        const val = currentBlock.load(DOUBLE, "@__global_" + gp + globals[g]);
        const ptr = ctx.getLocal(localId);
        currentBlock.store(DOUBLE, val, ptr);
      }
    }
  }

  // Return 0
  if (!currentBlock.isTerminated()) {
    currentBlock.ret(I32, "0");
  }
}

// Compile init statements for a non-entry module (returns void, no gc_init)
function compileModuleInit(ctx: CompilerContext, mod: LLModule, stmts: Array<Stmt>, globals: Array<string>, initName: string): void {
  const initFunc: LLFunction = mod.defineFunction(initName, VOID, []);
  ctx.setCurrentFunc(initFunc);
  ctx.clearLocals();

  const entry: LLBlock = initFunc.createBlock("entry");

  const globalLocalMap: Map<string, number> = new Map();
  const gp = ctx.globalPrefix;

  let currentBlock: LLBlock = entry;
  for (let i = 0; i < stmts.length; i = i + 1) {
    if (currentBlock.isTerminated()) break;

    for (let g = 0; g < globals.length; g = g + 1) {
      const localId = globalLocalMap.get(globals[g]);
      if (localId !== undefined) {
        const ptr = ctx.getLocal(localId);
        const val = currentBlock.load(DOUBLE, ptr);
        currentBlock.store(DOUBLE, val, "@__global_" + gp + globals[g]);
      }
    }

    currentBlock = compileStmt(ctx, currentBlock, stmts[i]);

    const stmt = stmts[i];
    if (stmt.kind === 1) {
      const letStmt: LetStmt = stmt as LetStmt;
      for (let g = 0; g < globals.length; g = g + 1) {
        if (globals[g] === letStmt.name) {
          globalLocalMap.set(letStmt.name, letStmt.localId);
          const ptr = ctx.getLocal(letStmt.localId);
          const val = currentBlock.load(DOUBLE, ptr);
          currentBlock.store(DOUBLE, val, "@__global_" + gp + letStmt.name);
          break;
        }
      }
    }

    for (let g = 0; g < globals.length; g = g + 1) {
      const localId = globalLocalMap.get(globals[g]);
      if (localId !== undefined) {
        const val = currentBlock.load(DOUBLE, "@__global_" + gp + globals[g]);
        const ptr = ctx.getLocal(localId);
        currentBlock.store(DOUBLE, val, ptr);
      }
    }
  }

  if (!currentBlock.isTerminated()) {
    currentBlock.retVoid();
  }
}
