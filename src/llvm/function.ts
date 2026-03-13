// LLFunction: LLVM IR function builder with blocks

import { LLVMType } from "./types";
import { LLBlock, RegCounter } from "./block";

export class LLFunction {
  readonly name: string;
  readonly returnType: LLVMType;
  readonly params: Array<[LLVMType, string]>;
  private blocks: Array<LLBlock>;
  private blockCounter: number;
  private regCounter: RegCounter;
  linkage: string;

  constructor(name: string, returnType: LLVMType, params: Array<[LLVMType, string]>) {
    this.name = name;
    this.returnType = returnType;
    this.params = params;
    this.blocks = [];
    this.blockCounter = 0;
    this.regCounter = new RegCounter();
    this.linkage = "";
  }

  // Create a new basic block
  createBlock(name: string): LLBlock {
    let bc: number = this.blockCounter;
    const label = name + "." + bc;
    this.blockCounter = bc + 1;
    let rc: RegCounter = this.regCounter;
    const block = new LLBlock(label, rc);
    let bArr = this.blocks;
    bArr.push(block);
    this.blocks = bArr;
    return block;
  }

  // Allocate a fresh register number (for use outside blocks)
  nextReg(): string {
    let rc: RegCounter = this.regCounter;
    let n: number = rc.next();
    return "%" + n;
  }

  // Emit function definition to LLVM IR text
  toIR(): string {
    let paramParts: Array<string> = [];
    for (let i = 0; i < this.params.length; i = i + 1) {
      let p: [LLVMType, string] = this.params[i];
      let pt: string = p[0];
      let pn: string = p[1];
      paramParts.push(pt + " " + pn);
    }
    let paramStr: string = paramParts.join(", ");

    let rt: string = this.returnType;
    let nm: string = this.name;
    let linkageStr: string = this.linkage !== "" ? this.linkage + " " : "";
    let ir = "define " + linkageStr + rt + " @" + nm + "(" + paramStr + ") {\n";

    for (let i = 0; i < this.blocks.length; i = i + 1) {
      let blk: LLBlock = this.blocks[i];
      if (i > 0) {
        ir = ir + "\n";
      }
      ir = ir + blk.toIR() + "\n";
    }

    ir = ir + "}\n";
    return ir;
  }
}
