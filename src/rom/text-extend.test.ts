import { describe, expect, it } from 'vitest';
import { readRom, ROM_BASE } from './gba-rom';
import { decodeTextBytes, type TextTable } from './text';
import { encodeTextBytes, readHuffmanCodes } from './text-encode';
import { changedTexts, extendTree, FIRST_PRINTABLE, LAST_PRINTABLE } from './text-extend';

// A tree like FE8's, with letters only in pairs: "ab", "cd", "ef" and the end marker. Text 0 is
// "abab", text 1 "cd", text 2 "ef" (the least used pair along with "cd"), text 3 "abcd".
const NODES = 0x100;
const TABLE = 0x200;
function rom(): { bytes: Uint8Array; t: TextTable } {
  const bytes = new Uint8Array(0x1000);
  const view = new DataView(bytes.buffer);
  const words = [0xffff6261, 0xffff6463, 0xffff6665, 0xffff0000, 0 | (1 << 16), 2 | (3 << 16), 4 | (5 << 16)];
  words.forEach((w, i) => view.setUint32(NODES + i * 4, w, true));
  const t: TextTable = { root: NODES + 6 * 4, nodes: NODES, table: TABLE, count: 4 };
  const codes = readHuffmanCodes(readRom(bytes), t);
  ['abab', 'cd', 'ef', 'abcd'].forEach((s, id) => {
    const at = 0x300 + id * 0x10;
    bytes.set(encodeTextBytes(codes, [...s].map((c) => c.charCodeAt(0)), false), at);
    view.setUint32(TABLE + id * 4, ROM_BASE + at, true);
  });
  return { bytes, t };
}

describe('extending the text tree', () => {
  const { bytes, t } = rom();
  const clean = readRom(bytes);
  const tree = extendTree(clean, t);

  it('gives every printable character a code and keeps the old ones but one', () => {
    for (let c = FIRST_PRINTABLE; c <= LAST_PRINTABLE; c++) expect(tree.codes.has(c)).toBe(true);
    const old = readHuffmanCodes(clean, t);
    const longer = [...old].filter(([v, code]) => tree.codes.get(v)!.join('') !== code.join(''));
    // "cd" is used by two texts and "ef" by one, so "ef" goes one level down.
    expect(longer.map(([v]) => v)).toEqual([0x6665]);
    expect(tree.codes.get(0x6665)).toEqual([...old.get(0x6665)!, 0]);
    expect(tree.changed).toEqual([2]);
  });

  it('decodes old text unchanged and new names, once moved texts are re-encoded', () => {
    const out = new Uint8Array(0x2000);
    out.set(bytes);
    const view = new DataView(out.buffer);
    const base = 0x1000;
    tree.words.forEach((w, i) => view.setUint32(base + i * 4, w, true));
    let at = 0x1800;
    const put = (b: Uint8Array) => {
      out.set(b, at);
      const p = ROM_BASE + at;
      at += 0x40;
      return p;
    };
    for (const c of changedTexts(clean, t, tree)) view.setUint32(TABLE + c.id * 4, put(encodeTextBytes(tree.codes, c.bytes, false)), true);
    const t2: TextTable = { ...t, nodes: base, root: base + tree.root * 4, count: 5 };
    view.setUint32(TABLE + 16, put(encodeTextBytes(tree.codes, [...'Xavier'].map((c) => c.charCodeAt(0)))), true);
    const text = (r: Uint8Array, tt: TextTable, id: number) => String.fromCharCode(...decodeTextBytes(readRom(r), tt, id));
    expect([0, 1, 2, 3].map((id) => text(out, t2, id))).toEqual(['abab', 'cd', 'ef', 'abcd']);
    expect(text(out, t2, 4)).toBe('Xavier');
  });
});
