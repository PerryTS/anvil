// AST -> HIR lowering
// Converts parsed AST nodes into HIR (High-level IR) for codegen

import {
  SourceFile, AstStmt, AstStmtKind, AstExpr, AstExprKind,
  TypeNode, TypeNodeKind, ParamDecl,
  ExprStmtAst, VarDeclAst, FunctionDeclAst, ReturnStmtAst,
  IfStmtAst, WhileStmtAst, ForStmtAst, DoWhileStmtAst,
  BreakStmtAst, ContinueStmtAst, BlockStmtAst,
  SwitchStmtAst, SwitchCase, ThrowStmtAst, TryCatchStmtAst,
  NumberLitExpr, StringLitExpr, BoolLitExpr,
  IdentifierExpr, BinaryExprAst, UnaryExprAst, UnaryPostfixExprAst,
  CallExprAst, MemberExprAst, IndexExprAst,
  AssignExprAst, CompoundAssignExprAst, ConditionalExprAst,
  ArrowExprAst, ArrayExprAst, ObjectExprAst, ObjectProperty,
  NewExprAst, TemplateExprAst, TypeAsExprAst, TypeofExprAst, SpreadExprAst, AwaitExprAst,
  ParenExprAst, EnumDeclAst, EnumMemberAst, ClassDeclAst, ClassMemberAst,
  ImportDeclAst, ImportSpecifier, ExportDeclAst, InterfaceDeclAst, InterfaceMemberAst,
  NamedTypeNode, ArrayTypeNode, GenericTypeNode, UnionTypeNode, ObjectLiteralTypeNode,
} from "../parser/ast";
import {
  HirModule, HirFunction, Stmt, StmtKind, Expr, ExprKind,
  ExprStmt as HirExprStmt, LetStmt, ReturnStmt as HirReturnStmt,
  IfStmt as HirIfStmt, WhileStmt as HirWhileStmt, ForStmt as HirForStmt,
  BreakStmt as HirBreakStmt, ContinueStmt as HirContinueStmt,
  BlockStmt as HirBlockStmt, TryCatchStmt,
  NumberExpr, StringExpr, BoolExpr, UndefinedExpr, NullExpr,
  BinaryExpr, BinaryOp, UnaryExpr, UnaryOp,
  CompareExpr, CompareOp, LogicalExpr, LogicalOp,
  LocalGetExpr, LocalSetExpr, CallExpr, FuncRefExpr,
  IfExpr, ArrayExpr, ArrayGetExpr, ArraySetExpr,
  ObjectLitExpr, FieldGetExpr, FieldSetExpr,
  MethodCallExpr, ClosureExpr, CaptureGetExpr, CaptureSetExpr,
  GlobalGetExpr, GlobalSetExpr, AwaitExpr,
  TypeofExpr as HirTypeofExpr,
} from "../hir/ir";
import {
  Type, TypeKind, ArrayType, ObjectType, UnionType,
  makeFunctionType, makeArrayType, makeUnionType, makeObjectType,
} from "../hir/types";
const NUMBER_TYPE: Type = { kind: TypeKind.Number };
const STRING_TYPE: Type = { kind: TypeKind.String };
const BOOLEAN_TYPE: Type = { kind: TypeKind.Boolean };
const VOID_TYPE: Type = { kind: TypeKind.Void };
const ANY_TYPE: Type = { kind: TypeKind.Any };
const UNDEFINED_TYPE: Type = { kind: TypeKind.Undefined };
const NULL_TYPE: Type = { kind: TypeKind.Null };

interface Scope {
  locals: Map<string, number>;     // name -> localId
  localTypes: Map<string, Type>;   // name -> type
  functions: Map<string, number>;  // name -> funcId
  funcReturnTypes: Map<string, Type>;  // name -> return type
  // Track object field layouts: variable name -> field name -> field index
  fieldLayouts: Map<string, Map<string, number>>;
  // Track enum values: "EnumName.Member" -> number value
  enumValues: Map<string, number>;
  // Track string enum values: "EnumName.Member" -> string value
  stringEnumValues: Map<string, string>;
  // Track class info: className -> { fields: Map<name, index>, methods: Map<name, funcName>, constructorFunc: string }
  classInfos: Map<string, ClassInfo>;
  // Track variable -> class name mapping for method dispatch on class instances
  varClassMap: Map<string, string>;
  // Closure support
  isClosureBoundary: boolean;
  closurePtrLocalId: number;  // localId of the $closure_ptr param (-1 if not in closure)
  closureCaptures: Array<[string, number]> | null;  // [name, outerLocalId] pairs, populated during lowering
  parent: Scope | null;
}

interface ClassInfo {
  fieldNames: Array<string>;
  fieldMap: Map<string, number>;
  fieldClassTypes: Map<string, string>;  // field name -> class name (for class-typed fields)
  methods: Map<string, string>;  // method name -> HIR function name
  methodNames: Array<string>;  // method names in order (for iteration)
  getters: Map<string, string>;  // property name -> getter HIR function name
  setters: Map<string, string>;  // property name -> setter HIR function name
  constructorFunc: string | null;
  superClass: string | null;
}

export class Lowerer {
  private nextLocalId: number;
  private nextFuncId: number;
  private functions: Array<HirFunction>;
  private scope: Scope;
  private inFunction: boolean;
  private moduleLocals: Map<string, number>;   // module-level variable names -> localIds
  private moduleGlobalsList: Array<string>;  // names of module vars referenced from functions
  private externalFuncs: Array<[number, string]>;  // [funcId, name] for imported functions
  private importedGlobals: Map<string, string>;  // localName -> fullGlobalName (for cross-module variables)
  private importedGlobalsList: Array<[string, string]>;  // parallel list for HIR output
  private sourceDir: string;  // directory of the source file being compiled
  // Interface/type field layouts: interfaceName -> Map<fieldName, index>
  private interfaceLayouts: Map<string, Map<string, number>>;
  // Interface field names in order (for iterating when copying parent fields)
  private interfaceFieldOrder: Map<string, Array<string>>;
  // Global field name -> index registry (across all interfaces, for fallback lookup)
  private globalFieldIndices: Map<string, number>;

  // Pending statements from expression lowering (e.g., postfix side-effects)
  private pendingStmts: Array<Stmt>;
  // Well-known runtime function names that map to direct FFI calls
  private runtimeFuncs: Map<string, string>;
  // Static class members: "ClassName.propName" -> "ClassName$static$propName" (global name)
  private staticMembers: Map<string, string>;
  // Static member types: "ClassName.propName" -> Type
  private staticMemberTypes: Map<string, Type>;
  // Static property initialization statements (emitted into init body)
  private staticInits: Array<Stmt>;
  // Function return field layouts: funcName -> Map<fieldName, index>
  private funcReturnLayouts: Map<string, Map<string, number>>;
  // Functions with rest params: funcName -> rest param index (0-based)
  private restParamFuncs: Map<string, number>;
  // Variables that need boxing (heap-allocated cells) for correct mutable closure capture
  private boxedVars: Map<string, boolean>;
  // Inside a closure, tracks which capture indices correspond to boxes
  private boxedCaptureNames: Map<string, boolean>;
  // Tracks which object literal fields are methods: "varName.fieldName" -> true
  private objMethodFields: Map<string, boolean>;
  // Temporary: field layout to set on 'this' in the next arrow being lowered (for object literal methods)
  private pendingThisLayout: Map<string, number> | null;
  // Module-level boxed vars: 'var' declarations that need boxing for closure capture at top level
  private moduleBoxedVars: Map<string, boolean>;

  constructor() {
    this.nextLocalId = 0;
    this.nextFuncId = 1;  // 0 is reserved for runtime
    this.functions = [];
    this.scope = { locals: new Map(), localTypes: new Map(), functions: new Map(), funcReturnTypes: new Map(), fieldLayouts: new Map(), enumValues: new Map(), stringEnumValues: new Map(), classInfos: new Map(), varClassMap: new Map(), isClosureBoundary: false, closurePtrLocalId: -1, closureCaptures: null, parent: null };
    this.interfaceLayouts = new Map();
    this.interfaceFieldOrder = new Map();
    this.globalFieldIndices = new Map();
    this.funcReturnLayouts = new Map();
    this.pendingStmts = [];
    this.inFunction = false;
    this.moduleLocals = new Map();
    this.moduleGlobalsList = [];
    this.externalFuncs = [];
    this.importedGlobals = new Map();
    this.importedGlobalsList = [];
    this.sourceDir = ".";

    // Map known global functions/methods to runtime FFI names
    this.runtimeFuncs = new Map();
    this.staticMembers = new Map();
    this.staticMemberTypes = new Map();
    this.staticInits = [];
    this.restParamFuncs = new Map();
    this.boxedVars = new Map();
    this.boxedCaptureNames = new Map();
    this.objMethodFields = new Map();
    this.pendingThisLayout = null;
    this.moduleBoxedVars = new Map();
  }

  setSourceDir(dir: string): void {
    this.sourceDir = dir;
  }

  // Register an imported variable from another module
  // localName: the name used in this module (e.g., "TAG_TRUE_I64")
  // fullGlobalName: the full global name including module prefix (e.g., "__global_codegen_nanbox__TAG_TRUE_I64")
  registerImportedGlobal(localName: string, fullGlobalName: string): void {
    this.importedGlobals.set(localName, fullGlobalName);
    this.importedGlobalsList.push([localName, fullGlobalName]);
  }

  // Force a module-level variable to be treated as a global (for cross-module exports)
  forceModuleGlobal(name: string): void {
    this.addModuleGlobal(name);
  }

  // Register enum values from imported modules
  registerExternalEnum(enumName: string, memberName: string, value: number): void {
    const key = enumName + "." + memberName;
    this.scope.enumValues.set(key, value);
  }

  // Register interface field layouts from imported modules
  registerInterfaceLayout(name: string, fields: Map<string, number>, fieldNames: Array<string>): void {
    this.interfaceLayouts.set(name, fields);
    this.interfaceFieldOrder.set(name, fieldNames);
  }

  // Register individual field name -> index in the global fallback registry
  registerGlobalFieldIndex(fieldName: string, index: number): void {
    if (!this.globalFieldIndices.has(fieldName)) {
      this.globalFieldIndices.set(fieldName, index);
    }
  }

  // Register an external class (from imported module)
  registerExternalClass(className: string, fieldNames: Array<string>, methodNames: Array<string>, methodReturnTypes: Array<string | null> | null, fieldTypeNames: Array<string | null> | null): void {
    const ctorName = className + "$new";
    const ctorId = this.nextFuncId;
    this.nextFuncId = this.nextFuncId + 1;
    this.scope.functions.set(ctorName, ctorId);
    this.scope.funcReturnTypes.set(ctorName, ANY_TYPE);

    const fieldMap: Map<string, number> = new Map();
    for (let i = 0; i < fieldNames.length; i = i + 1) {
      fieldMap.set(fieldNames[i], i);
    }

    const methods: Map<string, string> = new Map();
    for (let i = 0; i < methodNames.length; i = i + 1) {
      const methodFuncName = className + "$" + methodNames[i];
      const methodId = this.nextFuncId;
      this.nextFuncId = this.nextFuncId + 1;
      this.scope.functions.set(methodFuncName, methodId);
      // Set method return type: use interface-typed Object if return type name is known
      let retType: Type = ANY_TYPE;
      if (methodReturnTypes !== null && i < methodReturnTypes.length && methodReturnTypes[i] !== null) {
        const retObjType: ObjectType = makeObjectType(new Map());
        retObjType.interfaceName = methodReturnTypes[i] as string;
        retType = retObjType;
      }
      this.scope.funcReturnTypes.set(methodFuncName, retType);
      methods.set(methodNames[i], methodFuncName);
    }

    // Build field class types from provided type names
    const fieldClassTypes: Map<string, string> = new Map();
    if (fieldTypeNames !== null) {
      for (let i = 0; i < fieldNames.length; i = i + 1) {
        if (i < fieldTypeNames.length && fieldTypeNames[i] !== null) {
          const ftn = fieldTypeNames[i];
          if (ftn !== null) {
            fieldClassTypes.set(fieldNames[i], ftn);
          }
        }
      }
    }

    const classInfo: ClassInfo = {
      fieldNames: fieldNames,
      fieldMap: fieldMap,
      fieldClassTypes: fieldClassTypes,
      methods: methods,
      methodNames: methodNames,
      getters: new Map(),
      setters: new Map(),
      constructorFunc: ctorName,
      superClass: null,
    };
    this.scope.classInfos.set(className, classInfo);
    // Also register as interface layout for field access
    this.interfaceLayouts.set(className, fieldMap);
    this.interfaceFieldOrder.set(className, fieldNames);
  }

  lower(sourceFile: SourceFile): HirModule {
    const stmts: Array<Stmt> = [];

    // First pass: register imports, enums, function declarations, and class declarations
    for (let i = 0; i < sourceFile.statements.length; i = i + 1) {
      const stmt: AstStmt = sourceFile.statements[i] as AstStmt;
      // Register imports early so they're available during function lowering
      if (stmt.kind === AstStmtKind.ImportDecl) {
        const importDecl: ImportDeclAst = stmt as ImportDeclAst;
        const isPerryUi = importDecl.source === "perry/ui";
        for (let j = 0; j < importDecl.specifiers.length; j = j + 1) {
          const spec: ImportSpecifier = importDecl.specifiers[j] as ImportSpecifier;
          const localName: string = spec.local;
          // Skip imported globals - they're handled via importedGlobals, not as functions
          if (this.importedGlobals.has(localName)) {
            continue;
          }
          const funcId = this.nextFuncId;
          this.nextFuncId = this.nextFuncId + 1;
          this.scope.functions.set(localName, funcId);
          // Map perry/ui imports to their C function names
          const externalName = isPerryUi ? mapPerryUiName(localName) : localName;
          this.externalFuncs.push([funcId, externalName]);
        }
        if (importDecl.namespaceImport !== null) {
          const nsName: string = importDecl.namespaceImport;
          const funcId = this.nextFuncId;
          this.nextFuncId = this.nextFuncId + 1;
          this.scope.functions.set(nsName, funcId);
          this.externalFuncs.push([funcId, nsName]);
        }
      }
      // Register enum values early so they're available during lowering
      if (stmt.kind === AstStmtKind.EnumDecl) {
        this.lowerEnum(stmt as EnumDeclAst);
      }
      // Pre-register class constructor and method func IDs
      if (stmt.kind === AstStmtKind.ClassDecl) {
        this.preRegisterClass(stmt as ClassDeclAst);
      }
      if (stmt.kind === AstStmtKind.FunctionDecl) {
        const funcDecl = stmt as FunctionDeclAst;
        // Skip overload signatures (empty body) — only register the implementation
        if (funcDecl.body.length > 0) {
          const funcId = this.nextFuncId;
          this.nextFuncId = this.nextFuncId + 1;
          this.scope.functions.set(funcDecl.name, funcId);
          const retType = funcDecl.returnType !== null ? this.resolveType(funcDecl.returnType) : ANY_TYPE;
          this.scope.funcReturnTypes.set(funcDecl.name, retType);
        }
      }
      // Register interface field layouts
      if (stmt.kind === AstStmtKind.InterfaceDecl) {
        this.registerInterfaceFromDecl(stmt as InterfaceDeclAst);
      }
      if (stmt.kind === AstStmtKind.ExportDecl) {
        const exportDecl: ExportDeclAst = stmt as ExportDeclAst;
        if (exportDecl.declaration !== null && exportDecl.declaration.kind === AstStmtKind.FunctionDecl) {
          const funcDecl: FunctionDeclAst = exportDecl.declaration as FunctionDeclAst;
          // Skip overload signatures (empty body)
          if (funcDecl.body.length > 0) {
            const funcId = this.nextFuncId;
            this.nextFuncId = this.nextFuncId + 1;
            this.scope.functions.set(funcDecl.name, funcId);
            const retType = funcDecl.returnType !== null ? this.resolveType(funcDecl.returnType) : ANY_TYPE;
            this.scope.funcReturnTypes.set(funcDecl.name, retType);
          }
        }
        if (exportDecl.declaration !== null && exportDecl.declaration.kind === AstStmtKind.ClassDecl) {
          this.preRegisterClass(exportDecl.declaration as ClassDeclAst);
        }
        if (exportDecl.declaration !== null && exportDecl.declaration.kind === AstStmtKind.EnumDecl) {
          this.lowerEnum(exportDecl.declaration as EnumDeclAst);
        }
        if (exportDecl.declaration !== null && exportDecl.declaration.kind === AstStmtKind.InterfaceDecl) {
          this.registerInterfaceFromDecl(exportDecl.declaration as InterfaceDeclAst);
        }
      }
    }

    // Detect 'var' declarations at module level that need boxing for closure capture.
    // Only 'var' needs boxing — let/const module-level vars are LLVM globals which are
    // already shared mutable cells accessed via GlobalGet/GlobalSet.
    // But 'var' in for-loop inits creates a local that closures capture by value,
    // so we need boxing to share the mutable cell correctly (e.g., var loop closures).
    const moduleDeclKinds: Map<string, string> = new Map();
    this.boxCollectDecls(sourceFile.statements, moduleDeclKinds);
    const moduleBoxedAll: Map<string, boolean> = new Map();
    this.boxScanStmts(sourceFile.statements, moduleDeclKinds, moduleBoxedAll, false);
    // Filter: only box 'var' declarations (let/const at module level don't need boxing)
    this.boxedVars = new Map();
    this.moduleBoxedVars = new Map();
    const boxedKeys = Array.from(moduleBoxedAll.keys());
    for (let bk = 0; bk < boxedKeys.length; bk = bk + 1) {
      if (moduleDeclKinds.get(boxedKeys[bk]) === "var") {
        this.boxedVars.set(boxedKeys[bk], true);
        this.moduleBoxedVars.set(boxedKeys[bk], true);
      }
    }

    // Second pass: lower all statements
    for (let i = 0; i < sourceFile.statements.length; i = i + 1) {
      const stmt: AstStmt = sourceFile.statements[i] as AstStmt;
      // Skip type-only declarations (interfaces already registered in first pass)
      if (stmt.kind === AstStmtKind.InterfaceDecl || stmt.kind === AstStmtKind.TypeAliasDecl) {
        continue;
      }
      if (stmt.kind === AstStmtKind.ImportDecl) {
        // Already handled in first pass
        continue;
      }
      if (stmt.kind === AstStmtKind.ExportDecl) {
        const exportDecl: ExportDeclAst = stmt as ExportDeclAst;
        if (exportDecl.declaration !== null) {
          this.pushLoweredStmt(stmts, exportDecl.declaration);
        }
        continue;
      }
      this.pushLoweredStmt(stmts, stmt);
    }

    const globalNames: Array<string> = this.moduleGlobalsList;

    return {
      name: sourceFile.fileName,
      functions: this.functions,
      init: stmts,
      globals: globalNames,
      externalFuncs: this.externalFuncs,
      importedGlobals: this.importedGlobalsList,
    };
  }

  // --- Statements ---

  private pushLoweredStmt(stmts: Array<Stmt>, stmt: AstStmt): void {
    const lowered = this.lowerStmt(stmt);
    // Drain pending statements first (from postfix expressions etc.)
    for (let pi = 0; pi < this.pendingStmts.length; pi = pi + 1) {
      stmts.push(this.pendingStmts[pi]);
    }
    this.pendingStmts = [];
    if (lowered !== null) {
      stmts.push(lowered);
    }
    // Drain static init statements only at module level (not inside function bodies)
    if (!this.inFunction) {
      for (let si = 0; si < this.staticInits.length; si = si + 1) {
        stmts.push(this.staticInits[si]);
      }
      this.staticInits = [];
    }
  }

  private lowerStmt(stmt: AstStmt): Stmt | null {
    if (stmt.kind === AstStmtKind.VarDecl) {
      return this.lowerVarDecl(stmt as VarDeclAst);
    }
    if (stmt.kind === AstStmtKind.FunctionDecl) {
      // Skip overload signatures (empty body)
      if ((stmt as FunctionDeclAst).body.length === 0) return null;
      this.lowerFunctionDecl(stmt as FunctionDeclAst);
      return null; // functions are hoisted into the functions array
    }
    if (stmt.kind === AstStmtKind.Expr) {
      const exprStmt = stmt as ExprStmtAst;
      return { kind: StmtKind.Expr, expr: this.lowerExpr(exprStmt.expr) } as HirExprStmt;
    }
    if (stmt.kind === AstStmtKind.Return) {
      const ret = stmt as ReturnStmtAst;
      return {
        kind: StmtKind.Return,
        value: ret.value !== null ? this.lowerExpr(ret.value) : null,
      } as HirReturnStmt;
    }
    if (stmt.kind === AstStmtKind.If) {
      return this.lowerIf(stmt as IfStmtAst);
    }
    if (stmt.kind === AstStmtKind.While) {
      const w = stmt as WhileStmtAst;
      return {
        kind: StmtKind.While,
        condition: this.lowerExpr(w.condition),
        body: this.lowerBody(w.body),
      } as HirWhileStmt;
    }
    if (stmt.kind === AstStmtKind.For) {
      return this.lowerFor(stmt as ForStmtAst);
    }
    if (stmt.kind === AstStmtKind.DoWhile) {
      const dw = stmt as DoWhileStmtAst;
      // Lower do..while as: { body; while(cond) { body; } }
      // Simpler: emit the body, then a while loop
      const body = this.lowerBody(dw.body);
      const cond = this.lowerExpr(dw.condition);
      const allStmts: Array<Stmt> = [];
      for (let i = 0; i < body.length; i = i + 1) {
        allStmts.push(body[i]);
      }
      allStmts.push({ kind: StmtKind.While, condition: cond, body: body } as HirWhileStmt);
      return { kind: StmtKind.Block, stmts: allStmts } as HirBlockStmt;
    }
    if (stmt.kind === AstStmtKind.Break) {
      return { kind: StmtKind.Break } as HirBreakStmt;
    }
    if (stmt.kind === AstStmtKind.Continue) {
      return { kind: StmtKind.Continue } as HirContinueStmt;
    }
    if (stmt.kind === AstStmtKind.Block) {
      const block = stmt as BlockStmtAst;
      const stmts: Array<Stmt> = [];
      for (let i = 0; i < block.body.length; i = i + 1) {
        this.pushLoweredStmt(stmts, block.body[i]);
      }
      return { kind: StmtKind.Block, stmts: stmts } as HirBlockStmt;
    }
    if (stmt.kind === AstStmtKind.Switch) {
      return this.lowerSwitch(stmt as SwitchStmtAst);
    }
    if (stmt.kind === AstStmtKind.Throw) {
      const t = stmt as ThrowStmtAst;
      const throwCall: CallExpr = {
        kind: ExprKind.Call,
        ty: VOID_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_throw" } as FuncRefExpr,
        args: [this.lowerExpr(t.argument)],
      };
      return { kind: StmtKind.Expr, expr: throwCall } as HirExprStmt;
    }
    if (stmt.kind === AstStmtKind.TryCatch) {
      const tc = stmt as TryCatchStmtAst;
      const tryStmts: Array<Stmt> = [];
      for (let i = 0; i < tc.tryBody.length; i = i + 1) {
        this.pushLoweredStmt(tryStmts, tc.tryBody[i]);
      }
      let catchParamId = -1;
      let catchParamName = "";
      const catchStmts: Array<Stmt> = [];
      if (tc.catchParam !== null) {
        catchParamName = tc.catchParam;
        catchParamId = this.allocLocal(catchParamName);
        this.scope.localTypes.set(catchParamName, ANY_TYPE);
      }
      if (tc.catchBody !== null) {
        for (let i = 0; i < tc.catchBody.length; i = i + 1) {
          this.pushLoweredStmt(catchStmts, tc.catchBody[i]);
        }
      }
      const finallyStmts: Array<Stmt> = [];
      if (tc.finallyBody !== null) {
        for (let i = 0; i < tc.finallyBody.length; i = i + 1) {
          this.pushLoweredStmt(finallyStmts, tc.finallyBody[i]);
        }
      }
      return {
        kind: StmtKind.TryCatch,
        tryBody: tryStmts,
        catchParam: catchParamId,
        catchParamName: catchParamName,
        catchBody: catchStmts,
        finallyBody: finallyStmts,
      } as TryCatchStmt;
    }
    if (stmt.kind === AstStmtKind.Empty) {
      return null;
    }
    if (stmt.kind === AstStmtKind.EnumDecl) {
      return this.lowerEnum(stmt as EnumDeclAst);
    }
    if (stmt.kind === AstStmtKind.ClassDecl) {
      this.lowerClassDecl(stmt as ClassDeclAst);
      return null;
    }
    if (stmt.kind === AstStmtKind.InterfaceDecl) {
      this.registerInterfaceFromDecl(stmt as InterfaceDeclAst);
      return null;
    }
    if (stmt.kind === AstStmtKind.TypeAliasDecl) {
      return null;
    }

    throw new Error("Cannot lower statement kind: " + stmt.kind + " at line " + stmt.line);
  }

