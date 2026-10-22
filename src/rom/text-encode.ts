// Writing FE text: vanilla FE8 reads only Huffman-compressed text (msg.c calls the ARM decompressor
// for every entry), so new text is encoded with the ROM's own tree. The inverse of decodeTextBytes:
// each leaf of the tree holds one byte or a pair, and its path from the root is its code, read from
// the lowest bit of each byte up. A leaf holding 0 ends the text.

import type { GbaRom } from './gba-rom';
import type { TextTable } from './text';

/** Each leaf's value (a byte, or two bytes as low | high << 8) and its code as bits. */
export type HuffmanCodes = ReadonlyMap<number, readonly number[]>;

const MAX_DEPTH = 64;

export function readHuffmanCodes(rom: GbaRom, t: TextTable): HuffmanCodes {
  const codes = new Map<number, number[]>();
  const walk = (node: number, path: number[]) => {
    if (path.length > MAX_DEPTH || node < 0 || node + 4 > rom.size) return;
    const w = rom.u32(node);
    if (w & 0x80000000) {
      const v = w & 0xffff;
      if (!codes.has(v)) codes.set(v, path);
      return;
    }
    walk(t.nodes + rom.u16(node) * 4, [...path, 0]);
    walk(t.nodes + rom.u16(node + 2) * 4, [...path, 1]);
  };
  walk(t.root, []);
  return codes;
}

/** `text` (bytes, without a terminator) compressed with `codes`, ending with the terminator. Throws if a byte has no code. */
export function encodeTextBytes(codes: HuffmanCodes, text: readonly number[]): Uint8Array {
  const bits: number[] = [];
  for (let i = 0; i < text.length; ) {
    const b = text[i]!;
    const pair = i + 1 < text.length ? codes.get(b | (text[i + 1]! << 8)) : undefined;
    const code = pair ?? codes.get(b);
    if (!code || b === 0) throw new Error(`The game's text can't show "${String.fromCharCode(b)}".`);
    bits.push(...code);
    i += pair ? 2 : 1;
  }
  const end = codes.get(0);
  if (!end) throw new Error("This ROM's text has no end marker.");
  bits.push(...end);
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, k) => (out[k >> 3]! |= bit << (k & 7)));
  return out;
}
