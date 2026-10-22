// FE8 character table (gCharacterData in the fireemblem8u decompilation): 0x34-byte records for
// characters 1 upward, each holding its own number at +0x04. Found by that numbering, as items are.

import type { GbaRom } from './gba-rom';
import { decodeTextBytes, type TextTable } from './text';

export const CHARACTER_STRIDE = 0x34;
/** FE8 US keeps it here; findCharacterTable doesn't rely on it. */
export const FE8_US_CHARACTER_TABLE = 0x803d30;
const MIN_CHARACTERS = 0x40;

export interface RomCharacter {
  readonly id: number;
  readonly name: string;
  readonly defaultClass: number;
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

export function readCharacters(rom: GbaRom, text: TextTable, table: number): RomCharacter[] {
  const out: RomCharacter[] = [];
  for (let k = 0; table + (k + 1) * CHARACTER_STRIDE <= rom.size && rom.u8(table + k * CHARACTER_STRIDE + 4) === k + 1; k++) {
    const a = table + k * CHARACTER_STRIDE;
    const name = String.fromCharCode(...decodeTextBytes(rom, text, rom.u16(a)).filter((b) => b >= 0x20 && b < 0x7f)).trim();
    out.push({ id: k + 1, name, defaultClass: rom.u8(a + 5) });
  }
  return out;
}
