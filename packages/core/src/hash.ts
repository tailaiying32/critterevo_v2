/** FNV-1a hashing for the state hash (docs/DESIGN.md §3.3). */
export const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Hashes 32-bit integers, low byte first. */
export function fnv1aWords(values: readonly number[], seed = FNV_OFFSET): number {
  let hash = seed;
  for (const value of values) {
    let v = value | 0;
    for (let i = 0; i < 4; i++) {
      hash ^= v & 0xff;
      hash = Math.imul(hash, FNV_PRIME);
      v >>>= 8;
    }
  }
  return hash >>> 0;
}

/** Hashes the bytes of a typed array, exactly as stored. */
export function fnv1aArray(array: ArrayBufferView, seed = FNV_OFFSET): number {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = seed;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function toHex(hash: number): string {
  return hash.toString(16).padStart(8, "0");
}