  private lowerVarDecl(decl: VarDeclAst): LetStmt {
    let ty = decl.typeAnnotation !== null ? this.resolveType(decl.typeAnnotation) : ANY_TYPE;
    // Infer type from initializer when no annotation
    if (ty.kind === TypeKind.Any && decl.init !== null) {
      if (decl.init.kind === AstExprKind.String) {
        ty = STRING_TYPE;
      } else if (decl.init.kind === AstExprKind.Number) {
        ty = NUMBER_TYPE;
      } else if (decl.init.kind === AstExprKind.Bool) {
        ty = BOOLEAN_TYPE;
      } else if (decl.init.kind === AstExprKind.Array) {
        ty = makeArrayType(ANY_TYPE);
      } else if (decl.init.kind === AstExprKind.TypeAs) {
        // Infer type from 'expr as SomeType' cast
        const typeAs = decl.init as TypeAsExprAst;
        if (typeAs.typeNode !== null) {
          ty = this.resolveType(typeAs.typeNode);
        }
      } else if (decl.init.kind === AstExprKind.New) {
        const newExpr = decl.init as NewExprAst;
        if (newExpr.callee.kind === AstExprKind.Identifier) {
          const name = (newExpr.callee as IdentifierExpr).name;
          if (name === "Map") {
            const mapType: ObjectType = makeObjectType(new Map());
            mapType.isMap = true;
            ty = mapType;
          }
          if (name === "Set") {
            const setType: ObjectType = makeObjectType(new Map());
            setType.isSet = true;
            ty = setType;
          }
        }
      } else if (decl.init.kind === AstExprKind.Member || decl.init.kind === AstExprKind.Call) {
        // Infer type from member access or method call return type
        const exprTypeName = this.resolveExprTypeName(decl.init);
        if (exprTypeName !== null) {
          const objType: ObjectType = makeObjectType(new Map());
          objType.interfaceName = exprTypeName;
          ty = objType;
        }
      } else if (decl.init.kind === AstExprKind.Identifier) {
        // Propagate class type from another variable: let x = y
        const initName = (decl.init as IdentifierExpr).name;
        const srcClass = this.lookupVarClass(initName);
        if (srcClass !== null) {
          const objType: ObjectType = makeObjectType(new Map());
          objType.interfaceName = srcClass;
          ty = objType;
        }
      }
    }
    const localId = this.allocLocal(decl.name, ty);
    // Track module-level variables (not inside a function)
    if (!this.inFunction) {
      this.moduleLocals.set(decl.name, localId);
    }
    // Apply interface/class layout if type has interfaceName (including T | null unions)
    this.applyTypeLayout(decl.name, ty);
    // Track object field layout if initializer is an object literal
    if (decl.init !== null && decl.init.kind === AstExprKind.Object) {
      const objExpr = decl.init as ObjectExprAst;
      // Don't register layout if object has spread — field indices are not static
      let objHasSpread = false;
      for (let i = 0; i < objExpr.properties.length; i = i + 1) {
        if (objExpr.properties[i].key === "...") {
          objHasSpread = true;
          break;
        }
      }
      if (!objHasSpread) {
        const layout: Map<string, number> = new Map();
        for (let i = 0; i < objExpr.properties.length; i = i + 1) {
          layout.set(objExpr.properties[i].key, i);
          // Track method fields that use 'this'
          const pval = objExpr.properties[i].value;
          if (pval.kind === AstExprKind.Arrow) {
            const arrow = pval as ArrowExprAst;
            if (Array.isArray(arrow.body) && this.bodyUsesThis(arrow.body as Array<AstStmt>)) {
              this.objMethodFields.set(decl.name + "." + objExpr.properties[i].key, true);
            }
          }
        }
        this.scope.fieldLayouts.set(decl.name, layout);
      }
    }
    // Track field layout from function return if initializer is a function call
    if (decl.init !== null && decl.init.kind === AstExprKind.Call) {
      const callExpr = decl.init as CallExprAst;
      if (callExpr.callee.kind === AstExprKind.Identifier) {
        const calleeName = (callExpr.callee as IdentifierExpr).name;
        const returnLayout = this.funcReturnLayouts.get(calleeName);
        if (returnLayout !== undefined) {
          this.scope.fieldLayouts.set(decl.name, returnLayout);
        }
      }
    }
    // Track field layout if initializer is a variable reference (propagate layout)
    let layoutSrcExpr: AstExpr | null = decl.init;
    // Unwrap "x as T" to get the underlying expression
    if (layoutSrcExpr !== null && layoutSrcExpr.kind === AstExprKind.TypeAs) {
      layoutSrcExpr = (layoutSrcExpr as TypeAsExprAst).expr;
    }
    if (layoutSrcExpr !== null && layoutSrcExpr.kind === AstExprKind.Identifier) {
      const srcName = (layoutSrcExpr as IdentifierExpr).name;
      const srcLayout = this.lookupFieldLayout(srcName);
      if (srcLayout !== null) {
        this.scope.fieldLayouts.set(decl.name, srcLayout);
      }
      const srcClassName = this.lookupVarClass(srcName);
      if (srcClassName !== null) {
        this.scope.varClassMap.set(decl.name, srcClassName);
      }
    }
    // Track class type if initializer is new ClassName()
    if (decl.init !== null && decl.init.kind === AstExprKind.New) {
      const newExpr = decl.init as NewExprAst;
      if (newExpr.callee.kind === AstExprKind.Identifier) {
        const className = (newExpr.callee as IdentifierExpr).name;
        const classInfo = this.lookupClassInfo(className);
        if (classInfo !== null) {
          this.scope.varClassMap.set(decl.name, className);
          this.scope.fieldLayouts.set(decl.name, classInfo.fieldMap);
        }
      }
    }
    let initExpr: Expr | null = null;
    if (decl.init !== null) {
      // If type is Map/Record and init is empty object {}, replace with $map_alloc
      if (ty.kind === TypeKind.Object && (ty as ObjectType).isMap && decl.init.kind === AstExprKind.Object) {
        initExpr = {
          kind: ExprKind.Call,
          ty: ty,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$map_alloc" } as FuncRefExpr,
          args: [],
        } as CallExpr;
      } else {
        initExpr = this.lowerExpr(decl.init);
        // Update type from lowered expression if we couldn't infer from AST kind alone
        if (ty.kind === TypeKind.Any && initExpr.ty.kind !== TypeKind.Any) {
          ty = initExpr.ty;
          this.scope.localTypes.set(decl.name, ty);
        }
      }
    }
    // Boxing: if this variable needs a heap-allocated cell for mutable closure capture,
    // wrap the init value in $box_alloc and store the box in the local
    if (this.boxedVars.has(decl.name)) {
      const boxInit: Expr = initExpr !== null ? initExpr : ({ kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr);
      initExpr = {
        kind: ExprKind.Call,
        ty: ANY_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$box_alloc" } as FuncRefExpr,
        args: [boxInit],
      } as CallExpr;
    }
    return {
      kind: StmtKind.Let,
      localId: localId,
      name: decl.name,
      ty: ty,
      init: initExpr,
    };
  }

  private lowerFunctionDecl(decl: FunctionDeclAst): void {
    const funcId = this.scope.functions.get(decl.name);
    if (funcId === undefined) {
      throw new Error("Function not registered: " + decl.name);
    }

    const prevInFunction = this.inFunction;
    const prevLocalId = this.nextLocalId;
    this.inFunction = true;
    this.nextLocalId = 0;
    this.pushScope();

    const params: Array<[number, string, Type]> = [];
    for (let i = 0; i < decl.params.length; i = i + 1) {
      const p: ParamDecl = decl.params[i] as ParamDecl;
      const ty = p.typeAnnotation !== null ? this.resolveType(p.typeAnnotation) : ANY_TYPE;
      const localId = this.allocLocal(p.name, ty);
      params.push([localId, p.name, ty]);
      // Apply interface/class layout for typed parameters (including T | null unions)
      this.applyTypeLayout(p.name, ty);
      // Track rest params
      if (p.rest) {
        this.restParamFuncs.set(decl.name, i);
      }
    }

    const returnType = decl.returnType !== null ? this.resolveType(decl.returnType) : ANY_TYPE;

    // Pre-register nested function and class declarations (for forward references)
    for (let i = 0; i < decl.body.length; i = i + 1) {
      const bodyStmt: AstStmt = decl.body[i] as AstStmt;
      if (bodyStmt.kind === AstStmtKind.FunctionDecl) {
        const nestedDecl = bodyStmt as FunctionDeclAst;
        if (this.scope.functions.get(nestedDecl.name) === undefined) {
          const nestedId = this.nextFuncId;
          this.nextFuncId = this.nextFuncId + 1;
          this.scope.functions.set(nestedDecl.name, nestedId);
        }
      }
      if (bodyStmt.kind === AstStmtKind.ClassDecl) {
        this.preRegisterClass(bodyStmt as ClassDeclAst);
      }
    }

    // Detect variables that need boxing for mutable closure capture
    const prevBoxedVars = this.boxedVars;
    this.boxedVars = this.detectBoxedVars(decl.body);

    const body: Array<Stmt> = [];

    // Emit default parameter checks: if (param === undefined) param = defaultValue
    for (let i = 0; i < decl.params.length; i = i + 1) {
      const p: ParamDecl = decl.params[i] as ParamDecl;
      if (p.defaultValue !== null) {
        const paramLocal = params[i][0];
        const paramTy = params[i][2];
        const defaultExpr = this.lowerExpr(p.defaultValue);
        // if (param === undefined) { param = default; }
        const condition: CompareExpr = {
          kind: ExprKind.Compare,
          ty: BOOLEAN_TYPE,
          op: CompareOp.StrictEq,
          left: { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: paramLocal, name: p.name } as LocalGetExpr,
          right: { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr,
        };
        const assignStmt: HirExprStmt = {
          kind: StmtKind.Expr,
          expr: { kind: ExprKind.LocalSet, ty: paramTy, localId: paramLocal, name: p.name, value: defaultExpr } as LocalSetExpr,
        };
        body.push({
          kind: StmtKind.If,
          condition: condition,
          thenBody: [assignStmt],
          elseBody: [],
        } as HirIfStmt);
      }
    }

    for (let i = 0; i < decl.body.length; i = i + 1) {
      this.pushLoweredStmt(body, decl.body[i]);
    }

    // Scan for return statements with object literals to record return field layout
    for (let i = 0; i < decl.body.length; i = i + 1) {
      const bodyStmt: AstStmt = decl.body[i] as AstStmt;
      if (bodyStmt.kind === AstStmtKind.Return) {
        const retStmt = bodyStmt as ReturnStmtAst;
        if (retStmt.value !== null && retStmt.value.kind === AstExprKind.Object) {
          const objExpr = retStmt.value as ObjectExprAst;
          const layout: Map<string, number> = new Map();
          for (let j = 0; j < objExpr.properties.length; j = j + 1) {
            layout.set(objExpr.properties[j].key, j);
          }
          this.funcReturnLayouts.set(decl.name, layout);
        }
      }
    }

    const localCount = this.nextLocalId;
    this.popScope();
    this.inFunction = prevInFunction;
    this.nextLocalId = prevLocalId;
    this.boxedVars = prevBoxedVars;

    let fArr = this.functions;
    fArr.push({
      id: funcId,
      name: decl.name,
      params: params,
      returnType: returnType,
      body: body,
      localCount: localCount,
      isAsync: decl.async,
    });
    this.functions = fArr;
  }

  private lowerIf(stmt: IfStmtAst): HirIfStmt {
    const condition = this.lowerExpr(stmt.condition);
    const thenBody = this.lowerBody(stmt.consequent);
    let elseBody: Array<Stmt> = [];
    if (stmt.alternate !== null) {
      elseBody = this.lowerBody(stmt.alternate);
    }
    return {
      kind: StmtKind.If,
      condition: condition,
      thenBody: thenBody,
      elseBody: elseBody,
    };
  }

  private lowerFor(stmt: ForStmtAst): HirForStmt {
    let init: Stmt | null = null;
    if (stmt.init !== null) {
      init = this.lowerStmt(stmt.init);
    }
    let condition: Expr | null = null;
    if (stmt.condition !== null) {
      condition = this.lowerExpr(stmt.condition);
    }
    let update: Expr | null = null;
    if (stmt.update !== null) {
      update = this.lowerExpr(stmt.update);
    }
    const body = this.lowerBody(stmt.body);
    return {
      kind: StmtKind.For,
      init: init,
      condition: condition,
      update: update,
      body: body,
    } as HirForStmt;
  }

  private lowerSwitch(stmt: SwitchStmtAst): Stmt {
    // Lower switch as chained if/else
    const disc = this.lowerExpr(stmt.discriminant);
    const discLocal = this.allocLocal("$switch");
    const allStmts: Array<Stmt> = [];
    allStmts.push({
      kind: StmtKind.Let,
      localId: discLocal,
      name: "$switch",
      ty: ANY_TYPE,
      init: disc,
    } as LetStmt);

    // Build chained if/else from cases
    for (let i = 0; i < stmt.cases.length; i = i + 1) {
      const c: SwitchCase = stmt.cases[i] as SwitchCase;
      const body: Array<Stmt> = [];
      for (let j = 0; j < c.body.length; j = j + 1) {
        this.pushLoweredStmt(body, c.body[j]);
      }
      if (c.test !== null) {
        const test = this.lowerExpr(c.test);
        const cond: CompareExpr = {
          kind: ExprKind.Compare,
          ty: BOOLEAN_TYPE,
          op: CompareOp.StrictEq,
          left: { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: discLocal, name: "$switch" } as LocalGetExpr,
          right: test,
        };
        allStmts.push({ kind: StmtKind.If, condition: cond, thenBody: body, elseBody: [] } as HirIfStmt);
      } else {
        // Default case
        for (let j = 0; j < body.length; j = j + 1) {
          allStmts.push(body[j]);
        }
      }
    }

    return { kind: StmtKind.Block, stmts: allStmts } as HirBlockStmt;
  }

  private lowerBody(stmt: AstStmt): Array<Stmt> {
    if (stmt.kind === AstStmtKind.Block) {
      const block = stmt as BlockStmtAst;
      const stmts: Array<Stmt> = [];
      for (let i = 0; i < block.body.length; i = i + 1) {
        this.pushLoweredStmt(stmts, block.body[i]);
      }
      return stmts;
    }
    const result: Array<Stmt> = [];
    this.pushLoweredStmt(result, stmt);
    return result;
  }

  // --- Expressions ---

  private lowerExpr(expr: AstExpr): Expr {
    if (expr.kind === AstExprKind.Number) {
      const e = expr as NumberLitExpr;
      return { kind: ExprKind.Number, ty: NUMBER_TYPE, value: e.value } as NumberExpr;
    }

    if (expr.kind === AstExprKind.String) {
      const e = expr as StringLitExpr;
      return { kind: ExprKind.String, ty: STRING_TYPE, value: e.value } as StringExpr;
    }

    if (expr.kind === AstExprKind.Template) {
      const e = expr as TemplateExprAst;
      // Lower template literal to a chain of string concatenation
      // `parts[0] ${expr[0]} parts[1] ${expr[1]} ... parts[n]`
      // -> parts[0] + toString(expr[0]) + parts[1] + ...
      let result: Expr = { kind: ExprKind.String, ty: STRING_TYPE, value: e.parts[0] } as StringExpr;
      for (let i = 0; i < e.expressions.length; i = i + 1) {
        // Convert expression to string via $template_to_string pseudo-call
        const loweredExpr = this.lowerExpr(e.expressions[i]);
        const toStr: CallExpr = {
          kind: ExprKind.Call, ty: STRING_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$template_to_string" } as FuncRefExpr,
          args: [loweredExpr],
        };
        // Concatenate result + toStr(expr)
        result = { kind: ExprKind.Binary, ty: STRING_TYPE, op: BinaryOp.Add, left: result, right: toStr } as BinaryExpr;
        // Concatenate + parts[i+1]
        const nextPart = e.parts[i + 1];
        if (nextPart.length > 0) {
          const partExpr: StringExpr = { kind: ExprKind.String, ty: STRING_TYPE, value: nextPart };
          result = { kind: ExprKind.Binary, ty: STRING_TYPE, op: BinaryOp.Add, left: result, right: partExpr } as BinaryExpr;
        }
      }
      return result;
    }

    if (expr.kind === AstExprKind.Bool) {
      const e = expr as BoolLitExpr;
      return { kind: ExprKind.Bool, ty: BOOLEAN_TYPE, value: e.value } as BoolExpr;
    }

    if (expr.kind === AstExprKind.Null) {
      return { kind: ExprKind.Null, ty: NULL_TYPE } as NullExpr;
    }

    if (expr.kind === AstExprKind.Undefined) {
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    if (expr.kind === AstExprKind.Identifier) {
      const e = expr as IdentifierExpr;
      return this.lowerIdentifier(e);
    }

    if (expr.kind === AstExprKind.Binary) {
      return this.lowerBinary(expr as BinaryExprAst);
    }

    if (expr.kind === AstExprKind.Unary) {
      return this.lowerUnary(expr as UnaryExprAst);
    }

    if (expr.kind === AstExprKind.UnaryPostfix) {
      return this.lowerPostfix(expr as UnaryPostfixExprAst);
    }

    if (expr.kind === AstExprKind.Call) {
      return this.lowerCall(expr as CallExprAst);
    }

    if (expr.kind === AstExprKind.Member) {
      return this.lowerMember(expr as MemberExprAst);
    }

    if (expr.kind === AstExprKind.Index) {
      return this.lowerIndex(expr as IndexExprAst);
    }

    if (expr.kind === AstExprKind.Assign) {
      return this.lowerAssign(expr as AssignExprAst);
    }

    if (expr.kind === AstExprKind.CompoundAssign) {
      return this.lowerCompoundAssign(expr as CompoundAssignExprAst);
    }

    if (expr.kind === AstExprKind.Conditional) {
      const e = expr as ConditionalExprAst;
      return {
        kind: ExprKind.If,
        ty: ANY_TYPE,
        condition: this.lowerExpr(e.condition),
        thenExpr: this.lowerExpr(e.consequent),
        elseExpr: this.lowerExpr(e.alternate),
      } as IfExpr;
    }

    if (expr.kind === AstExprKind.Array) {
      const e = expr as ArrayExprAst;
      // Check if any element is a spread
      let hasSpread = false;
      for (let i = 0; i < e.elements.length; i = i + 1) {
        if (e.elements[i].kind === AstExprKind.Spread) {
          hasSpread = true;
        }
      }
      if (!hasSpread) {
        const elements: Array<Expr> = [];
        for (let i = 0; i < e.elements.length; i = i + 1) {
          elements.push(this.lowerExpr(e.elements[i]));
        }
        return { kind: ExprKind.Array, ty: ANY_TYPE, elements: elements } as ArrayExpr;
      }
      // Has spread: build array using concat operations
      // Start with empty array, concat each group or spread
      let result: Expr = { kind: ExprKind.Array, ty: ANY_TYPE, elements: [] } as ArrayExpr;
      let currentGroup: Array<Expr> = [];
      for (let i = 0; i < e.elements.length; i = i + 1) {
        if (e.elements[i].kind === AstExprKind.Spread) {
          // Flush current group as a literal array
          if (currentGroup.length > 0) {
            const group: ArrayExpr = { kind: ExprKind.Array, ty: ANY_TYPE, elements: currentGroup };
            result = { kind: ExprKind.MethodCall, ty: ANY_TYPE, object: result, method: "concat", args: [group] } as MethodCallExpr;
            currentGroup = [];
          }
          // Concat the spread argument
          const spreadArg = this.lowerExpr((e.elements[i] as SpreadExprAst).argument);
          result = { kind: ExprKind.MethodCall, ty: ANY_TYPE, object: result, method: "concat", args: [spreadArg] } as MethodCallExpr;
        } else {
          currentGroup.push(this.lowerExpr(e.elements[i]));
        }
      }
      // Flush remaining group
      if (currentGroup.length > 0) {
        const group: ArrayExpr = { kind: ExprKind.Array, ty: ANY_TYPE, elements: currentGroup };
        result = { kind: ExprKind.MethodCall, ty: ANY_TYPE, object: result, method: "concat", args: [group] } as MethodCallExpr;
      }
      return result;
    }

    if (expr.kind === AstExprKind.Object) {
      const e = expr as ObjectExprAst;
      const fields: Array<[string, Expr]> = [];
      for (let i = 0; i < e.properties.length; i = i + 1) {
        const p: ObjectProperty = e.properties[i] as ObjectProperty;
        // Method shorthand: inject 'this' as first parameter if body references 'this'
        if (p.value.kind === AstExprKind.Arrow) {
          const arrow = p.value as ArrowExprAst;
          if (Array.isArray(arrow.body) && this.bodyUsesThis(arrow.body as Array<AstStmt>)) {
            // Create a modified arrow with 'this' prepended to params
            const thisParam: ParamDecl = { name: "this", typeAnnotation: null, defaultValue: null, rest: false, accessibility: null };
            const newParams: Array<ParamDecl> = [thisParam];
            for (let j = 0; j < arrow.params.length; j = j + 1) {
              newParams.push(arrow.params[j]);
            }
            const modifiedArrow: ArrowExprAst = {
              kind: AstExprKind.Arrow,
              line: arrow.line,
              col: arrow.col,
              params: newParams,
              returnType: arrow.returnType,
              body: arrow.body,
              async: arrow.async,
            };
            // Set pending layout so lowerArrow sets field layout for 'this'
            const methodLayout: Map<string, number> = new Map();
            for (let k = 0; k < e.properties.length; k = k + 1) {
              methodLayout.set(e.properties[k].key, k);
            }
            this.pendingThisLayout = methodLayout;
            fields.push([p.key, this.lowerArrow(modifiedArrow)]);
            this.pendingThisLayout = null;
            continue;
          }
        }
        fields.push([p.key, this.lowerExpr(p.value)]);
      }
      return { kind: ExprKind.ObjectLit, ty: ANY_TYPE, fields: fields } as ObjectLitExpr;
    }

    if (expr.kind === AstExprKind.Arrow) {
      return this.lowerArrow(expr as ArrowExprAst);
    }

    if (expr.kind === AstExprKind.New) {
      const e = expr as NewExprAst;
      if (e.callee.kind === AstExprKind.Identifier) {
        const name = (e.callee as IdentifierExpr).name;
        // new Map() -> call js_map_alloc
        if (name === "Map") {
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$map_alloc" } as FuncRefExpr,
            args: [],
          } as CallExpr;
        }
        // new $regex(pattern, flags) -> regex literal
        if (name === "$regex") {
          const args: Array<Expr> = [];
          for (let i = 0; i < e.args.length; i = i + 1) {
            args.push(this.lowerExpr(e.args[i]));
          }
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$regex_new" } as FuncRefExpr,
            args: args,
          } as CallExpr;
        }
        // new RegExp(pattern, flags) -> regex
        if (name === "RegExp") {
          const args: Array<Expr> = [];
          for (let i = 0; i < e.args.length; i = i + 1) {
            args.push(this.lowerExpr(e.args[i]));
          }
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$regex_new" } as FuncRefExpr,
            args: args,
          } as CallExpr;
        }
        // new Date() / new Date(timestamp) -> call js_date_new / js_date_new_from_timestamp
        if (name === "Date") {
          if (e.args.length === 0) {
            return {
              kind: ExprKind.Call,
              ty: NUMBER_TYPE,
              callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_date_new" } as FuncRefExpr,
              args: [],
            } as CallExpr;
          }
          const tsArg = this.lowerExpr(e.args[0]);
          return {
            kind: ExprKind.Call,
            ty: NUMBER_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_date_new_from_timestamp" } as FuncRefExpr,
            args: [tsArg],
          } as CallExpr;
        }
        // new Error(msg) -> just return the string msg for now
        if (name === "Error") {
          if (e.args.length > 0) {
            return this.lowerExpr(e.args[0]);
          }
          return { kind: ExprKind.String, ty: STRING_TYPE, value: "Error" } as StringExpr;
        }
        // new Set() -> call js_set_alloc
        if (name === "Set") {
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$set_alloc" } as FuncRefExpr,
            args: [],
          } as CallExpr;
        }
        // new ClassName(args) -> call ClassName$new(args)
        const classInfo = this.lookupClassInfo(name);
        if (classInfo !== null && classInfo.constructorFunc !== null) {
          const ctorFuncId = this.lookupFunction(classInfo.constructorFunc);
          const args: Array<Expr> = [];
          for (let i = 0; i < e.args.length; i = i + 1) {
            args.push(this.lowerExpr(e.args[i]));
          }
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: ctorFuncId !== null ? ctorFuncId : 0, name: classInfo.constructorFunc } as FuncRefExpr,
            args: args,
          } as CallExpr;
        }
      }
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    if (expr.kind === AstExprKind.TypeAs) {
      // Type assertion - just lower the expression
      const e = expr as TypeAsExprAst;
      return this.lowerExpr(e.expr);
    }

    if (expr.kind === AstExprKind.Typeof) {
      const e = expr as TypeofExprAst;
      const typeofExpr: HirTypeofExpr = { kind: ExprKind.Typeof, ty: STRING_TYPE, operand: this.lowerExpr(e.operand) };
      return typeofExpr;
    }

    if (expr.kind === AstExprKind.Paren) {
      const e = expr as ParenExprAst;
      return this.lowerExpr(e.expr);
    }

    if (expr.kind === AstExprKind.This) {
      const thisId = this.lookupLocal("this");
      if (thisId !== null) {
        return { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: thisId, name: "this" } as LocalGetExpr;
      }
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    if (expr.kind === AstExprKind.Void) {
      // Evaluate operand for side effects, then return undefined
      const operand = this.lowerExpr((expr as any).operand);
      this.pendingStmts.push({ kind: StmtKind.Expr, expr: operand } as HirExprStmt);
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }

    if (expr.kind === AstExprKind.Await) {
      const inner = this.lowerExpr((expr as AwaitExprAst).operand);
      return { kind: ExprKind.Await, ty: ANY_TYPE, inner: inner } as AwaitExpr;
    }

    throw new Error("Cannot lower expr kind: " + expr.kind + " at line " + expr.line);
  }

  private lowerIdentifier(expr: IdentifierExpr): Expr {
    // Check if inside a function and referencing a module-level variable
    if (this.inFunction && this.moduleLocals.has(expr.name)) {
      this.addModuleGlobal(expr.name);
      const ty = this.lookupLocalType(expr.name);
      const globalGet: GlobalGetExpr = { kind: ExprKind.GlobalGet, ty: ty, name: expr.name };
      // If this module-level var is boxed, unwrap the box
      if (this.moduleBoxedVars.has(expr.name)) {
        return this.makeBoxGet(globalGet);
      }
      return globalGet;
    }

    // Check if it's an imported global variable from another module
    const importedGlobalName = this.importedGlobals.get(expr.name);
    if (importedGlobalName !== undefined) {
      return { kind: ExprKind.GlobalGet, ty: ANY_TYPE, name: importedGlobalName } as GlobalGetExpr;
    }

    // Check if it's a local variable, with capture awareness
    const localResult = this.lookupLocalCaptureAware(expr.name);
    if (localResult !== null) {
      if (localResult[1]) {
        // This is a captured variable from outside a closure boundary
        const captureIndex = localResult[2];
        const closurePtrLocalId = localResult[3];
        const ty = this.lookupLocalType(expr.name);
        const capExpr: CaptureGetExpr = { kind: ExprKind.CaptureGet, ty: ty, captureIndex: captureIndex, closurePtrLocalId: closurePtrLocalId };
        // If this captured variable is a box, unwrap it
        if (this.boxedCaptureNames.has(expr.name)) {
          return this.makeBoxGet(capExpr);
        }
        return capExpr;
      }
      // Check if this is a boxed variable in the current scope
      if (this.boxedVars.has(expr.name)) {
        const boxLocal: LocalGetExpr = { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: localResult[0], name: expr.name };
        return this.makeBoxGet(boxLocal);
      }
      const ty = this.lookupLocalType(expr.name);
      return { kind: ExprKind.LocalGet, ty: ty, localId: localResult[0], name: expr.name } as LocalGetExpr;
    }

    // Check if it's a function reference
    const funcId = this.lookupFunction(expr.name);
    if (funcId !== null) {
      return { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: funcId, name: expr.name } as FuncRefExpr;
    }

    // Handle __dirname as a runtime call that returns a string
    if (expr.name === "__dirname") {
      return {
        kind: ExprKind.Call,
        ty: STRING_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "pd_get_dirname" } as FuncRefExpr,
        args: [],
      } as CallExpr;
    }
    // Handle process.xxx via the resolveBuiltinCall mechanism
    if (expr.name === "process") {
      return {
        kind: ExprKind.Call,
        ty: ANY_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_get_process" } as FuncRefExpr,
        args: [],
      } as CallExpr;
    }
    // Handle Error() as a constructor
    if (expr.name === "Error") {
      const fid = this.nextFuncId;
      this.nextFuncId = this.nextFuncId + 1;
      this.externalFuncs.push([fid, expr.name]);
      return { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: fid, name: expr.name } as FuncRefExpr;
    }

    // Well-known built-in globals that are only used as prefixes for method calls
    // (e.g., Math.floor, Object.keys, JSON.stringify, Date.now)
    // Return undefined — the actual call will be resolved by resolveBuiltinCall
    if (expr.name === "Math" || expr.name === "Object" || expr.name === "JSON" ||
        expr.name === "Date" || expr.name === "globalThis" || expr.name === "Symbol" ||
        expr.name === "Reflect" || expr.name === "Promise" || expr.name === "RegExp" ||
        expr.name === "Infinity" || expr.name === "NaN" || expr.name === "crypto" ||
        expr.name === "Number" || expr.name === "Array") {
      if (expr.name === "Infinity") {
        return { kind: ExprKind.Number, ty: NUMBER_TYPE, value: Infinity } as NumberExpr;
      }
      if (expr.name === "NaN") {
        return { kind: ExprKind.Number, ty: NUMBER_TYPE, value: NaN } as NumberExpr;
      }
      return { kind: ExprKind.Undefined, ty: ANY_TYPE } as UndefinedExpr;
    }

    // Unknown identifier - might be a global or will be resolved later
    // For now, treat as an unresolved reference (allocate a local for it)
    console.error("[WARN] Unresolved identifier: " + expr.name + " (inFunction=" + this.inFunction + ")");
    const id = this.allocLocal(expr.name);
    return { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: id, name: expr.name } as LocalGetExpr;
  }

  // Returns [localId, isCaptured, captureIndex, closurePtrLocalId] or null
  private lookupLocalCaptureAware(name: string): [number, boolean, number, number] | null {
    let scope: Scope | null = this.scope;
    let crossedBoundary = false;
    let closurePtrLocalId = -1;
    let closureScope: Scope | null = null;
    while (scope !== null) {
      const id = scope.locals.get(name);
      if (id !== undefined) {
        if (crossedBoundary && closureScope !== null) {
          // This variable is from outside the closure boundary - it's a capture
          const captures = closureScope.closureCaptures;
          if (captures !== null) {
            // Check if already captured
            for (let i = 0; i < captures.length; i = i + 1) {
              if (captures[i][0] === name) {
                return [id, true, i, closurePtrLocalId];
              }
            }
            // New capture
            const captureIndex = captures.length;
            captures.push([name, id]);
            return [id, true, captureIndex, closurePtrLocalId];
          }
        }
        return [id, false, 0, 0];
      }
      if (scope.isClosureBoundary && !crossedBoundary) {
        crossedBoundary = true;
        closurePtrLocalId = scope.closurePtrLocalId;
        closureScope = scope;
      }
      scope = scope.parent;
    }
    return null;
  }

  private lowerBinary(expr: BinaryExprAst): Expr {
    const left = this.lowerExpr(expr.left);
    const right = this.lowerExpr(expr.right);

    // Logical operators get their own node type
    if (expr.op === "&&") {
      return { kind: ExprKind.Logical, ty: ANY_TYPE, op: LogicalOp.And, left: left, right: right } as LogicalExpr;
    }
    if (expr.op === "||") {
      return { kind: ExprKind.Logical, ty: ANY_TYPE, op: LogicalOp.Or, left: left, right: right } as LogicalExpr;
    }
    if (expr.op === "??") {
      return { kind: ExprKind.Logical, ty: ANY_TYPE, op: LogicalOp.NullishCoalesce, left: left, right: right } as LogicalExpr;
    }

    // Comparison operators
    if (expr.op === "==") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Eq, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "!=") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Ne, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "===") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.StrictEq, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "!==") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.StrictNe, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "<") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Lt, left: left, right: right } as CompareExpr;
    }
    if (expr.op === "<=") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Le, left: left, right: right } as CompareExpr;
    }
    if (expr.op === ">") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Gt, left: left, right: right } as CompareExpr;
    }
    if (expr.op === ">=") {
      return { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.Ge, left: left, right: right } as CompareExpr;
    }

    // Arithmetic operators
    let op: number;
    if (expr.op === "+") { op = BinaryOp.Add; }
    else if (expr.op === "-") { op = BinaryOp.Sub; }
    else if (expr.op === "*") { op = BinaryOp.Mul; }
    else if (expr.op === "/") { op = BinaryOp.Div; }
    else if (expr.op === "%") { op = BinaryOp.Mod; }
    else if (expr.op === "&") { op = BinaryOp.BitAnd; }
    else if (expr.op === "|") { op = BinaryOp.BitOr; }
    else if (expr.op === "^") { op = BinaryOp.BitXor; }
    else if (expr.op === "<<") { op = BinaryOp.Shl; }
    else if (expr.op === ">>") { op = BinaryOp.Shr; }
    else if (expr.op === ">>>") { op = BinaryOp.UShr; }
    else if (expr.op === "**") {
      // Exponentiation: lower to Math.pow(left, right) call
      const left = this.lowerExpr(expr.left);
      const right = this.lowerExpr(expr.right);
      return {
        kind: ExprKind.Call,
        ty: NUMBER_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_math_pow" } as FuncRefExpr,
        args: [left, right],
      } as CallExpr;
    }
    else if (expr.op === "in") {
      // "key" in obj -> js_object_has_property(obj, key)
      const left = this.lowerExpr(expr.left);  // key (string)
      const right = this.lowerExpr(expr.right); // object
      return {
        kind: ExprKind.Call,
        ty: BOOLEAN_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$in_operator" } as FuncRefExpr,
        args: [right, left],  // obj first, then key
      } as CallExpr;
    }
    else if (expr.op === "instanceof") {
      // For now, return false
      return { kind: ExprKind.Bool, ty: BOOLEAN_TYPE, value: false } as BoolExpr;
    }
    else {
      throw new Error("Unknown binary operator: " + expr.op);
    }

    // Infer result type from operand types
    let ty: Type = ANY_TYPE;
    if (left.ty.kind === TypeKind.Number && right.ty.kind === TypeKind.Number) {
      ty = NUMBER_TYPE;
    } else if (left.ty.kind === TypeKind.String && right.ty.kind === TypeKind.String && op === BinaryOp.Add) {
      ty = STRING_TYPE;
    } else if ((left.ty.kind === TypeKind.String || right.ty.kind === TypeKind.String) && op === BinaryOp.Add) {
      ty = STRING_TYPE;
    }

    return { kind: ExprKind.Binary, ty: ty, op: op, left: left, right: right } as BinaryExpr;
  }

  private lowerUnary(expr: UnaryExprAst): Expr {
    const operand = this.lowerExpr(expr.operand);
    let op: number;
    if (expr.op === "-") { op = UnaryOp.Neg; }
    else if (expr.op === "!") { op = UnaryOp.Not; }
    else if (expr.op === "~") { op = UnaryOp.BitNot; }
    else if (expr.op === "+") { op = UnaryOp.Plus; }
    else if (expr.op === "++" || expr.op === "--") {
      // Pre-increment/decrement: lower to assignment
      return this.lowerPreIncDec(expr);
    }
    else if (expr.op === "delete") {
      return this.lowerDelete(expr);
    }
    else if (expr.op === "void") {
      // void expr evaluates expr and returns undefined
      return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
    }
    else {
      throw new Error("Unknown unary operator: " + expr.op);
    }
    return { kind: ExprKind.Unary, ty: operand.ty, op: op, operand: operand } as UnaryExpr;
  }

  private lowerDelete(expr: UnaryExprAst): Expr {
    // delete obj.prop -> call $object_delete_field(obj, "prop")
    if (expr.operand.kind === AstExprKind.Member) {
      const member = expr.operand as MemberExprAst;
      const objExpr = this.lowerExpr(member.object);
      const keyExpr: Expr = { kind: ExprKind.String, ty: STRING_TYPE, value: member.property } as StringExpr;
      return {
        kind: ExprKind.Call,
        ty: BOOLEAN_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, name: "$object_delete_field" } as FuncRefExpr,
        args: [objExpr, keyExpr],
      } as CallExpr;
    }
    // delete arr[idx] -> set arr[idx] = undefined
    if (expr.operand.kind === AstExprKind.Index) {
      const idx = expr.operand as IndexExprAst;
      const arrExpr = this.lowerExpr(idx.object);
      const indexExpr = this.lowerExpr(idx.index);
      const undefinedExpr: Expr = { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
      return {
        kind: ExprKind.Call,
        ty: BOOLEAN_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, name: "$array_delete" } as FuncRefExpr,
        args: [arrExpr, indexExpr, undefinedExpr],
      } as CallExpr;
    }
    // Fallback: evaluate and return true
    return { kind: ExprKind.Bool, ty: BOOLEAN_TYPE, value: true } as BoolExpr;
  }

  private lowerPreIncDec(expr: UnaryExprAst): Expr {
    // ++x => x = x + 1
    const operand = expr.operand;
    if (operand.kind === AstExprKind.Identifier) {
      const ident = operand as IdentifierExpr;
      // Check for module-level global
      if (this.inFunction && this.moduleLocals.has(ident.name)) {
        this.addModuleGlobal(ident.name);
        const one: NumberExpr = { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 };
        const binOp = expr.op === "++" ? BinaryOp.Add : BinaryOp.Sub;
        if (this.moduleBoxedVars.has(ident.name)) {
          const globalGet: GlobalGetExpr = { kind: ExprKind.GlobalGet, ty: ANY_TYPE, name: ident.name };
          const get = this.makeBoxGet(globalGet);
          const add: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: binOp, left: get, right: one };
          return this.makeBoxSet({ kind: ExprKind.GlobalGet, ty: ANY_TYPE, name: ident.name } as GlobalGetExpr, add);
        }
        const get: GlobalGetExpr = { kind: ExprKind.GlobalGet, ty: NUMBER_TYPE, name: ident.name };
        const add: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: binOp, left: get, right: one };
        return { kind: ExprKind.GlobalSet, ty: NUMBER_TYPE, name: ident.name, value: add } as GlobalSetExpr;
      }
      const captureResult = this.lookupLocalCaptureAware(ident.name);
      if (captureResult !== null) {
        const one: NumberExpr = { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 };
        const binOp = expr.op === "++" ? BinaryOp.Add : BinaryOp.Sub;
        if (captureResult[1]) {
          // Captured variable
          if (this.boxedCaptureNames.has(ident.name)) {
            const capExpr: CaptureGetExpr = { kind: ExprKind.CaptureGet, ty: ANY_TYPE, captureIndex: captureResult[2], closurePtrLocalId: captureResult[3] };
            const get = this.makeBoxGet(capExpr);
            const add: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: binOp, left: get, right: one };
            return this.makeBoxSet(capExpr, add);
          }
          const get: CaptureGetExpr = { kind: ExprKind.CaptureGet, ty: NUMBER_TYPE, captureIndex: captureResult[2], closurePtrLocalId: captureResult[3] };
          const add: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: binOp, left: get, right: one };
          return { kind: ExprKind.CaptureSet, ty: NUMBER_TYPE, captureIndex: captureResult[2], closurePtrLocalId: captureResult[3], value: add } as CaptureSetExpr;
        }
        // Boxed local variable
        if (this.boxedVars.has(ident.name)) {
          const boxLocal: LocalGetExpr = { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: captureResult[0], name: ident.name };
          const get = this.makeBoxGet(boxLocal);
          const add: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: binOp, left: get, right: one };
          return this.makeBoxSet(boxLocal, add);
        }
        const get: LocalGetExpr = { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: captureResult[0], name: ident.name };
        const add: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: binOp, left: get, right: one };
        return { kind: ExprKind.LocalSet, ty: NUMBER_TYPE, localId: captureResult[0], name: ident.name, value: add } as LocalSetExpr;
      }
    }
    // Fallback: just return the operand
    return this.lowerExpr(expr.operand);
  }

  private lowerPostfix(expr: UnaryPostfixExprAst): Expr {
    // x++ => (x = x + 1) - 1, i.e. increment x but return old value
    // x-- => (x = x - 1) + 1
    if (expr.operand.kind === AstExprKind.Identifier) {
      const ident = expr.operand as IdentifierExpr;
      // Check for module-level global
      if (this.inFunction && this.moduleLocals.has(ident.name)) {
        this.addModuleGlobal(ident.name);
        const one: NumberExpr = { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 };
        const incOp = expr.op === "++" ? BinaryOp.Add : BinaryOp.Sub;
        const reverseOp = expr.op === "++" ? BinaryOp.Sub : BinaryOp.Add;
        const one2: NumberExpr = { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 };
        if (this.moduleBoxedVars.has(ident.name)) {
          const globalGet: GlobalGetExpr = { kind: ExprKind.GlobalGet, ty: ANY_TYPE, name: ident.name };
          const get = this.makeBoxGet(globalGet);
          const incExpr: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: incOp, left: get, right: one };
          const setExpr = this.makeBoxSet({ kind: ExprKind.GlobalGet, ty: ANY_TYPE, name: ident.name } as GlobalGetExpr, incExpr);
          return { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: reverseOp, left: setExpr, right: one2 } as BinaryExpr;
        }
        const get: GlobalGetExpr = { kind: ExprKind.GlobalGet, ty: NUMBER_TYPE, name: ident.name };
        const incExpr: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: incOp, left: get, right: one };
        const setExpr: GlobalSetExpr = { kind: ExprKind.GlobalSet, ty: NUMBER_TYPE, name: ident.name, value: incExpr };
        return { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: reverseOp, left: setExpr, right: one2 } as BinaryExpr;
      }
      const captureResult = this.lookupLocalCaptureAware(ident.name);
      if (captureResult !== null) {
        const one: NumberExpr = { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 };
        const incOp = expr.op === "++" ? BinaryOp.Add : BinaryOp.Sub;
        const reverseOp = expr.op === "++" ? BinaryOp.Sub : BinaryOp.Add;
        const one2: NumberExpr = { kind: ExprKind.Number, ty: NUMBER_TYPE, value: 1 };
        if (captureResult[1]) {
          // Captured variable
          if (this.boxedCaptureNames.has(ident.name)) {
            const capExpr: CaptureGetExpr = { kind: ExprKind.CaptureGet, ty: ANY_TYPE, captureIndex: captureResult[2], closurePtrLocalId: captureResult[3] };
            const get = this.makeBoxGet(capExpr);
            const incExpr: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: incOp, left: get, right: one };
            const setExpr = this.makeBoxSet(capExpr, incExpr);
            return { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: reverseOp, left: setExpr, right: one2 } as BinaryExpr;
          }
          const get: CaptureGetExpr = { kind: ExprKind.CaptureGet, ty: NUMBER_TYPE, captureIndex: captureResult[2], closurePtrLocalId: captureResult[3] };
          const incExpr: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: incOp, left: get, right: one };
          const setExpr: CaptureSetExpr = { kind: ExprKind.CaptureSet, ty: NUMBER_TYPE, captureIndex: captureResult[2], closurePtrLocalId: captureResult[3], value: incExpr };
          return { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: reverseOp, left: setExpr, right: one2 } as BinaryExpr;
        }
        // Boxed local
        if (this.boxedVars.has(ident.name)) {
          const boxLocal: LocalGetExpr = { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: captureResult[0], name: ident.name };
          const get = this.makeBoxGet(boxLocal);
          const incExpr: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: incOp, left: get, right: one };
          const setExpr = this.makeBoxSet(boxLocal, incExpr);
          return { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: reverseOp, left: setExpr, right: one2 } as BinaryExpr;
        }
        const localId = captureResult[0];
        const get: LocalGetExpr = { kind: ExprKind.LocalGet, ty: NUMBER_TYPE, localId: localId, name: ident.name };
        const incExpr: BinaryExpr = { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: incOp, left: get, right: one };
        const setExpr: LocalSetExpr = { kind: ExprKind.LocalSet, ty: NUMBER_TYPE, localId: localId, name: ident.name, value: incExpr };
        return { kind: ExprKind.Binary, ty: NUMBER_TYPE, op: reverseOp, left: setExpr, right: one2 } as BinaryExpr;
      }
    }
    // Fallback: just do pre-increment behavior
    return this.lowerPreIncDec({ kind: AstExprKind.Unary, line: expr.line, col: expr.col, op: expr.op, operand: expr.operand } as UnaryExprAst);
  }

  private lowerArrow(expr: ArrowExprAst): Expr {
    const funcName = "$closure_" + this.nextFuncId;
    const funcId = this.nextFuncId;
    this.nextFuncId = this.nextFuncId + 1;

    // Save and reset local ID counter for the new function scope
    const prevLocalId = this.nextLocalId;
    this.nextLocalId = 0;

    // Save outer boxed vars and set up boxed capture tracking for the closure
    const prevBoxedVars = this.boxedVars;
    const prevBoxedCaptureNames = this.boxedCaptureNames;
    this.boxedCaptureNames = new Map();
    // The closure's own body doesn't have its own boxed vars
    // (those are detected per-function). Reset for the closure scope.
    this.boxedVars = new Map();

    // Push a closure scope
    this.pushScope();
    this.scope.isClosureBoundary = true;
    this.scope.closureCaptures = [];

    // First param: closure pointer (synthetic, used by CaptureGet codegen)
    const closurePtrId = this.allocLocal("$closure_ptr", ANY_TYPE);
    this.scope.closurePtrLocalId = closurePtrId;
    const params: Array<[number, string, Type]> = [[closurePtrId, "$closure_ptr", ANY_TYPE]];

    // User params
    for (let i = 0; i < expr.params.length; i = i + 1) {
      const p: ParamDecl = expr.params[i] as ParamDecl;
      const ty = p.typeAnnotation !== null ? this.resolveType(p.typeAnnotation) : ANY_TYPE;
      const localId = this.allocLocal(p.name, ty);
      params.push([localId, p.name, ty]);
    }

    // Inside the closure body, captured variables that were boxed in the outer scope
    // need to be read/written through box_get/box_set. Use the outer scope's boxedVars
    // as the boxedCaptureNames so the closure body knows which captures are boxes.
    this.boxedCaptureNames = prevBoxedVars;

    // For object literal methods: set field layout for 'this' parameter
    if (this.pendingThisLayout !== null) {
      this.scope.fieldLayouts.set("this", this.pendingThisLayout);
    }

    // Lower body - captures are automatically detected via lookupLocalCaptureAware
    const body: Array<Stmt> = [];
    const arrowBody = expr.body;
    if (Array.isArray(arrowBody)) {
      // Block body: array of statements
      const stmts = arrowBody as Array<AstStmt>;
      for (let i = 0; i < stmts.length; i = i + 1) {
        this.pushLoweredStmt(body, stmts[i]);
      }
    } else {
      // Expression body: treat as return expr
      const exprBody = arrowBody as AstExpr;
      const lowered = this.lowerExpr(exprBody);
      body.push({ kind: StmtKind.Return, value: lowered } as HirReturnStmt);
    }

    // Collect captures (populated during body lowering)
    const captures = this.scope.closureCaptures;
    const captureOuterIds: Array<number> = [];
    const captureNames: Array<string> = [];
    if (captures !== null) {
      for (let i = 0; i < captures.length; i = i + 1) {
        captureOuterIds.push(captures[i][1]);
        captureNames.push(captures[i][0]);
      }
    }

    const localCount = this.nextLocalId;
    this.popScope();
    this.nextLocalId = prevLocalId;
    this.boxedVars = prevBoxedVars;
    this.boxedCaptureNames = prevBoxedCaptureNames;

    // Register the closure function
    let fArr2 = this.functions;
    fArr2.push({
      id: funcId,
      name: funcName,
      params: params,
      returnType: ANY_TYPE,
      body: body,
      localCount: localCount,
      isAsync: expr.async,
    });
    this.functions = fArr2;

    // Build capture value expressions (in outer scope context)
    // For boxed variables, capture the box (LocalGet of the box local), not the value
    const captureValues: Array<Expr> = [];
    for (let i = 0; i < captureOuterIds.length; i = i + 1) {
      captureValues.push({ kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: captureOuterIds[i], name: captureNames[i] } as LocalGetExpr);
    }

    return {
      kind: ExprKind.Closure,
      ty: ANY_TYPE,
      funcId: funcId,
      captures: captureValues,
    } as ClosureExpr;
  }

  private lowerCall(expr: CallExprAst): Expr {
    // Handle super(args) constructor call
    if (expr.callee.kind === AstExprKind.Super) {
      // Find current class and its parent
      const currentClassName = this.lookupVarClass("this");
      if (currentClassName !== null) {
        const currentClassInfo = this.lookupClassInfo(currentClassName);
        if (currentClassInfo !== null && currentClassInfo.superClass !== null) {
          const parentCtorName = currentClassInfo.superClass + "$new";
          const parentCtorId = this.lookupFunction(parentCtorName);
          // super(args) calls parent constructor, which returns the object
          // We need to pass our 'this' object's fields into the parent constructor
          // Actually, in Perry's model: super(args) calls parent$new(args) which returns a new object.
          // Then we copy the parent fields into our 'this'.
          // Simpler approach: call parent constructor, then set our 'this' fields from the result.
          const args: Array<Expr> = [];
          for (let i = 0; i < expr.args.length; i = i + 1) {
            args.push(this.lowerExpr(expr.args[i]));
          }
          // Call parent constructor to get the initialized parent part
          const parentObj: CallExpr = {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: parentCtorId !== null ? parentCtorId : 0, name: parentCtorName } as FuncRefExpr,
            args: args,
          };
          // Copy parent fields from the returned object to 'this'
          const parentInfo = this.lookupClassInfo(currentClassInfo.superClass);
          if (parentInfo !== null) {
            // Store parent result in a temp, then copy each field
            // Use Assign to generate: let $super = parentCtor(args)
            const superLocal = this.allocLocal("$super");
            this.pendingStmts.push({
              kind: StmtKind.Let,
              localId: superLocal,
              name: "$super",
              ty: ANY_TYPE,
              init: parentObj,
            } as LetStmt);
            const thisExpr: LocalGetExpr = { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: this.lookupLocal("this") as number, name: "this" };
            const superExpr: LocalGetExpr = { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: superLocal, name: "$super" };
            for (let fi = 0; fi < parentInfo.fieldNames.length; fi = fi + 1) {
              const fName = parentInfo.fieldNames[fi];
              const fIdx = parentInfo.fieldMap.get(fName);
              if (fIdx !== undefined) {
                // this.field = $super.field
                const getField: FieldGetExpr = { kind: ExprKind.FieldGet, ty: ANY_TYPE, object: superExpr, field: fName, fieldIndex: fIdx };
                const setField: FieldSetExpr = { kind: ExprKind.FieldSet, ty: ANY_TYPE, object: thisExpr, field: fName, fieldIndex: fIdx, value: getField };
                this.pendingStmts.push({ kind: StmtKind.Expr, expr: setField } as HirExprStmt);
              }
            }
          }
          // super() call doesn't return a useful value; return undefined
          return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
        }
      }
    }

    // Special case: method calls on known objects
    if (expr.callee.kind === AstExprKind.Member) {
      const member = expr.callee as MemberExprAst;

      // Handle this.method() calls inside class methods/constructors
      if (member.object.kind === AstExprKind.This) {
        const varClassName = this.lookupVarClass("this");
        if (varClassName !== null) {
          const classInfo = this.lookupClassInfo(varClassName);
          if (classInfo !== null) {
            const methodFuncName = classInfo.methods.get(member.property);
            if (methodFuncName !== undefined) {
              const funcId = this.lookupFunction(methodFuncName);
              const thisExpr = this.lowerExpr(member.object);
              const args: Array<Expr> = [thisExpr];  // 'this' is first arg
              for (let i = 0; i < expr.args.length; i = i + 1) {
                args.push(this.lowerExpr(expr.args[i]));
              }
              const retType = this.lookupFuncReturnType(methodFuncName);
              return {
                kind: ExprKind.Call,
                ty: retType,
                callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: funcId !== null ? funcId : 0, name: methodFuncName } as FuncRefExpr,
                args: args,
              } as CallExpr;
            }
          }
        }
      }

      // Built-in global method calls: console.log, Math.floor, etc.
      if (member.object.kind === AstExprKind.Identifier) {
        const obj = member.object as IdentifierExpr;
        const runtimeName = this.resolveBuiltinCall(obj.name, member.property, expr.args.length);
        if (runtimeName !== null) {
          // Math.min/max with >2 args: chain pairwise calls
          if ((runtimeName === "llvm.minnum.f64" || runtimeName === "llvm.maxnum.f64") && expr.args.length > 2) {
            let result: Expr = this.lowerExpr(expr.args[0]);
            for (let i = 1; i < expr.args.length; i = i + 1) {
              const arg = this.lowerExpr(expr.args[i]);
              result = {
                kind: ExprKind.Call,
                ty: NUMBER_TYPE,
                callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: runtimeName } as FuncRefExpr,
                args: [result, arg],
              } as CallExpr;
            }
            return result;
          }
          const args: Array<Expr> = [];
          // path.resolve with 1 arg: prepend process.cwd() as first arg
          if (runtimeName === "pd_path_resolve" && expr.args.length === 1) {
            args.push({
              kind: ExprKind.Call,
              ty: ANY_TYPE,
              callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "pd_process_cwd" } as FuncRefExpr,
              args: [],
            } as CallExpr);
          }
          for (let i = 0; i < expr.args.length; i = i + 1) {
            args.push(this.lowerExpr(expr.args[i]));
          }
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: runtimeName } as FuncRefExpr,
            args: args,
          } as CallExpr;
        }

        // Static method call: ClassName.method()
        const staticMethodName = obj.name + "$static$" + member.property;
        const staticMethodId = this.lookupFunction(staticMethodName);
        if (staticMethodId !== null) {
          const staticArgs: Array<Expr> = [];
          for (let i = 0; i < expr.args.length; i = i + 1) {
            staticArgs.push(this.lowerExpr(expr.args[i]));
          }
          const sRetType = this.lookupFuncReturnType(staticMethodName);
          return {
            kind: ExprKind.Call,
            ty: sRetType,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: staticMethodId, name: staticMethodName } as FuncRefExpr,
            args: staticArgs,
          } as CallExpr;
        }

        // Method calls on class instances: obj.method(args) -> ClassName$method(obj, args)
        // Must check BEFORE array/map/set methods to avoid routing class get/set as Map methods
        const varClassName = this.lookupVarClass(obj.name);
        if (varClassName !== null) {
          const classInfo2 = this.lookupClassInfo(varClassName);
          if (classInfo2 !== null) {
            const methodFuncName2 = classInfo2.methods.get(member.property);
            if (methodFuncName2 !== undefined) {
              const funcId2 = this.lookupFunction(methodFuncName2);
              const objExpr2 = this.lowerExpr(member.object);
              const args2: Array<Expr> = [objExpr2];
              for (let i = 0; i < expr.args.length; i = i + 1) {
                args2.push(this.lowerExpr(expr.args[i]));
              }
              const retType2 = this.lookupFuncReturnType(methodFuncName2);
              return {
                kind: ExprKind.Call,
                ty: retType2,
                callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: funcId2 !== null ? funcId2 : 0, name: methodFuncName2 } as FuncRefExpr,
                args: args2,
              } as CallExpr;
            }
          }
        }

        // Method calls on known typed locals (arrays, maps)
        const localType = this.lookupLocalType(obj.name);
        if (this.isArrayMethod(member.property) && (localType.kind === TypeKind.Array || localType.kind === TypeKind.Any)) {
          const objExpr = this.lowerExpr(member.object);
          const args: Array<Expr> = [];
          for (let i = 0; i < expr.args.length; i = i + 1) {
            args.push(this.lowerExpr(expr.args[i]));
          }
          return {
            kind: ExprKind.MethodCall,
            ty: ANY_TYPE,
            object: objExpr,
            method: member.property,
            args: args,
          } as MethodCallExpr;
        }

        if (this.isMapMethod(member.property) && ((localType.kind === TypeKind.Object && (localType as ObjectType).isMap) || localType.kind === TypeKind.Any)) {
          const objExpr = this.lowerExpr(member.object);
          const args: Array<Expr> = [];
          for (let i = 0; i < expr.args.length; i = i + 1) {
            args.push(this.lowerExpr(expr.args[i]));
          }
          return {
            kind: ExprKind.MethodCall,
            ty: ANY_TYPE,
            object: objExpr,
            method: member.property,
            args: args,
          } as MethodCallExpr;
        }

        if (this.isSetMethod(member.property) && localType.kind === TypeKind.Object && (localType as ObjectType).isSet) {
          const objExpr = this.lowerExpr(member.object);
          const args: Array<Expr> = [];
          for (let i = 0; i < expr.args.length; i = i + 1) {
            args.push(this.lowerExpr(expr.args[i]));
          }
          return {
            kind: ExprKind.MethodCall,
            ty: ANY_TYPE,
            object: objExpr,
            method: "set_" + member.property,
            args: args,
          } as MethodCallExpr;
        }

        // Date instance method calls: dateVar.getTime(), dateVar.getFullYear(), etc.
        const dateMethodMap = this.resolveDateMethod(member.property);
        if (dateMethodMap !== null) {
          const objExpr = this.lowerExpr(member.object);
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: dateMethodMap } as FuncRefExpr,
            args: [objExpr],
          } as CallExpr;
        }

        // Regex method calls (e.g., regex.test(str))
        if (member.property === "test" && expr.args.length === 1) {
          const objExpr = this.lowerExpr(member.object);
          const args: Array<Expr> = [];
          args.push(this.lowerExpr(expr.args[0]));
          return {
            kind: ExprKind.MethodCall,
            ty: BOOLEAN_TYPE,
            object: objExpr,
            method: "regex_test",
            args: args,
          } as MethodCallExpr;
        }

        // String method calls
        if (this.isStringMethod(member.property) && (localType.kind === TypeKind.String || localType.kind === TypeKind.Any)) {
          const objExpr = this.lowerExpr(member.object);
          const args: Array<Expr> = [];
          for (let i = 0; i < expr.args.length; i = i + 1) {
            args.push(this.lowerExpr(expr.args[i]));
          }
          return {
            kind: ExprKind.MethodCall,
            ty: this.stringMethodReturnType(member.property),
            object: objExpr,
            method: "str_" + member.property,
            args: args,
          } as MethodCallExpr;
        }

        // .toString() on any value
        if (member.property === "toString") {
          const objExpr = this.lowerExpr(member.object);
          return {
            kind: ExprKind.MethodCall,
            ty: STRING_TYPE,
            object: objExpr,
            method: "toString",
            args: [],
          } as MethodCallExpr;
        }

        // Object literal method call: obj.method() where method is a method field
        // The method closure has 'this' as first parameter, so pass 'obj' as first arg
        if (this.objMethodFields.has(obj.name + "." + member.property)) {
          const objExprM = this.lowerExpr(member.object);
          // Get the closure from the object field
          const fieldLayout = this.scope.fieldLayouts.get(obj.name);
          const fieldIdx = fieldLayout !== undefined ? fieldLayout.get(member.property) : undefined;
          if (fieldIdx !== undefined) {
            const closureVal: FieldGetExpr = { kind: ExprKind.FieldGet, ty: ANY_TYPE, object: objExprM, field: member.property, fieldIndex: fieldIdx };
            const args: Array<Expr> = [objExprM];  // 'this' is first arg
            for (let i = 0; i < expr.args.length; i = i + 1) {
              args.push(this.lowerExpr(expr.args[i]));
            }
            return { kind: ExprKind.Call, ty: ANY_TYPE, callee: closureVal, args: args } as CallExpr;
          }
        }

      }

      // Method calls on non-identifier objects (e.g., arr.slice(0).push(x))
      const objExpr = this.lowerExpr(member.object);
      // Regex .test() on non-identifier
      if (member.property === "test" && expr.args.length === 1) {
        const args: Array<Expr> = [];
        args.push(this.lowerExpr(expr.args[0]));
        return {
          kind: ExprKind.MethodCall,
          ty: BOOLEAN_TYPE,
          object: objExpr,
          method: "regex_test",
          args: args,
        } as MethodCallExpr;
      }
      // Class method dispatch for chained member access (e.g., new Box(5).map(fn))
      // Must be checked BEFORE array/map/set method fallback, since method names like
      // "map" exist in both class methods and Array.prototype
      const objClassName = this.resolveExprClassName(member.object);
      if (objClassName !== null) {
        const objClassInfo = this.lookupClassInfo(objClassName);
        if (objClassInfo !== null) {
          const methodFuncName = objClassInfo.methods.get(member.property);
          if (methodFuncName !== undefined) {
            const funcId = this.lookupFunction(methodFuncName);
            const args: Array<Expr> = [objExpr];  // 'this' is first arg
            for (let i = 0; i < expr.args.length; i = i + 1) {
              args.push(this.lowerExpr(expr.args[i]));
            }
            const retType = this.lookupFuncReturnType(methodFuncName);
            return {
              kind: ExprKind.Call,
              ty: retType,
              callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: funcId !== null ? funcId : 0, name: methodFuncName } as FuncRefExpr,
              args: args,
            } as CallExpr;
          }
        }
      }

      // When the object is known to be a string, prefer string methods over array methods
      // (indexOf, includes, slice exist in both lists)
      if (this.isStringMethod(member.property) && objExpr.ty.kind === TypeKind.String) {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.MethodCall,
          ty: this.stringMethodReturnType(member.property),
          object: objExpr,
          method: "str_" + member.property,
          args: args,
        } as MethodCallExpr;
      }
      if (this.isArrayMethod(member.property) || this.isMapMethod(member.property) || this.isSetMethod(member.property)) {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.MethodCall,
          ty: ANY_TYPE,
          object: objExpr,
          method: member.property,
          args: args,
        } as MethodCallExpr;
      }
      if (this.isStringMethod(member.property)) {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.MethodCall,
          ty: this.stringMethodReturnType(member.property),
          object: objExpr,
          method: "str_" + member.property,
          args: args,
        } as MethodCallExpr;
      }
      // .toString() on non-identifier objects
      if (member.property === "toString") {
        return {
          kind: ExprKind.MethodCall,
          ty: STRING_TYPE,
          object: objExpr,
          method: "toString",
          args: [],
        } as MethodCallExpr;
      }
    }

    // Handle global built-in function calls: Number(), parseInt(), $object_keys(), etc.
    if (expr.callee.kind === AstExprKind.Identifier) {
      const calleeName = (expr.callee as IdentifierExpr).name;
      if (calleeName === "$object_rest") {
        // $object_rest(src, excludeKeys) - create object copy excluding listed keys
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.Call,
          ty: ANY_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$object_rest" } as FuncRefExpr,
          args: args,
        } as CallExpr;
      }
      if (calleeName === "$object_keys") {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.Call,
          ty: ANY_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$object_keys" } as FuncRefExpr,
          args: args,
        } as CallExpr;
      }
      if (calleeName === "Number" || calleeName === "parseFloat") {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.Call,
          ty: NUMBER_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_number_coerce" } as FuncRefExpr,
          args: args,
        } as CallExpr;
      }
      if (calleeName === "parseInt") {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.Call,
          ty: NUMBER_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_parse_int" } as FuncRefExpr,
          args: args,
        } as CallExpr;
      }
      if (calleeName === "String") {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.Call,
          ty: STRING_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$template_to_string" } as FuncRefExpr,
          args: args,
        } as CallExpr;
      }
      if (calleeName === "Boolean") {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.Call,
          ty: BOOLEAN_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_is_truthy" } as FuncRefExpr,
          args: args,
        } as CallExpr;
      }
      if (calleeName === "Array") {
        // Array(n) → create array with n elements (all undefined)
        // For now just return empty array
        return { kind: ExprKind.Array, ty: ANY_TYPE, elements: [] } as ArrayExpr;
      }
      if (calleeName === "isNaN") {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.Call,
          ty: BOOLEAN_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_is_nan" } as FuncRefExpr,
          args: args,
        } as CallExpr;
      }
      if (calleeName === "isFinite") {
        const args: Array<Expr> = [];
        for (let i = 0; i < expr.args.length; i = i + 1) {
          args.push(this.lowerExpr(expr.args[i]));
        }
        return {
          kind: ExprKind.Call,
          ty: BOOLEAN_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "js_is_finite" } as FuncRefExpr,
          args: args,
        } as CallExpr;
      }
      if (calleeName === "perryResolveStaticPlugin") {
        // Perry built-in: always returns undefined (no bundled plugins in anvil)
        return { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE } as UndefinedExpr;
      }
    }

    // Regular function call
    const callee = this.lowerExpr(expr.callee);
    const args: Array<Expr> = [];

    // Check if callee has rest params
    let restIdx = -1;
    if (expr.callee.kind === AstExprKind.Identifier) {
      const callName = (expr.callee as IdentifierExpr).name;
      const ri = this.restParamFuncs.get(callName);
      if (ri !== undefined) {
        restIdx = ri;
      }
    }

    if (restIdx >= 0) {
      // Pack regular args before rest index
      for (let i = 0; i < restIdx && i < expr.args.length; i = i + 1) {
        args.push(this.lowerExpr(expr.args[i]));
      }
      // Pack rest args into an array literal
      const restElements: Array<Expr> = [];
      for (let i = restIdx; i < expr.args.length; i = i + 1) {
        restElements.push(this.lowerExpr(expr.args[i]));
      }
      args.push({ kind: ExprKind.Array, ty: ANY_TYPE, elements: restElements } as ArrayExpr);
    } else {
      for (let i = 0; i < expr.args.length; i = i + 1) {
        args.push(this.lowerExpr(expr.args[i]));
      }
    }

    // Infer return type from the callee
    let callRetType: Type = ANY_TYPE;
    if (expr.callee.kind === AstExprKind.Identifier) {
      const name = (expr.callee as IdentifierExpr).name;
      callRetType = this.lookupFuncReturnType(name);
    }

    return { kind: ExprKind.Call, ty: callRetType, callee: callee, args: args } as CallExpr;
  }

  private isArrayMethod(name: string): boolean {
    return name === "push" || name === "pop" || name === "shift" || name === "unshift" ||
           name === "indexOf" || name === "includes" ||
           name === "slice" || name === "splice" || name === "concat" ||
           name === "join" || name === "reverse" || name === "sort" ||
           name === "map" || name === "filter" || name === "reduce" ||
           name === "forEach" || name === "find" || name === "findIndex" ||
           name === "every" || name === "some";
  }

  private isMapMethod(name: string): boolean {
    return name === "set" || name === "get" || name === "has" ||
           name === "delete" || name === "size" || name === "clear";
  }

  private isSetMethod(name: string): boolean {
    return name === "add" || name === "has" || name === "delete" ||
           name === "size" || name === "clear";
  }

  private isStringMethod(name: string): boolean {
    return name === "indexOf" || name === "slice" || name === "trim" ||
           name === "charAt" || name === "charCodeAt" || name === "split" ||
           name === "startsWith" || name === "endsWith" || name === "includes" ||
           name === "replace" || name === "toUpperCase" || name === "toLowerCase" ||
           name === "substring" || name === "match";
  }

  private stringMethodReturnType(name: string): Type {
    // Methods that return strings
    if (name === "slice" || name === "trim" || name === "charAt" ||
        name === "replace" || name === "toUpperCase" || name === "toLowerCase" ||
        name === "substring") {
      return STRING_TYPE;
    }
    // Methods that return numbers
    if (name === "indexOf" || name === "charCodeAt") {
      return NUMBER_TYPE;
    }
    // Methods that return booleans
    if (name === "startsWith" || name === "endsWith" || name === "includes") {
      return BOOLEAN_TYPE;
    }
    return ANY_TYPE;
  }

  private resolveMathConstant(name: string): number | null {
    if (name === "PI") return 3.141592653589793;
    if (name === "E") return 2.718281828459045;
    if (name === "LN2") return 0.6931471805599453;
    if (name === "LN10") return 2.302585092994046;
    if (name === "LOG2E") return 1.4426950408889634;
    if (name === "LOG10E") return 0.4342944819032518;
    if (name === "SQRT2") return 1.4142135623730951;
    if (name === "SQRT1_2") return 0.7071067811865476;
    return null;
  }

  private resolveDateMethod(methodName: string): string | null {
    if (methodName === "getTime") return "js_date_get_time";
    if (methodName === "getFullYear") return "js_date_get_full_year";
    if (methodName === "getMonth") return "js_date_get_month";
    if (methodName === "getDate") return "js_date_get_date";
    if (methodName === "getHours") return "js_date_get_hours";
    if (methodName === "getMinutes") return "js_date_get_minutes";
    if (methodName === "getSeconds") return "js_date_get_seconds";
    if (methodName === "getMilliseconds") return "js_date_get_milliseconds";
    if (methodName === "toISOString") return "js_date_to_iso_string";
    return null;
  }

  private resolveBuiltinCall(objName: string, methodName: string, argCount: number): string | null {
    if (objName === "console" && methodName === "log") {
      return "js_console_log_dynamic";
    }
    if (objName === "console" && methodName === "error") {
      return "js_console_error_dynamic";
    }
    if (objName === "console" && methodName === "warn") {
      return "js_console_warn_dynamic";
    }
    if (objName === "Math") {
      if (methodName === "floor") return "llvm.floor.f64";
      if (methodName === "ceil") return "llvm.ceil.f64";
      if (methodName === "round") return "llvm.roundeven.f64";
      if (methodName === "abs") return "llvm.fabs.f64";
      if (methodName === "sqrt") return "llvm.sqrt.f64";
      if (methodName === "pow") return "js_math_pow";
      if (methodName === "min") return "llvm.minnum.f64";
      if (methodName === "max") return "llvm.maxnum.f64";
      if (methodName === "random") return "js_math_random";
      if (methodName === "log") return "js_math_log";
    }
    if (objName === "process" && methodName === "exit") {
      return "js_process_exit";
    }
    if (objName === "process" && methodName === "cwd") {
      return "pd_process_cwd";
    }
    if (objName === "String" && methodName === "fromCharCode") {
      return "js_string_from_char_code";
    }
    if (objName === "fs") {
      if (methodName === "readFileSync") return "pd_fs_read_file_sync";
      if (methodName === "writeFileSync") return "pd_fs_write_file_sync";
      if (methodName === "existsSync") return "pd_fs_exists_sync";
      if (methodName === "unlinkSync") return "pd_fs_unlink_sync";
    }
    if (objName === "path") {
      if (methodName === "resolve") return "pd_path_resolve";
      if (methodName === "dirname") return "pd_path_dirname";
      if (methodName === "basename") return "pd_path_basename";
      if (methodName === "join") return "pd_path_join";
      if (methodName === "relative") return "pd_path_relative";
      if (methodName === "extname") return "pd_path_extname";
      if (methodName === "normalize") return "pd_path_normalize";
      if (methodName === "isAbsolute") return "pd_path_is_absolute";
    }
    if (objName === "Object" && methodName === "keys") {
      return "$object_keys";
    }
    if (objName === "Object" && methodName === "values") {
      return "$object_values";
    }
    if (objName === "Object" && methodName === "entries") {
      return "$object_entries";
    }
    if (objName === "Object" && methodName === "assign") {
      return "js_object_assign";
    }
    if (objName === "Object" && methodName === "freeze") {
      return "js_object_freeze";
    }
    if (objName === "Date" && methodName === "now") {
      return "js_date_now";
    }
    if (objName === "Array" && methodName === "isArray") {
      return "js_array_is_array";
    }
    if (objName === "Number" && methodName === "isNaN") {
      return "js_number_is_nan";
    }
    if (objName === "Number" && methodName === "isFinite") {
      return "js_number_is_finite";
    }
    if (objName === "JSON" && methodName === "stringify") {
      return "js_json_stringify";
    }
    if (objName === "JSON" && methodName === "parse") {
      return "js_json_parse";
    }
    return null;
  }

  private lowerMember(expr: MemberExprAst): Expr {
    // Handle optional chaining: x?.y -> (x !== null && x !== undefined) ? x.y : undefined
    if (expr.optional) {
      const objExpr = this.lowerExpr(expr.object);
      // Create a non-optional version for the then branch
      const nonOptExpr: MemberExprAst = {
        kind: AstExprKind.Member,
        line: expr.line,
        col: expr.col,
        object: expr.object,
        property: expr.property,
        optional: false,
      };
      const thenExpr = this.lowerMember(nonOptExpr);
      const undefExpr: UndefinedExpr = { kind: ExprKind.Undefined, ty: UNDEFINED_TYPE };
      // Check: obj !== undefined && obj !== null
      const checkUndef: CompareExpr = { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.StrictNe, left: objExpr, right: undefExpr };
      const nullExpr: NullExpr = { kind: ExprKind.Null, ty: NULL_TYPE };
      const checkNull: CompareExpr = { kind: ExprKind.Compare, ty: BOOLEAN_TYPE, op: CompareOp.StrictNe, left: objExpr, right: nullExpr };
      const condition: LogicalExpr = { kind: ExprKind.Logical, ty: BOOLEAN_TYPE, op: LogicalOp.And, left: checkUndef, right: checkNull };
      return { kind: ExprKind.If, ty: ANY_TYPE, condition: condition, thenExpr: thenExpr, elseExpr: undefExpr } as IfExpr;
    }

    // Handle process.env.X -> js_getenv("X")
    if (expr.object.kind === AstExprKind.Member) {
      const innerMember = expr.object as MemberExprAst;
      if (innerMember.object.kind === AstExprKind.Identifier) {
        const ident = innerMember.object as IdentifierExpr;
        if (ident.name === "process" && innerMember.property === "env") {
          // process.env.X -> call js_getenv with string "X"
          const envName: StringExpr = { kind: ExprKind.String, ty: STRING_TYPE, value: expr.property };
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$getenv" } as FuncRefExpr,
            args: [envName],
          } as CallExpr;
        }
      }
    }

    // Handle process.argv -> js_process_get_argv()
    if (expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      if (ident.name === "process" && expr.property === "argv") {
        return {
          kind: ExprKind.Call,
          ty: ANY_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "pd_process_get_argv" } as FuncRefExpr,
          args: [],
        } as CallExpr;
      }
    }

    // Handle Math constants: Math.PI, Math.E, etc.
    if (expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      if (ident.name === "Math") {
        const mathConst = this.resolveMathConstant(expr.property);
        if (mathConst !== null) {
          return { kind: ExprKind.Number, ty: NUMBER_TYPE, value: mathConst } as NumberExpr;
        }
      }
    }

    // Handle enum member access: EnumName.Member -> number or string constant
    if (expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      const enumVal = this.lookupEnumValue(ident.name, expr.property);
      if (enumVal !== null) {
        return { kind: ExprKind.Number, ty: NUMBER_TYPE, value: enumVal } as NumberExpr;
      }
      const strEnumVal = this.lookupStringEnumValue(ident.name, expr.property);
      if (strEnumVal !== null) {
        return { kind: ExprKind.String, ty: STRING_TYPE, value: strEnumVal } as StringExpr;
      }
    }

    // Handle static member access: ClassName.prop -> GlobalGet
    if (expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      const staticKey = ident.name + "." + expr.property;
      const staticGlobal = this.staticMembers.get(staticKey);
      if (staticGlobal !== undefined) {
        const sTy = this.staticMemberTypes.get(staticKey);
        return { kind: ExprKind.GlobalGet, ty: sTy !== undefined ? sTy : ANY_TYPE, name: staticGlobal } as GlobalGetExpr;
      }
    }

    // Handle .length on arrays and strings -> MethodCall with no args
    if (expr.property === "length" && expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      const ty = this.lookupLocalType(ident.name);
      if (ty.kind === TypeKind.Array || ty.kind === TypeKind.Any) {
        const obj = this.lowerExpr(expr.object);
        return {
          kind: ExprKind.MethodCall,
          ty: NUMBER_TYPE,
          object: obj,
          method: "length",
          args: [],
        } as MethodCallExpr;
      }
      if (ty.kind === TypeKind.String) {
        const obj = this.lowerExpr(expr.object);
        return {
          kind: ExprKind.MethodCall,
          ty: NUMBER_TYPE,
          object: obj,
          method: "str_length",
          args: [],
        } as MethodCallExpr;
      }
    }

    // Handle .length on non-identifier expressions (e.g., obj.arr.length)
    if (expr.property === "length" && expr.object.kind !== AstExprKind.Identifier) {
      const obj = this.lowerExpr(expr.object);
      return {
        kind: ExprKind.MethodCall,
        ty: NUMBER_TYPE,
        object: obj,
        method: "length",
        args: [],
      } as MethodCallExpr;
    }

    // Handle .size on maps -> MethodCall with no args
    if (expr.property === "size" && expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      const ty = this.lookupLocalType(ident.name);
      if (ty.kind === TypeKind.Object && (ty as ObjectType).isMap) {
        const obj = this.lowerExpr(expr.object);
        return {
          kind: ExprKind.MethodCall,
          ty: NUMBER_TYPE,
          object: obj,
          method: "size",
          args: [],
        } as MethodCallExpr;
      }
      if (ty.kind === TypeKind.Object && (ty as ObjectType).isSet) {
        const obj = this.lowerExpr(expr.object);
        return {
          kind: ExprKind.MethodCall,
          ty: NUMBER_TYPE,
          object: obj,
          method: "set_size",
          args: [],
        } as MethodCallExpr;
      }
    }

    // Check for getter: if the object is a class instance with a getter for this property, call it
    let getterClassName: string | null = null;
    if (expr.object.kind === AstExprKind.Identifier) {
      getterClassName = this.lookupVarClass((expr.object as IdentifierExpr).name);
    } else if (expr.object.kind === AstExprKind.This) {
      getterClassName = this.lookupVarClass("this");
    }
    if (getterClassName !== null) {
      const getterClassInfo = this.lookupClassInfo(getterClassName);
      if (getterClassInfo !== null) {
        const getterFunc = getterClassInfo.getters.get(expr.property);
        if (getterFunc !== undefined) {
          const getterFuncId = this.lookupFunction(getterFunc);
          const getterObj = this.lowerExpr(expr.object);
          return {
            kind: ExprKind.Call,
            ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: getterFuncId !== null ? getterFuncId : 0, name: getterFunc } as FuncRefExpr,
            args: [getterObj],
          } as CallExpr;
        }
      }
    }

    const obj = this.lowerExpr(expr.object);
    // Property access -> field get with compile-time field index
    let fieldIndex = 0;
    if (expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      fieldIndex = this.lookupFieldIndex(ident.name, expr.property);
    } else if (expr.object.kind === AstExprKind.This) {
      fieldIndex = this.lookupFieldIndex("this", expr.property);
    } else if (expr.object.kind === AstExprKind.TypeAs) {
      // Type assertion: (expr as SomeType).field -> use the cast type for field resolution
      const typeAs = expr.object as TypeAsExprAst;
      if (typeAs.typeNode.kind === TypeNodeKind.Named) {
        const castTypeName = (typeAs.typeNode as NamedTypeNode).name;
        const layout = this.interfaceLayouts.get(castTypeName);
        if (layout !== undefined) {
          const idx = layout.get(expr.property);
          if (idx !== undefined) fieldIndex = idx;
        }
        const ci = this.lookupClassInfo(castTypeName);
        if (ci !== null) {
          const idx2 = ci.fieldMap.get(expr.property);
          if (idx2 !== undefined) fieldIndex = idx2;
        }
      }
    } else if (expr.object.kind === AstExprKind.Paren) {
      // Parenthesized expression: unwrap and resolve type
      const inner = (expr.object as ParenExprAst).expr;
      if (inner.kind === AstExprKind.TypeAs) {
        const typeAs2 = inner as TypeAsExprAst;
        if (typeAs2.typeNode.kind === TypeNodeKind.Named) {
          const castTypeName2 = (typeAs2.typeNode as NamedTypeNode).name;
          const layout2 = this.interfaceLayouts.get(castTypeName2);
          if (layout2 !== undefined) {
            const idx3 = layout2.get(expr.property);
            if (idx3 !== undefined) fieldIndex = idx3;
          }
          const ci2 = this.lookupClassInfo(castTypeName2);
          if (ci2 !== null) {
            const idx4 = ci2.fieldMap.get(expr.property);
            if (idx4 !== undefined) fieldIndex = idx4;
          }
        }
      } else {
        const typeName3 = this.resolveExprTypeName(inner);
        if (typeName3 !== null) {
          const layout3 = this.interfaceLayouts.get(typeName3);
          if (layout3 !== undefined) {
            const idx5 = layout3.get(expr.property);
            if (idx5 !== undefined) fieldIndex = idx5;
          }
        }
      }
    } else if (expr.object.kind === AstExprKind.Member || expr.object.kind === AstExprKind.Call || expr.object.kind === AstExprKind.Index) {
      // Chained member access, method call result, or array element: resolve the type of the intermediate expression
      const typeName = this.resolveExprTypeName(expr.object);
      if (typeName !== null) {
        const layout = this.interfaceLayouts.get(typeName);
        if (layout !== undefined) {
          const idx = layout.get(expr.property);
          if (idx !== undefined) fieldIndex = idx;
        }
        // Also check class field maps
        const ci = this.lookupClassInfo(typeName);
        if (ci !== null) {
          const idx2 = ci.fieldMap.get(expr.property);
          if (idx2 !== undefined) fieldIndex = idx2;
        }
      }
    }
    // If object is any-typed AND (no known field layout OR field not in layout), use dynamic by-name access
    if (expr.object.kind === AstExprKind.Identifier) {
      const idCheck = expr.object as IdentifierExpr;
      const typeCheck = this.lookupLocalType(idCheck.name);
      if (typeCheck.kind === TypeKind.Any && (this.lookupFieldLayout(idCheck.name) === null || fieldIndex === 9999)) {
        const keyStr: StringExpr = { kind: ExprKind.String, ty: STRING_TYPE, value: expr.property };
        return {
          kind: ExprKind.Call,
          ty: ANY_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$dynamic_get_property" } as FuncRefExpr,
          args: [obj, keyStr],
        } as CallExpr;
      }
    }
    return {
      kind: ExprKind.FieldGet,
      ty: ANY_TYPE,
      object: obj,
      field: expr.property,
      fieldIndex: fieldIndex,
    } as FieldGetExpr;
  }

  private lowerIndex(expr: IndexExprAst): Expr {
    // Check if the object is a Map/Record — use Map.get instead of array indexing
    if (expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      const varType = this.lookupLocalType(ident.name);
      if (varType.kind === TypeKind.Object && (varType as ObjectType).isMap) {
        const obj = this.lowerExpr(expr.object);
        const key = this.lowerExpr(expr.index);
        return { kind: ExprKind.MethodCall, ty: ANY_TYPE, object: obj, method: "get", args: [key] } as MethodCallExpr;
      }
    }
    // Check if the object is known to be an array
    let isArray = false;
    if (expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      const varType = this.lookupLocalType(ident.name);
      if (varType.kind === TypeKind.Array) {
        isArray = true;
      }
    }

    // Check if the index is a string expression (not a number)
    const isStringIndex = this.isStringExpression(expr.index);

    const obj = this.lowerExpr(expr.object);
    const index = this.lowerExpr(expr.index);

    // If index is a string and object is not a known array, use dynamic property access
    if (isStringIndex && !isArray) {
      return {
        kind: ExprKind.Call,
        ty: ANY_TYPE,
        callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$dynamic_get_property" } as FuncRefExpr,
        args: [obj, index],
      } as CallExpr;
    }

    // Infer element type from the array's type
    let elemType: Type = ANY_TYPE;
    if (expr.object.kind === AstExprKind.Identifier) {
      const ident = expr.object as IdentifierExpr;
      const arrType = this.lookupLocalType(ident.name);
      if (arrType.kind === TypeKind.Array) {
        elemType = (arrType as ArrayType).elementType;
      }
    }
    return { kind: ExprKind.ArrayGet, ty: elemType, array: obj, index: index } as ArrayGetExpr;
  }

  private lowerAssign(expr: AssignExprAst): Expr {
    const value = this.lowerExpr(expr.value);

    // Simple local assignment: x = expr
    if (expr.target.kind === AstExprKind.Identifier) {
      const ident = expr.target as IdentifierExpr;
      // Module-level variable assignment from within a function
      if (this.inFunction && this.moduleLocals.has(ident.name)) {
        this.addModuleGlobal(ident.name);
        if (this.moduleBoxedVars.has(ident.name)) {
          return this.makeBoxSet({ kind: ExprKind.GlobalGet, ty: ANY_TYPE, name: ident.name } as GlobalGetExpr, value);
        }
        return { kind: ExprKind.GlobalSet, ty: value.ty, name: ident.name, value: value } as GlobalSetExpr;
      }
      // Check capture-aware lookup for closure variables
      const captureResult = this.lookupLocalCaptureAware(ident.name);
      if (captureResult !== null) {
        if (captureResult[1]) {
          // Writing to a captured variable
          // If the capture is a box, write through the box
          if (this.boxedCaptureNames.has(ident.name)) {
            const capExpr: CaptureGetExpr = { kind: ExprKind.CaptureGet, ty: ANY_TYPE, captureIndex: captureResult[2], closurePtrLocalId: captureResult[3] };
            return this.makeBoxSet(capExpr, value);
          }
          return { kind: ExprKind.CaptureSet, ty: value.ty, captureIndex: captureResult[2], closurePtrLocalId: captureResult[3], value: value } as CaptureSetExpr;
        }
        // If this is a boxed variable, write through the box
        if (this.boxedVars.has(ident.name)) {
          const boxLocal: LocalGetExpr = { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: captureResult[0], name: ident.name };
          return this.makeBoxSet(boxLocal, value);
        }
        return { kind: ExprKind.LocalSet, ty: value.ty, localId: captureResult[0], name: ident.name, value: value } as LocalSetExpr;
      }
      // Create new local
      const newId = this.allocLocal(ident.name);
      return { kind: ExprKind.LocalSet, ty: value.ty, localId: newId, name: ident.name, value: value } as LocalSetExpr;
    }

    // Member assignment: obj.prop = expr
    if (expr.target.kind === AstExprKind.Member) {
      const member = expr.target as MemberExprAst;
      // Check for static member assignment: ClassName.prop = x
      if (member.object.kind === AstExprKind.Identifier) {
        const ident = member.object as IdentifierExpr;
        const staticKey = ident.name + "." + member.property;
        const staticGlobal = this.staticMembers.get(staticKey);
        if (staticGlobal !== undefined) {
          return { kind: ExprKind.GlobalSet, ty: value.ty, name: staticGlobal, value: value } as GlobalSetExpr;
        }
      }
      // Check for setter: if the object is a class instance with a setter for this property, call it
      let setterClassName: string | null = null;
      if (member.object.kind === AstExprKind.Identifier) {
        setterClassName = this.lookupVarClass((member.object as IdentifierExpr).name);
      } else if (member.object.kind === AstExprKind.This) {
        setterClassName = this.lookupVarClass("this");
      }
      if (setterClassName !== null) {
        const setterClassInfo = this.lookupClassInfo(setterClassName);
        if (setterClassInfo !== null) {
          const setterFunc = setterClassInfo.setters.get(member.property);
          if (setterFunc !== undefined) {
            const setterFuncId = this.lookupFunction(setterFunc);
            const setterObj = this.lowerExpr(member.object);
            return {
              kind: ExprKind.Call,
              ty: value.ty,
              callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: setterFuncId !== null ? setterFuncId : 0, name: setterFunc } as FuncRefExpr,
              args: [setterObj, value],
            } as CallExpr;
          }
        }
      }
      const obj = this.lowerExpr(member.object);
      let fieldIndex = 0;
      if (member.object.kind === AstExprKind.Identifier) {
        const ident = member.object as IdentifierExpr;
        fieldIndex = this.lookupFieldIndex(ident.name, member.property);
      } else if (member.object.kind === AstExprKind.This) {
        fieldIndex = this.lookupFieldIndex("this", member.property);
      } else if (member.object.kind === AstExprKind.TypeAs) {
        const typeAs = member.object as TypeAsExprAst;
        if (typeAs.typeNode.kind === TypeNodeKind.Named) {
          const castName = (typeAs.typeNode as NamedTypeNode).name;
          const layout = this.interfaceLayouts.get(castName);
          if (layout !== undefined) {
            const idx = layout.get(member.property);
            if (idx !== undefined) fieldIndex = idx;
          }
          const ci = this.lookupClassInfo(castName);
          if (ci !== null) {
            const idx2 = ci.fieldMap.get(member.property);
            if (idx2 !== undefined) fieldIndex = idx2;
          }
        }
      } else if (member.object.kind === AstExprKind.Member || member.object.kind === AstExprKind.Call) {
        const typeName = this.resolveExprTypeName(member.object);
        if (typeName !== null) {
          const layout = this.interfaceLayouts.get(typeName);
          if (layout !== undefined) {
            const idx = layout.get(member.property);
            if (idx !== undefined) fieldIndex = idx;
          }
          const ci = this.lookupClassInfo(typeName);
          if (ci !== null) {
            const idx2 = ci.fieldMap.get(member.property);
            if (idx2 !== undefined) fieldIndex = idx2;
          }
        }
      }
      // If object is any-typed AND (no known field layout OR field not in layout), use dynamic by-name set
      if (member.object.kind === AstExprKind.Identifier) {
        const idCheck2 = member.object as IdentifierExpr;
        const typeCheck2 = this.lookupLocalType(idCheck2.name);
        if (typeCheck2.kind === TypeKind.Any && (this.lookupFieldLayout(idCheck2.name) === null || fieldIndex === 9999)) {
          const keyStr2: StringExpr = { kind: ExprKind.String, ty: STRING_TYPE, value: member.property };
          return {
            kind: ExprKind.Call,
            ty: value.ty,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$dynamic_set_property" } as FuncRefExpr,
            args: [obj, keyStr2, value],
          } as CallExpr;
        }
      }
      return {
        kind: ExprKind.FieldSet,
        ty: value.ty,
        object: obj,
        field: member.property,
        fieldIndex: fieldIndex,
        value: value,
      } as FieldSetExpr;
    }

    // Index assignment: arr[i] = expr
    if (expr.target.kind === AstExprKind.Index) {
      const idx = expr.target as IndexExprAst;
      // Check if the object is a Map/Record — use Map.set instead of array indexing
      if (idx.object.kind === AstExprKind.Identifier) {
        const idxIdent = idx.object as IdentifierExpr;
        const varType = this.lookupLocalType(idxIdent.name);
        if (varType.kind === TypeKind.Object && (varType as ObjectType).isMap) {
          const mapObj = this.lowerExpr(idx.object);
          const key = this.lowerExpr(idx.index);
          return { kind: ExprKind.MethodCall, ty: value.ty, object: mapObj, method: "set", args: [key, value] } as MethodCallExpr;
        }
      }

      // Check for string index on non-array (dynamic property set)
      let isArray = false;
      if (idx.object.kind === AstExprKind.Identifier) {
        const idxIdent2 = idx.object as IdentifierExpr;
        const varType2 = this.lookupLocalType(idxIdent2.name);
        if (varType2.kind === TypeKind.Array) {
          isArray = true;
        }
      }
      const isStringIdx = this.isStringExpression(idx.index);
      if (isStringIdx && !isArray) {
        const obj = this.lowerExpr(idx.object);
        const key = this.lowerExpr(idx.index);
        return {
          kind: ExprKind.Call,
          ty: value.ty,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$dynamic_set_property" } as FuncRefExpr,
          args: [obj, key, value],
        } as CallExpr;
      }

      const arr = this.lowerExpr(idx.object);
      const index = this.lowerExpr(idx.index);
      return {
        kind: ExprKind.ArraySet,
        ty: value.ty,
        array: arr,
        index: index,
        value: value,
      } as ArraySetExpr;
    }

    throw new Error("Cannot assign to expression kind: " + expr.target.kind);
  }

  private lowerCompoundAssign(expr: CompoundAssignExprAst): Expr {
    // x += y => x = x + y
    let binOp: string;
    if (expr.op === "+=") binOp = "+";
    else if (expr.op === "-=") binOp = "-";
    else if (expr.op === "*=") binOp = "*";
    else if (expr.op === "/=") binOp = "/";
    else if (expr.op === "%=") binOp = "%";
    else if (expr.op === "&=") binOp = "&";
    else if (expr.op === "|=") binOp = "|";
    else if (expr.op === "^=") binOp = "^";
    else if (expr.op === "<<=") binOp = "<<";
    else if (expr.op === ">>=") binOp = ">>";
    else if (expr.op === ">>>=") binOp = ">>>";
    else if (expr.op === "**=") binOp = "**";
    else if (expr.op === "??=") {
      // target ??= value => target = target ?? value
      const binExpr: BinaryExprAst = {
        kind: AstExprKind.Binary,
        line: expr.line,
        col: expr.col,
        op: "??",
        left: expr.target,
        right: expr.value,
      };
      const assignExpr: AssignExprAst = {
        kind: AstExprKind.Assign,
        line: expr.line,
        col: expr.col,
        target: expr.target,
        value: binExpr,
      };
      return this.lowerAssign(assignExpr);
    }
    else {
      throw new Error("Unknown compound assignment: " + expr.op);
    }

    const binExpr: BinaryExprAst = {
      kind: AstExprKind.Binary,
      line: expr.line,
      col: expr.col,
      op: binOp,
      left: expr.target,
      right: expr.value,
    };

    const assignExpr: AssignExprAst = {
      kind: AstExprKind.Assign,
      line: expr.line,
      col: expr.col,
      target: expr.target,
      value: binExpr,
    };

    return this.lowerAssign(assignExpr);
  }

  // --- Type resolution ---

  private resolveType(node: TypeNode): Type {
    if (node.kind === TypeNodeKind.Named) {
      const named = node as NamedTypeNode;
      if (named.name === "number") return NUMBER_TYPE;
      if (named.name === "string") return STRING_TYPE;
      if (named.name === "boolean") return BOOLEAN_TYPE;
      if (named.name === "void") return VOID_TYPE;
      if (named.name === "undefined") return UNDEFINED_TYPE;
      if (named.name === "null") return NULL_TYPE;
      if (named.name === "any") return ANY_TYPE;
      if (named.name === "never") return { kind: TypeKind.Never };
      // Check if it's a known interface type
      if (this.interfaceLayouts.has(named.name)) {
        const ty: ObjectType = makeObjectType(new Map());
        ty.interfaceName = named.name;
        return ty;
      }
      // Check if it's a known class type
      const classInfo = this.lookupClassInfo(named.name);
      if (classInfo !== null) {
        const ty: ObjectType = makeObjectType(new Map());
        ty.interfaceName = named.name;
        return ty;
      }
      // Unknown named type -> treat as any
      return ANY_TYPE;
    }
    if (node.kind === TypeNodeKind.Array) {
      const arr = node as ArrayTypeNode;
      return makeArrayType(this.resolveType(arr.elementType));
    }
    if (node.kind === TypeNodeKind.Generic) {
      const gen = node as GenericTypeNode;
      if (gen.name === "Array" && gen.typeArgs.length === 1) {
        return makeArrayType(this.resolveType(gen.typeArgs[0]));
      }
      if (gen.name === "Map" || gen.name === "Record") {
        const mapType: ObjectType = makeObjectType(new Map());
        mapType.isMap = true;
        return mapType;
      }
      if (gen.name === "Set") {
        const setType: ObjectType = makeObjectType(new Map());
        setType.isSet = true;
        return setType;
      }
      // Check if it's a known class type (e.g., Box<U> -> ObjectType with interfaceName "Box")
      // Also check for constructor function (ClassName$new) since classInfos may not be
      // populated yet during preRegisterClass
      const classInfo = this.lookupClassInfo(gen.name);
      const ctorFunc = this.lookupFunction(gen.name + "$new");
      if (classInfo !== null || ctorFunc !== null) {
        const objType: ObjectType = makeObjectType(new Map());
        objType.interfaceName = gen.name;
        return objType;
      }
      return ANY_TYPE;
    }
    if (node.kind === TypeNodeKind.Union) {
      const union = node as UnionTypeNode;
      const members: Array<Type> = [];
      for (let i = 0; i < union.members.length; i = i + 1) {
        const unionMember: TypeNode = union.members[i] as TypeNode;
        members.push(this.resolveType(unionMember));
      }
      return makeUnionType(members);
    }
    if (node.kind === TypeNodeKind.Function) {
      return ANY_TYPE; // Function types are complex, treat as any for now
    }
    if ((node.kind as number) === 9) { // TypeNodeKind.ObjectLiteral
      const objNode = node as ObjectLiteralTypeNode;
      const ty: ObjectType = makeObjectType(new Map());
      // Generate a synthetic interface name to track layout
      const syntheticName = "__obj_" + this.nextFuncId + "_" + objNode.members.length;
      this.nextFuncId = this.nextFuncId + 1;
      ty.interfaceName = syntheticName;
      // Register the layout as an interface
      const layout: Map<string, number> = new Map();
      const fieldOrder: Array<string> = [];
      for (let i = 0; i < objNode.members.length; i = i + 1) {
        layout.set(objNode.members[i][0], i);
        fieldOrder.push(objNode.members[i][0]);
      }
      this.interfaceLayouts.set(syntheticName, layout);
      this.interfaceFieldOrder.set(syntheticName, fieldOrder);
      return ty;
    }
    return ANY_TYPE;
  }

  // --- Scope management ---

  private pushScope(): void {
    this.scope = { locals: new Map(), localTypes: new Map(), functions: new Map(), funcReturnTypes: new Map(), fieldLayouts: new Map(), enumValues: new Map(), stringEnumValues: new Map(), classInfos: new Map(), varClassMap: new Map(), isClosureBoundary: false, closurePtrLocalId: -1, closureCaptures: null, parent: this.scope };
  }

  private lookupFuncReturnType(name: string): Type {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const ty = scope.funcReturnTypes.get(name);
      if (ty !== undefined) return ty;
      scope = scope.parent;
    }
    return ANY_TYPE;
  }

  private popScope(): void {
    if (this.scope.parent !== null) {
      this.scope = this.scope.parent;
    }
  }

  private addModuleGlobal(name: string): void {
    // Add to globals list if not already present
    let found = false;
    for (let i = 0; i < this.moduleGlobalsList.length; i = i + 1) {
      if (this.moduleGlobalsList[i] === name) { found = true; break; }
    }
    if (!found) {
      let arr = this.moduleGlobalsList;
      arr.push(name);
      this.moduleGlobalsList = arr;
    }
  }

  private allocLocal(name: string, ty: Type = ANY_TYPE): number {
    const id = this.nextLocalId;
    this.nextLocalId = this.nextLocalId + 1;
    this.scope.locals.set(name, id);
    this.scope.localTypes.set(name, ty);
    return id;
  }

  private lookupLocal(name: string): number | null {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const id = scope.locals.get(name);
      if (id !== undefined) return id;
      scope = scope.parent;
    }
    return null;
  }

  // Check if an AST expression produces a string value (for dynamic property access dispatch)
  private isStringExpression(expr: AstExpr): boolean {
    if (expr.kind === AstExprKind.String) return true;
    if (expr.kind === AstExprKind.Template) return true;
    if (expr.kind === AstExprKind.Binary) {
      const bin = expr as BinaryExprAst;
      if (bin.op === "+") {
        // string + anything or anything + string = string
        return this.isStringExpression(bin.left) || this.isStringExpression(bin.right);
      }
    }
    if (expr.kind === AstExprKind.Identifier) {
      const name = (expr as IdentifierExpr).name;
      const ty = this.lookupLocalType(name);
      return ty.kind === TypeKind.String;
    }
    return false;
  }

  private lookupLocalType(name: string): Type {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const ty = scope.localTypes.get(name);
      if (ty !== undefined) return ty;
      scope = scope.parent;
    }
    return ANY_TYPE;
  }

  private preRegisterClass(decl: ClassDeclAst): void {
    // Pre-register constructor and method funcIds so they're available for forward references
    const ctorName = decl.name + "$new";
    const ctorId = this.nextFuncId;
    this.nextFuncId = this.nextFuncId + 1;
    this.scope.functions.set(ctorName, ctorId);
    this.scope.funcReturnTypes.set(ctorName, ANY_TYPE);

    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (member.kind === "method") {
        const prefix = member.isStatic ? decl.name + "$static$" : decl.name + "$";
        const methodName = prefix + member.name;
        const methodId = this.nextFuncId;
        this.nextFuncId = this.nextFuncId + 1;
        this.scope.functions.set(methodName, methodId);
        const retType = member.returnType !== null ? this.resolveType(member.returnType) : ANY_TYPE;
        this.scope.funcReturnTypes.set(methodName, retType);
      }
      if (member.kind === "getter") {
        const getterName = decl.name + "$get$" + member.name;
        const getterId = this.nextFuncId;
        this.nextFuncId = this.nextFuncId + 1;
        this.scope.functions.set(getterName, getterId);
        const retType = member.returnType !== null ? this.resolveType(member.returnType) : ANY_TYPE;
        this.scope.funcReturnTypes.set(getterName, retType);
      }
      if (member.kind === "setter") {
        const setterName = decl.name + "$set$" + member.name;
        const setterId = this.nextFuncId;
        this.nextFuncId = this.nextFuncId + 1;
        this.scope.functions.set(setterName, setterId);
        this.scope.funcReturnTypes.set(setterName, ANY_TYPE);
      }
    }
  }

  private lowerEnum(decl: EnumDeclAst): Stmt | null {
    // Register enum values as compile-time constants
    let nextValue = 0;
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: EnumMemberAst = decl.members[i] as EnumMemberAst;
      const key = decl.name + "." + member.name;
      if (member.initializer !== null && member.initializer.kind === AstExprKind.String) {
        // String enum member
        const strVal = (member.initializer as StringLitExpr).value;
        this.scope.stringEnumValues.set(key, strVal);
      } else {
        if (member.initializer !== null && member.initializer.kind === AstExprKind.Number) {
          nextValue = (member.initializer as NumberLitExpr).value;
        }
        this.scope.enumValues.set(key, nextValue);
        nextValue = nextValue + 1;
      }
    }
    return null; // enums don't emit runtime code
  }

  private lowerClassDecl(decl: ClassDeclAst): void {
    // Collect fields and their indices
    const fieldNames: Array<string> = [];
    const fieldMap: Map<string, number> = new Map();
    const methods: Map<string, string> = new Map();
    let constructorMember: ClassMemberAst | null = null;

    // Inherit parent class fields if this class extends another
    if (decl.superClass !== null) {
      const parentInfo = this.lookupClassInfo(decl.superClass);
      if (parentInfo !== null) {
        // Copy parent fields in order (they get indices 0..N-1)
        for (let pi = 0; pi < parentInfo.fieldNames.length; pi = pi + 1) {
          const pFieldName = parentInfo.fieldNames[pi];
          fieldMap.set(pFieldName, fieldNames.length);
          fieldNames.push(pFieldName);
        }
        // Inherit parent methods
        for (let pi = 0; pi < parentInfo.methodNames.length; pi = pi + 1) {
          const mName = parentInfo.methodNames[pi];
          const mFuncName = parentInfo.methods.get(mName);
          if (mFuncName !== undefined) {
            methods.set(mName, mFuncName);
          }
        }
      }
    }

    const fieldClassTypes: Map<string, string> = new Map();
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (member.kind === "property" && !member.isStatic) {
        fieldMap.set(member.name, fieldNames.length);
        fieldNames.push(member.name);
        // Track class type of field if type annotation is a named type (class reference)
        if (member.typeAnnotation !== null) {
          if (member.typeAnnotation.kind === TypeNodeKind.Named) {
            const namedType = member.typeAnnotation as NamedTypeNode;
            fieldClassTypes.set(member.name, namedType.name);
          }
          // Handle union types like "LLFunction | null" — extract the non-null class name
          if (member.typeAnnotation.kind === TypeNodeKind.Union) {
            const unionType = member.typeAnnotation as UnionTypeNode;
            for (let u = 0; u < unionType.members.length; u = u + 1) {
              const ut: TypeNode = unionType.members[u] as TypeNode;
              if (ut.kind === TypeNodeKind.Named) {
                const uName = (ut as NamedTypeNode).name;
                if (uName !== "null" && uName !== "undefined" && uName !== "string" && uName !== "number" && uName !== "boolean" && uName !== "void") {
                  fieldClassTypes.set(member.name, uName);
                }
              }
            }
          }
        }
      }
      if (member.kind === "constructor") {
        constructorMember = member;
      }
    }

    // Also add constructor params with accessibility modifiers as fields
    if (constructorMember !== null && constructorMember.params !== null) {
      for (let i = 0; i < constructorMember.params.length; i = i + 1) {
        const p: ParamDecl = constructorMember.params[i] as ParamDecl;
        if (p.accessibility !== null && !fieldMap.has(p.name)) {
          fieldMap.set(p.name, fieldNames.length);
          fieldNames.push(p.name);
        }
      }
    }

    // Collect method names for iteration
    const methodNamesList: Array<string> = [];
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const m: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (m.kind === "method" && !m.isStatic) {
        methodNamesList.push(m.name);
      }
    }

    const gettersMap: Map<string, string> = new Map();
    const settersMap: Map<string, string> = new Map();

    const classInfo: ClassInfo = {
      fieldNames: fieldNames,
      fieldMap: fieldMap,
      fieldClassTypes: fieldClassTypes,
      methods: methods,
      methodNames: methodNamesList,
      getters: gettersMap,
      setters: settersMap,
      constructorFunc: null,
      superClass: decl.superClass,
    };

    // Use pre-registered constructor function
    const ctorName = decl.name + "$new";
    const ctorId = this.lookupFunction(ctorName);
    if (ctorId === null) {
      throw new Error("Constructor not pre-registered: " + ctorName);
    }
    classInfo.constructorFunc = ctorName;

    // Register class info before lowering methods (so this.field works)
    this.scope.classInfos.set(decl.name, classInfo);
    // Also store field layout for the class name (for FieldGet/FieldSet on instances)
    this.scope.fieldLayouts.set(decl.name, fieldMap);

    const prevInFunction2 = this.inFunction;
    const prevLocalId2 = this.nextLocalId;
    this.inFunction = true;
    this.nextLocalId = 0;
    this.pushScope();

    // The constructor receives user params. 'this' is allocated inside.
    const ctorParams: Array<[number, string, Type]> = [];
    if (constructorMember !== null && constructorMember.params !== null) {
      for (let i = 0; i < constructorMember.params.length; i = i + 1) {
        const p: ParamDecl = constructorMember.params[i] as ParamDecl;
        const ty = p.typeAnnotation !== null ? this.resolveType(p.typeAnnotation) : ANY_TYPE;
        const localId = this.allocLocal(p.name, ty);
        ctorParams.push([localId, p.name, ty]);
      }
    } else if (decl.superClass !== null) {
      // No explicit constructor but has parent class — inherit parent constructor params
      const parentInfo = this.lookupClassInfo(decl.superClass);
      if (parentInfo !== null && parentInfo.constructorFunc !== null) {
        // Look up parent constructor's params from the already-lowered function
        const parentCtorName = parentInfo.constructorFunc;
        for (let fi = 0; fi < this.functions.length; fi = fi + 1) {
          const fn = this.functions[fi];
          if (fn.name === parentCtorName) {
            for (let pi = 0; pi < fn.params.length; pi = pi + 1) {
              const pp = fn.params[pi];
              const pName = pp[1];
              const pTy = pp[2];
              const localId = this.allocLocal(pName, pTy);
              ctorParams.push([localId, pName, pTy]);
            }
            break;
          }
        }
      }
    }

    // Allocate 'this' as a local - the constructor will alloc the object
    const thisId = this.allocLocal("this", ANY_TYPE);
    // Set field layout and class mapping for 'this' inside the constructor
    this.scope.fieldLayouts.set("this", fieldMap);
    this.scope.varClassMap.set("this", decl.name);

    // Build constructor body:
    // 1. Allocate object: this = js_object_alloc(0, fieldCount)
    // 2. Initialize property defaults
    // 3. Execute constructor body
    // 4. return this
    const ctorBody: Array<Stmt> = [];

    // Allocate object as a call to $object_alloc pseudo-function
    const allocExpr: CallExpr = {
      kind: ExprKind.Call,
      ty: ANY_TYPE,
      callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$object_alloc_" + fieldNames.length } as FuncRefExpr,
      args: [],
    };
    ctorBody.push({
      kind: StmtKind.Let,
      localId: thisId,
      name: "this",
      ty: ANY_TYPE,
      init: allocExpr,
    } as LetStmt);

    // Initialize fields with default values
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (member.kind === "property" && !member.isStatic && member.initializer !== null) {
        const fieldIdx = fieldMap.get(member.name);
        if (fieldIdx !== undefined) {
          const valExpr = this.lowerExpr(member.initializer);
          const setExpr: FieldSetExpr = {
            kind: ExprKind.FieldSet,
            ty: ANY_TYPE,
            object: { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: thisId, name: "this" } as LocalGetExpr,
            field: member.name,
            fieldIndex: fieldIdx,
            value: valExpr,
          };
          ctorBody.push({ kind: StmtKind.Expr, expr: setExpr } as HirExprStmt);
        }
      }
    }

    // For classes with a superclass but no explicit constructor, generate implicit super(...args) call
    if (constructorMember === null && decl.superClass !== null) {
      const parentInfo = this.lookupClassInfo(decl.superClass);
      if (parentInfo !== null) {
        const parentCtorName = decl.superClass + "$new";
        // Build args from our constructor params (which mirror the parent's)
        const superArgs: Array<Expr> = [];
        for (let i = 0; i < ctorParams.length; i = i + 1) {
          superArgs.push({ kind: ExprKind.LocalGet, ty: ctorParams[i][2], localId: ctorParams[i][0], name: ctorParams[i][1] } as LocalGetExpr);
        }
        // Call parent constructor: $super = Parent$new(args...)
        const superLocal = this.allocLocal("$super");
        const parentObj: CallExpr = {
          kind: ExprKind.Call,
          ty: ANY_TYPE,
          callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: parentCtorName } as FuncRefExpr,
          args: superArgs,
        };
        ctorBody.push({
          kind: StmtKind.Let,
          localId: superLocal,
          name: "$super",
          ty: ANY_TYPE,
          init: parentObj,
        } as LetStmt);
        // Copy parent fields: this.field = $super.field
        const thisExpr: LocalGetExpr = { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: thisId, name: "this" };
        const superExpr: LocalGetExpr = { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: superLocal, name: "$super" };
        for (let fi = 0; fi < parentInfo.fieldNames.length; fi = fi + 1) {
          const fName = parentInfo.fieldNames[fi];
          const fIdx = parentInfo.fieldMap.get(fName);
          if (fIdx !== undefined) {
            const getField: FieldGetExpr = { kind: ExprKind.FieldGet, ty: ANY_TYPE, object: superExpr, field: fName, fieldIndex: fIdx };
            const setField: FieldSetExpr = { kind: ExprKind.FieldSet, ty: ANY_TYPE, object: thisExpr, field: fName, fieldIndex: fIdx, value: getField };
            ctorBody.push({ kind: StmtKind.Expr, expr: setField } as HirExprStmt);
          }
        }
      }
    }

    // Initialize fields from constructor params with accessibility modifiers (public/private/protected)
    if (constructorMember !== null && constructorMember.params !== null) {
      for (let i = 0; i < constructorMember.params.length; i = i + 1) {
        const p: ParamDecl = constructorMember.params[i] as ParamDecl;
        if (p.accessibility !== null) {
          const fieldIdx = fieldMap.get(p.name);
          if (fieldIdx !== undefined) {
            const paramLocalId = this.lookupLocal(p.name);
            if (paramLocalId !== null) {
              const setExpr: FieldSetExpr = {
                kind: ExprKind.FieldSet,
                ty: ANY_TYPE,
                object: { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: thisId, name: "this" } as LocalGetExpr,
                field: p.name,
                fieldIndex: fieldIdx,
                value: { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: paramLocalId, name: p.name } as LocalGetExpr,
              };
              ctorBody.push({ kind: StmtKind.Expr, expr: setExpr } as HirExprStmt);
            }
          }
        }
      }
    }

    // Lower constructor body
    if (constructorMember !== null && constructorMember.body !== null) {
      for (let i = 0; i < constructorMember.body.length; i = i + 1) {
        this.pushLoweredStmt(ctorBody, constructorMember.body[i]);
      }
    }

    // Return this
    ctorBody.push({
      kind: StmtKind.Return,
      value: { kind: ExprKind.LocalGet, ty: ANY_TYPE, localId: thisId, name: "this" } as LocalGetExpr,
    } as HirReturnStmt);

    const ctorLocalCount = this.nextLocalId;
    this.popScope();
    this.inFunction = prevInFunction2;
    this.nextLocalId = prevLocalId2;

    let fArr3 = this.functions;
    fArr3.push({
      id: ctorId,
      name: ctorName,
      params: ctorParams,
      returnType: ANY_TYPE,
      body: ctorBody,
      localCount: ctorLocalCount,
      isAsync: false,
    });
    this.functions = fArr3;

    // Pre-populate methods map so all methods are visible during body lowering
    // (fixes forward-reference issue where method A calls method B declared later)
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (member.kind === "method" && !member.isStatic) {
        methods.set(member.name, decl.name + "$" + member.name);
      }
    }

    // Pre-populate and generate getter/setter functions
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (member.kind === "getter" && member.body !== null) {
        const getterFuncName = decl.name + "$get$" + member.name;
        gettersMap.set(member.name, getterFuncName);
        const getterId = this.lookupFunction(getterFuncName);
        if (getterId === null) {
          throw new Error("Getter not pre-registered: " + getterFuncName);
        }

        const prevInFuncG = this.inFunction;
        const prevLocalIdG = this.nextLocalId;
        this.inFunction = true;
        this.nextLocalId = 0;
        this.pushScope();

        const getterThisId = this.allocLocal("this", ANY_TYPE);
        const getterParams: Array<[number, string, Type]> = [[getterThisId, "this", ANY_TYPE]];
        this.scope.fieldLayouts.set("this", fieldMap);
        this.scope.varClassMap.set("this", decl.name);

        const getterBody: Array<Stmt> = [];
        for (let j = 0; j < member.body.length; j = j + 1) {
          this.pushLoweredStmt(getterBody, member.body[j]);
        }

        const getRetType = member.returnType !== null ? this.resolveType(member.returnType) : ANY_TYPE;
        const getterLocalCount = this.nextLocalId;
        this.popScope();
        this.inFunction = prevInFuncG;
        this.nextLocalId = prevLocalIdG;

        let fArrG = this.functions;
        fArrG.push({
          id: getterId,
          name: getterFuncName,
          params: getterParams,
          returnType: getRetType,
          body: getterBody,
          localCount: getterLocalCount,
          isAsync: false,
        });
        this.functions = fArrG;
      }
      if (member.kind === "setter" && member.body !== null) {
        const setterFuncName = decl.name + "$set$" + member.name;
        settersMap.set(member.name, setterFuncName);
        const setterId = this.lookupFunction(setterFuncName);
        if (setterId === null) {
          throw new Error("Setter not pre-registered: " + setterFuncName);
        }

        const prevInFuncS = this.inFunction;
        const prevLocalIdS = this.nextLocalId;
        this.inFunction = true;
        this.nextLocalId = 0;
        this.pushScope();

        const setterThisId = this.allocLocal("this", ANY_TYPE);
        const setterParams: Array<[number, string, Type]> = [[setterThisId, "this", ANY_TYPE]];
        this.scope.fieldLayouts.set("this", fieldMap);
        this.scope.varClassMap.set("this", decl.name);

        if (member.params !== null) {
          for (let j = 0; j < member.params.length; j = j + 1) {
            const p: ParamDecl = member.params[j] as ParamDecl;
            const ty = p.typeAnnotation !== null ? this.resolveType(p.typeAnnotation) : ANY_TYPE;
            const localId = this.allocLocal(p.name, ty);
            setterParams.push([localId, p.name, ty]);
          }
        }

        const setterBody: Array<Stmt> = [];
        for (let j = 0; j < member.body.length; j = j + 1) {
          this.pushLoweredStmt(setterBody, member.body[j]);
        }

        const setterLocalCount = this.nextLocalId;
        this.popScope();
        this.inFunction = prevInFuncS;
        this.nextLocalId = prevLocalIdS;

        let fArrS = this.functions;
        fArrS.push({
          id: setterId,
          name: setterFuncName,
          params: setterParams,
          returnType: ANY_TYPE,
          body: setterBody,
          localCount: setterLocalCount,
          isAsync: false,
        });
        this.functions = fArrS;
      }
    }

    // Generate methods: ClassName$methodName(this, params...)
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (member.kind === "method" && !member.isStatic && member.body !== null) {
        const methodName = decl.name + "$" + member.name;
        const methodId = this.lookupFunction(methodName);
        if (methodId === null) {
          throw new Error("Method not pre-registered: " + methodName);
        }

        const prevInFunc3 = this.inFunction;
        const prevLocalId3 = this.nextLocalId;
        this.inFunction = true;
        this.nextLocalId = 0;
        this.pushScope();

        // 'this' is the first parameter
        const methodThisId = this.allocLocal("this", ANY_TYPE);
        const methodParams: Array<[number, string, Type]> = [[methodThisId, "this", ANY_TYPE]];

        // Store field layout and class mapping for 'this'
        this.scope.fieldLayouts.set("this", fieldMap);
        this.scope.varClassMap.set("this", decl.name);

        if (member.params !== null) {
          for (let j = 0; j < member.params.length; j = j + 1) {
            const p: ParamDecl = member.params[j] as ParamDecl;
            const ty = p.typeAnnotation !== null ? this.resolveType(p.typeAnnotation) : ANY_TYPE;
            const localId = this.allocLocal(p.name, ty);
            methodParams.push([localId, p.name, ty]);
            // Apply interface/class layout for typed parameters (including T | null unions)
            this.applyTypeLayout(p.name, ty);
          }
        }

        const methodBody: Array<Stmt> = [];
        // Handle @log decorator: inject console.log("Calling <name>") at start
        if (member.decorator === "log") {
          const logStr: Expr = { kind: ExprKind.String, ty: STRING_TYPE, value: "Calling " + member.name } as StringExpr;
          const logCall: Expr = {
            kind: ExprKind.Call, ty: ANY_TYPE,
            callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, name: "js_console_log_dynamic" } as FuncRefExpr,
            args: [logStr],
          } as CallExpr;
          methodBody.push({ kind: StmtKind.Expr, expr: logCall } as HirExprStmt);
        }
        for (let j = 0; j < member.body.length; j = j + 1) {
          this.pushLoweredStmt(methodBody, member.body[j]);
        }

        const retType = member.returnType !== null ? this.resolveType(member.returnType) : ANY_TYPE;

        const methodLocalCount = this.nextLocalId;
        this.popScope();
        this.inFunction = prevInFunc3;
        this.nextLocalId = prevLocalId3;

        let fArr4 = this.functions;
        fArr4.push({
          id: methodId,
          name: methodName,
          params: methodParams,
          returnType: retType,
          body: methodBody,
          localCount: methodLocalCount,
          isAsync: false,
        });
        this.functions = fArr4;
      }
    }

    // Register static properties as module globals BEFORE compiling static methods
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (member.kind === "property" && member.isStatic) {
        const globalName = decl.name + "$static$" + member.name;
        const staticKey = decl.name + "." + member.name;
        this.staticMembers.set(staticKey, globalName);
        const memberTy = member.typeAnnotation !== null ? this.resolveType(member.typeAnnotation) : ANY_TYPE;
        this.staticMemberTypes.set(staticKey, memberTy);
        this.addModuleGlobal(globalName);
        if (member.initializer !== null) {
          const initVal = this.lowerExpr(member.initializer);
          this.staticInits.push({
            kind: StmtKind.Expr,
            expr: { kind: ExprKind.GlobalSet, ty: initVal.ty, name: globalName, value: initVal } as GlobalSetExpr,
          } as HirExprStmt);
        }
      }
    }

    // Generate static methods
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: ClassMemberAst = decl.members[i] as ClassMemberAst;
      if (member.kind === "method" && member.isStatic && member.body !== null) {
        const staticMethodName = decl.name + "$static$" + member.name;
        const staticMethodId = this.lookupFunction(staticMethodName);
        if (staticMethodId === null) {
          throw new Error("Static method not pre-registered: " + staticMethodName);
        }

        const prevInFuncS = this.inFunction;
        const prevLocalIdS = this.nextLocalId;
        this.inFunction = true;
        this.nextLocalId = 0;
        this.pushScope();

        const staticParams: Array<[number, string, Type]> = [];
        if (member.params !== null) {
          for (let j = 0; j < member.params.length; j = j + 1) {
            const p: ParamDecl = member.params[j] as ParamDecl;
            const ty = p.typeAnnotation !== null ? this.resolveType(p.typeAnnotation) : ANY_TYPE;
            const localId = this.allocLocal(p.name, ty);
            staticParams.push([localId, p.name, ty]);
          }
        }

        this.scope.classInfos.set(decl.name, classInfo);

        const staticBody: Array<Stmt> = [];
        for (let j = 0; j < member.body.length; j = j + 1) {
          this.pushLoweredStmt(staticBody, member.body[j]);
        }

        const sRetType = member.returnType !== null ? this.resolveType(member.returnType) : ANY_TYPE;

        const staticLocalCount = this.nextLocalId;
        this.popScope();
        this.inFunction = prevInFuncS;
        this.nextLocalId = prevLocalIdS;

        let fArr5 = this.functions;
        fArr5.push({
          id: staticMethodId,
          name: staticMethodName,
          params: staticParams,
          returnType: sRetType,
          body: staticBody,
          localCount: staticLocalCount,
          isAsync: false,
        });
        this.functions = fArr5;
      }
    }
  }

  private lookupClassInfo(name: string): ClassInfo | null {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const info = scope.classInfos.get(name);
      if (info !== undefined) return info;
      scope = scope.parent;
    }
    return null;
  }

  private lookupVarClass(varName: string): string | null {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const cls = scope.varClassMap.get(varName);
      if (cls !== undefined) return cls;
      scope = scope.parent;
    }
    return null;
  }

  // Resolve the class name of an expression (for chained method dispatch)
  // Handles: identifier (via varClassMap), this.field (via fieldClassTypes), new Foo(...)
  private resolveExprClassName(expr: AstExpr): string | null {
    if (expr.kind === AstExprKind.Identifier) {
      return this.lookupVarClass((expr as IdentifierExpr).name);
    }
    if (expr.kind === AstExprKind.Member) {
      const memberExpr = expr as MemberExprAst;
      // For this.field or obj.field, resolve the owner's class and look up field type
      let ownerClass: string | null = null;
      if (memberExpr.object.kind === AstExprKind.This) {
        ownerClass = this.lookupVarClass("this");
      } else if (memberExpr.object.kind === AstExprKind.Identifier) {
        ownerClass = this.lookupVarClass((memberExpr.object as IdentifierExpr).name);
      }
      if (ownerClass !== null) {
        const ownerInfo = this.lookupClassInfo(ownerClass);
        if (ownerInfo !== null) {
          const fieldClass = ownerInfo.fieldClassTypes.get(memberExpr.property);
          if (fieldClass !== undefined) {
            return fieldClass;
          }
        }
      }
    }
    if (expr.kind === AstExprKind.New) {
      const newExpr = expr as NewExprAst;
      if (newExpr.callee.kind === AstExprKind.Identifier) {
        return (newExpr.callee as IdentifierExpr).name;
      }
    }
    return null;
  }

  // Resolve the type name of an expression (for chained field access)
  // Returns the interface/class name of what the expression evaluates to
  private resolveExprTypeName(expr: AstExpr): string | null {
    if (expr.kind === AstExprKind.Identifier) {
      const name = (expr as IdentifierExpr).name;
      // Check variable's interface type
      const ifaceName = this.getInterfaceName(this.lookupLocalType(name));
      if (ifaceName !== null) return ifaceName;
      // Check class mapping
      return this.lookupVarClass(name);
    }
    if (expr.kind === AstExprKind.This) {
      return this.lookupVarClass("this");
    }
    if (expr.kind === AstExprKind.Member) {
      const memberExpr = expr as MemberExprAst;
      // Resolve the owner's type, then look up the field's type
      let ownerTypeName: string | null = null;
      if (memberExpr.object.kind === AstExprKind.This) {
        ownerTypeName = this.lookupVarClass("this");
      } else if (memberExpr.object.kind === AstExprKind.Identifier) {
        const idName = (memberExpr.object as IdentifierExpr).name;
        ownerTypeName = this.lookupVarClass(idName);
        if (ownerTypeName === null) {
          ownerTypeName = this.getInterfaceName(this.lookupLocalType(idName));
        }
      } else {
        // Recursive for deeper chains
        ownerTypeName = this.resolveExprTypeName(memberExpr.object);
      }
      if (ownerTypeName !== null) {
        // Check fieldClassTypes on class info
        const ci = this.lookupClassInfo(ownerTypeName);
        if (ci !== null) {
          const fieldType = ci.fieldClassTypes.get(memberExpr.property);
          if (fieldType !== undefined) return fieldType;
        }
        // Check interface layout for the field — but we need field TYPE, not index
        // Field types aren't tracked in interface layouts; only class fieldClassTypes
      }
      return null;
    }
    if (expr.kind === AstExprKind.Call) {
      const callExpr = expr as CallExprAst;
      if (callExpr.callee.kind === AstExprKind.Member) {
        const callMember = callExpr.callee as MemberExprAst;
        // Look up the return type of the method
        let ownerClassName: string | null = null;
        if (callMember.object.kind === AstExprKind.This) {
          ownerClassName = this.lookupVarClass("this");
        } else if (callMember.object.kind === AstExprKind.Identifier) {
          const idName2 = (callMember.object as IdentifierExpr).name;
          ownerClassName = this.lookupVarClass(idName2);
          if (ownerClassName === null) {
            ownerClassName = this.getInterfaceName(this.lookupLocalType(idName2));
          }
        } else {
          ownerClassName = this.resolveExprTypeName(callMember.object);
        }
        if (ownerClassName !== null) {
          const methodFuncName = ownerClassName + "$" + callMember.property;
          const retType = this.lookupFuncReturnType(methodFuncName);
          const retName = this.getInterfaceName(retType);
          if (retName !== null) return retName;
        }
      }
      // Simple function call
      if (callExpr.callee.kind === AstExprKind.Identifier) {
        const funcName2 = (callExpr.callee as IdentifierExpr).name;
        const retType2 = this.lookupFuncReturnType(funcName2);
        const retName2 = this.getInterfaceName(retType2);
        if (retName2 !== null) return retName2;
      }
      return null;
    }
    if (expr.kind === AstExprKind.New) {
      const newExpr = expr as NewExprAst;
      if (newExpr.callee.kind === AstExprKind.Identifier) {
        return (newExpr.callee as IdentifierExpr).name;
      }
    }
    if (expr.kind === AstExprKind.TypeAs) {
      const typeAs = expr as TypeAsExprAst;
      if (typeAs.typeNode.kind === TypeNodeKind.Named) {
        return (typeAs.typeNode as NamedTypeNode).name;
      }
      return null;
    }
    if (expr.kind === AstExprKind.Paren) {
      return this.resolveExprTypeName((expr as ParenExprAst).expr);
    }
    if (expr.kind === AstExprKind.Index) {
      // Array indexing: resolve element type from array variable's type
      const idxExpr = expr as IndexExprAst;
      if (idxExpr.object.kind === AstExprKind.Identifier) {
        const arrName = (idxExpr.object as IdentifierExpr).name;
        const arrType = this.lookupLocalType(arrName);
        if (arrType.kind === TypeKind.Array) {
          const elemType = (arrType as ArrayType).elementType;
          return this.getInterfaceName(elemType);
        }
      }
    }
    return null;
  }

  private lookupEnumValue(enumName: string, memberName: string): number | null {
    const key = enumName + "." + memberName;
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const val = scope.enumValues.get(key);
      if (val !== undefined) return val;
      scope = scope.parent;
    }
    return null;
  }

  private lookupStringEnumValue(enumName: string, memberName: string): string | null {
    const key = enumName + "." + memberName;
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const val = scope.stringEnumValues.get(key);
      if (val !== undefined) return val;
      scope = scope.parent;
    }
    return null;
  }

  private lookupFieldLayout(varName: string): Map<string, number> | null {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const layout = scope.fieldLayouts.get(varName);
      if (layout !== undefined) return layout;
      scope = scope.parent;
    }
    return null;
  }

  private lookupFieldIndex(varName: string, fieldName: string): number {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const layout = scope.fieldLayouts.get(varName);
      if (layout !== undefined) {
        const idx = layout.get(fieldName);
        if (idx !== undefined) return idx;
        // Layout known but field not in it -> return out-of-bounds index
        // Runtime returns undefined for out-of-bounds field access
        return 9999;
      }
      scope = scope.parent;
    }
    // Fallback: check if the variable has a known interface type (including T | null unions)
    const varType = this.lookupLocalType(varName);
    const ifaceName = this.getInterfaceName(varType);
    if (ifaceName !== null) {
      const ifaceLayout = this.interfaceLayouts.get(ifaceName);
      if (ifaceLayout !== undefined) {
        const idx = ifaceLayout.get(fieldName);
        if (idx !== undefined) return idx;
        return 9999;
      }
    }
    return 0; // fallback to 0 only when no layout is known
  }

  // Extract interface name from a type, handling Union types (T | null)
  private getInterfaceName(ty: Type): string | null {
    if (ty.kind === TypeKind.Object && (ty as ObjectType).interfaceName !== "") {
      return (ty as ObjectType).interfaceName;
    }
    if (ty.kind === TypeKind.Union) {
      const members: Array<Type> = (ty as UnionType).members;
      if (members !== undefined) {
        for (let i = 0; i < members.length; i = i + 1) {
          const m: Type = members[i];
          if (m.kind === TypeKind.Object && (m as ObjectType).interfaceName !== "") {
            return (m as ObjectType).interfaceName;
          }
        }
      }
    }
    return null;
  }

  // Register field layout and class mapping for a variable with an interface/class type
  private applyTypeLayout(varName: string, ty: Type): void {
    const ifaceName = this.getInterfaceName(ty);
    if (ifaceName === null) return;
    const ifaceLayout = this.interfaceLayouts.get(ifaceName);
    if (ifaceLayout !== undefined) {
      this.scope.fieldLayouts.set(varName, ifaceLayout);
    }
    const classInfo = this.lookupClassInfo(ifaceName);
    if (classInfo !== null) {
      this.scope.varClassMap.set(varName, ifaceName);
      this.scope.fieldLayouts.set(varName, classInfo.fieldMap);
    }
  }

  private registerInterfaceFromDecl(decl: InterfaceDeclAst): void {
    const layout: Map<string, number> = new Map();
    let idx = 0;
    // Include parent interface members first (for extends)
    if (decl.extends !== null && decl.extends !== undefined) {
      for (let e = 0; e < decl.extends.length; e = e + 1) {
        const parentName: string = decl.extends[e];
        const parentLayout = this.interfaceLayouts.get(parentName);
        if (parentLayout !== undefined) {
          // Copy parent fields using interfaceFieldOrder
          const parentFields = this.interfaceFieldOrder.get(parentName);
          if (parentFields !== undefined) {
            for (let pk = 0; pk < parentFields.length; pk = pk + 1) {
              const pKey: string = parentFields[pk];
              const pIdx = parentLayout.get(pKey);
              if (pIdx !== undefined) {
                layout.set(pKey, pIdx);
                if (pIdx + 1 > idx) {
                  idx = pIdx + 1;
                }
              }
            }
          }
        }
      }
    }
    const fieldOrder: Array<string> = [];
    // Add parent field names first
    if (decl.extends !== null && decl.extends !== undefined) {
      for (let e = 0; e < decl.extends.length; e = e + 1) {
        const parentName2: string = decl.extends[e];
        const parentFields2 = this.interfaceFieldOrder.get(parentName2);
        if (parentFields2 !== undefined) {
          for (let pf = 0; pf < parentFields2.length; pf = pf + 1) {
            fieldOrder.push(parentFields2[pf]);
          }
        }
      }
    }
    for (let i = 0; i < decl.members.length; i = i + 1) {
      const member: InterfaceMemberAst = decl.members[i] as InterfaceMemberAst;
      if (member.kind === "property" || member.kind === "method") {
        if (!layout.has(member.name)) {
          layout.set(member.name, idx);
          fieldOrder.push(member.name);
          idx = idx + 1;
        }
      }
    }
    this.interfaceLayouts.set(decl.name, layout);
    this.interfaceFieldOrder.set(decl.name, fieldOrder);
  }

  private lookupFunction(name: string): number | null {
    let scope: Scope | null = this.scope;
    while (scope !== null) {
      const id = scope.functions.get(name);
      if (id !== undefined) return id;
      scope = scope.parent;
    }
    return null;
  }

  // --- Boxing: detect variables that need heap-allocated cells for mutable closure capture ---

  // Detect variables that need boxing for correct mutable closure capture semantics.
  // A variable needs boxing if it's captured by a closure AND:
  //   - it's declared as 'var' (shared across loop iterations), OR
  //   - it's mutated (assigned) inside a closure body
  private detectBoxedVars(stmts: Array<AstStmt>): Map<string, boolean> {
    const result: Map<string, boolean> = new Map();
    // Step 1: Collect variable declarations and their declKind
    const declKinds: Map<string, string> = new Map();
    this.boxCollectDecls(stmts, declKinds);
    // Step 2: Find closures and scan their bodies for captured/mutated vars
    this.boxScanStmts(stmts, declKinds, result, false);
    return result;
  }

  // Collect variable declarations at the current scope level (not into function bodies)
  private boxCollectDecls(stmts: Array<AstStmt>, result: Map<string, string>): void {
    for (let i = 0; i < stmts.length; i = i + 1) {
      const s: AstStmt = stmts[i] as AstStmt;
      if (s.kind === AstStmtKind.VarDecl) {
        result.set((s as VarDeclAst).name, (s as VarDeclAst).declKind);
      }
      if (s.kind === AstStmtKind.Block) {
        this.boxCollectDecls((s as BlockStmtAst).body, result);
      }
      if (s.kind === AstStmtKind.For) {
        const f = s as ForStmtAst;
        if (f.init !== null && f.init.kind === AstStmtKind.VarDecl) {
          result.set((f.init as VarDeclAst).name, (f.init as VarDeclAst).declKind);
        }
        this.boxCollectDecls([f.body], result);
      }
      if (s.kind === AstStmtKind.While) {
        this.boxCollectDecls([(s as WhileStmtAst).body], result);
      }
      if (s.kind === AstStmtKind.If) {
        const ifS = s as IfStmtAst;
        this.boxCollectDecls([ifS.consequent], result);
        if (ifS.alternate !== null) {
          this.boxCollectDecls([ifS.alternate], result);
        }
      }
      if (s.kind === AstStmtKind.ExportDecl) {
        const e = s as ExportDeclAst;
        if (e.declaration !== null) {
          this.boxCollectDecls([e.declaration], result);
        }
      }
      if (s.kind === AstStmtKind.TryCatch) {
        const tc = s as TryCatchStmtAst;
        this.boxCollectDecls(tc.tryBody, result);
        if (tc.catchBody !== null) {
          this.boxCollectDecls(tc.catchBody, result);
        }
      }
    }
  }

  // Scan statements for closures, detecting captured/mutated outer variables
  private boxScanStmts(stmts: Array<AstStmt>, outerDecls: Map<string, string>, boxed: Map<string, boolean>, inClosure: boolean): void {
    for (let i = 0; i < stmts.length; i = i + 1) {
      this.boxScanStmt(stmts[i] as AstStmt, outerDecls, boxed, inClosure);
    }
  }

  private boxScanStmt(stmt: AstStmt, outerDecls: Map<string, string>, boxed: Map<string, boolean>, inClosure: boolean): void {
    if (stmt.kind === AstStmtKind.Expr) {
      this.boxScanExpr((stmt as ExprStmtAst).expr, outerDecls, boxed, inClosure);
    } else if (stmt.kind === AstStmtKind.VarDecl) {
      const decl = stmt as VarDeclAst;
      if (decl.init !== null) {
        this.boxScanExpr(decl.init, outerDecls, boxed, inClosure);
      }
    } else if (stmt.kind === AstStmtKind.Return) {
      const ret = stmt as ReturnStmtAst;
      if (ret.value !== null) {
        this.boxScanExpr(ret.value, outerDecls, boxed, inClosure);
      }
    } else if (stmt.kind === AstStmtKind.Block) {
      this.boxScanStmts((stmt as BlockStmtAst).body, outerDecls, boxed, inClosure);
    } else if (stmt.kind === AstStmtKind.If) {
      const ifS = stmt as IfStmtAst;
      this.boxScanExpr(ifS.condition, outerDecls, boxed, inClosure);
      this.boxScanStmt(ifS.consequent, outerDecls, boxed, inClosure);
      if (ifS.alternate !== null) {
        this.boxScanStmt(ifS.alternate, outerDecls, boxed, inClosure);
      }
    } else if (stmt.kind === AstStmtKind.For) {
      const forS = stmt as ForStmtAst;
      if (forS.init !== null) this.boxScanStmt(forS.init, outerDecls, boxed, inClosure);
      if (forS.condition !== null) this.boxScanExpr(forS.condition, outerDecls, boxed, inClosure);
      if (forS.update !== null) this.boxScanExpr(forS.update, outerDecls, boxed, inClosure);
      this.boxScanStmt(forS.body, outerDecls, boxed, inClosure);
    } else if (stmt.kind === AstStmtKind.While) {
      const whS = stmt as WhileStmtAst;
      this.boxScanExpr(whS.condition, outerDecls, boxed, inClosure);
      this.boxScanStmt(whS.body, outerDecls, boxed, inClosure);
    } else if (stmt.kind === AstStmtKind.DoWhile) {
      const dwS = stmt as DoWhileStmtAst;
      this.boxScanExpr(dwS.condition, outerDecls, boxed, inClosure);
      this.boxScanStmt(dwS.body, outerDecls, boxed, inClosure);
    } else if (stmt.kind === AstStmtKind.Throw) {
      this.boxScanExpr((stmt as ThrowStmtAst).argument, outerDecls, boxed, inClosure);
    } else if (stmt.kind === AstStmtKind.TryCatch) {
      const tc = stmt as TryCatchStmtAst;
      this.boxScanStmts(tc.tryBody, outerDecls, boxed, inClosure);
      if (tc.catchBody !== null) {
        this.boxScanStmts(tc.catchBody, outerDecls, boxed, inClosure);
      }
      if (tc.finallyBody !== null) {
        this.boxScanStmts(tc.finallyBody, outerDecls, boxed, inClosure);
      }
    } else if (stmt.kind === AstStmtKind.Switch) {
      const sw = stmt as SwitchStmtAst;
      this.boxScanExpr(sw.discriminant, outerDecls, boxed, inClosure);
      for (let i = 0; i < sw.cases.length; i = i + 1) {
        const c: SwitchCase = sw.cases[i] as SwitchCase;
        if (c.test !== null) this.boxScanExpr(c.test, outerDecls, boxed, inClosure);
        this.boxScanStmts(c.body, outerDecls, boxed, inClosure);
      }
    } else if (stmt.kind === AstStmtKind.ExportDecl) {
      const ex = stmt as ExportDeclAst;
      if (ex.declaration !== null) {
        this.boxScanStmt(ex.declaration, outerDecls, boxed, inClosure);
      }
    }
    // FunctionDecl: scan body as a "closure" context (named functions capture outer vars)
    if (stmt.kind === AstStmtKind.FunctionDecl) {
      const fd = stmt as FunctionDeclAst;
      // Check if this named function references any outer variables
      this.boxScanStmts(fd.body, outerDecls, boxed, true);
    }
  }

  private boxScanExpr(expr: AstExpr, outerDecls: Map<string, string>, boxed: Map<string, boolean>, inClosure: boolean): void {
    if (expr.kind === AstExprKind.Arrow) {
      // Entering a closure - scan body in closure context
      const arrow = expr as ArrowExprAst;
      if (Array.isArray(arrow.body)) {
        this.boxScanStmts(arrow.body as Array<AstStmt>, outerDecls, boxed, true);
      } else {
        this.boxScanExpr(arrow.body as AstExpr, outerDecls, boxed, true);
      }
      return;
    }
    if (expr.kind === AstExprKind.Identifier) {
      const name = (expr as IdentifierExpr).name;
      if (inClosure && outerDecls.has(name)) {
        // This outer var is captured by a closure
        const declKind = outerDecls.get(name);
        if (declKind === "var") {
          boxed.set(name, true);
        }
      }
      return;
    }
    // Detect mutations inside closures
    if (expr.kind === AstExprKind.Assign) {
      const a = expr as AssignExprAst;
      if (inClosure && a.target.kind === AstExprKind.Identifier) {
        const name = (a.target as IdentifierExpr).name;
        if (outerDecls.has(name)) {
          boxed.set(name, true);
        }
      }
      this.boxScanExpr(a.target, outerDecls, boxed, inClosure);
      this.boxScanExpr(a.value, outerDecls, boxed, inClosure);
      return;
    }
    if (expr.kind === AstExprKind.CompoundAssign) {
      const a = expr as CompoundAssignExprAst;
      if (inClosure && a.target.kind === AstExprKind.Identifier) {
        const name = (a.target as IdentifierExpr).name;
        if (outerDecls.has(name)) {
          boxed.set(name, true);
        }
      }
      this.boxScanExpr(a.target, outerDecls, boxed, inClosure);
      this.boxScanExpr(a.value, outerDecls, boxed, inClosure);
      return;
    }
    if (expr.kind === AstExprKind.UnaryPostfix) {
      const p = expr as UnaryPostfixExprAst;
      if (inClosure && p.operand.kind === AstExprKind.Identifier) {
        const name = (p.operand as IdentifierExpr).name;
        if (outerDecls.has(name)) {
          boxed.set(name, true);
        }
      }
      this.boxScanExpr(p.operand, outerDecls, boxed, inClosure);
      return;
    }
    if (expr.kind === AstExprKind.Unary) {
      const u = expr as UnaryExprAst;
      if (inClosure && (u.op === "++" || u.op === "--") && u.operand.kind === AstExprKind.Identifier) {
        const name = (u.operand as IdentifierExpr).name;
        if (outerDecls.has(name)) {
          boxed.set(name, true);
        }
      }
      this.boxScanExpr(u.operand, outerDecls, boxed, inClosure);
      return;
    }
    // Recurse into sub-expressions
    if (expr.kind === AstExprKind.Binary) {
      const b = expr as BinaryExprAst;
      this.boxScanExpr(b.left, outerDecls, boxed, inClosure);
      this.boxScanExpr(b.right, outerDecls, boxed, inClosure);
    } else if (expr.kind === AstExprKind.Call) {
      const c = expr as CallExprAst;
      this.boxScanExpr(c.callee, outerDecls, boxed, inClosure);
      for (let j = 0; j < c.args.length; j = j + 1) {
        this.boxScanExpr(c.args[j], outerDecls, boxed, inClosure);
      }
    } else if (expr.kind === AstExprKind.Member) {
      this.boxScanExpr((expr as MemberExprAst).object, outerDecls, boxed, inClosure);
    } else if (expr.kind === AstExprKind.Index) {
      const idx = expr as IndexExprAst;
      this.boxScanExpr(idx.object, outerDecls, boxed, inClosure);
      this.boxScanExpr(idx.index, outerDecls, boxed, inClosure);
    } else if (expr.kind === AstExprKind.Array) {
      const arr = expr as ArrayExprAst;
      for (let j = 0; j < arr.elements.length; j = j + 1) {
        this.boxScanExpr(arr.elements[j], outerDecls, boxed, inClosure);
      }
    } else if (expr.kind === AstExprKind.Object) {
      const obj = expr as ObjectExprAst;
      for (let j = 0; j < obj.properties.length; j = j + 1) {
        if (obj.properties[j].value !== null) {
          this.boxScanExpr(obj.properties[j].value, outerDecls, boxed, inClosure);
        }
      }
    } else if (expr.kind === AstExprKind.Template) {
      const tmpl = expr as TemplateExprAst;
      for (let j = 0; j < tmpl.expressions.length; j = j + 1) {
        this.boxScanExpr(tmpl.expressions[j], outerDecls, boxed, inClosure);
      }
    } else if (expr.kind === AstExprKind.Conditional) {
      const cond = expr as ConditionalExprAst;
      this.boxScanExpr(cond.condition, outerDecls, boxed, inClosure);
      this.boxScanExpr(cond.consequent, outerDecls, boxed, inClosure);
      this.boxScanExpr(cond.alternate, outerDecls, boxed, inClosure);
    } else if (expr.kind === AstExprKind.Paren) {
      this.boxScanExpr((expr as ParenExprAst).expr, outerDecls, boxed, inClosure);
    } else if (expr.kind === AstExprKind.Spread) {
      this.boxScanExpr((expr as SpreadExprAst).argument, outerDecls, boxed, inClosure);
    } else if (expr.kind === AstExprKind.TypeAs) {
      this.boxScanExpr((expr as TypeAsExprAst).expr, outerDecls, boxed, inClosure);
    } else if (expr.kind === AstExprKind.Typeof) {
      this.boxScanExpr((expr as TypeofExprAst).operand, outerDecls, boxed, inClosure);
    } else if (expr.kind === AstExprKind.New) {
      const n = expr as NewExprAst;
      this.boxScanExpr(n.callee, outerDecls, boxed, inClosure);
      for (let j = 0; j < n.args.length; j = j + 1) {
        this.boxScanExpr(n.args[j], outerDecls, boxed, inClosure);
      }
    } else if (expr.kind === AstExprKind.Void) {
      // void expression has an operand
    } else if (expr.kind === AstExprKind.Await) {
      this.boxScanExpr((expr as AwaitExprAst).operand, outerDecls, boxed, inClosure);
    }
  }

  // Helper: generate a $box_get call expression
  private makeBoxGet(boxExpr: Expr): CallExpr {
    return {
      kind: ExprKind.Call,
      ty: ANY_TYPE,
      callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$box_get" } as FuncRefExpr,
      args: [boxExpr],
    } as CallExpr;
  }

  // Helper: generate a $box_set call expression
  private makeBoxSet(boxExpr: Expr, value: Expr): CallExpr {
    return {
      kind: ExprKind.Call,
      ty: ANY_TYPE,
      callee: { kind: ExprKind.FuncRef, ty: ANY_TYPE, funcId: 0, name: "$box_set" } as FuncRefExpr,
      args: [boxExpr, value],
    } as CallExpr;
  }

  // Check if a statement body contains a 'this' reference (not inside nested functions)
  private bodyUsesThis(stmts: Array<AstStmt>): boolean {
    for (let i = 0; i < stmts.length; i = i + 1) {
      if (this.stmtUsesThis(stmts[i])) return true;
    }
    return false;
  }

  private stmtUsesThis(stmt: AstStmt): boolean {
    if (stmt.kind === AstStmtKind.Expr) {
      return this.exprUsesThis((stmt as ExprStmtAst).expr);
    }
    if (stmt.kind === AstStmtKind.VarDecl) {
      const d = stmt as VarDeclAst;
      return d.init !== null && this.exprUsesThis(d.init);
    }
    if (stmt.kind === AstStmtKind.Return) {
      const r = stmt as ReturnStmtAst;
      return r.value !== null && this.exprUsesThis(r.value);
    }
    if (stmt.kind === AstStmtKind.If) {
      const s = stmt as IfStmtAst;
      if (this.exprUsesThis(s.condition)) return true;
      if (this.stmtUsesThis(s.consequent)) return true;
      return s.alternate !== null && this.stmtUsesThis(s.alternate);
    }
    if (stmt.kind === AstStmtKind.Block) {
      return this.bodyUsesThis((stmt as BlockStmtAst).body);
    }
    if (stmt.kind === AstStmtKind.While) {
      const w = stmt as WhileStmtAst;
      return this.exprUsesThis(w.condition) || this.stmtUsesThis(w.body);
    }
    if (stmt.kind === AstStmtKind.For) {
      const f = stmt as ForStmtAst;
      if (f.init !== null && this.stmtUsesThis(f.init)) return true;
      if (f.condition !== null && this.exprUsesThis(f.condition)) return true;
      if (f.update !== null && this.exprUsesThis(f.update)) return true;
      return this.stmtUsesThis(f.body);
    }
    if (stmt.kind === AstStmtKind.Throw) {
      return this.exprUsesThis((stmt as ThrowStmtAst).argument);
    }
    // Don't recurse into nested function declarations
    return false;
  }

  private exprUsesThis(expr: AstExpr): boolean {
    if (expr.kind === AstExprKind.This) return true;
    if (expr.kind === AstExprKind.Binary) {
      const b = expr as BinaryExprAst;
      return this.exprUsesThis(b.left) || this.exprUsesThis(b.right);
    }
    if (expr.kind === AstExprKind.Unary || expr.kind === AstExprKind.UnaryPostfix) {
      return this.exprUsesThis((expr as UnaryExprAst).operand);
    }
    if (expr.kind === AstExprKind.Call) {
      const c = expr as CallExprAst;
      if (this.exprUsesThis(c.callee)) return true;
      for (let i = 0; i < c.args.length; i = i + 1) {
        if (this.exprUsesThis(c.args[i])) return true;
      }
      return false;
    }
    if (expr.kind === AstExprKind.Member) {
      return this.exprUsesThis((expr as MemberExprAst).object);
    }
    if (expr.kind === AstExprKind.Index) {
      const idx = expr as IndexExprAst;
      return this.exprUsesThis(idx.object) || this.exprUsesThis(idx.index);
    }
    if (expr.kind === AstExprKind.Assign) {
      const a = expr as AssignExprAst;
      return this.exprUsesThis(a.target) || this.exprUsesThis(a.value);
    }
    if (expr.kind === AstExprKind.Conditional) {
      const c = expr as ConditionalExprAst;
      return this.exprUsesThis(c.condition) || this.exprUsesThis(c.consequent) || this.exprUsesThis(c.alternate);
    }
    if (expr.kind === AstExprKind.Paren) {
      return this.exprUsesThis((expr as ParenExprAst).expr);
    }
    if (expr.kind === AstExprKind.TypeAs) {
      return this.exprUsesThis((expr as TypeAsExprAst).expr);
    }
    if (expr.kind === AstExprKind.Array) {
      const arr = expr as ArrayExprAst;
      for (let i = 0; i < arr.elements.length; i = i + 1) {
        if (this.exprUsesThis(arr.elements[i])) return true;
      }
      return false;
    }
    if (expr.kind === AstExprKind.Object) {
      const obj = expr as ObjectExprAst;
      for (let i = 0; i < obj.properties.length; i = i + 1) {
        if (this.exprUsesThis(obj.properties[i].value)) return true;
      }
      return false;
    }
    // Don't recurse into nested arrow/function expressions
    return false;
  }
}

