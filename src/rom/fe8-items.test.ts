import { describe, expect, it } from 'vitest';
import { ROM_BASE, readRom } from './gba-rom';
import { findItemTable, isStaff, isWeapon, ITEM_STRIDE, readItems } from './fe8-items';
import type { TextTable } from './text';

function romWithItems(table: number, count: number) {
  const bytes = new Uint8Array(table + (count + 2) * ITEM_STRIDE + 0x400);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) bytes[table + i * ITEM_STRIDE + 6] = i;
  // Item 1: "Iron Sword" (text 1), a sword, weapon, 46 uses, Mt 5, Hit 90, Wt 5, Crit 0, range 1-1, rank E, 10 a use.
  const a = table + ITEM_STRIDE;
  view.setUint16(a, 1, true);
  bytes[a + 7] = 0;
  view.setUint32(a + 8, 1, true);
  bytes.set([46, 5, 90, 5, 0, 0x11], a + 0x14);
  bytes[a + 0x1c] = 1;
  view.setUint16(a + 0x1a, 10, true); // 10 gold a use
  bytes[a + 0x1d] = 3; // icon 3
  // Item 2: a staff with range 1-2 written as 0x12.
  const b = table + 2 * ITEM_STRIDE;
  bytes[b + 7] = 4;
  view.setUint32(b + 8, 5, true);
  bytes[b + 0x19] = 0x12;
  // Its stat bonuses: HP +7, Skl -1, Con +2.
  const bonuses = table + (count + 1) * ITEM_STRIDE;
  bytes.set([7, 0, 0xff, 0, 0, 0, 0, 0, 2], bonuses);
  view.setUint32(b + 0x0c, ROM_BASE + bonuses, true);
  const strings = 0x10;
  bytes.set([...'Iron Sword'].map((c) => c.charCodeAt(0)).concat(0x1f, 0), strings);
  view.setUint32(0x40 + 4, (ROM_BASE + strings) | 0x80000000, true);
  const text: TextTable = { root: 0, nodes: 0, table: 0x40, count: 4 };
  return { rom: readRom(bytes), text };
}

describe('FE8 items', () => {
  it('finds the table by its numbered records', () => {
    const { rom } = romWithItems(0x400, 0x90);
    expect(findItemTable(rom)).toBe(0x400);
  });

  it('ignores runs that are too short to be the item table', () => {
    const { rom } = romWithItems(0x400, 0x20);
    expect(findItemTable(rom)).toBeNull();
  });

  it('reads names and weapon stats', () => {
    const { rom, text } = romWithItems(0x400, 0x90);
    const items = readItems(rom, text, 0x400);
    expect(items).toHaveLength(0x8f);
    expect(items[0]).toEqual({
      id: 1,
      name: 'Iron Sword',
      type: 0,
      attributes: 1,
      uses: 46,
      might: 5,
      hit: 90,
      weight: 5,
      crit: 0,
      minRange: 1,
      maxRange: 1,
      rank: 1,
      costPerUse: 10,
      icon: 3,
      statBonuses: null,
    });
    expect(isWeapon(items[0]!)).toBe(true);
    expect(items[1]!.statBonuses).toEqual({ hp: 7, str: 0, skl: -1, spd: 0, def: 0, res: 0, lck: 0, mov: 0, con: 2 });
    expect(isStaff(items[1]!)).toBe(true);
    expect([items[1]!.minRange, items[1]!.maxRange]).toEqual([1, 2]);
  });
});
