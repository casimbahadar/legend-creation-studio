// FE8 US class table: names and map sprite ids from a clean ROM.
// Ported from Endless Chronicle (index.html, classes() and gbaClassData). EC finds the table by its
// shape for other games and hacks; for the clean FE8 US ROM it uses the fixed address below.

import type { GbaRom } from './gba-rom';
import { decodeTextBytes, type TextTable } from './text';

const CLASS_TABLE = 0x807110;
const CLASS_STRIDE = 0x54;
/** EC reads class ids 1 to 0x65. */
const LAST_CLASS_ID = 0x65;
/** Offsets inside a class record, as EC reads them. */
const BASE_MOV = 0x12;
const MOVE_COST_POINTER = 0x38;
/** One move cost per terrain id. */
const TERRAIN_COUNT = 0x41;

export interface RomClass {
  /** Class id as the ROM numbers it. */
  readonly id: number;
  readonly name: string;
  /** Index into the map sprite table. */
  readonly mapSprite: number;
  /** Base movement. */
  readonly mov: number;
  /** Move cost per terrain id (255 = impassable), or null if the ROM has no table for this class. */
  readonly moveCosts: Uint8Array | null;
}

export function readClasses(rom: GbaRom, text: TextTable): RomClass[] {
  const out: RomClass[] = [];
  for (let id = 1; id <= LAST_CLASS_ID; id++) {
    const a = CLASS_TABLE + id * CLASS_STRIDE;
    // Like EC, keep printable characters only: some names end in control codes such as 0x1F.
    const name = String.fromCharCode(...decodeTextBytes(rom, text, rom.u16(a)).filter((b) => b >= 0x20 && b < 0x7f)).trim();
    const costs = rom.u32(a + MOVE_COST_POINTER);
    const moveCosts = rom.isPointer(costs) && rom.offsetOf(costs) + TERRAIN_COUNT <= rom.size ? rom.bytes.slice(rom.offsetOf(costs), rom.offsetOf(costs) + TERRAIN_COUNT) : null;
    out.push({ id, name, mapSprite: rom.u8(a + 6), mov: rom.u8(a + BASE_MOV), moveCosts });
  }
  return out;
}
