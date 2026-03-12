// Main codegen driver: HIR Module -> LLVM IR string

import { HirModule, HirFunction, Stmt } from "../hir/ir";
import { Type, TypeKind, VOID_TYPE } from "../hir/types";
import { LLModule } from "../llvm/module";
import { LLFunction } from "../llvm/function";
import { LLBlock } from "../llvm/block";
import { DOUBLE, I32, I64, VOID } from "../llvm/types";
import { TAG_UNDEFINED, i64Literal } from "./nanbox";
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

  constructor(mod: LLModule) {
    this.mod = mod;
    this.currentFunc = null;
    this.locals = new Map();
    this.funcNames = new Map();
    this.funcInfos = new Map();
    this.loopStack = [];
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
      throw new Error("Unknown local: " + id);
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
    this.loopStack.push([breakLabel, continueLabel]);
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
}

// Compile a full HIR module to LLVM IR text
export function compileModule(hirModule: HirModule): string {
  const mod = new LLModule();
  const ctx = new CompilerContext(mod);

  // Declare runtime FFI functions
  declareRuntimeFunctions(mod);

  // Register all functions first (for forward references)
  for (let i = 0; i < hirModule.functions.length; i = i + 1) {
    const func = hirModule.functions[i];
    ctx.registerFunc(func.id, func.name, func);
  }

  // Compile each function
  for (let i = 0; i < hirModule.functions.length; i = i + 1) {
    compileFunction(ctx, mod, hirModule.functions[i]);
  }

  // Compile init statements as main()
  compileInit(ctx, mod, hirModule.init);

  return mod.toIR();
}

function compileFunction(ctx: CompilerContext, mod: LLModule, hirFunc: HirFunction): void {
  // All params and return are double (NaN-boxed values)
  const params: Array<[string, string]> = [];
  for (let i = 0; i < hirFunc.params.length; i = i + 1) {
    params.push([DOUBLE, "%p" + i]);
  }

  const func = mod.defineFunction(hirFunc.name, DOUBLE, params);
  ctx.setCurrentFunc(func);
  ctx.clearLocals();

  const entry = func.createBlock("entry");

  // Allocate and store params into local slots
  for (let i = 0; i < hirFunc.params.length; i = i + 1) {
    const param = hirFunc.params[i];
    const localId = param[0];
    const ptr = entry.alloca(DOUBLE);
    entry.store(DOUBLE, "%p" + i, ptr);
    ctx.setLocal(localId, ptr);
  }

  // Compile body
  let currentBlock = entry;
  for (let i = 0; i < hirFunc.body.length; i = i + 1) {
    if (currentBlock.isTerminated()) break;
    currentBlock = compileStmt(ctx, currentBlock, hirFunc.body[i]);
  }

  // Add implicit return undefined if not terminated
  if (!currentBlock.isTerminated()) {
    const undef = currentBlock.bitcastI64ToDouble(i64Literal(TAG_UNDEFINED));
    currentBlock.ret(DOUBLE, undef);
  }
}

function compileInit(ctx: CompilerContext, mod: LLModule, stmts: Array<Stmt>): void {
  const mainFunc = mod.defineFunction("main", I32, []);
  ctx.setCurrentFunc(mainFunc);
  ctx.clearLocals();

  const entry = mainFunc.createBlock("entry");

  // Initialize runtime
  entry.callVoid("js_gc_init", []);

  // Compile init statements
  let currentBlock = entry;
  for (let i = 0; i < stmts.length; i = i + 1) {
    if (currentBlock.isTerminated()) break;
    currentBlock = compileStmt(ctx, currentBlock, stmts[i]);
  }

  // Return 0
  if (!currentBlock.isTerminated()) {
    currentBlock.ret(I32, "0");
  }
}
