// FE8 character table (gCharacterData in the fireemblem8u decompilation): 0x34-byte records for
// characters 1 upward, each holding its own number at +0x04. Found by that numbering, as items are.

import type { ClassStats } from './fe8-classes';
import type { GbaRom } from './gba-rom';
import { decodeTextBytes, type TextTable } from './text';

export const CHARACTER_STRIDE = 0x34;
/**
 * Character 1's record in FE8 US, as found on a real ROM by numbering. The often-quoted 0x803D30 is
 * the empty record 0 just before it; writing there put every change one character too early.
 * Nothing relies on this address: characterRecord finds the table.
 */
export const FE8_US_CHARACTER_TABLE = 0x803d64;
const MIN_CHARACTERS = 0x40;
/** Offsets in a character record. */
export const BASE_LEVEL = 0x0b;
export const BASE_STATS = 0x0c;
const GROWTHS = 0x1c;
const ATTRIBUTES = 0x28;

export interface RomCharacter {
  readonly id: number;
  readonly name: string;
  readonly defaultClass: number;
  /** Portrait id (fe8-portraits), 0 for none. */
  readonly portrait: number;
  readonly baseLevel: number;
  /** Personal bases, added to the class's (FE8 stores them signed; luck is personal only). */
  readonly base: ClassStats;
  /** Personal growths, used instead of the class's. FE8 has no Con growth. */
  readonly growths: ClassStats;
  /** Character attribute bits, added to the class's (CA_BOSS for bosses). */
  readonly attributes: number;
}

/** Offset of character 1's record, or null. */
export function findCharacterTable(rom: GbaRom): number | null {
  const num = (s: number, k: number) => rom.bytes[s + k * CHARACTER_STRIDE + 4];
  let best: { start: number; count: number } | null = null;
  for (let s = 0; s + CHARACTER_STRIDE * MIN_CHARACTERS <= rom.size; s += 4) {
    if (num(s, 0) !== 1 || num(s, 1) !== 2 || num(s, 2) !== 3) continue;
    let k = 0;
    while (k < 0x100 && s + (k + 1) * CHARACTER_STRIDE <= rom.size && num(s, k) === k + 1) k++;
    if (k >= MIN_CHARACTERS && (!best || k > best.count)) best = { start: s, count: k };
  }
  return best ? best.start : null;
}

/** A character's base level, personal bases and growths, from its record at `a`. */
export function readCharacterStats(rom: GbaRom, a: number): Pick<RomCharacter, 'baseLevel' | 'base' | 'growths'> {
  const b = (i: number) => (rom.u8(a + BASE_STATS + i) << 24) >> 24;
  const g = (i: number) => rom.u8(a + GROWTHS + i);
  return {
    baseLevel: (rom.u8(a + BASE_LEVEL) << 24) >> 24,
    base: { hp: b(0), str: b(1), skl: b(2), spd: b(3), def: b(4), res: b(5), lck: b(6), con: b(7) },
    growths: { hp: g(0), str: g(1), skl: g(2), spd: g(3), def: g(4), res: g(5), lck: g(6), con: 0 },
  };
}

const tables = new WeakMap<GbaRom, number | null>();

/** Offset of character `id`'s record, finding the table once per ROM. Throws if there is none. */
export function characterRecord(rom: GbaRom, id: number): number {
  if (!tables.has(rom)) tables.set(rom, findCharacterTable(rom));
  const table = tables.get(rom);
  if (table === null || table === undefined) throw new Error("Couldn't find the character table in this ROM.");
  return table + (id - 1) * CHARACTER_STRIDE;
}

export function readCharacters(rom: GbaRom, text: TextTable, table: number): RomCharacter[] {
  const out: RomCharacter[] = [];
  for (let k = 0; table + (k + 1) * CHARACTER_STRIDE <= rom.size && rom.u8(table + k * CHARACTER_STRIDE + 4) === k + 1; k++) {
    const a = table + k * CHARACTER_STRIDE;
    const name = String.fromCharCode(...decodeTextBytes(rom, text, rom.u16(a)).filter((b) => b >= 0x20 && b < 0x7f)).trim();
    out.push({ id: k + 1, name, defaultClass: rom.u8(a + 5), portrait: rom.u16(a + 6), ...readCharacterStats(rom, a), attributes: rom.u32(a + ATTRIBUTES) });
  }
  return out;
}
