// LLFunction: LLVM IR function builder with blocks

import { LLVMType, VOID } from "./types";
import { LLBlock } from "./block";

export class LLFunction {
  readonly name: string;
  readonly returnType: LLVMType;
  readonly params: Array<[LLVMType, string]>;
  private blocks: Array<LLBlock>;
  private blockCounter: number;
  private regCounter: number;

  constructor(name: string, returnType: LLVMType, params: Array<[LLVMType, string]>) {
    this.name = name;
    this.returnType = returnType;
    this.params = params;
    this.blocks = [];
    this.blockCounter = 0;
    this.regCounter = 0;

    // Reserve register numbers for parameters
    // In LLVM IR, params are %0, %1, ... but we use named params
  }

  // Create a new basic block
  createBlock(name: string): LLBlock {
    const self = this;
    const label = name + "." + this.blockCounter;
    this.blockCounter = this.blockCounter + 1;
    const block = new LLBlock(label, function(): number {
      self.regCounter = self.regCounter + 1;
      return self.regCounter;
    });
    this.blocks.push(block);
    return block;
  }

  // Allocate a fresh register number (for use outside blocks)
  nextReg(): string {
    this.regCounter = this.regCounter + 1;
    return "%" + this.regCounter;
  }

  // Emit function definition to LLVM IR text
  toIR(): string {
    const paramStr = this.params.map(function(p: [LLVMType, string]): string {
      return p[0] + " " + p[1];
    }).join(", ");

    let ir = "define " + this.returnType + " @" + this.name + "(" + paramStr + ") {\n";

    for (let i = 0; i < this.blocks.length; i = i + 1) {
      if (i > 0) {
        ir = ir + "\n";
      }
      ir = ir + this.blocks[i].toIR() + "\n";
    }

    ir = ir + "}\n";
    return ir;
  }
}
