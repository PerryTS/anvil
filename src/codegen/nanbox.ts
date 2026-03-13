// NaN-boxing constants matching perry-runtime/src/value.rs exactly
// Both bigint form (for Node.js arithmetic) and string form (for i64 literals in LLVM IR)
// String form avoids precision loss when bigints are stored as doubles in self-compiled binary

export const TAG_UNDEFINED  = 0x7FFC_0000_0000_0001n;
export const TAG_NULL       = 0x7FFC_0000_0000_0002n;
export const TAG_FALSE      = 0x7FFC_0000_0000_0003n;
export const TAG_TRUE       = 0x7FFC_0000_0000_0004n;
export const POINTER_TAG    = 0x7FFD_0000_0000_0000n;
export const POINTER_MASK   = 0x0000_FFFF_FFFF_FFFFn;
export const INT32_TAG      = 0x7FFE_0000_0000_0000n;
export const INT32_MASK     = 0x0000_0000_FFFF_FFFFn;
export const STRING_TAG     = 0x7FFF_0000_0000_0000n;
export const BIGINT_TAG     = 0x7FFA_0000_0000_0000n;
export const TAG_MASK       = 0xFFFF_0000_0000_0000n;

// Pre-computed string representations for use in LLVM IR generation
// These avoid bigint->double precision loss in the self-compiled binary
export const TAG_UNDEFINED_I64  = "9222246136947933185";
export const TAG_NULL_I64       = "9222246136947933186";
export const TAG_FALSE_I64      = "9222246136947933187";
export const TAG_TRUE_I64       = "9222246136947933188";
export const POINTER_TAG_I64    = "9222527611924643840";
export const POINTER_MASK_I64   = "281474976710655";
export const INT32_TAG_I64      = "9222809086901354496";
export const STRING_TAG_I64     = "9223090561878065152";

// Format a bigint as an i64 literal for LLVM IR
export function i64Literal(v: bigint): string {
  // LLVM IR uses signed i64, so we need to handle the sign
  if (v > 0x7FFF_FFFF_FFFF_FFFFn) {
    // Convert to signed representation
    return (v - (1n << 64n)).toString();
  }
  return v.toString();
}

// Format a double literal for LLVM IR
export function doubleLiteral(v: number): string {
  if (v === 0) {
    return "0.0";
  }
  // Use toString() since Perry doesn't support toExponential
  let s: string = v.toString();
  // Ensure decimal point for integer-like values (LLVM requires it for doubles)
  // Check for '.', 'e', or 'E' by scanning each character
  // (avoid >= comparison on indexOf results which has issues in self-compiled binary)
  let needsDot: boolean = true;
  for (let i = 0; i < s.length; i = i + 1) {
    const ch = s.charAt(i);
    if (ch === "." || ch === "e" || ch === "E") {
      needsDot = false;
    }
  }
  if (needsDot) {
    return s + ".0";
  }
  return s;
}
