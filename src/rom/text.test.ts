import { describe, expect, it } from 'vitest';
import { ROM_BASE, readRom } from './gba-rom';
import { decodeText, decodeTextBytes, findTextTable, textBytesToString } from './text';

// A tiny synthetic ROM with the FE text layout. Tree: leaves A, B, end; then (A|B); root = ((A|B) | end).
// Codes from the root, bit 0 = left: A = 0,0  B = 0,1  end = 1.
const NODES = 0x100;
const ROOT = NODES + 4 * 4;
const TABLE = ROOT + 8;
const ENTRIES = 600;
const STRINGS = 0x1800;

function syntheticRom(): Uint8Array {
  const r = new Uint8Array(0x2000);
  const put32 = (o: number, v: number) => new DataView(r.buffer).setUint32(o, v >>> 0, true);
  const node = (i: number, left: number, right: number) => put32(NODES + i * 4, (right << 16) | left);
  node(0, 0x41, 0xffff); // leaf 'A'
  node(1, 0x42, 0xffff); // leaf 'B'
  node(2, 0x00, 0xffff); // leaf end
  node(3, 0, 1);
  node(4, 3, 2); // root
  put32(ROOT + 4, ROM_BASE + ROOT); // the word after the root points back at it
  r[STRINGS] = 0x18; // "AB" then end: bits 0,0,0,1,1 read from bit 0 up
  r.set([0x48, 0x69, 0x01, 0x00], STRINGS + 0x10); // uncompressed "Hi" + newline code
  for (let i = 0; i < ENTRIES; i++) put32(TABLE + i * 4, ROM_BASE + STRINGS);
  put32(TABLE + 4, (ROM_BASE + STRINGS + 0x10) | 0x80000000);
  return r;
}

describe('FE text', () => {
  const rom = readRom(syntheticRom());
  const table = findTextTable(rom);

  it('finds the tree and table by shape', () => {
    expect(table).toEqual({ root: ROOT, nodes: NODES, table: TABLE, count: ENTRIES });
  });

  it('decodes a Huffman string', () => {
    expect(decodeText(rom, table!, 0)).toBe('AB');
  });

  it('reads an uncompressed string and keeps control codes visible', () => {
    expect(Array.from(decodeTextBytes(rom, table!, 1))).toEqual([0x48, 0x69, 0x01]);
    expect(decodeText(rom, table!, 1)).toBe('Hi[0x01]');
  });

  it('returns empty text for ids outside the table', () => {
    expect(decodeText(rom, table!, -1)).toBe('');
    expect(decodeText(rom, table!, ENTRIES)).toBe('');
  });

  it('finds nothing in a ROM without text', () => {
    expect(findTextTable(readRom(new Uint8Array(0x1000)))).toBeNull();
  });

  it('formats bytes losslessly', () => {
    expect(textBytesToString(Uint8Array.from([0x45, 0x00, 0xff]))).toBe('E[0x00][0xFF]');
  });
});
