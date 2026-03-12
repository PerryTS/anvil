// Shell out to clang/cc for .o and final link

import { execSync } from "child_process";
import * as path from "path";

const DEFAULT_RUNTIME_PATH = path.resolve(__dirname, "../../../perry/target/release/libperry_runtime.a");

export interface LinkOptions {
  llFile: string;
  outputPath: string;
  runtimePath: string;
}

// Compile .ll to .o via clang
export function compileLLToObject(llFile: string, objFile: string): void {
  const cmd = "clang -c " + quote(llFile) + " -o " + quote(objFile);
  console.log("[perrysdad] " + cmd);
  execSync(cmd, { stdio: "inherit" });
}

// Link .o + runtime into final executable
export function linkExecutable(objFile: string, runtimePath: string, outputPath: string): void {
  const cmd = "cc " + quote(objFile) + " " + quote(runtimePath) + " -lSystem -lresolv -liconv -o " + quote(outputPath);
  console.log("[perrysdad] " + cmd);
  execSync(cmd, { stdio: "inherit" });
}

// Full pipeline: .ll -> .o -> executable
export function linkAll(options: LinkOptions): void {
  const objFile = options.llFile.replace(/\.ll$/, ".o");
  compileLLToObject(options.llFile, objFile);
  linkExecutable(objFile, options.runtimePath, options.outputPath);
}

export function getDefaultRuntimePath(): string {
  return DEFAULT_RUNTIME_PATH;
}

function quote(s: string): string {
  // Simple quoting for shell safety
  if (s.indexOf(" ") >= 0 || s.indexOf("(") >= 0 || s.indexOf(")") >= 0) {
    return "'" + s + "'";
  }
  return s;
}
