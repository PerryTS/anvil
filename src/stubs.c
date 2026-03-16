// Stub implementations for functions not in libperry_runtime.a
// These are needed for anvil's self-compilation
// All pd_* functions accept/return NaN-boxed doubles

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <libgen.h>
#include <sys/stat.h>
#include <limits.h>

// Forward declarations for runtime functions we call
extern long long js_string_from_bytes(const char* ptr, int len);
extern double js_nanbox_string(long long handle);
extern long long js_nanbox_get_pointer(double val);
extern double js_nanbox_pointer(long long ptr_val);
extern void* js_array_alloc(int capacity);
extern void* js_array_push_f64(void* arr, double val);

// NaN-boxing constants (must match perry-runtime/src/value.rs)
static const unsigned long long TAG_TRUE  = 0x7FFC000000000004ULL;
static const unsigned long long TAG_FALSE = 0x7FFC000000000003ULL;
static const unsigned long long TAG_UNDEFINED = 0x7FFC000000000001ULL;

// StringHeader layout: { u32 length, u32 capacity } then data bytes
typedef struct {
    unsigned int length;
    unsigned int capacity;
} StringHeader;

// Extract string data pointer (follows header)
static const char* sh_data(long long sh_ptr) {
    return (const char*)sh_ptr + sizeof(StringHeader);
}

// Get string length from header
static unsigned int sh_len(long long sh_ptr) {
    return ((StringHeader*)sh_ptr)->length;
}

// Extract a NaN-boxed string to a null-terminated C string in buf
static void str_extract(double val, char* buf, int bufsize) {
    long long ptr = js_nanbox_get_pointer(val);
    unsigned int len = sh_len(ptr);
    if ((int)len >= bufsize) len = (unsigned int)(bufsize - 1);
    memcpy(buf, sh_data(ptr), len);
    buf[len] = '\0';
}

// Create a NaN-boxed string from a C string
static double str_box(const char* s) {
    int len = (int)strlen(s);
    long long handle = js_string_from_bytes(s, len);
    return js_nanbox_string(handle);
}

// Bitcast i64 to double
static double i64_to_f64(unsigned long long bits) {
    double d;
    memcpy(&d, &bits, sizeof(d));
    return d;
}

// ============================================================
// Dynamic property access (handles string, array, and object)
// ============================================================

extern double js_array_get_f64(void* arr, int index);
extern void js_array_set_f64(void* arr, int index, double val);
extern long long js_string_char_at(long long str_handle, int index);
extern double js_object_get_field_by_name_f64(void* obj_ptr, long long name_str);
extern void js_object_set_field_by_name(void* obj_ptr, long long name_str, double val);

static int is_nanbox_string(double val) {
    unsigned long long bits;
    memcpy(&bits, &val, sizeof(bits));
    unsigned long long tag = bits >> 48;
    return tag == 0x7FFF;
}

// pd_dynamic_get(obj, key) -> value
// Dispatches based on obj/key types:
//   str[number] -> js_string_char_at
//   arr[number] -> js_array_get_f64
//   obj[string] -> js_object_get_field_by_name_f64
double pd_dynamic_get(double obj, double key) {
    if (key == key) {
        // Key is a regular number (not NaN)
        int idx = (int)key;
        if (is_nanbox_string(obj)) {
            // String character access
            unsigned long long bits;
            memcpy(&bits, &obj, sizeof(bits));
            long long str_handle = (long long)(bits & 0x0000FFFFFFFFFFFFULL);
            long long char_handle = js_string_char_at(str_handle, idx);
            return js_nanbox_string(char_handle);
        } else {
            // Array element access
            void* arr_ptr = (void*)js_nanbox_get_pointer(obj);
            return js_array_get_f64(arr_ptr, idx);
        }
    } else {
        // Key is NaN-boxed (string) — object field access by name
        long long obj_i64 = js_nanbox_get_pointer(obj);
        unsigned long long key_bits;
        memcpy(&key_bits, &key, sizeof(key_bits));
        long long key_str = (long long)(key_bits & 0x0000FFFFFFFFFFFFULL);
        return js_object_get_field_by_name_f64((void*)obj_i64, key_str);
    }
}