// Map perry/ui TypeScript function names to their perry_ui_* C function names
function mapPerryUiName(tsName: string): string {
  // Widget constructors — route through pd_ui_* bridge wrappers
  // (these handle NaN-boxed double <-> i64 handle/string conversions)
  if (tsName === "App") return "pd_ui_App";
  if (tsName === "Text") return "pd_ui_Text";
  if (tsName === "Button") return "pd_ui_Button";
  if (tsName === "HStack") return "pd_ui_HStack";
  if (tsName === "VStack") return "pd_ui_VStack";
  if (tsName === "VStackWithInsets") return "pd_ui_VStackWithInsets";
  if (tsName === "HStackWithInsets") return "pd_ui_HStackWithInsets";
  if (tsName === "ScrollView") return "pd_ui_ScrollView";
  if (tsName === "Spacer") return "pd_ui_Spacer";
  if (tsName === "Divider") return "pd_ui_Divider";
  if (tsName === "TextField") return "pd_ui_TextField";

  // Widget hierarchy
  if (tsName === "widgetAddChild") return "pd_ui_widgetAddChild";
  if (tsName === "widgetClearChildren") return "pd_ui_widgetClearChildren";

  // Widget properties
  if (tsName === "widgetSetBackgroundColor") return "pd_ui_widgetSetBackgroundColor";
  if (tsName === "widgetSetEdgeInsets") return "pd_ui_widgetSetEdgeInsets";
  if (tsName === "widgetSetOnClick") return "pd_ui_widgetSetOnClick";

  // Text properties
  if (tsName === "textSetFontSize") return "pd_ui_textSetFontSize";
  if (tsName === "textSetFontWeight") return "pd_ui_textSetFontWeight";
  if (tsName === "textSetColor") return "pd_ui_textSetColor";
  if (tsName === "textSetSelectable") return "pd_ui_textSetSelectable";
  if (tsName === "textSetString") return "pd_ui_textSetString";
  if (tsName === "textSetWraps") return "pd_ui_textSetWraps";

  // Button properties
  if (tsName === "buttonSetBordered") return "pd_ui_buttonSetBordered";

  // TextField
  if (tsName === "textfieldFocus") return "pd_ui_textfieldFocus";
  if (tsName === "textfieldSetString") return "pd_ui_textfieldSetString";
  if (tsName === "textfieldGetString") return "pd_ui_textfieldGetString";

  // ScrollView
  if (tsName === "scrollviewSetChild") return "pd_ui_scrollviewSetChild";
  if (tsName === "scrollviewSetOffset") return "pd_ui_scrollviewSetOffset";
  if (tsName === "scrollviewGetOffset") return "pd_ui_scrollviewGetOffset";

  // Keyboard
  if (tsName === "addKeyboardShortcut") return "pd_ui_addKeyboardShortcut";

  // Clipboard
  if (tsName === "clipboardRead") return "pd_ui_clipboardRead";
  if (tsName === "clipboardWrite") return "pd_ui_clipboardWrite";

  // Menu
  if (tsName === "menuCreate") return "pd_ui_menuCreate";
  if (tsName === "menuAddItem") return "pd_ui_menuAddItem";
  if (tsName === "widgetSetContextMenu") return "pd_ui_widgetSetContextMenu";

  // Fallback: use perry_ui_ prefix directly (will need wrapper if types mismatch)
  return "perry_ui_" + tsName;
}
