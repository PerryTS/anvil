// Runtime FFI declarations for LLVM IR codegen
// These match perry-runtime's #[no_mangle] extern "C" functions

import { LLModule } from "../llvm/module";
const DOUBLE: string = "double";
const I64: string = "i64";
const I32: string = "i32";
const I8: string = "i8";
const PTR: string = "ptr";
const VOID: string = "void";

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
  mod.declareFunction("js_string_from_bytes", I64, [PTR, I32]);
  mod.declareFunction("js_string_concat", I64, [I64, I64]);
  mod.declareFunction("js_string_eq", I32, [I64, I64]);
  mod.declareFunction("js_string_length", I32, [I64]);
  mod.declareFunction("js_jsvalue_to_string", I64, [DOUBLE]);
  mod.declareFunction("js_string_from_number", I64, [DOUBLE]);
  mod.declareFunction("js_string_from_bool", I64, [I32]);
  mod.declareFunction("js_number_to_string", I64, [DOUBLE]);
  mod.declareFunction("js_string_starts_with", I32, [I64, I64]);
  mod.declareFunction("js_string_ends_with", I32, [I64, I64]);
  mod.declareFunction("js_string_index_of", I32, [I64, I64]);
  mod.declareFunction("js_string_slice", I64, [I64, I32, I32]);
  mod.declareFunction("js_string_trim", I64, [I64]);
  mod.declareFunction("js_string_char_at", I64, [I64, I32]);
  mod.declareFunction("js_string_char_code_at", DOUBLE, [I64, I32]);
  mod.declareFunction("js_string_split", I64, [I64, I64]);
  mod.declareFunction("js_string_replace_string", I64, [I64, I64, I64]);
  mod.declareFunction("js_string_to_upper_case", I64, [I64]);
  mod.declareFunction("js_string_to_lower_case", I64, [I64]);
  mod.declareFunction("js_string_substring", I64, [I64, I32, I32]);
  mod.declareFunction("js_string_from_char_code", PTR, [I32]);

  // --- Dynamic arithmetic (JSValue = repr(transparent) u64 -> passed as i64) ---
  mod.declareFunction("js_add", I64, [I64, I64]);
  mod.declareFunction("js_sub", I64, [I64, I64]);
  mod.declareFunction("js_mul", I64, [I64, I64]);
  mod.declareFunction("js_div", I64, [I64, I64]);
  mod.declareFunction("js_mod", I64, [I64, I64]);

  // --- Comparison (these take f64 directly, NOT JSValue) ---
  mod.declareFunction("js_jsvalue_equals", I32, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_jsvalue_compare", I32, [DOUBLE, DOUBLE]);
  // js_eq takes JSValue params
  mod.declareFunction("js_eq", I64, [I64, I64]);

  // --- Type checks ---
  mod.declareFunction("js_is_truthy", I32, [DOUBLE]);
  mod.declareFunction("js_typeof", I64, [DOUBLE]);  // unused, kept for compat
  mod.declareFunction("js_value_typeof", PTR, [DOUBLE]);
  mod.declareFunction("js_number_coerce", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_parse_int", DOUBLE, [I64, DOUBLE]);
  mod.declareFunction("js_array_is_array", DOUBLE, [DOUBLE]);

  // --- Object ---
  // js_object_alloc(class_id: u32, field_count: u32) -> *mut ObjectHeader
  mod.declareFunction("js_object_alloc", PTR, [I32, I32]);
  // js_object_get_field_f64(obj: *const ObjectHeader, field_index: u32) -> f64
  mod.declareFunction("js_object_get_field_f64", DOUBLE, [PTR, I32]);
  // js_object_set_field_f64(obj: *mut ObjectHeader, field_index: u32, value: f64)
  mod.declareFunction("js_object_set_field_f64", VOID, [PTR, I32, DOUBLE]);
  // js_object_keys(obj: *const ObjectHeader) -> *mut ArrayHeader (string keys)
  mod.declareFunction("js_object_keys", PTR, [PTR]);
  // js_object_rest(src: *const ObjectHeader, exclude_keys: *const ArrayHeader) -> *mut ObjectHeader
  mod.declareFunction("js_object_rest", PTR, [PTR, PTR]);
  // js_object_get_field_by_name_f64(obj: *ObjectHeader, key: *StringHeader) -> f64
  mod.declareFunction("js_object_get_field_by_name_f64", DOUBLE, [PTR, PTR]);
  // js_object_set_field_by_name(obj: *ObjectHeader, key: *StringHeader, value: f64)
  mod.declareFunction("js_object_set_field_by_name", VOID, [PTR, PTR, DOUBLE]);
  // js_object_clone_with_extra(src_f64: f64, extra_count: i32, keys_ptr: ptr, keys_len: i32) -> *mut ObjectHeader
  mod.declareFunction("js_object_clone_with_extra", PTR, [DOUBLE, I32, PTR, I32]);
  // pd_dynamic_get(obj: f64, key: f64) -> f64 — handles string/array/object indexing
  mod.declareFunction("pd_dynamic_get", DOUBLE, [DOUBLE, DOUBLE]);
  // pd_dynamic_set(obj: f64, key: f64, val: f64) -> f64
  mod.declareFunction("pd_dynamic_set", DOUBLE, [DOUBLE, DOUBLE, DOUBLE]);
  // pd_dynamic_length(obj: f64) -> i32 — .length for string or array
  mod.declareFunction("pd_dynamic_length", I32, [DOUBLE]);
  // js_object_values(obj: *const ObjectHeader) -> *mut ArrayHeader
  mod.declareFunction("js_object_values", PTR, [PTR]);
  // js_object_entries(obj: *const ObjectHeader) -> *mut ArrayHeader
  mod.declareFunction("js_object_entries", PTR, [PTR]);
  // js_regexp_new(pattern: *const StringHeader, flags: *const StringHeader) -> *mut RegExpHeader
  mod.declareFunction("js_regexp_new", PTR, [I64, I64]);
  // js_regexp_test(re: *RegExpHeader, s: *StringHeader) -> i32
  mod.declareFunction("js_regexp_test", I32, [PTR, PTR]);
  // js_string_replace_regex(s: *StringHeader, re: *RegExpHeader, replacement: *StringHeader) -> *StringHeader
  mod.declareFunction("js_string_replace_regex", PTR, [PTR, PTR, PTR]);
  // js_string_match(s: *StringHeader, re: *RegExpHeader) -> *ArrayHeader
  mod.declareFunction("js_string_match", PTR, [PTR, PTR]);
  // js_object_delete_field(obj: *mut ObjectHeader, key: *StringHeader) -> i32
  mod.declareFunction("js_object_delete_field", I32, [PTR, PTR]);
  // js_object_has_property(obj: f64, key: f64) -> f64  (1.0 or 0.0)
  mod.declareFunction("js_object_has_property", DOUBLE, [DOUBLE, DOUBLE]);
  // js_object_set_keys(obj: *mut ObjectHeader, keys: *mut ArrayHeader) -> void
  mod.declareFunction("js_object_set_keys", VOID, [PTR, PTR]);

  // --- Array ---
  // js_array_alloc(capacity: u32) -> *mut ArrayHeader
  mod.declareFunction("js_array_alloc", PTR, [I32]);
  // js_array_get_f64(arr: *const ArrayHeader, index: u32) -> f64
  mod.declareFunction("js_array_get_f64", DOUBLE, [PTR, I32]);
  // js_array_set_f64(arr: *mut ArrayHeader, index: u32, value: f64)
  mod.declareFunction("js_array_set_f64", VOID, [PTR, I32, DOUBLE]);
  // js_array_push_f64(arr: *mut ArrayHeader, value: f64) -> *mut ArrayHeader
  mod.declareFunction("js_array_push_f64", PTR, [PTR, DOUBLE]);
  // js_array_length(arr: *const ArrayHeader) -> u32
  mod.declareFunction("js_array_length", I32, [PTR]);
  // js_array_pop_f64(arr: *mut ArrayHeader) -> f64
  mod.declareFunction("js_array_pop_f64", DOUBLE, [PTR]);
  // js_array_shift_f64(arr: *mut ArrayHeader) -> f64
  mod.declareFunction("js_array_shift_f64", DOUBLE, [PTR]);
  // js_array_unshift_f64(arr: *mut ArrayHeader, value: f64) -> *mut ArrayHeader
  mod.declareFunction("js_array_unshift_f64", PTR, [PTR, DOUBLE]);
  // js_array_splice(arr, start, delete_count, items, items_count, out_arr) -> *mut ArrayHeader
  mod.declareFunction("js_array_splice", PTR, [PTR, I32, I32, PTR, I32, PTR]);
  // js_array_slice(arr: *const ArrayHeader, start: i32, end: i32) -> *mut ArrayHeader
  mod.declareFunction("js_array_slice", PTR, [PTR, I32, I32]);
  // js_array_indexOf_f64(arr: *const ArrayHeader, value: f64) -> i32
  mod.declareFunction("js_array_indexOf_f64", I32, [PTR, DOUBLE]);
  // js_array_includes_f64(arr: *const ArrayHeader, value: f64) -> i32
  mod.declareFunction("js_array_includes_f64", I32, [PTR, DOUBLE]);
  // js_array_join(arr: *const ArrayHeader, separator: *const StringHeader) -> *mut StringHeader
  mod.declareFunction("js_array_join", PTR, [PTR, PTR]);
  // js_array_concat(arr1, arr2) -> *mut ArrayHeader
  mod.declareFunction("js_array_concat", PTR, [PTR, PTR]);
  // js_array_forEach(arr, callback) -> void
  mod.declareFunction("js_array_forEach", VOID, [PTR, PTR]);
  // js_array_map(arr, callback) -> *mut ArrayHeader
  mod.declareFunction("js_array_map", PTR, [PTR, PTR]);
  // js_array_filter(arr, callback) -> *mut ArrayHeader
  mod.declareFunction("js_array_filter", PTR, [PTR, PTR]);
  // js_array_find(arr, callback) -> f64
  mod.declareFunction("js_array_find", DOUBLE, [PTR, PTR]);
  // js_array_findIndex(arr, callback) -> i32
  mod.declareFunction("js_array_findIndex", I32, [PTR, PTR]);
  // js_array_reduce(arr, callback, has_initial, initial) -> f64
  mod.declareFunction("js_array_reduce", DOUBLE, [PTR, PTR, I32, DOUBLE]);
  // js_array_sort_with_comparator(arr, comparator) -> *mut ArrayHeader
  mod.declareFunction("js_array_sort_with_comparator", PTR, [PTR, PTR]);
  // js_array_every(arr, callback) -> i32
  mod.declareFunction("js_array_every", I32, [PTR, PTR]);
  // js_array_some(arr, callback) -> i32
  mod.declareFunction("js_array_some", I32, [PTR, PTR]);

  // --- Closure ---
  // js_closure_alloc(func_ptr: *const u8, capture_count: u32) -> *mut ClosureHeader
  mod.declareFunction("js_closure_alloc", PTR, [PTR, I32]);
  // js_closure_set_capture_f64(closure: *mut ClosureHeader, index: u32, value: f64)
  mod.declareFunction("js_closure_set_capture_f64", VOID, [PTR, I32, DOUBLE]);
  // js_closure_get_capture_f64(closure: *const ClosureHeader, index: u32) -> f64
  mod.declareFunction("js_closure_get_capture_f64", DOUBLE, [PTR, I32]);
  // js_closure_callN(closure: *const ClosureHeader, args...) -> f64
  mod.declareFunction("js_closure_call0", DOUBLE, [PTR]);
  mod.declareFunction("js_closure_call1", DOUBLE, [PTR, DOUBLE]);
  mod.declareFunction("js_closure_call2", DOUBLE, [PTR, DOUBLE, DOUBLE]);
  mod.declareFunction("js_closure_call3", DOUBLE, [PTR, DOUBLE, DOUBLE, DOUBLE]);
  mod.declareFunction("js_closure_call4", DOUBLE, [PTR, DOUBLE, DOUBLE, DOUBLE, DOUBLE]);
  mod.declareFunction("js_closure_call5", DOUBLE, [PTR, DOUBLE, DOUBLE, DOUBLE, DOUBLE, DOUBLE]);

  // --- Map ---
  // js_map_alloc(capacity: u32) -> *mut MapHeader
  mod.declareFunction("js_map_alloc", PTR, [I32]);
  // js_map_set(map: *mut MapHeader, key: f64, value: f64) -> *mut MapHeader
  mod.declareFunction("js_map_set", PTR, [PTR, DOUBLE, DOUBLE]);
  // js_map_get(map: *const MapHeader, key: f64) -> f64
  mod.declareFunction("js_map_get", DOUBLE, [PTR, DOUBLE]);
  // js_map_has(map: *const MapHeader, key: f64) -> i32
  mod.declareFunction("js_map_has", I32, [PTR, DOUBLE]);
  // js_map_delete(map: *mut MapHeader, key: f64) -> i32
  mod.declareFunction("js_map_delete", I32, [PTR, DOUBLE]);
  // js_map_size(map: *const MapHeader) -> u32
  mod.declareFunction("js_map_size", I32, [PTR]);
  // js_map_clear(map: *mut MapHeader)
  mod.declareFunction("js_map_clear", VOID, [PTR]);

  // --- Set ---
  mod.declareFunction("js_set_alloc", PTR, [I32]);
  mod.declareFunction("js_set_add", PTR, [PTR, DOUBLE]);
  mod.declareFunction("js_set_has", I32, [PTR, DOUBLE]);
  mod.declareFunction("js_set_delete", I32, [PTR, DOUBLE]);
  mod.declareFunction("js_set_size", I32, [PTR]);
  mod.declareFunction("js_set_clear", VOID, [PTR]);

  // --- Process ---
  mod.declareFunction("js_process_exit", VOID, [I32]);
  mod.declareFunction("js_process_get_argv", DOUBLE, []);
  mod.declareFunction("js_process_cwd", DOUBLE, []);
  // js_getenv(name: *const StringHeader) -> *mut StringHeader (null if not found)
  mod.declareFunction("js_getenv", PTR, [PTR]);

  // --- Math (only declare those that exist in the runtime) ---
  mod.declareFunction("js_math_pow", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_math_random", DOUBLE, []);
  mod.declareFunction("js_math_log", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_math_fmod", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("js_math_log10", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_math_log2", DOUBLE, [DOUBLE]);
  // Use LLVM intrinsics for floor, ceil, round, abs, sqrt
  mod.declareFunction("llvm.floor.f64", DOUBLE, [DOUBLE]);
  mod.declareFunction("llvm.ceil.f64", DOUBLE, [DOUBLE]);
  mod.declareFunction("llvm.roundeven.f64", DOUBLE, [DOUBLE]);
  mod.declareFunction("llvm.fabs.f64", DOUBLE, [DOUBLE]);
  mod.declareFunction("llvm.sqrt.f64", DOUBLE, [DOUBLE]);
  mod.declareFunction("llvm.minnum.f64", DOUBLE, [DOUBLE, DOUBLE]);
  mod.declareFunction("llvm.maxnum.f64", DOUBLE, [DOUBLE, DOUBLE]);

  // --- Date ---
  mod.declareFunction("js_date_now", DOUBLE, []);
  mod.declareFunction("js_date_new", DOUBLE, []);
  mod.declareFunction("js_date_new_from_timestamp", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_get_time", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_get_full_year", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_get_month", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_get_date", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_get_hours", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_get_minutes", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_get_seconds", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_get_milliseconds", DOUBLE, [DOUBLE]);
  mod.declareFunction("js_date_to_iso_string", PTR, [DOUBLE]);

  // --- Error/exceptions ---
  mod.declareFunction("js_throw", VOID, [DOUBLE]);
  mod.declareFunction("js_try_push", PTR, []);
  mod.declareFunction("js_try_end", VOID, []);
  mod.declareFunction("js_get_exception", DOUBLE, []);
  mod.declareFunction("js_clear_exception", VOID, []);
  mod.declareFunction("js_enter_finally", VOID, []);
  mod.declareFunction("js_leave_finally", VOID, []);
  mod.declareFunction("setjmp", I32, [PTR]);

  // --- Dispatch init ---
  mod.declareFunction("js_stdlib_init_dispatch", VOID, []);

  // --- JSON ---
  mod.declareFunction("js_json_stringify", PTR, [DOUBLE, I32]);
  mod.declareFunction("js_json_parse", I64, [PTR]);

  // --- Promise ---
  // js_promise_new() -> *mut PromiseHeader
  mod.declareFunction("js_promise_new", PTR, []);
  // js_promise_resolve(promise: *mut PromiseHeader, value: f64)
  mod.declareFunction("js_promise_resolve", VOID, [PTR, DOUBLE]);
  // js_promise_reject(promise: *mut PromiseHeader, reason: f64)
  mod.declareFunction("js_promise_reject", VOID, [PTR, DOUBLE]);
  // js_promise_then(promise: *mut PromiseHeader, on_fulfilled: *ClosureHeader, on_rejected: *ClosureHeader) -> *mut PromiseHeader
  mod.declareFunction("js_promise_then", PTR, [PTR, PTR, PTR]);
  // js_promise_run_microtasks()
  mod.declareFunction("js_promise_run_microtasks", VOID, []);
  // js_promise_state(promise: *mut PromiseHeader) -> i32 (0=pending, 1=fulfilled, 2=rejected)
  mod.declareFunction("js_promise_state", I32, [PTR]);
  // js_promise_value(promise: *mut PromiseHeader) -> f64
  mod.declareFunction("js_promise_value", DOUBLE, [PTR]);
  // js_await_any_promise(value: f64) -> f64  (blocks until resolved)
  mod.declareFunction("js_await_any_promise", DOUBLE, [DOUBLE]);

  // --- Stubs (from stubs.c) ---
  mod.declareFunction("pd_add_dynamic", DOUBLE, [DOUBLE, DOUBLE]);
}