// pd_dynamic_set(obj, key, value)
double pd_dynamic_set(double obj, double key, double val) {
    if (key == key) {
        // Numeric index — array set
        void* arr_ptr = (void*)js_nanbox_get_pointer(obj);
        js_array_set_f64(arr_ptr, (int)key, val);
    } else {
        // String key — object field set by name
        long long obj_i64 = js_nanbox_get_pointer(obj);
        unsigned long long key_bits;
        memcpy(&key_bits, &key, sizeof(key_bits));
        long long key_str = (long long)(key_bits & 0x0000FFFFFFFFFFFFULL);
        js_object_set_field_by_name((void*)obj_i64, key_str, val);
    }
    return val;
}

// pd_dynamic_length(obj) -> i32 length
// Returns .length for strings or arrays
extern int js_array_length(void* arr);
extern int js_string_length(long long str_handle);

int pd_dynamic_length(double obj) {
    if (is_nanbox_string(obj)) {
        unsigned long long bits;
        memcpy(&bits, &obj, sizeof(bits));
        long long str_handle = (long long)(bits & 0x0000FFFFFFFFFFFFULL);
        return js_string_length(str_handle);
    } else {
        void* ptr = (void*)js_nanbox_get_pointer(obj);
        return js_array_length(ptr);
    }
}

// ============================================================
// Global argc/argv storage
// ============================================================
static int g_argc = 0;
static char** g_argv = NULL;

// Called by Perry's init before main
void js_set_args(int argc, char** argv) {
    g_argc = argc;
    g_argv = argv;
}

// ============================================================
// Process
// ============================================================

// pd_process_get_argv() -> nanboxed array of strings
// Adds a dummy argv[0] to match Node.js convention (node, script, ...args)
// so that process.argv.slice(2) works correctly for native binaries
double pd_process_get_argv(void) {
    void* arr = js_array_alloc(g_argc + 1 > 4 ? g_argc + 1 : 4);
    // Dummy argv[0] to simulate Node.js's "node" entry
    long long dummy = js_string_from_bytes("perry", 5);
    arr = js_array_push_f64(arr, js_nanbox_string(dummy));
    for (int i = 0; i < g_argc; i++) {
        int len = (int)strlen(g_argv[i]);
        long long str_handle = js_string_from_bytes(g_argv[i], len);
        double boxed_str = js_nanbox_string(str_handle);
        arr = js_array_push_f64(arr, boxed_str);
    }
    long long arr_i64 = (long long)(void*)arr;
    return js_nanbox_pointer(arr_i64);
}

// pd_process_cwd() -> nanboxed string
double pd_process_cwd(void) {
    char buf[PATH_MAX];
    if (getcwd(buf, sizeof(buf)) == NULL) {
        buf[0] = '.';
        buf[1] = '\0';
    }
    return str_box(buf);
}

// js_get_process() -> a dummy nanboxed value (process methods are handled as builtins)
double js_get_process(void) {
    return 0.0;
}

// ============================================================
// __dirname
// ============================================================

// pd_get_dirname() -> nanboxed string with __dirname value (= cwd for now)
double pd_get_dirname(void) {
    char buf[PATH_MAX];
    if (getcwd(buf, sizeof(buf)) == NULL) {
        buf[0] = '.';
        buf[1] = '\0';
    }
    return str_box(buf);
}

// ============================================================
// Path operations
// ============================================================

// pd_path_resolve(base, rel) -> nanboxed resolved path
// Both args are NaN-boxed strings
double pd_path_resolve(double base_val, double rel_val) {
    char base[PATH_MAX];
    char rel[PATH_MAX];
    str_extract(base_val, base, PATH_MAX);
    str_extract(rel_val, rel, PATH_MAX);

    char result[PATH_MAX];
    if (rel[0] == '/') {
        // Absolute path - use as-is
        strncpy(result, rel, PATH_MAX - 1);
        result[PATH_MAX - 1] = '\0';
    } else {
        // Relative path - join with base
        snprintf(result, PATH_MAX, "%s/%s", base, rel);
    }

    // Normalize: resolve . and ..
    char normalized[PATH_MAX];
    char* parts[256];
    int nparts = 0;

    // Copy to work buffer
    char work[PATH_MAX];
    strncpy(work, result, PATH_MAX - 1);
    work[PATH_MAX - 1] = '\0';

    int is_absolute = (work[0] == '/');
    char* tok = strtok(work, "/");
    while (tok != NULL) {
        if (strcmp(tok, ".") == 0) {
            // skip
        } else if (strcmp(tok, "..") == 0) {
            if (nparts > 0) nparts--;
        } else {
            parts[nparts++] = tok;
        }
        tok = strtok(NULL, "/");
    }

    normalized[0] = '\0';
    if (is_absolute) strcat(normalized, "/");
    for (int i = 0; i < nparts; i++) {
        if (i > 0) strcat(normalized, "/");
        strcat(normalized, parts[i]);
    }
    if (normalized[0] == '\0') strcpy(normalized, ".");

    return str_box(normalized);
}

