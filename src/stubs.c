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

// pd_fs_exists_sync(path) -> nanboxed boolean
double pd_fs_exists_sync(double path_val) {
    char filepath[PATH_MAX];
    str_extract(path_val, filepath, PATH_MAX);

    if (access(filepath, F_OK) == 0) {
        return i64_to_f64(TAG_TRUE);
    }
    return i64_to_f64(TAG_FALSE);
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

    // Numeric addition
    extern double js_add(double a, double b);
    return js_add(a, b);
}

// ============================================================
// execSync
// ============================================================

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
