// Shell out to clang/cc for .o and final link

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

function findRuntimePath(): string {
  // Try several known locations
  const candidates: Array<string> = [
    path.resolve(__dirname, "../../../perry/target/release/libperry_runtime.a"),
    path.resolve(process.cwd(), "../perry/target/release/libperry_runtime.a"),
    "/Users/amlug/projects/perry/target/release/libperry_runtime.a",
  ];
  for (let i = 0; i < candidates.length; i = i + 1) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i];
    }
  }
  return candidates[0]; // fallback
}

const DEFAULT_RUNTIME_PATH = findRuntimePath();

export interface LinkOptions {
  llFile: string;
  outputPath: string;
  runtimePath: string;
}

// Compile .ll to .o via clang
export function compileLLToObject(llFile: string, objFile: string): void {
  const cmd = "clang -c " + quote(llFile) + " -o " + quote(objFile);
  console.error("[anvil] " + cmd);
  execSync(cmd, { stdio: "inherit" });
}

// Link .o + runtime into final executable
export function linkExecutable(objFile: string, runtimePath: string, outputPath: string): void {
  // Compile stubs if available
  // Look for stubs.c: first next to __dirname/../, then in src/
  let stubsC = path.resolve(__dirname, "../stubs.c");
  if (!fs.existsSync(stubsC)) {
    stubsC = path.resolve(__dirname, "../../src/stubs.c");
  }
  let stubsArg = "";
  if (fs.existsSync(stubsC)) {
    const stubsO = outputPath + "_stubs.o";
    const stubCmd = "clang -c " + quote(stubsC) + " -o " + quote(stubsO);
    execSync(stubCmd, { stdio: "inherit" });
    stubsArg = " " + quote(stubsO);
  }
  const cmd = "cc " + quote(objFile) + stubsArg + " " + quote(runtimePath) + " -lSystem -lresolv -liconv -o " + quote(outputPath);
  console.error("[anvil] " + cmd);
  execSync(cmd, { stdio: "inherit" });
  // Clean up stubs .o
  if (stubsArg !== "") {
    const stubsO = outputPath + "_stubs.o";
    if (fs.existsSync(stubsO)) {
      fs.unlinkSync(stubsO);
    }
  }
}

// Link multiple .o files + runtime into final executable
export function linkMultipleObjects(objFiles: Array<string>, runtimePath: string, outputPath: string): void {
  let cmd = "cc";
  for (let i = 0; i < objFiles.length; i = i + 1) {
    cmd = cmd + " " + quote(objFiles[i]);
  }
  cmd = cmd + " " + quote(runtimePath) + " -lSystem -lresolv -liconv -o " + quote(outputPath);
  console.error("[anvil] Linking " + objFiles.length + " object files...");
  execSync(cmd, { stdio: "inherit" });
}

// Full pipeline: .ll -> .o -> executable
export function linkAll(options: LinkOptions): void {
  // Replace .ll extension with .o (Perry doesn't support regex literals)
  let llFile: string = options.llFile;
  let objFile: string = llFile.substring(0, llFile.length - 3) + ".o";
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