// pd_path_dirname(path) -> nanboxed string
double pd_path_dirname(double path_val) {
    char buf[PATH_MAX];
    str_extract(path_val, buf, PATH_MAX);
    // dirname() may modify the buffer, so copy first
    char copy[PATH_MAX];
    strncpy(copy, buf, PATH_MAX - 1);
    copy[PATH_MAX - 1] = '\0';
    char* dir = dirname(copy);
    return str_box(dir);
}

// pd_path_basename(path) -> nanboxed string
double pd_path_basename(double path_val) {
    char buf[PATH_MAX];
    str_extract(path_val, buf, PATH_MAX);
    char copy[PATH_MAX];
    strncpy(copy, buf, PATH_MAX - 1);
    copy[PATH_MAX - 1] = '\0';
    char* base = basename(copy);
    return str_box(base);
}

// pd_path_join(a, b) -> nanboxed string
double pd_path_join(double a_val, double b_val) {
    char a[PATH_MAX];
    char b[PATH_MAX];
    str_extract(a_val, a, PATH_MAX);
    str_extract(b_val, b, PATH_MAX);

    char result[PATH_MAX];
    if (b[0] == '/') {
        strncpy(result, b, PATH_MAX - 1);
        result[PATH_MAX - 1] = '\0';
    } else {
        snprintf(result, PATH_MAX, "%s/%s", a, b);
    }
    return str_box(result);
}

// pd_path_relative(base, target) -> nanboxed string
double pd_path_relative(double base_val, double target_val) {
    char base[PATH_MAX];
    char target[PATH_MAX];
    str_extract(base_val, base, PATH_MAX);
    str_extract(target_val, target, PATH_MAX);

    // Find common prefix
    int last_sep = 0;
    int i = 0;
    while (base[i] && target[i] && base[i] == target[i]) {
        if (base[i] == '/') last_sep = i + 1;
        i++;
    }
    if (!base[i] && (!target[i] || target[i] == '/')) {
        last_sep = i;
        if (target[i] == '/') last_sep++;
    }

    // Count remaining dirs in base to add ../ prefixes
    char result[PATH_MAX];
    result[0] = '\0';
    const char* bp = base + last_sep;
    while (*bp) {
        if (*bp == '/') {
            strcat(result, "../");
        }
        bp++;
    }
    if (base[last_sep] != '\0') {
        // There's still a non-empty remaining part of base
        strcat(result, "../");
    }

    strcat(result, target + last_sep);

    if (result[0] == '\0') strcpy(result, ".");
    // Remove trailing slash if any
    int rlen = (int)strlen(result);
    if (rlen > 1 && result[rlen - 1] == '/') result[rlen - 1] = '\0';

    return str_box(result);
}

// pd_path_extname(path) -> nanboxed string (file extension)
double pd_path_extname(double path_val) {
    char path[PATH_MAX];
    str_extract(path_val, path, PATH_MAX);

    // Find last '.' after last '/'
    const char* last_dot = NULL;
    const char* last_sep = path;
    for (const char* p = path; *p; p++) {
        if (*p == '/') { last_sep = p + 1; last_dot = NULL; }
        if (*p == '.') last_dot = p;
    }
    if (last_dot != NULL && last_dot > last_sep && last_dot != last_sep) {
        return str_box(last_dot);
    }
    return str_box("");
}

// pd_path_normalize(path) -> nanboxed string (simplified)
double pd_path_normalize(double path_val) {
    // For now, just return the path as-is
    return path_val;
}

// pd_path_is_absolute(path) -> nanboxed bool
double pd_path_is_absolute(double path_val) {
    char path[PATH_MAX];
    str_extract(path_val, path, PATH_MAX);
    if (path[0] == '/') {
        uint64_t tag = 0x7FFC000000000004ULL; // TAG_TRUE
        double result;
        memcpy(&result, &tag, 8);
        return result;
    }
    uint64_t tag = 0x7FFC000000000003ULL; // TAG_FALSE
    double result;
    memcpy(&result, &tag, 8);
    return result;
}

