// Pipeline: parse -> lower -> codegen -> clang -> link

import * as fs from "fs";
import * as path from "path";
import { HirModule } from "../hir/ir";
import { compileModule } from "../codegen/compiler";
import { linkAll, getDefaultRuntimePath, compileLLToObject, linkMultipleObjects } from "./linker";
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
  console.log("[anvil] Parsing " + options.inputFile + "...");
  const source = fs.readFileSync(options.inputFile, "utf-8");
  const parser = new Parser(source, path.basename(options.inputFile));
  const ast = parser.parse();

  // Step 1.5: Resolve imported enums
  const sourceDir = path.dirname(path.resolve(options.inputFile));
  const lowerer = new Lowerer();
  lowerer.setSourceDir(sourceDir);
  resolveImportedTypes(ast, sourceDir, lowerer);

  // Step 2: Lower AST -> HIR
  console.log("[anvil] Lowering to HIR...");
  const hirModule = lowerer.lower(ast);

  // Step 3: Codegen + link
  compileFromHIR(hirModule, options);
}

// Resolve imported enums from other modules
function resolveImportedTypes(ast: any, sourceDir: string, lowerer: Lowerer): void {
  for (let i = 0; i < ast.statements.length; i = i + 1) {
    const stmt = ast.statements[i];
    if (stmt.kind !== 16) continue; // AstStmtKind.ImportDecl = 16
    const importDecl = stmt as any;
    const importSource: string = importDecl.source;
    // Resolve relative import path
    if (!importSource.startsWith(".")) continue;
    let filePath = path.resolve(sourceDir, importSource);
    if (!filePath.endsWith(".ts")) {
      filePath = filePath + ".ts";
    }
    if (!fs.existsSync(filePath)) continue;
    // Parse the imported file to extract enum and interface declarations
    try {
      const importedSource = fs.readFileSync(filePath, "utf-8");
      const importedParser = new Parser(importedSource, path.basename(filePath));
      const importedAst = importedParser.parse();
      let ifaceDecls: Array<any> = [];
      for (let j = 0; j < importedAst.statements.length; j = j + 1) {
        const s = importedAst.statements[j];
        let enumDecl: any = null;
        let ifaceDecl: any = null;
        if (s.kind === 15) { // AstStmtKind.EnumDecl = 15
          enumDecl = s;
        }
        if (s.kind === 18) { // AstStmtKind.InterfaceDecl = 18
          ifaceDecl = s;
        }
        if (s.kind === 17) { // AstStmtKind.ExportDecl = 17
          const exportDecl = s as any;
          if (exportDecl.declaration !== null && exportDecl.declaration.kind === 15) {
            enumDecl = exportDecl.declaration;
          }
          if (exportDecl.declaration !== null && exportDecl.declaration.kind === 18) {
            ifaceDecl = exportDecl.declaration;
          }
        }
        if (enumDecl !== null) {
          let nextValue = 0;
          for (let k = 0; k < enumDecl.members.length; k = k + 1) {
            const member = enumDecl.members[k];
            if (member.initializer !== null && member.initializer.kind === 0) { // AstExprKind.Number = 0
              nextValue = member.initializer.value;
            }
            lowerer.registerExternalEnum(enumDecl.name, member.name, nextValue);
            nextValue = nextValue + 1;
          }
        }
        if (ifaceDecl !== null) {
          // Collect interface declaration for two-pass resolution
          let ifaceArr = ifaceDecls;
          ifaceArr.push(ifaceDecl);
          ifaceDecls = ifaceArr;
        }
        // Resolve class declarations
        let classDecl: any = null;
        if (s.kind === 14) { // AstStmtKind.ClassDecl = 14
          classDecl = s;
        }
        if (s.kind === 17) { // ExportDecl
          const exportDecl2 = s as any;
          if (exportDecl2.declaration !== null && exportDecl2.declaration.kind === 14) {
            classDecl = exportDecl2.declaration;
          }
        }
        if (classDecl !== null) {
          const fieldNames: Array<string> = [];
          const fieldTypeNames: Array<string | null> = [];
          const methodNames: Array<string> = [];
          const methodReturnTypes: Array<string | null> = [];
          for (let k = 0; k < classDecl.members.length; k = k + 1) {
            const member = classDecl.members[k];
            if (member.kind === "property" && !member.isStatic) {
              fieldNames.push(member.name);
              // Extract field type name
              let fieldTypeName: string | null = null;
              if (member.typeAnnotation !== null) {
                const ft = member.typeAnnotation;
                if (ft.kind === 0 && ft.name !== "void" && ft.name !== "string" && ft.name !== "number" && ft.name !== "boolean") {
                  fieldTypeName = ft.name;
                }
                if (ft.kind === 3 && ft.members !== undefined) {
                  for (let u = 0; u < ft.members.length; u = u + 1) {
                    const ut = ft.members[u];
                    if (ut.kind === 0 && ut.name !== "null" && ut.name !== "undefined" && ut.name !== "void" && ut.name !== "string" && ut.name !== "number" && ut.name !== "boolean") {
                      fieldTypeName = ut.name;
                    }
                  }
                }
              }
              fieldTypeNames.push(fieldTypeName);
            }
            if (member.kind === "method" && !member.isStatic) {
              methodNames.push(member.name);
              // Extract return type name if it's a simple identifier
              let retTypeName: string | null = null;
              if (member.returnType !== null) {
                const rt = member.returnType;
                if (rt.kind === 0 && rt.name !== "void" && rt.name !== "string" && rt.name !== "number" && rt.name !== "boolean") {
                  retTypeName = rt.name;
                }
                if (rt.kind === 3 && rt.members !== undefined) {
                  for (let u = 0; u < rt.members.length; u = u + 1) {
                    const ut = rt.members[u];
                    if (ut.kind === 0 && ut.name !== "null" && ut.name !== "undefined" && ut.name !== "void" && ut.name !== "string" && ut.name !== "number" && ut.name !== "boolean") {
                      retTypeName = ut.name;
                    }
                  }
                }
              }
              methodReturnTypes.push(retTypeName);
            }
          }
          lowerer.registerExternalClass(classDecl.name, fieldNames, methodNames, methodReturnTypes, fieldTypeNames);
        }
      }
      // Two-pass interface resolution: first register base interfaces, then resolve inheritance
      // Pass 1: register interfaces without extends (base interfaces)
      for (let j2 = 0; j2 < ifaceDecls.length; j2 = j2 + 1) {
        const iface = ifaceDecls[j2];
        if (iface.extends === null || iface.extends === undefined || iface.extends.length === 0) {
          const layout: Map<string, number> = new Map();
          const fieldOrder: Array<string> = [];
          let idx = 0;
          for (let k = 0; k < iface.members.length; k = k + 1) {
            const member = iface.members[k];
            if (member.kind === "property" || member.kind === "method") {
              layout.set(member.name, idx);
              fieldOrder.push(member.name);
              idx = idx + 1;
            }
          }
          lowerer.registerInterfaceLayout(iface.name, layout, fieldOrder);
        }
      }
      // Pass 2: register interfaces with extends (derived interfaces)
      for (let j3 = 0; j3 < ifaceDecls.length; j3 = j3 + 1) {
        const iface = ifaceDecls[j3];
        if (iface.extends !== null && iface.extends !== undefined && iface.extends.length > 0) {
          const layout: Map<string, number> = new Map();
          const fieldOrder: Array<string> = [];
          let idx = 0;
          // First, include parent interface members
          for (let e = 0; e < iface.extends.length; e = e + 1) {
            const parentName: string = iface.extends[e];
            // Find the parent in our collected interfaces
            for (let p = 0; p < ifaceDecls.length; p = p + 1) {
              if (ifaceDecls[p].name === parentName) {
                for (let k = 0; k < ifaceDecls[p].members.length; k = k + 1) {
                  const member = ifaceDecls[p].members[k];
                  if (member.kind === "property" || member.kind === "method") {
                    if (!layout.has(member.name)) {
                      layout.set(member.name, idx);
                      fieldOrder.push(member.name);
                      idx = idx + 1;
                    }
                  }
                }
              }
            }
          }
          // Then add this interface's own members (skip already-added ones like 'kind')
          for (let k = 0; k < iface.members.length; k = k + 1) {
            const member = iface.members[k];
            if (member.kind === "property" || member.kind === "method") {
              if (!layout.has(member.name)) {
                layout.set(member.name, idx);
                fieldOrder.push(member.name);
                idx = idx + 1;
              }
            }
          }
          lowerer.registerInterfaceLayout(iface.name, layout, fieldOrder);
        }
      }
    } catch (e) {
      // If parsing fails, skip silently
    }
  }
}

