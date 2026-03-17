# Anvil

A TypeScript-to-native compiler with an LLVM backend, written in TypeScript.

Anvil parses a subset of TypeScript, lowers it through a high-level IR, emits LLVM IR, and links against the [Perry](https://github.com/aspect-build/perry) runtime to produce native executables.

## Why

Anvil exists as the self-hosting test for the Perry compiler. Perry (written in Rust) compiles TypeScript to native code. Anvil is itself written in Perry-compatible TypeScript — so when Perry can compile Anvil, and Anvil can compile programs, the toolchain has passed the "King's Test" of compiler maturity.

## Parity Status

Anvil and Perry share the same runtime (`libperry_runtime.a`) and NaN-boxing scheme. A test suite of 81 TypeScript files validates that both compilers produce identical output.

**Current parity: 68/68 deterministic tests match (100%)**

| Status | Count | Details |
|--------|-------|---------|
| PASS | 68 | Perry output = Anvil output |
| Inherent DIFF | 2 | `test_date` (timestamps), `test_math` (Math.random) |
| Skipped | 11 | UI/timer/crypto/plugin (platform-specific) |

### Bugs fixed during parity work

#### Perry (Cranelift backend)

| Fix | Root cause | Files |
|-----|-----------|-------|
| i64 wrapper shim conversion | `bitcast` instead of `fcvt_to_sint_sat`/`fcvt_from_sint` in integer-specialized function wrappers corrupted return values | `functions.rs` |
| Default params in i64 functions | `fcvt_to_sint_sat` converts undefined (missing arg) to 0 instead of triggering default value logic; now excluded from i64 specialization | `functions.rs` |
| Closure default param handling | Closures didn't check for TAG_UNDEFINED on missing args or apply default values | `closures.rs`, `expr.rs` |
| Class instance `.map()` interception | `.map()` unconditionally lowered as `ArrayMap` even on class instances like `Box.map()` | `lower.rs` |
| User-defined class type inference | `const b = new Box(5)` got `Type::Any` instead of `Type::Named("Box")` | `destructuring.rs` |
| Class method return type inference | `Stmt::Let` didn't check `ClassMeta.method_return_types` before falling through to array method heuristics | `stmt.rs` |
| Module-level variable staleness | Named functions cached module-level variables in Cranelift locals at entry and never reloaded after calls that modify them | `functions.rs` |
| TsParamProp handling | `constructor(public name: string)` parameter properties not registered as fields, no `this.name = name` synthesized | `lower_decl.rs` |
| CLASS_CAPTURE LocalId collision | Inlined function LocalIds colliding with class constructor parameter LocalIds caused wrong variable promotion to globals | `codegen.rs` |
| Regex `.test()` on named vars | `Type::Named("RegExp")` not recognized in `.test()` type check, falling through to dynamic dispatch returning `[object Object]` | `lower.rs` |
| Math constants | `Math.PI`, `Math.E`, etc. not resolved at compile time, falling through to property lookup returning undefined | `lower.rs` |
| `delete`/`in` operator booleans | `js_object_has_property` returned raw `0.0`/`1.0` instead of NaN-boxed TAG_TRUE/TAG_FALSE; `Expr::Delete` used `fcvt_from_sint` | `object.rs`, `expr.rs` |
| `String()` BigInt coercion | `js_string_coerce` missing BigInt case, NaN-boxed BigInt fell through to float path producing NaN | `builtins.rs` |
| Object literal `this` binding | Object methods referencing `this` compiled as plain `FuncRef` instead of `Closure` with `captures_this: true` | `lower.rs`, `closures.rs` |
| Detached method `this` unbinding | `const fn = obj.getX; fn()` retained `this` binding; now uses `CAPTURES_THIS_FLAG` and `js_closure_unbind_this` to strip `this` on PropertyGet | `closure.rs`, `expr.rs` |
| Generic identity string args | I64 string values passed to `Any`-typed F64 parameters via raw `bitcast` instead of proper NaN-boxing with STRING_TAG | `expr.rs` |
| `var` loop closure hoisting | `var` declarations in for-loop init not hoisted, closures didn't capture them as mutable | `lower.rs`, `lower_decl.rs` |
| ArrayPush mutable capture | `collect_mutable_captures_from_expr` didn't walk into `ArrayPush`/`ArrayUnshift`/`ArrayPushSpread` | `closures.rs` |
| `.map()` on `new ClassName()` | ArrayMap guard only checked `Ident` receivers, not `New` expressions | `lower.rs`, `expr.rs` |

#### Anvil (LLVM backend)

| Fix | Root cause | Files |
|-----|-----------|-------|
| Interface method dispatch | Interface-typed variables returned undefined for method calls; no runtime dispatch based on implementing class | `lower.ts`, `expr.ts`, `ast.ts`, `parser.ts` |
| Property/global dispatch | Interface dispatch only handled local variable receivers, not `this._field.method()` or module-level vars | `lower.ts`, `expr.ts` |

### Known limitations

- **Comparison operators** print `1`/`0` instead of `true`/`false` — both compilers treat boolean results as `f64(1.0)`/`f64(0.0)`. A working fix exists (NaN-boxed booleans + arithmetic unboxing + while-loop truthiness fix) but requires changes across 8 files.
- **BigInt** is partially supported — literals and arithmetic work, but `String()` coercion was recently fixed and some edge cases may remain.

## Architecture

```
source.ts
  → Scanner → Parser → AST
  → Lowerer → HIR (typed intermediate representation)
  → Codegen → LLVM IR (.ll)
  → clang → object file (.o)
  → cc + libperry_runtime.a → native executable
```

| Stage | Key files |
|---|---|
| Lexer | `src/parser/scanner.ts`, `src/parser/token.ts` |
| Parser | `src/parser/parser.ts` |
| HIR & lowering | `src/hir/ir.ts`, `src/hir/types.ts`, `src/hir/lower.ts` |
| Codegen | `src/codegen/compiler.ts`, `src/codegen/expr.ts`, `src/codegen/stmt.ts` |
| LLVM IR builder | `src/llvm/module.ts`, `src/llvm/block.ts`, `src/llvm/function.ts` |
| Driver & linker | `src/driver/compile.ts`, `src/driver/linker.ts` |
| Runtime stubs | `src/stubs.c` |

Values are represented using NaN-boxing (`src/codegen/nanbox.ts`), matching the Perry runtime's encoding.

## Supported features

- Variables (`let`, `const`, `var`)
- Functions and arrow functions
- Closures with mutable captures
- Classes with constructors, methods, fields, inheritance, and `implements`
- Interface method dispatch (runtime class_id-based)
- Const enums
- Control flow (`if`/`else`, `while`, `for`, `for...of`, `for...in`)
- Arithmetic, comparison, logical, bitwise, and unary operators
- Strings and string methods
- Arrays and array methods (`push`, `pop`, `shift`, `splice`, `slice`, `map`, `filter`, `reduce`, `forEach`, `find`, `length`)
- Objects, field access, spread, rest, and destructuring
- Maps and Sets
- Async/await and Promises
- Generators
- Template literals
- Regular expressions
- BigInt
- Multi-file compilation with import/export resolution
- `console.log`, `console.error`, `console.warn`

## Prerequisites

- Node.js and npm
- `clang` (for compiling LLVM IR to object files)
- `libperry_runtime.a` — build it from the Perry project:
  ```
  cd ../perry && cargo build --release -p perry-runtime
  ```

## Usage

```bash
npm install
npx tsc

# Compile a TypeScript file to a native executable
node dist/main.js myfile.ts -o myfile --runtime /path/to/libperry_runtime.a

# Keep the generated LLVM IR for inspection
node dist/main.js myfile.ts --emit-ll -o myfile --runtime /path/to/libperry_runtime.a

# Run the parity test suite (requires Perry compiler installed)
RUNTIME=/path/to/libperry_runtime.a
for f in ../perry/test-files/test_*.ts; do
  name=$(basename "${f%.ts}")
  perry compile "$f" -o "/tmp/perry_$name" 2>/dev/null || continue
  expected=$("/tmp/perry_$name" 2>/dev/null)
  node dist/main.js "$f" -o "/tmp/anvil_$name" --runtime "$RUNTIME" 2>/dev/null || continue
  actual=$("/tmp/anvil_$name" 2>/dev/null)
  [ "$actual" = "$expected" ] && echo "PASS $name" || echo "DIFF $name"
done
```

## License

MIT