// ============================================================
// Filesystem operations
// ============================================================

// pd_fs_read_file_sync(path, encoding) -> nanboxed string
double pd_fs_read_file_sync(double path_val, double encoding_val) {
    char filepath[PATH_MAX];
    str_extract(path_val, filepath, PATH_MAX);

    FILE* f = fopen(filepath, "rb");
    if (f == NULL) {
        fprintf(stderr, "pd_fs_read_file_sync: cannot open '%s'\n", filepath);
        exit(1);
    }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);

    char* data = (char*)malloc(size + 1);
    if (data == NULL) {
        fprintf(stderr, "pd_fs_read_file_sync: malloc failed\n");
        fclose(f);
        exit(1);
    }
    long nread = (long)fread(data, 1, size, f);
    fclose(f);
    data[nread] = '\0';

    long long handle = js_string_from_bytes(data, (int)nread);
    free(data);
    return js_nanbox_string(handle);
}

// pd_fs_write_file_sync(path, data) -> undefined
double pd_fs_write_file_sync(double path_val, double data_val) {
    char filepath[PATH_MAX];
    str_extract(path_val, filepath, PATH_MAX);

    long long data_ptr = js_nanbox_get_pointer(data_val);
    unsigned int data_len = sh_len(data_ptr);
    const char* data = sh_data(data_ptr);

    FILE* f = fopen(filepath, "wb");
    if (f == NULL) {
        fprintf(stderr, "pd_fs_write_file_sync: cannot open '%s' for writing\n", filepath);
        exit(1);
    }
    fwrite(data, 1, data_len, f);
    fclose(f);

    return i64_to_f64(TAG_UNDEFINED);
}

// pd_fs_exists_sync(path) -> numeric 1.0/0.0 (Perry returns numeric booleans)
double pd_fs_exists_sync(double path_val) {
    char filepath[PATH_MAX];
    str_extract(path_val, filepath, PATH_MAX);

    if (access(filepath, F_OK) == 0) {
        return 1.0;
    }
    return 0.0;
}

// pd_fs_unlink_sync(path) -> undefined
double pd_fs_unlink_sync(double path_val) {
    char filepath[PATH_MAX];
    str_extract(path_val, filepath, PATH_MAX);
    unlink(filepath);
    return i64_to_f64(TAG_UNDEFINED);
}

// ============================================================
// Dynamic add (handles number+number and string+string)
// ============================================================

// NaN-boxing tag masks
static const unsigned long long STRING_TAG_MASK = 0x7FFF000000000000ULL;
static const unsigned long long TAG_MASK        = 0xFFFF000000000000ULL;
static const unsigned long long POINTER_MASK_VAL = 0x0000FFFFFFFFFFFFULL;

extern long long js_string_concat(long long a, long long b);
extern long long js_jsvalue_to_string(double val);

static unsigned long long f64_to_i64(double d) {
    unsigned long long bits;
    memcpy(&bits, &d, sizeof(bits));
    return bits;
}

// pd_add_dynamic(a, b) -> nanboxed result
// If either operand is a string, concatenate as strings.
// Otherwise, add as numbers.
double pd_add_dynamic(double a, double b) {
    unsigned long long a_bits = f64_to_i64(a);
    unsigned long long b_bits = f64_to_i64(b);
    unsigned long long a_tag = a_bits & TAG_MASK;
    unsigned long long b_tag = b_bits & TAG_MASK;

    int a_is_string = (a_tag == STRING_TAG_MASK);
    int b_is_string = (b_tag == STRING_TAG_MASK);

    if (a_is_string || b_is_string) {
        // String concatenation
        long long a_str, b_str;
        if (a_is_string) {
            a_str = (long long)(a_bits & POINTER_MASK_VAL);
        } else {
            a_str = js_jsvalue_to_string(a);
        }
        if (b_is_string) {
            b_str = (long long)(b_bits & POINTER_MASK_VAL);
        } else {
            b_str = js_jsvalue_to_string(b);
        }
        long long result = js_string_concat(a_str, b_str);
        return js_nanbox_string(result);
    }

    // Numeric addition - just add directly (both are plain f64 numbers)
    return a + b;
}