// Resolve imported variables (non-function exports) from other modules
// Registers them as imported globals so they're loaded from the source module's globals
function resolveImportedGlobals(ast: any, sourceDir: string, baseDir: string, lowerer: Lowerer): void {
  for (let i = 0; i < ast.statements.length; i = i + 1) {
    const stmt = ast.statements[i];
    if (stmt.kind !== 16) continue; // AstStmtKind.ImportDecl = 16
    const importDecl = stmt as any;
    const importSource: string = importDecl.source;
    if (!importSource.startsWith(".")) continue;
    let filePath = path.resolve(sourceDir, importSource);
    if (!filePath.endsWith(".ts")) {
      filePath = filePath + ".ts";
    }
    if (!fs.existsSync(filePath)) continue;

    // Compute the source module name
    const sourceModName = fileToModuleName(filePath, baseDir);

    try {
      const importedSource = fs.readFileSync(filePath, "utf-8");
      const importedParser = new Parser(importedSource, path.basename(filePath));
      const importedAst = importedParser.parse();

      // Collect exported variable names (const/let/var declarations, not functions/classes/enums/interfaces)
      const exportedVars: Set<string> = new Set();
      for (let j = 0; j < importedAst.statements.length; j = j + 1) {
        const s = importedAst.statements[j];
        // Top-level var declarations
        if (s.kind === 1) { // AstStmtKind.VarDecl = 1
          exportedVars.add((s as any).name);
        }
        // Exported var declarations
        if (s.kind === 17) { // AstStmtKind.ExportDecl = 17
          const exportDecl = s as any;
          if (exportDecl.declaration !== null && exportDecl.declaration.kind === 1) {
            exportedVars.add(exportDecl.declaration.name);
          }
        }
      }

      // Check which imported specifiers refer to variables
      for (let j = 0; j < importDecl.specifiers.length; j = j + 1) {
        const spec = importDecl.specifiers[j];
        const localName: string = spec.local;
        if (exportedVars.has(localName)) {
          const fullGlobalName = "__global_" + sourceModName + "__" + localName;
          lowerer.registerImportedGlobal(localName, fullGlobalName);
        }
      }
    } catch (e) {
      // If parsing fails, skip
    }
  }
}

