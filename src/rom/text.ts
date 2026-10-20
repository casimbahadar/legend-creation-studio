// FE text: Huffman-compressed strings in any GBA Fire Emblem ROM.
// Ported from Endless Chronicle (index.html, textDecoderFor), without its 40-character cap.
//
// Layout the finder relies on: the word at X points at X - 4, the Huffman root node.
// The text table (one pointer per text id) follows at X + 4. Tree nodes are two u16
// child indices (left for bit 0, right for bit 1); a node whose top bit is set is a
// leaf holding one or two bytes. A text pointer with bit 31 set is uncompressed.

import type { GbaRom } from './gba-rom';

/** FE8 US: the game's text routine holds the text table address here. Hacks that move the table update it. */
const FE8U_TEXT_TABLE_POINTER = 0xa2a0;
const MIN_TABLE_ENTRIES = 500;
const MAX_TABLE_ENTRIES = 12000;
const MAX_TEXT_BYTES = 0x4000;

export interface TextTable {
  /** Offset of the Huffman root node. */
  readonly root: number;
  /** Offset of tree node 0. */
  readonly nodes: number;
  /** Offset of the text pointer table. */
  readonly table: number;
  /** Number of text ids in the table. */
  readonly count: number;
}

function countEntries(rom: GbaRom, table: number): number {
  let m = 0;
  while (m < MAX_TABLE_ENTRIES && table + m * 4 + 4 <= rom.size && rom.isPointer(rom.u32(table + m * 4) & 0x7fffffff)) m++;
  return m;
}

/** Finds the Huffman tree and text table by their shape, so hacks and other GBA FE games work too. */
export function findTextTable(rom: GbaRom): TextTable | null {
  let best: { x: number; count: number } | null = null;
  for (let x = 4; x + 8 <= rom.size; x += 4) {
    if (rom.u32(x) !== 0x08000000 + x - 4) continue;
    const count = countEntries(rom, x + 4);
    if (count >= MIN_TABLE_ENTRIES && (!best || count > best.count)) best = { x, count };
  }
  if (!best) return null;

  const root = best.x - 4;
  const nodes = root - (Math.max(rom.u16(root), rom.u16(root + 2)) + 1) * 4;
  let table = best.x + 4;
  let count = best.count;
  if (rom.size >= FE8U_TEXT_TABLE_POINTER + 4) {
    const p = rom.u32(FE8U_TEXT_TABLE_POINTER);
    if (rom.isPointer(p)) {
      const moved = rom.offsetOf(p);
      const movedCount = countEntries(rom, moved);
      if (movedCount >= 2) {
        table = moved;
        count = movedCount;
      }
    }
  }
  return { root, nodes, table, count };
}

/** Raw bytes of one text entry, without the terminating 0. Empty if the id has no valid pointer. */
export function decodeTextBytes(rom: GbaRom, t: TextTable, id: number): Uint8Array {
  if (!Number.isInteger(id) || id < 0 || id >= t.count) return new Uint8Array();
  const p = rom.u32(t.table + id * 4);
  if (!rom.isPointer(p & 0x7fffffff)) return new Uint8Array();
  const out: number[] = [];

  if (p & 0x80000000) {
    let a = rom.offsetOf(p & 0x7fffffff);
    while (a < rom.size && rom.u8(a) !== 0 && out.length < MAX_TEXT_BYTES) out.push(rom.u8(a++));
    return Uint8Array.from(out);
  }

  const start = rom.offsetOf(p);
  let bit = 0;
  let node = t.root;
  for (let steps = 0; out.length < MAX_TEXT_BYTES && steps < MAX_TEXT_BYTES * 32; steps++) {
    const w = rom.u32(node);
    if (w & 0x80000000) {
      const v = w & 0xffff;
      if (!v) break;
      out.push(v & 0xff);
      if (v & 0xff00) out.push(v >> 8);
      node = t.root;
      continue;
    }
    const byte = start + (bit >> 3);
    if (byte >= rom.size) break;
    const b = (rom.u8(byte) >> (bit & 7)) & 1;
    bit++;
    node = t.nodes + rom.u16(node + (b ? 2 : 0)) * 4;
    if (node < 0 || node + 4 > rom.size) break;
  }
  return Uint8Array.from(out);
}

/** Text as a string: printable ASCII as is, every other byte (control codes) as "[0xNN]" so nothing is lost. */
export function textBytesToString(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `[0x${b.toString(16).toUpperCase().padStart(2, '0')}]`;
  }
  return s;
}

export function decodeText(rom: GbaRom, t: TextTable, id: number): string {
  return textBytesToString(decodeTextBytes(rom, t, id));
}