// ============================================================
// execSync
// ============================================================

// js_stdlib_process_pending() - called by UI event loop internals
// Stub: no pending stdlib work in anvil-compiled binaries
void js_stdlib_process_pending(void) {
    // no-op
}

#ifdef PERRY_UI_STUBS
// ============================================================
// Perry UI bridge wrappers
// Anvil passes all args as NaN-boxed doubles. These wrappers
// unbox handles/strings to i64 and call the real perry_ui_* C functions.
// ============================================================

// Perry UI extern declarations
extern long long perry_ui_app_create(long long title_ptr, double width, double height);
extern void perry_ui_app_set_body(long long app_handle, long long body_handle);
extern void perry_ui_app_run(long long app_handle);
extern long long perry_ui_text_create(long long text_ptr);
extern long long perry_ui_button_create(long long label_ptr, double on_press);
extern long long perry_ui_hstack_create(double spacing);
extern long long perry_ui_vstack_create(double spacing);
extern long long perry_ui_vstack_create_with_insets(double spacing, double top, double left, double bottom, double right);
extern long long perry_ui_hstack_create_with_insets(double spacing, double top, double left, double bottom, double right);
extern long long perry_ui_scrollview_create(void);
extern long long perry_ui_spacer_create(void);
extern long long perry_ui_divider_create(void);
extern void perry_ui_widget_add_child(long long parent, long long child);
extern void perry_ui_widget_clear_children(long long handle);
extern void perry_ui_scrollview_set_child(long long scroll, long long child);
extern void perry_ui_scrollview_set_offset(long long scroll, double offset);
extern double perry_ui_scrollview_get_offset(long long scroll);
extern void perry_ui_text_set_color(long long handle, double r, double g, double b, double a);
extern void perry_ui_text_set_font_size(long long handle, double size);
extern void perry_ui_text_set_font_weight(long long handle, double size, double weight);
extern void perry_ui_text_set_selectable(long long handle, double selectable);
extern void perry_ui_text_set_string(long long handle, long long text_ptr);
extern void perry_ui_text_set_wraps(long long handle, double max_width);
extern void perry_ui_button_set_bordered(long long handle, double bordered);
extern void perry_ui_textfield_focus(long long handle);
extern void perry_ui_add_keyboard_shortcut(long long key_ptr, double modifiers, double callback);
extern double perry_ui_clipboard_read(void);
extern void perry_ui_clipboard_write(long long text_ptr);
extern void perry_ui_widget_set_background_color(long long handle, double r, double g, double b, double a);
extern void perry_ui_widget_set_edge_insets(long long handle, double top, double left, double bottom, double right);
extern void perry_ui_widget_set_on_click(long long handle, double callback);
extern long long perry_ui_textfield_create(long long placeholder_ptr, double on_change);
extern void perry_ui_textfield_set_string(long long handle, long long text_ptr);
extern long long perry_ui_textfield_get_string(long long handle);

// Runtime function for extracting string pointer from NaN-boxed string
extern long long js_get_string_pointer_unified(double val);

// Helper: unbox a NaN-boxed handle to i64
static long long unbox_handle(double val) {
    return js_nanbox_get_pointer(val);
}

// Helper: box an i64 handle to NaN-boxed double
static double box_handle(long long handle) {
    return js_nanbox_pointer(handle);
}

// Helper: unbox a NaN-boxed string to raw StringHeader* (i64)
static long long unbox_string(double val) {
    return js_get_string_pointer_unified(val);
}

// pd_ui_App(config_object) -> NaN-boxed handle
// Desugars: App({title, width, height, body}) -> app_create + app_set_body + app_run
double pd_ui_App(double config_val) {
    void* config_ptr = (void*)unbox_handle(config_val);
    // Get fields by name
    long long title_name = js_string_from_bytes("title", 5);
    long long width_name = js_string_from_bytes("width", 5);
    long long height_name = js_string_from_bytes("height", 6);
    long long body_name = js_string_from_bytes("body", 4);

    double title_f64 = js_object_get_field_by_name_f64(config_ptr, title_name);
    double width_f64 = js_object_get_field_by_name_f64(config_ptr, width_name);
    double height_f64 = js_object_get_field_by_name_f64(config_ptr, height_name);
    double body_f64 = js_object_get_field_by_name_f64(config_ptr, body_name);

    long long title_ptr = unbox_string(title_f64);
    long long body_handle = unbox_handle(body_f64);

    long long app_handle = perry_ui_app_create(title_ptr, width_f64, height_f64);
    perry_ui_app_set_body(app_handle, body_handle);
    perry_ui_app_run(app_handle);
    return box_handle(app_handle);
}

