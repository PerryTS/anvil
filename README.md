# Anvil

A TypeScript-to-native compiler with an LLVM backend, written in TypeScript.

Anvil parses a subset of TypeScript, lowers it through a high-level IR, emits LLVM IR, and links against the [Perry](https://github.com/aspect-build/perry) runtime to produce native executables.

## Why

Anvil exists as the self-hosting test for the Perry compiler. Perry (written in Rust) compiles TypeScript to native code. Anvil is itself written in Perry-compatible TypeScript — so when Perry can compile Anvil, and Anvil can compile programs, the toolchain has passed the "King's Test" of compiler maturity.

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
- Closures
- Classes with constructors, methods, and fields
- Const enums
- Control flow (`if`/`else`, `while`, `for`)
- Arithmetic, comparison, logical, bitwise, and unary operators
- Strings and string methods
- Arrays and array methods (`push`, `pop`, `shift`, `splice`, `slice`, `length`)
- Objects and field access
- Maps
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

# Compile a TypeScript file to a native executable
npx ts-node src/main.ts myfile.ts -o myfile

# Keep the generated LLVM IR for inspection
npx ts-node src/main.ts myfile.ts --emit-ll -o myfile

# Specify a custom runtime path
npx ts-node src/main.ts myfile.ts --runtime /path/to/libperry_runtime.a -o myfile

# Run built-in tests (Phase 0-1, pre-parser)
npx ts-node src/main.ts --test hello --emit-ll -o output
npx ts-node src/main.ts --test arithmetic --emit-ll -o output
npx ts-node src/main.ts --test strings --emit-ll -o output
npx ts-node src/main.ts --test functions --emit-ll -o output
npx ts-node src/main.ts --test control --emit-ll -o output
```

## License

MIT
