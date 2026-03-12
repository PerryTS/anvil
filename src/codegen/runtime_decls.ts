// Runtime FFI declarations for LLVM IR codegen
// These match perry-runtime's #[no_mangle] extern "C" functions

import { LLModule } from "../llvm/module";
import { DOUBLE, I64, I32, I8, PTR, VOID } from "../llvm/types";

export function declareRuntimeFunctions(mod: LLModule): void {
  // --- GC ---
  mod.declareFunction("js_gc_init", VOID, []);

  // --- Console ---
  mod.declareFunction("js_console_log_number", VOID, [DOUBLE]);
  mod.declareFunction("js_console_log_dynamic", VOID, [DOUBLE]);
  mod.declareFunction("js_console_error_number", VOID, [DOUBLE]);
  mod.declareFunction("js_console_error_dynamic", VOID, [DOUBLE]);
  mod.declareFunction("js_console_warn_number", VOID, [DOUBLE]);
  mod.declareFunction("js_console_warn_dynamic", VOID, [DOUBLE]);

  // --- NaN-boxing ---
  mod.declareFunction("js_nanbox_string", DOUBLE, [I64]);
  mod.declareFunction("js_nanbox_pointer", DOUBLE, [I64]);
  mod.declareFunction("js_nanbox_get_pointer", I64, [DOUBLE]);
  mod.declareFunction("js_nanbox_is_string", I32, [DOUBLE]);
  mod.declareFunction("js_nanbox_is_pointer", I32, [DOUBLE]);

  // --- String ---
  mod.declareFunction("js_string_from_bytes", I64, [PTR, I64]);
  mod.declareFunction("js_string_concat", I64, [I64, I64]);
  mod.declareFunction("js_string_eq", I32, [I64, I64]);
  mod.declareFunction("js_string_len", I64, [I64]);
  mod.declareFunction("js_jsvalue_to_string", I64, [DOUBLE]);
  mod.declareFunction("js_string_from_number", I64, [DOUBLE]);
  mod.declareFunction("js_string_from_bool", I64, [I32]);
  mod.declareFunction("js_number_to_string", I64, [DOUBLE]);
  mod.declareFunction("js_string_includes", I32, [I64, I64]);
  mod.declareFunction("js_string_starts_with", I32, [I64, I64]);
  mod.declareFunction("js_string_ends_with", I32, [I64, I64]);
  mod.declareFunction("js_string_index_of", I32, [I64, I64]);
  mod.declareFunction("js_string_slice", I64, [I64, I32, I32]);
  mod.declareFunction("js_string_trim", I64, [I64]);
  mod.declareFunction("js_string_char_at", I64, [I64, I32]);
  mod.declareFunction("js_string_char_code_at", I32, [I64, I32]);
  mod.declareFunction("js_string_split", I64, [I64, I64]);
  mod.declareFunction("js_string_replace", I64, [I64, I64, I64]);
  mod.declareFunction("js_string_to_upper_case", I64, [I64]);
  mod.declareFunction("js_string_to_lower_case", I64, [I64]);

  // --- Dynamic arithmetic ---
  mod.declareFunction("js_add", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_sub", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_mul", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_div", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_mod", DOUBLE, [DOUBLE, DOUBLE]);

  // --- Comparison ---
  // js_jsvalue_equals(f64, f64) -> i32: strict equality (0 or 1)
  mod.declareFunction("js_jsvalue_equals", I32, [DOUBLE, DOUBLE]);
  // js_jsvalue_compare(f64, f64) -> i32: -1, 0, or 1
  mod.declareFunction("js_jsvalue_compare", I32, [DOUBLE, DOUBLE]);
  // js_eq(f64, f64) -> f64: returns NaN-boxed boolean
  mod.declareFunction("js_eq", DOUBLE, [DOUBLE, DOUBLE]);

  // --- Type checks ---
  mod.declareFunction("js_is_truthy", I32, [DOUBLE]);
  mod.declareFunction("js_typeof", I64, [DOUBLE]);

  // --- Object ---
  mod.declareFunction("js_object_alloc", I64, [I32, I32]);
  mod.declareFunction("js_object_set_field_f64", VOID, [I64, I32, DOUBLE]);
  mod.declareFunction("js_object_get_field_f64", DOUBLE, [I64, I32]);
  mod.declareFunction("js_object_get_field_count", I32, [I64]);

  // --- Array ---
  mod.declareFunction("js_array_alloc", I64, [I32]);
  mod.declareFunction("js_array_get", DOUBLE, [I64, I32]);
  mod.declareFunction("js_array_set", VOID, [I64, I32, DOUBLE]);
  mod.declareFunction("js_array_push", VOID, [I64, DOUBLE]);
  mod.declareFunction("js_array_length", I32, [I64]);
  mod.declareFunction("js_array_pop", DOUBLE, [I64]);
  mod.declareFunction("js_array_splice", I64, [I64, I32, I32]);
  mod.declareFunction("js_array_slice", I64, [I64, I32, I32]);
  mod.declareFunction("js_array_index_of", I32, [I64, DOUBLE]);

  // --- Closure ---
  mod.declareFunction("js_closure_alloc", I64, [PTR, I32]);
  mod.declareFunction("js_closure_set_capture_f64", VOID, [I64, I32, DOUBLE]);
  mod.declareFunction("js_closure_get_capture_f64", DOUBLE, [I64, I32]);
  mod.declareFunction("js_closure_call0", DOUBLE, [I64]);
  mod.declareFunction("js_closure_call1", DOUBLE, [I64, DOUBLE]);
  mod.declareFunction("js_closure_call2", DOUBLE, [I64, DOUBLE, DOUBLE]);
  mod.declareFunction("js_closure_call3", DOUBLE, [I64, DOUBLE, DOUBLE, DOUBLE]);

  // --- Map ---
  mod.declareFunction("js_map_new", I64, []);
  mod.declareFunction("js_map_set", VOID, [I64, DOUBLE, DOUBLE]);
  mod.declareFunction("js_map_get", DOUBLE, [I64, DOUBLE]);
  mod.declareFunction("js_map_has", I32, [I64, DOUBLE]);
  mod.declareFunction("js_map_delete", I32, [I64, DOUBLE]);
  mod.declareFunction("js_map_size", I32, [I64]);

  // --- Process ---
  mod.declareFunction("js_process_exit", VOID, [I32]);

  // --- Math ---
  mod.declareFunction("js_math_floor", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_math_ceil", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_math_round", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_math_abs", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_math_sqrt", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_math_pow", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_math_min", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_math_max", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_math_random", DOUBLE, []);
  mod.declareFunction("js_math_log", DOUBLE, [DOUBLE]);

  // --- Error/exceptions ---
  mod.declareFunction("js_throw", VOID, [DOUBLE]);
  mod.declareFunction("js_try_enter", I32, [PTR]);
  mod.declareFunction("js_try_exit", VOID, []);
  mod.declareFunction("js_get_current_exception", DOUBLE, []);

  // --- Dispatch init ---
  mod.declareFunction("js_stdlib_init_dispatch", VOID, []);
}