// pd_ui_Text(text) -> NaN-boxed handle
double pd_ui_Text(double text_val) {
    long long text_ptr = unbox_string(text_val);
    long long handle = perry_ui_text_create(text_ptr);
    return box_handle(handle);
}

// pd_ui_Button(label, on_press) -> NaN-boxed handle
double pd_ui_Button(double label_val, double on_press) {
    long long label_ptr = unbox_string(label_val);
    long long handle = perry_ui_button_create(label_ptr, on_press);
    return box_handle(handle);
}

// pd_ui_HStack(spacing) -> NaN-boxed handle
double pd_ui_HStack(double spacing) {
    long long handle = perry_ui_hstack_create(spacing);
    return box_handle(handle);
}

// pd_ui_VStack(spacing) -> NaN-boxed handle
double pd_ui_VStack(double spacing) {
    long long handle = perry_ui_vstack_create(spacing);
    return box_handle(handle);
}

// pd_ui_VStackWithInsets(spacing, top, left, bottom, right) -> NaN-boxed handle
double pd_ui_VStackWithInsets(double spacing, double top, double left, double bottom, double right) {
    long long handle = perry_ui_vstack_create_with_insets(spacing, top, left, bottom, right);
    return box_handle(handle);
}

// pd_ui_HStackWithInsets(spacing, top, left, bottom, right) -> NaN-boxed handle
double pd_ui_HStackWithInsets(double spacing, double top, double left, double bottom, double right) {
    long long handle = perry_ui_hstack_create_with_insets(spacing, top, left, bottom, right);
    return box_handle(handle);
}

// pd_ui_ScrollView() -> NaN-boxed handle
double pd_ui_ScrollView(void) {
    long long handle = perry_ui_scrollview_create();
    return box_handle(handle);
}

// pd_ui_Spacer() -> NaN-boxed handle
double pd_ui_Spacer(void) {
    long long handle = perry_ui_spacer_create();
    return box_handle(handle);
}

// pd_ui_Divider() -> NaN-boxed handle
double pd_ui_Divider(void) {
    long long handle = perry_ui_divider_create();
    return box_handle(handle);
}

