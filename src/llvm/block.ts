// LLBlock: LLVM IR basic block instruction emitter
//
// Uses alloca/load/store for locals to avoid SSA phi nodes.
// LLVM's mem2reg pass will optimize these into SSA form.

import { LLVMType, DOUBLE, I64, I32, I1, PTR, VOID } from "./types";

export class LLBlock {
  readonly label: string;
  private instructions: Array<string>;
  private terminated: boolean;
  private nextReg: () => number;

  constructor(label: string, nextReg: () => number) {
    this.label = label;
    this.instructions = [];
    this.terminated = false;
    this.nextReg = nextReg;
  }

  isTerminated(): boolean {
    return this.terminated;
  }

  // Emit a raw instruction line
  private emit(line: string): void {
    this.instructions.push("  " + line);
  }

  // Allocate a new SSA register name (using function-wide counter for uniqueness)
  private reg(): string {
    return "%r" + this.nextReg();
  }

  // --- Arithmetic (double) ---

  fadd(a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = fadd double " + a + ", " + b);
    return r;
  }

  fsub(a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = fsub double " + a + ", " + b);
    return r;
  }

  fmul(a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = fmul double " + a + ", " + b);
    return r;
  }

  fdiv(a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = fdiv double " + a + ", " + b);
    return r;
  }

  frem(a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = frem double " + a + ", " + b);
    return r;
  }

  fneg(a: string): string {
    const r = this.reg();
    this.emit(r + " = fneg double " + a);
    return r;
  }

  // --- Comparisons ---

  fcmp(cond: string, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = fcmp " + cond + " double " + a + ", " + b);
    return r;
  }

  icmpEq(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = icmp eq " + ty + " " + a + ", " + b);
    return r;
  }

  icmpNe(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = icmp ne " + ty + " " + a + ", " + b);
    return r;
  }

  icmpSlt(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = icmp slt " + ty + " " + a + ", " + b);
    return r;
  }

  icmpSgt(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = icmp sgt " + ty + " " + a + ", " + b);
    return r;
  }

  icmpSle(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = icmp sle " + ty + " " + a + ", " + b);
    return r;
  }

  icmpSge(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = icmp sge " + ty + " " + a + ", " + b);
    return r;
  }

  // --- Memory ---

  alloca(ty: LLVMType): string {
    const r = this.reg();
    this.emit(r + " = alloca " + ty);
    return r;
  }

  load(ty: LLVMType, ptr: string): string {
    const r = this.reg();
    this.emit(r + " = load " + ty + ", ptr " + ptr);
    return r;
  }

  store(ty: LLVMType, val: string, ptr: string): void {
    this.emit("store " + ty + " " + val + ", ptr " + ptr);
  }

  // --- Conversions ---

  bitcastI64ToDouble(val: string): string {
    const r = this.reg();
    this.emit(r + " = bitcast i64 " + val + " to double");
    return r;
  }

  bitcastDoubleToI64(val: string): string {
    const r = this.reg();
    this.emit(r + " = bitcast double " + val + " to i64");
    return r;
  }

  sitofp(fromTy: LLVMType, val: string, toTy: LLVMType): string {
    const r = this.reg();
    this.emit(r + " = sitofp " + fromTy + " " + val + " to " + toTy);
    return r;
  }

  fptosi(fromTy: LLVMType, val: string, toTy: LLVMType): string {
    const r = this.reg();
    this.emit(r + " = fptosi " + fromTy + " " + val + " to " + toTy);
    return r;
  }

  trunc(fromTy: LLVMType, val: string, toTy: LLVMType): string {
    const r = this.reg();
    this.emit(r + " = trunc " + fromTy + " " + val + " to " + toTy);
    return r;
  }

  zext(fromTy: LLVMType, val: string, toTy: LLVMType): string {
    const r = this.reg();
    this.emit(r + " = zext " + fromTy + " " + val + " to " + toTy);
    return r;
  }

  sext(fromTy: LLVMType, val: string, toTy: LLVMType): string {
    const r = this.reg();
    this.emit(r + " = sext " + fromTy + " " + val + " to " + toTy);
    return r;
  }

