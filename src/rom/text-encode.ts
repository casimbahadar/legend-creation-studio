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
  const count = Math.floor((rom.size - t.nodes) / 4);
  return codesOfNodes((i) => (i >= 0 && i < count ? rom.u32(t.nodes + i * 4) : undefined), (t.root - t.nodes) / 4);
}

/** The codes of a tree given as its node words (by index) and its root's index. */
export function codesOfNodes(node: (index: number) => number | undefined, root: number): HuffmanCodes {
  const codes = new Map<number, number[]>();
  const walk = (index: number, path: number[]) => {
    const w = node(index);
    if (path.length > MAX_DEPTH || w === undefined) return;
    if (w & 0x80000000) {
      const v = w & 0xffff;
      if (!codes.has(v)) codes.set(v, path);
      return;
    }
    walk(w & 0xffff, [...path, 0]);
    walk(w >>> 16, [...path, 1]);
  };
  walk(root, []);
  return codes;
}

/**
 * The filler FE8 puts after the last letter of an odd-length string ("[.]"): letters are compressed
 * in pairs, and the game drops trailing fillers after decoding (msg.c, SetMsgTerminator).
 */
export const TEXT_FILLER = 0x1f;

/**
 * `text` (bytes, without a terminator) compressed with `codes`, ending with the terminator. FE8's
 * tree holds letters only in pairs, so a lone last letter is paired with the filler, as the game
 * does (unless `filler` is false, for text that must decode to exactly these bytes); otherwise the
 * shortest split into the pairs and single bytes the tree has is used. Throws when no split works.
 */
export function encodeTextBytes(codes: HuffmanCodes, text: readonly number[], filler = true): Uint8Array {
  const n = text.length;
  // best[i]: the shortest code for text[i..]; null if there is none.
  const best: ({ bits: number; symbol: number; next: number } | null)[] = new Array(n + 1).fill(null);
  best[n] = { bits: 0, symbol: -1, next: n };
  for (let i = n - 1; i >= 0; i--) {
    // A 0 on its own would end the text, so an inner 0 can only start a pair.
    const options: [number, number][] = text[i] === 0 ? [] : [[text[i]!, i + 1]];
    if (i + 1 < n && text[i + 1] !== 0) options.push([text[i]! | (text[i + 1]! << 8), i + 2]);
    if (filler && i + 1 === n && text[i] !== 0) options.push([text[i]! | (TEXT_FILLER << 8), n]);
    for (const [symbol, next] of options) {
      const code = codes.get(symbol);
      const rest = best[next];
      if (!code || !rest) continue;
      const bits = code.length + rest.bits;
      if (!best[i] || bits < best[i]!.bits) best[i] = { bits, symbol, next };
    }
  }
  if (!best[0]) throw new Error("The game's text can't spell this name. Try another spelling.");
  const end = codes.get(0);
  if (!end) throw new Error("This ROM's text has no end marker.");
  const bits: number[] = [];
  for (let i = 0; i < n; i = best[i]!.next) bits.push(...codes.get(best[i]!.symbol)!);
  bits.push(...end);
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, k) => (out[k >> 3]! |= bit << (k & 7)));
  return out;
}

/** Characters any name can use: printable ASCII, which the patch adds to the text when needed (text-extend). */
export const FIRST_PRINTABLE = 0x20;
export const LAST_PRINTABLE = 0x7e;

/**
 * Why `name` can't be written into the game, or null if it can: with the ROM's own `codes`, or, for
 * printable characters, once the patch has added letters to the game's text.
 */
export function nameProblem(codes: HuffmanCodes, name: string): string | null {
  const bytes = [...name.trim()].map((c) => c.charCodeAt(0));
  try {
    encodeTextBytes(codes, bytes);
    return null;
  } catch {
    // Otherwise each character needs a code of its own once letters are added: printable, or one the ROM has alone (such as é).
    const bad = bytes.find((b) => (b < FIRST_PRINTABLE || b > LAST_PRINTABLE) && !codes.has(b));
    return bad === undefined ? null : `The game's text can't show "${String.fromCharCode(bad)}". Use letters, numbers and common punctuation.`;
  }
}