// pd_ui_widgetAddChild(parent, child)
double pd_ui_widgetAddChild(double parent_val, double child_val) {
    perry_ui_widget_add_child(unbox_handle(parent_val), unbox_handle(child_val));
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_widgetClearChildren(handle)
double pd_ui_widgetClearChildren(double handle_val) {
    perry_ui_widget_clear_children(unbox_handle(handle_val));
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_scrollviewSetChild(scroll, child)
double pd_ui_scrollviewSetChild(double scroll_val, double child_val) {
    perry_ui_scrollview_set_child(unbox_handle(scroll_val), unbox_handle(child_val));
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_scrollviewSetOffset(scroll, offset)
double pd_ui_scrollviewSetOffset(double scroll_val, double offset) {
    perry_ui_scrollview_set_offset(unbox_handle(scroll_val), offset);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_scrollviewGetOffset(scroll) -> f64
double pd_ui_scrollviewGetOffset(double scroll_val) {
    return perry_ui_scrollview_get_offset(unbox_handle(scroll_val));
}

// pd_ui_textSetColor(handle, r, g, b, a)
double pd_ui_textSetColor(double handle_val, double r, double g, double b, double a) {
    perry_ui_text_set_color(unbox_handle(handle_val), r, g, b, a);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_textSetFontSize(handle, size)
double pd_ui_textSetFontSize(double handle_val, double size) {
    perry_ui_text_set_font_size(unbox_handle(handle_val), size);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_textSetFontWeight(handle, size, weight)
double pd_ui_textSetFontWeight(double handle_val, double size, double weight) {
    perry_ui_text_set_font_weight(unbox_handle(handle_val), size, weight);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_textSetSelectable(handle, selectable)
double pd_ui_textSetSelectable(double handle_val, double selectable) {
    perry_ui_text_set_selectable(unbox_handle(handle_val), selectable);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_textSetString(handle, text)
double pd_ui_textSetString(double handle_val, double text_val) {
    perry_ui_text_set_string(unbox_handle(handle_val), unbox_string(text_val));
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_textSetWraps(handle, maxWidth)
double pd_ui_textSetWraps(double handle_val, double max_width) {
    perry_ui_text_set_wraps(unbox_handle(handle_val), max_width);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_buttonSetBordered(handle, bordered)
double pd_ui_buttonSetBordered(double handle_val, double bordered) {
    perry_ui_button_set_bordered(unbox_handle(handle_val), bordered);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_textfieldFocus(handle)
double pd_ui_textfieldFocus(double handle_val) {
    perry_ui_textfield_focus(unbox_handle(handle_val));
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_addKeyboardShortcut(key, modifiers, callback)
double pd_ui_addKeyboardShortcut(double key_val, double modifiers, double callback) {
    perry_ui_add_keyboard_shortcut(unbox_string(key_val), modifiers, callback);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_clipboardRead() -> NaN-boxed string
double pd_ui_clipboardRead(void) {
    return perry_ui_clipboard_read();
}

// pd_ui_clipboardWrite(text)
double pd_ui_clipboardWrite(double text_val) {
    perry_ui_clipboard_write(unbox_string(text_val));
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_widgetSetBackgroundColor(handle, r, g, b, a)
double pd_ui_widgetSetBackgroundColor(double handle_val, double r, double g, double b, double a) {
    perry_ui_widget_set_background_color(unbox_handle(handle_val), r, g, b, a);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_widgetSetEdgeInsets(handle, top, left, bottom, right)
double pd_ui_widgetSetEdgeInsets(double handle_val, double top, double left, double bottom, double right) {
    perry_ui_widget_set_edge_insets(unbox_handle(handle_val), top, left, bottom, right);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_widgetSetOnClick(handle, callback)
double pd_ui_widgetSetOnClick(double handle_val, double callback) {
    perry_ui_widget_set_on_click(unbox_handle(handle_val), callback);
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_TextField(placeholder, onChange) -> NaN-boxed handle
double pd_ui_TextField(double placeholder_val, double on_change) {
    long long placeholder_ptr = unbox_string(placeholder_val);
    long long handle = perry_ui_textfield_create(placeholder_ptr, on_change);
    return box_handle(handle);
}

// pd_ui_textfieldSetString(handle, text)
double pd_ui_textfieldSetString(double handle_val, double text_val) {
    perry_ui_textfield_set_string(unbox_handle(handle_val), unbox_string(text_val));
    return i64_to_f64(TAG_UNDEFINED);
}

// pd_ui_textfieldGetString(handle) -> NaN-boxed string
double pd_ui_textfieldGetString(double handle_val) {
    long long str_ptr = perry_ui_textfield_get_string(unbox_handle(handle_val));
    return js_nanbox_string(str_ptr);
}

// Menu
extern long long perry_ui_menu_create(void);
extern void perry_ui_menu_add_item(long long menu_handle, long long title_ptr, double callback);
extern void perry_ui_widget_set_context_menu(long long widget_handle, long long menu_handle);

double pd_ui_menuCreate(void) {
    return box_handle(perry_ui_menu_create());
}

double pd_ui_menuAddItem(double menu_val, double title_val, double callback) {
    perry_ui_menu_add_item(unbox_handle(menu_val), unbox_string(title_val), callback);
    return i64_to_f64(TAG_UNDEFINED);
}

double pd_ui_widgetSetContextMenu(double widget_val, double menu_val) {
    perry_ui_widget_set_context_menu(unbox_handle(widget_val), unbox_handle(menu_val));
    return i64_to_f64(TAG_UNDEFINED);
}

// execSync(cmd_val, opts_val) -> nanboxed string result
double execSync(double cmd_val, double opts_val) {
    char cmd[8192];
    str_extract(cmd_val, cmd, 8192);

    int ret = system(cmd);
    if (ret != 0) {
        fprintf(stderr, "execSync failed (exit %d): %s\n", ret, cmd);
        exit(1);
    }

    // Return empty string (execSync with stdio:"inherit" doesn't capture output)
    long long str_handle = js_string_from_bytes("", 0);
    return js_nanbox_string(str_handle);
}
#endif // PERRY_UI_STUBS