// Compile from a pre-built HIR module (used in Phase 0-1 before parser exists)
export function compileFromHIR(hirModule: HirModule, options: CompileOptions): void {
  // Step 1: Generate LLVM IR
  console.log("[anvil] Generating LLVM IR...");
  const llvmIR = compileModule(hirModule, null, null, true);

  // Step 2: Write .ll file
  const llFile = options.outputFile + ".ll";
  fs.writeFileSync(llFile, llvmIR);
  console.log("[anvil] Wrote " + llFile);

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
    const objFile = llFile.substring(0, llFile.length - 3) + ".o";
    if (fs.existsSync(objFile)) {
      fs.unlinkSync(objFile);
    }
  }

  console.log("[anvil] Built " + options.outputFile);
}

// Convert a file path to a module name (e.g., "src/hir/types.ts" -> "hir_types")
function fileToModuleName(filePath: string, baseDir: string): string {
  let rel = path.relative(baseDir, filePath);
  // Remove .ts extension
  if (rel.endsWith(".ts")) {
    rel = rel.substring(0, rel.length - 3);
  }
  // Replace path separators with _
  let result = "";
  for (let i = 0; i < rel.length; i = i + 1) {
    const ch = rel.charAt(i);
    if (ch === "/" || ch === "\\") {
      result = result + "_";
    } else {
      result = result + ch;
    }
  }
  return result;
}

