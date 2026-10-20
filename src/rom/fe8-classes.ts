// FE8 US class table: names and map sprite ids from a clean ROM.
// Ported from Endless Chronicle (index.html, classes() and gbaClassData). EC finds the table by its
// shape for other games and hacks; for the clean FE8 US ROM it uses the fixed address below.

import type { GbaRom } from './gba-rom';
import { decodeText, type TextTable } from './text';

const CLASS_TABLE = 0x807110;
const CLASS_STRIDE = 0x54;
/** EC reads class ids 1 to 0x65. */
const LAST_CLASS_ID = 0x65;

export interface RomClass {
  /** Class id as the ROM numbers it. */
  readonly id: number;
  readonly name: string;
  /** Index into the map sprite table. */
  readonly mapSprite: number;
}

export function readClasses(rom: GbaRom, text: TextTable): RomClass[] {
  const out: RomClass[] = [];
  for (let id = 1; id <= LAST_CLASS_ID; id++) {
    const a = CLASS_TABLE + id * CLASS_STRIDE;
    const name = decodeText(rom, text, rom.u16(a)).trim();
    out.push({ id, name, mapSprite: rom.u8(a + 6) });
  }
  return out;
}
