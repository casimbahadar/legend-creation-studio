import { describe, expect, it } from 'vitest';
import { chapterPlaces, fe8Places, openedMap, placeKindAt } from './places';

describe('doors, chests, villages and houses on a map', () => {
  // A 4 x 1 map: door, full chest, village, house; a tile change covers the first three squares but the last.
  const map = { width: 4, terrain: Uint8Array.from([0x1e, 0x21, 0x03, 0x05]) };
  const changes = [{ id: 0, x: 0, y: 0, width: 2, height: 1, tiles: [1, 2] }, { id: 1, x: 2, y: 0, width: 1, height: 1, tiles: [3] }];

  it('tells what a square can hold from its terrain, a door, chest or village only over a tile change', () => {
    expect([0, 1, 2, 3].map((x) => placeKindAt(map, changes, x, 0))).toEqual(['door', 'chest', 'village', 'house']);
    expect([0, 1, 2, 3].map((x) => placeKindAt(map, [], x, 0))).toEqual([null, null, null, 'house']);
  });

  it("starts from FE8's own: chests with their item by name or gold, villages and houses as FE8's own scene", () => {
    const names = new Map([[0x1f, 'vulnerary']]);
    const places = fe8Places(
      {
        changes,
        events: [
          { kind: 'door', x: 0, y: 0, flag: 0, word: 1 },
          { kind: 'chest', x: 1, y: 0, flag: 0, word: 0, item: 0x1f, gold: null },
          { kind: 'chest', x: 5, y: 0, flag: 0, word: 0, item: 0x77, gold: 300 },
          { kind: 'randomChest', x: 6, y: 0, flag: 0, word: 0, items: [] },
          { kind: 'village', x: 2, y: 0, flag: 0, word: 0, scene: null },
          { kind: 'house', x: 3, y: 0, flag: 0, word: 0, scene: null },
        ],
      },
      (id) => names.get(id),
    );
    expect(places).toEqual([
      { kind: 'door', at: [0, 0] },
      { kind: 'chest', at: [1, 0], item: 'vulnerary' },
      { kind: 'chest', at: [5, 0], gold: 300 },
      { kind: 'chest', at: [6, 0], fe8: true },
      { kind: 'village', at: [2, 0], fe8: true },
      { kind: 'house', at: [3, 0], fe8: true },
    ]);
    expect(chapterPlaces({}, places)).toBe(places);
    expect(chapterPlaces({ places: [] }, places)).toEqual([]);
  });

  it('applies the tile changes of opened doors, chests and villages to the map, and its terrain', () => {
    const config = new Uint8Array(0x2400);
    config[0x2000 + 1] = 0x17; // metatile 1: floor
    const cells = Uint16Array.from([5, 5, 5, 5]);
    const base = { chapter: 0, width: 4, height: 1, cells, terrain: Uint8Array.from([0x1e, 0x21, 0x03, 0x05]), tileset: { tiles: new Uint8Array(), config, palettes: [] } };
    const one = [{ id: 0, x: 0, y: 0, width: 2, height: 1, tiles: [1, null] }];
    expect(openedMap(base, one, [{ kind: 'door', at: [0, 0] }])).toBe(base);
    const opened = openedMap(base, one, [{ kind: 'door', at: [0, 0], done: true }]);
    expect([Array.from(opened.cells), Array.from(opened.terrain)]).toEqual([[1, 5, 5, 5], [0x17, 0x21, 0x03, 0x05]]);
  });
});

