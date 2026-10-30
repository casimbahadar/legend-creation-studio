// GBA BIOS LZ77 (type 0x10) decompression, as used for FE maps, tiles and graphics.
// Ported from Endless Chronicle (index.html, Game().lz77).

export function decompressLz77(bytes: Uint8Array, offset: number): Uint8Array {
  const at = (i: number) => {
    if (i >= bytes.length) throw new RangeError('LZ77 data runs past the end of the ROM');
    return bytes[i]!;
  };
  if (at(offset) !== 0x10) throw new Error(`No LZ77 data at 0x${offset.toString(16)}`);
  const size = at(offset + 1) | (at(offset + 2) << 8) | (at(offset + 3) << 16);
  const out = new Uint8Array(size);
  let o = 0;
  let i = offset + 4;
  while (o < size) {
    const flags = at(i++);
    for (let b = 0; b < 8 && o < size; b++) {
      if (flags & (0x80 >> b)) {
        const v = (at(i) << 8) | at(i + 1);
        i += 2;
        const length = (v >> 12) + 3;
        const distance = (v & 0xfff) + 1;
        if (distance > o) throw new Error('LZ77 back-reference before the start of the output');
        for (let k = 0; k < length && o < size; k++, o++) out[o] = out[o - distance]!;
      } else {
        out[o++] = at(i++);
      }
    }
  }
  return out;
}

/**
 * FE8's Decompress (src/bmlib.c): data whose first byte says how it's stored, raw (0x00: the bytes after
 * a 4-byte header whose upper 24 bits are the size, header included; UnpackRaw) or LZ77 (0x10).
 */
export function decompress(bytes: Uint8Array, offset: number): Uint8Array {
  if (offset + 4 > bytes.length) throw new RangeError('Data runs past the end of the ROM');
  if (bytes[offset] === 0x10) return decompressLz77(bytes, offset);
  if (bytes[offset] !== 0x00) throw new Error(`No raw or LZ77 data at 0x${offset.toString(16)}`);
  const size = (bytes[offset + 1]! | (bytes[offset + 2]! << 8) | (bytes[offset + 3]! << 16)) - 4;
  if (size < 0 || offset + 4 + size > bytes.length) throw new RangeError('Raw data runs past the end of the ROM');
  return bytes.slice(offset + 4, offset + 4 + size);
}