// Get imports from a single file
function getFileImports(filePath: string): Array<string> {
  console.log("[getFileImports] checking " + filePath);
  const imports: Array<string> = [];
  if (!fs.existsSync(filePath)) {
    console.log("[getFileImports] file not found");
    return imports;
  }
  console.log("[getFileImports] reading file...");
  const source = fs.readFileSync(filePath, "utf-8");
  console.log("[getFileImports] source length=" + source.length);
  console.log("[getFileImports] creating parser...");
  const p = new Parser(source, path.basename(filePath));
  console.log("[getFileImports] parsing...");
  let ast: any = null;
  try {
    ast = p.parse();
  } catch (e) {
    console.log("[getFileImports] parse error");
    return imports;
  }
  console.log("[getFileImports] parse done");

  const dir = path.dirname(filePath);
  for (let i = 0; i < ast.statements.length; i = i + 1) {
    const stmt = ast.statements[i];
    let importSource: string | null = null;

    if (stmt.kind === 16) { // AstStmtKind.ImportDecl
      importSource = (stmt as any).source;
    }
    if (stmt.kind === 17) { // AstStmtKind.ExportDecl
      const exportDecl = stmt as any;
      if (exportDecl.declaration === null && exportDecl.source !== null) {
        importSource = exportDecl.source;
      }
    }

    if (importSource !== null && importSource.startsWith(".")) {
      let depPath = path.resolve(dir, importSource);
      if (!depPath.endsWith(".ts")) {
        depPath = depPath + ".ts";
      }
      imports.push(depPath);
    }
  }
  return imports;
}

// Discover all modules by following imports from the entry file (iterative DFS)
function discoverModules(entryFile: string): Array<string> {
  const resolved = path.resolve(entryFile);
  // State: 0 = unvisited, 1 = in progress, 2 = done
  const state: Map<string, number> = new Map();
  const order: Array<string> = [];

  // Each stack entry: [filePath, depsExpanded]
  const stack: Array<[string, boolean]> = [];
  stack.push([resolved, false]);

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const filePath = top[0];
    const depsExpanded = top[1];

    const fileState = state.get(filePath);
    if (fileState === 2) {
      // Already fully processed
      stack.pop();
      continue;
    }

    if (depsExpanded) {
      // All deps have been processed, now add this file
      stack.pop();
      state.set(filePath, 2);
      order.push(filePath);
      continue;
    }

    // Mark deps as expanded and push dependencies
    top[1] = true;
    state.set(filePath, 1); // in progress

    const deps = getFileImports(filePath);
    for (let i = deps.length - 1; i >= 0; i = i - 1) {
      const depState = state.get(deps[i]);
      if (depState === undefined) {
        stack.push([deps[i], false]);
      }
    }
  }

  return order;
}

