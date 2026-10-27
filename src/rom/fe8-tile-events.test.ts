import { describe, expect, it } from 'vitest';
import { ASSET_TABLE, EVENT_GROUP, type ChapterInfo } from './fe8-chapters';
import { mapChangeAt, readMapChanges, readTileEvents, readVisitScene } from './fe8-tile-events';
import { readRom } from './gba-rom';

const ptr = (offset: number) => 0x08000000 + offset;

/** Event commands: the command, its length in halfwords and subcommand, its 16-bit argument, and any 32-bit words after. */
const ev = (cmd: number, length: number, sub: number, arg: number, ...words: number[]) => ({ cmd, length, sub, arg, words });
type Ev = ReturnType<typeof ev>;

describe('FE8 doors, chests, villages and houses', () => {
  const bytes = new Uint8Array(ASSET_TABLE + 0x100);
  const view = new DataView(bytes.buffer);
  const u32 = (at: number, ...words: number[]) => words.forEach((w, i) => view.setUint32(at + i * 4, w >>> 0, true));
  const script = (at: number, commands: readonly Ev[]) => {
    let p = at;
    for (const c of commands) {
      view.setUint16(p, (c.cmd << 8) | (c.length << 4) | c.sub, true);
      view.setUint16(p + 2, c.arg, true);
      c.words.forEach((w, i) => view.setUint32(p + 4 + i * 4, w >>> 0, true));
      p += c.length * 2;
    }
  };
  const loc = (x: number, y: number, tile: number) => x | (y << 8) | (tile << 16);

  // Map changes (asset 5): change 0 over (2, 3) and (3, 3), the first square to metatile 16 and the
  // second left alone; change 1 over (2, 3) alone, to metatile 32; then the end.
  u32(ASSET_TABLE + 5 * 4, ptr(0x1000));
  bytes.set([0, 2, 3, 2, 1], 0x1000);
  u32(0x1008, ptr(0x1100));
  view.setUint16(0x1100, 16 << 2, true);
  bytes.set([1, 2, 3, 1, 1], 0x100c);
  u32(0x1014, ptr(0x1110));
  view.setUint16(0x1110, 32 << 2, true);
  bytes[0x1018] = 0xff;

  // The location list (event group at 0x2000): a village with flag 7 and its gate's entry, an item chest,
  // a gold chest, a door with flag 9, a house, a random chest, the end.
  u32(0x2000 + EVENT_GROUP.location, ptr(0x2100));
  u32(0x2100, 0x00070006, ptr(0x3000), loc(8, 2, 0x10));
  u32(0x210c, 0x00070005, 1, loc(8, 1, 0x20));
  u32(0x2118, 0x00000007, 0x1f, loc(1, 1, 0x14));
  u32(0x2124, 0x00000007, 0x77 | (500 << 16), loc(2, 1, 0x14));
  u32(0x2130, 0x00090008, 1, loc(5, 6, 0x12));
  u32(0x213c, 0x00000005, ptr(0x3200), loc(9, 9, 0x10));
  u32(0x2148, 0x00000005, ptr(0x2200), loc(4, 4, 0x14));
  bytes.set([0x1f, 50, 0x20, 50, 0], 0x2200);

  // The village: Text_BG (background 16, message 0x9b5) through a helper that adds slot 3 into slot 2
  // and shows text -1; then item 0x1f given. The house checks who visits and gives 500 gold.
  script(0x3000, [ev(0x05, 4, 0, 2, 16), ev(0x05, 4, 0, 3, 0x9b5), ev(0x0a, 4, 0, 0, ptr(0x3100)), ev(0x05, 4, 0, 3, 0x1f), ev(0x37, 2, 0, 0xffff), ev(0x01, 2, 0, 0)]);
  script(0x3100, [ev(0x06, 2, 0, 0x032), ev(0x1b, 2, 0, 0xffff), ev(0x01, 2, 0, 0)]);
  script(0x3200, [ev(0x19, 2, 0, 0), ev(0x05, 4, 0, 3, 500), ev(0x37, 2, 1, 0xffff), ev(0x01, 2, 0, 0)]);

  const rom = readRom(bytes);
  const chapter: ChapterInfo = { index: 0, title: '', mapIds: [0, 0, 0, 0, 0, 0, 0, 5], eventDataId: 0, eventGroup: 0x2000 };

  it('reads the map changes, a square opening the last change that holds it', () => {
    const changes = readMapChanges(rom, chapter);
    expect(changes).toEqual([
      { id: 0, x: 2, y: 3, width: 2, height: 1, tiles: [16, null] },
      { id: 1, x: 2, y: 3, width: 1, height: 1, tiles: [32] },
    ]);
    expect([mapChangeAt(changes, 2, 3), mapChangeAt(changes, 3, 3), mapChangeAt(changes, 4, 3)]).toEqual([1, 0, null]);
    expect(readMapChanges(rom, { ...chapter, mapIds: [0, 0, 0, 0, 0, 0, 0, 0] })).toEqual([]);
  });

  it('reads the doors, chests, villages and houses, leaving out the gate entry', () => {
    const events = readTileEvents(rom, chapter);
    expect(events.map((e) => [e.kind, e.x, e.y, e.flag])).toEqual([
      ['village', 8, 2, 7],
      ['chest', 1, 1, 0],
      ['chest', 2, 1, 0],
      ['door', 5, 6, 9],
      ['house', 9, 9, 0],
      ['randomChest', 4, 4, 0],
    ]);
    expect(events[1]).toMatchObject({ item: 0x1f, gold: null });
    expect(events[2]).toMatchObject({ item: 0x77, gold: 500 });
    expect(events[5]).toMatchObject({ items: [{ item: 0x1f, chance: 50 }, { item: 0x20, chance: 50 }] });
  });

  it("follows a scene through its calls for its text and what it gives, and marks one that does more", () => {
    expect(readVisitScene(rom, 0x3000)).toEqual({ texts: [0x9b5], item: 0x1f, gold: null, custom: false });
    expect(readVisitScene(rom, 0x3200)).toEqual({ texts: [], item: null, gold: 500, custom: true });
    expect(readTileEvents(rom, chapter)[0]).toMatchObject({ scene: { texts: [0x9b5], item: 0x1f } });
  });

  it('reads nothing for a chapter without an event group', () => {
    expect(readTileEvents(rom, { ...chapter, eventGroup: null })).toEqual([]);
  });
});
