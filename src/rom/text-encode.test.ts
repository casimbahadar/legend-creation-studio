import { describe, expect, it } from 'vitest';
import { readRom, ROM_BASE } from './gba-rom';
import { decodeTextBytes, type TextTable } from './text';
import { encodeTextBytes, readHuffmanCodes } from './text-encode';

describe('encoding FE text', () => {
  // A tree with leaves "A", "B", the pair "AB" and the end marker.
  const bytes = new Uint8Array(0x400);
  const view = new DataView(bytes.buffer);
  const NODES = 0x100;
  const leaves = [0x41, 0x42, 0x4241, 0];
  leaves.forEach((v, i) => view.setUint32(NODES + i * 4, 0x80000000 | v, true));
  view.setUint32(NODES + 16, 0 | (1 << 16), true); // node 4: A | B
  view.setUint32(NODES + 20, 2 | (3 << 16), true); // node 5: AB | end
  const ROOT = NODES + 24;
  view.setUint32(ROOT, 4 | (5 << 16), true);
  const TABLE = 0x200;
  const rom = readRom(bytes);
  const t: TextTable = { root: ROOT, nodes: NODES, table: TABLE, count: 1 };

  it('reads each leaf code from the tree', () => {
    expect(Object.fromEntries(readHuffmanCodes(rom, t))).toEqual({ 0x41: [0, 0], 0x42: [0, 1], 0x4241: [1, 0], 0: [1, 1] });
  });

  it('round-trips through the decoder, using pairs where it can', () => {
    const text = [...'ABBAB'].map((c) => c.charCodeAt(0));
    const encoded = encodeTextBytes(readHuffmanCodes(rom, t), text);
    // AB, B, AB, end: 10 01 10 11 read lowest bit first.
    expect(Array.from(encoded)).toEqual([0b11011001]);
    bytes.set(encoded, 0x300);
    view.setUint32(TABLE, ROM_BASE + 0x300, true);
    expect(Array.from(decodeTextBytes(rom, t, 0))).toEqual(text);
  });

  it("refuses bytes the tree can't write", () => {
    expect(() => encodeTextBytes(readHuffmanCodes(rom, t), [0x43])).toThrow("can't spell this name");
  });

  it('finds a split when pairing from the left would leave a letter the tree only has in pairs', () => {
    // Leaves "a", "ab", "bc" and the end marker: "abc" can only be "a" + "bc", as "Jasmine" ends in a
    // letter FE8's tree holds only in pairs.
    const b2 = new Uint8Array(0x400);
    const v2 = new DataView(b2.buffer);
    [0x61, 0x6261, 0x6362, 0].forEach((v, i) => v2.setUint32(NODES + i * 4, 0x80000000 | v, true));
    v2.setUint32(NODES + 16, 0 | (1 << 16), true);
    v2.setUint32(NODES + 20, 2 | (3 << 16), true);
    v2.setUint32(ROOT, 4 | (5 << 16), true);
    const rom2 = readRom(b2);
    const text = [...'abc'].map((c) => c.charCodeAt(0));
    b2.set(encodeTextBytes(readHuffmanCodes(rom2, t), text), 0x300);
    v2.setUint32(TABLE, ROM_BASE + 0x300, true);
    expect(String.fromCharCode(...decodeTextBytes(rom2, t, 0))).toBe('abc');
    expect(() => encodeTextBytes(readHuffmanCodes(rom2, t), [...'abcc'].map((c) => c.charCodeAt(0)))).toThrow("can't spell this name");
  });
});