// Multi-file compilation: discover all modules, compile each, link together
export function compileMultiFile(options: CompileOptions): void {
  const entryFile = path.resolve(options.inputFile);
  const baseDir = path.dirname(entryFile);

  // Step 1: Discover all modules in dependency order
  console.log("[anvil] Discovering modules...");
  const modules = discoverModules(entryFile);
  console.log("[anvil] Found " + modules.length + " module(s)");

  if (modules.length <= 1) {
    // Single file, use the simple path
    compile(options);
    return;
  }

  // Step 2: Compute module names and dependency init order
  const moduleNames: Array<string> = [];
  for (let i = 0; i < modules.length; i = i + 1) {
    moduleNames.push(fileToModuleName(modules[i], baseDir));
  }

  // Step 2.5: Pre-pass to collect cross-module variable imports
  // Maps source module path -> Set of variable names that are imported by other modules
  const exportedVarsByModule: Map<string, Array<string>> = new Map();
  for (let i = 0; i < modules.length; i = i + 1) {
    const filePath = modules[i];
    const source = fs.readFileSync(filePath, "utf-8");
    const p = new Parser(source, path.basename(filePath));
    let ast: any = null;
    try { ast = p.parse(); } catch (e) { continue; }
    const sourceDir = path.dirname(filePath);
    for (let si = 0; si < ast.statements.length; si = si + 1) {
      const stmt = ast.statements[si];
      if (stmt.kind !== 16) continue; // ImportDecl
      const importDecl = stmt as any;
      const importSource: string = importDecl.source;
      if (!importSource.startsWith(".")) continue;
      let depPath = path.resolve(sourceDir, importSource);
      if (!depPath.endsWith(".ts")) { depPath = depPath + ".ts"; }
      if (!fs.existsSync(depPath)) continue;
      // Parse the imported file to find exported variables
      try {
        const depSource = fs.readFileSync(depPath, "utf-8");
        const depParser = new Parser(depSource, path.basename(depPath));
        const depAst = depParser.parse();
        const exportedVars: Set<string> = new Set();
        for (let j = 0; j < depAst.statements.length; j = j + 1) {
          const s = depAst.statements[j];
          if (s.kind === 1) { exportedVars.add((s as any).name); }
          if (s.kind === 17) {
            const ed = s as any;
            if (ed.declaration !== null && ed.declaration.kind === 1) {
              exportedVars.add(ed.declaration.name);
            }
          }
        }
        // Check which import specifiers match exported variables
        for (let j = 0; j < importDecl.specifiers.length; j = j + 1) {
          const spec = importDecl.specifiers[j];
          const localName: string = spec.local;
          if (exportedVars.has(localName)) {
            let arr = exportedVarsByModule.get(depPath);
            if (arr === undefined) {
              arr = [];
              exportedVarsByModule.set(depPath, arr);
            }
            // Avoid duplicates
            let found = false;
            for (let k = 0; k < arr.length; k = k + 1) {
              if (arr[k] === localName) { found = true; break; }
            }
            if (!found) { arr.push(localName); }
          }
        }
      } catch (e) { /* skip */ }
    }
  }

  // Step 3: Compile each module
  const objFiles: Array<string> = [];
  const depInits: Array<string> = [];

  for (let i = 0; i < modules.length; i = i + 1) {
    const filePath = modules[i];
    const modName = moduleNames[i];
    const isEntry = (filePath === entryFile);

    console.log("[anvil] Compiling " + modName + (isEntry ? " (entry)" : "") + "...");

    // Parse
    const source = fs.readFileSync(filePath, "utf-8");
    const parser = new Parser(source, path.basename(filePath));
    const ast = parser.parse();

    // Resolve imported enums and globals
    const sourceDir = path.dirname(filePath);
    const lowerer = new Lowerer();
    lowerer.setSourceDir(sourceDir);
    resolveImportedTypes(ast, sourceDir, lowerer);
    resolveImportedGlobals(ast, sourceDir, baseDir, lowerer);

    // Force module globals for variables that other modules import from this one
    const forcedGlobals = exportedVarsByModule.get(filePath);
    if (forcedGlobals !== undefined) {
      for (let fg = 0; fg < forcedGlobals.length; fg = fg + 1) {
        lowerer.forceModuleGlobal(forcedGlobals[fg]);
      }
    }

    // Lower to HIR
    const hirModule = lowerer.lower(ast);

    // Generate LLVM IR
    let llvmIR: string;
    if (isEntry) {
      // Entry module: generate main() with dependency init calls
      llvmIR = compileModule(hirModule, modName, depInits, true);
    } else {
      // Non-entry module: generate _init_<modName>()
      llvmIR = compileModule(hirModule, modName, null, false);
      depInits.push("_init_" + modName);
    }

    // Write .ll and compile to .o
    const llFile = options.outputFile + "_" + modName + ".ll";
    const objFile = options.outputFile + "_" + modName + ".o";
    fs.writeFileSync(llFile, llvmIR);
    compileLLToObject(llFile, objFile);
    objFiles.push(objFile);

    // Clean up .ll unless requested to keep
    if (!options.emitLL) {
      fs.unlinkSync(llFile);
    }
  }

  // Step 4: Compile and include stubs for missing runtime functions
  const stubsC = path.resolve(path.dirname(entryFile), "stubs.c");
  if (fs.existsSync(stubsC)) {
    const stubsO = options.outputFile + "_stubs.o";
    compileLLToObject(stubsC, stubsO);
    objFiles.push(stubsO);
  }

  // Step 5: Link all object files together
  linkMultipleObjects(objFiles, options.runtimePath, options.outputFile);

  // Clean up .o files
  if (!options.emitLL) {
    for (let i = 0; i < objFiles.length; i = i + 1) {
      if (fs.existsSync(objFiles[i])) {
        fs.unlinkSync(objFiles[i]);
      }
    }
  }

  console.log("[anvil] Built " + options.outputFile);
}
