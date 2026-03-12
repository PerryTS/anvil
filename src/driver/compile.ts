// Pipeline: parse -> lower -> codegen -> clang -> link

import * as fs from "fs";
import * as path from "path";
import { HirModule } from "../hir/ir";
import { compileModule } from "../codegen/compiler";
import { linkAll, getDefaultRuntimePath } from "./linker";
import { Parser } from "../parser/parser";
import { Lowerer } from "../hir/lower";

export interface CompileOptions {
  inputFile: string;
  outputFile: string;
  runtimePath: string;
  emitLL: boolean;  // if true, also keep the .ll file
}

export function compile(options: CompileOptions): void {
  // Step 1: Parse
  console.log("[perrysdad] Parsing " + options.inputFile + "...");
  const source = fs.readFileSync(options.inputFile, "utf-8");
  const parser = new Parser(source, path.basename(options.inputFile));
  const ast = parser.parse();

  // Step 2: Lower AST -> HIR
  console.log("[perrysdad] Lowering to HIR...");
  const lowerer = new Lowerer();
  const hirModule = lowerer.lower(ast);

  // Step 3: Codegen + link
  compileFromHIR(hirModule, options);
}

// Compile from a pre-built HIR module (used in Phase 0-1 before parser exists)
export function compileFromHIR(hirModule: HirModule, options: CompileOptions): void {
  // Step 1: Generate LLVM IR
  console.log("[perrysdad] Generating LLVM IR...");
  const llvmIR = compileModule(hirModule);

  // Step 2: Write .ll file
  const llFile = options.outputFile + ".ll";
  fs.writeFileSync(llFile, llvmIR);
  console.log("[perrysdad] Wrote " + llFile);

  // Step 3: Compile and link
  linkAll({
    llFile: llFile,
    outputPath: options.outputFile,
    runtimePath: options.runtimePath,
  });

  // Clean up .ll unless requested to keep
  if (!options.emitLL) {
    fs.unlinkSync(llFile);
    // Also clean up .o
    const objFile = llFile.replace(/\.ll$/, ".o");
    if (fs.existsSync(objFile)) {
      fs.unlinkSync(objFile);
    }
  }

  console.log("[perrysdad] Built " + options.outputFile);
}
