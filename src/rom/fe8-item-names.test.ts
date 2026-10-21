import { describe, expect, it } from 'vitest';
import { checkItemNames, FE8_ITEM_NAMES } from './fe8-item-names';

describe('FE8 item name list', () => {
  it('has unique names and ids', () => {
    expect(new Set(FE8_ITEM_NAMES.map((i) => i.name)).size).toBe(FE8_ITEM_NAMES.length);
    expect(new Set(FE8_ITEM_NAMES.map((i) => i.id)).size).toBe(FE8_ITEM_NAMES.length);
    for (const i of FE8_ITEM_NAMES) expect(i.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('reports entries the ROM names differently or lacks', () => {
    const list = [
      { name: 'iron-sword', id: 1, gameName: 'Iron Sword' },
      { name: 'fire', id: 0x38, gameName: 'Fire' },
      { name: 'elixir', id: 0x6d, gameName: 'Elixir' },
    ];
    const rom = [
      { id: 1, name: 'Iron Sword' },
      { id: 0x38, name: 'Thunder' },
    ];
    expect(checkItemNames(rom, list).map((m) => [m.entry.name, m.romName])).toEqual([
      ['fire', 'Thunder'],
      ['elixir', null],
    ]);
  });
});