  inttoptr(fromTy: LLVMType, val: string): string {
    const r = this.reg();
    this.emit(r + " = inttoptr " + fromTy + " " + val + " to ptr");
    return r;
  }

  ptrtoint(val: string, toTy: LLVMType): string {
    const r = this.reg();
    this.emit(r + " = ptrtoint ptr " + val + " to " + toTy);
    return r;
  }

  // --- Integer arithmetic ---

  add(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = add " + ty + " " + a + ", " + b);
    return r;
  }

  sub(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = sub " + ty + " " + a + ", " + b);
    return r;
  }

  mul(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = mul " + ty + " " + a + ", " + b);
    return r;
  }

  and(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = and " + ty + " " + a + ", " + b);
    return r;
  }

  or(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = or " + ty + " " + a + ", " + b);
    return r;
  }

  xor(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = xor " + ty + " " + a + ", " + b);
    return r;
  }

  shl(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = shl " + ty + " " + a + ", " + b);
    return r;
  }

  ashr(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = ashr " + ty + " " + a + ", " + b);
    return r;
  }

  lshr(ty: LLVMType, a: string, b: string): string {
    const r = this.reg();
    this.emit(r + " = lshr " + ty + " " + a + ", " + b);
    return r;
  }

  // --- Select ---

  select(condTy: LLVMType, cond: string, ty: LLVMType, trueVal: string, falseVal: string): string {
    const r = this.reg();
    this.emit(r + " = select " + condTy + " " + cond + ", " + ty + " " + trueVal + ", " + ty + " " + falseVal);
    return r;
  }

  // --- Function calls ---

  call(retTy: LLVMType, funcName: string, args: Array<[LLVMType, string]>): string {
    const r = this.reg();
    const argStr = formatArgs(args);
    this.emit(r + " = call " + retTy + " @" + funcName + "(" + argStr + ")");
    return r;
  }

  callVoid(funcName: string, args: Array<[LLVMType, string]>): void {
    const argStr = formatArgs(args);
    this.emit("call void @" + funcName + "(" + argStr + ")");
  }

  callIndirect(retTy: LLVMType, fnPtr: string, args: Array<[LLVMType, string]>): string {
    const r = this.reg();
    const argStr = formatArgs(args);
    const paramTypes = args.map(function(a: [LLVMType, string]): string { return a[0]; }).join(", ");
    this.emit(r + " = call " + retTy + " (" + paramTypes + ")* " + fnPtr + "(" + argStr + ")");
    return r;
  }

  // --- Control flow ---

  br(target: string): void {
    this.emit("br label %" + target);
    this.terminated = true;
  }

  condBr(cond: string, trueLabel: string, falseLabel: string): void {
    this.emit("br i1 " + cond + ", label %" + trueLabel + ", label %" + falseLabel);
    this.terminated = true;
  }

  ret(ty: LLVMType, val: string): void {
    this.emit("ret " + ty + " " + val);
    this.terminated = true;
  }

  retVoid(): void {
    this.emit("ret void");
    this.terminated = true;
  }

  unreachable(): void {
    this.emit("unreachable");
    this.terminated = true;
  }

  // --- GEP ---

  gep(baseTy: LLVMType, ptr: string, indices: Array<[LLVMType, string]>): string {
    const r = this.reg();
    const idxStr = indices.map(function(idx: [LLVMType, string]): string { return idx[0] + " " + idx[1]; }).join(", ");
    this.emit(r + " = getelementptr " + baseTy + ", ptr " + ptr + ", " + idxStr);
    return r;
  }

  // --- Phi ---

  phi(ty: LLVMType, incoming: Array<[string, string]>): string {
    const r = this.reg();
    const pairs = incoming.map(function(pair: [string, string]): string { return "[ " + pair[0] + ", %" + pair[1] + " ]"; }).join(", ");
    this.emit(r + " = phi " + ty + " " + pairs);
    return r;
  }

  // --- Output ---

  toIR(): string {
    return this.label + ":\n" + this.instructions.join("\n");
  }
}

function formatArgs(args: Array<[LLVMType, string]>): string {
  return args.map(function(a: [LLVMType, string]): string { return a[0] + " " + a[1]; }).join(", ");
}
