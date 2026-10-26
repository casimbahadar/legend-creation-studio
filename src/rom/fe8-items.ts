// FE8 item table: names and weapon stats from the player's ROM.
// New work (Endless Chronicle doesn't read FE8 items); the record layout is from memory of FE8
// and checked against a real ROM by the LCS_FE8_ROM tests. The table is found by its shape, since
// every record holds its own item id at +0x06, so hacks that move it still work.

import type { GbaRom } from './gba-rom';
import { decodeTextBytes, type TextTable } from './text';

export const ITEM_STRIDE = 0x24;
/** FE8 US keeps the table here; findItemTable doesn't rely on it. */
export const FE8_US_ITEM_TABLE = 0x809b10;
const MIN_ITEMS = 0x80;
const MAX_ITEMS = 0x100;

/** Weapon types by their FE8 number. */
export const WEAPON_TYPES = ['sword', 'lance', 'axe', 'bow', 'staff', 'anima', 'light', 'dark'] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

export interface RomItem {
  readonly id: number;
  readonly name: string;
  /** FE8 weapon type number; 0 to 7 are the weapon types above, higher numbers are items. */
  readonly type: number;
  /** Bit 0: a weapon. Bit 1: magic. Bit 2: a staff. */
  readonly attributes: number;
  readonly uses: number;
  readonly might: number;
  readonly hit: number;
  readonly weight: number;
  readonly crit: number;
  readonly minRange: number;
  readonly maxRange: number;
  /** Weapon rank needed, as FE stores it (E = 1, D = 31, C = 71, B = 121, A = 181, S = 251). */
  readonly rank: number;
  /** Price of one use (costPerUse); staff experience depends on it. */
  readonly costPerUse: number;
}

/** Offset of the item table, found by its numbered records, or null. */
export function findItemTable(rom: GbaRom): number | null {
  const id = (s: number, i: number) => rom.bytes[s + i * ITEM_STRIDE + 6];
  let best: { start: number; count: number } | null = null;
  for (let s = 0; s + ITEM_STRIDE * MIN_ITEMS <= rom.size; s += 4) {
    if (id(s, 1) !== 1 || id(s, 2) !== 2 || id(s, 3) !== 3 || id(s, 0) !== 0) continue;
    let k = 0;
    while (k < MAX_ITEMS && s + (k + 1) * ITEM_STRIDE <= rom.size && id(s, k) === k) k++;
    if (k >= MIN_ITEMS && (!best || k > best.count)) best = { start: s, count: k };
  }
  return best ? best.start : null;
}

export function readItems(rom: GbaRom, text: TextTable, table: number): RomItem[] {
  const out: RomItem[] = [];
  for (let id = 1; table + (id + 1) * ITEM_STRIDE <= rom.size && rom.u8(table + id * ITEM_STRIDE + 6) === id; id++) {
    const a = table + id * ITEM_STRIDE;
    // Keep printable characters only, as for class names.
    const name = String.fromCharCode(...decodeTextBytes(rom, text, rom.u16(a)).filter((b) => b >= 0x20 && b < 0x7f)).trim();
    const range = rom.u8(a + 0x19);
    out.push({
      id,
      name,
      type: rom.u8(a + 7),
      attributes: rom.u32(a + 8),
      uses: rom.u8(a + 0x14),
      might: rom.u8(a + 0x15),
      hit: rom.u8(a + 0x16),
      weight: rom.u8(a + 0x17),
      crit: rom.u8(a + 0x18),
      minRange: range >> 4,
      maxRange: range & 15,
      rank: rom.u8(a + 0x1c),
      costPerUse: rom.u16(a + 0x1a),
    });
  }
  return out;
}

export const isWeapon = (item: RomItem) => (item.attributes & 1) !== 0;
export const isStaff = (item: RomItem) => (item.attributes & 4) !== 0;
