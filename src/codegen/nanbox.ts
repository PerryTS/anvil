// NaN-boxing constants matching perry-runtime/src/value.rs exactly

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
  // LLVM IR expects scientific notation for doubles
  return v.toExponential(6).replace("+", "");
}
