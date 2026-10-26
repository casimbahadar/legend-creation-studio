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
const WEAPON_RANKS = 0x2c;
const BASE_STATS = 0x0b;
const GROWTHS = 0x1b;
const PROMOTION = 0x05;
const MAX_STATS = 0x13;
const RELATIVE_POWER = 0x1a;
const ATTRIBUTES = 0x28;
const TERRAIN_AVOID_POINTER = 0x44;
const TERRAIN_DEF_POINTER = 0x48;
const TERRAIN_RES_POINTER = 0x4c;

/** A class's stats in FE8's order. Classes have no base luck, so base luck is 0. */
export interface ClassStats {
  readonly hp: number;
  readonly str: number;
  readonly skl: number;
  readonly spd: number;
  readonly def: number;
  readonly res: number;
  readonly lck: number;
  readonly con: number;
}
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
  /** Starting weapon rank per weapon type (sword, lance, axe, bow, staff, anima, light, dark); 0 = can't use. */
  readonly weaponRanks: Uint8Array;
  /** Base stats at level 1. */
  readonly base: ClassStats;
  /** Growth rates in percent (con has none, so it is 0). */
  readonly growths: ClassStats;
  /** Stat maximums; luck's is FE8's fixed 30. */
  readonly caps: ClassStats;
  /** How much the class counts for in experience (classRelativePower). */
  readonly power: number;
  /** The class it promotes to, 0 for none. */
  readonly promotion: number;
  /** Class attribute bits (CA_* in the decompilation's include/bmunit.h). */
  readonly attributes: number;
  /** Avoid, Def and Res bonus per terrain id, or null if the ROM has no table. */
  readonly terrainAvoid: Uint8Array | null;
  readonly terrainDef: Uint8Array | null;
  readonly terrainRes: Uint8Array | null;
}

/** The per-terrain table a class record points to at `at`, or null if it doesn't point into the ROM. */
function terrainTable(rom: GbaRom, at: number): Uint8Array | null {
  const p = rom.u32(at);
  if (!rom.isPointer(p) || rom.offsetOf(p) + TERRAIN_COUNT > rom.size) return null;
  return rom.bytes.slice(rom.offsetOf(p), rom.offsetOf(p) + TERRAIN_COUNT);
}

/** FE8's attribute bits that play uses (include/bmunit.h). */
export const CA_THIEF = 1 << 3;
export const CA_PROMOTED = 1 << 8;
export const CA_LORD = 1 << 13;
export const CA_BOSS = 1 << 15;
export const CA_MAXLEVEL10 = 1 << 19;
/** FE8's luck cap (UNIT_LCK_MAX). */
const LUCK_CAP = 30;

/** A class's base stats, growths, caps and what it counts for in experience, by class id. */
export function readClassStats(rom: GbaRom, id: number): Pick<RomClass, 'base' | 'growths' | 'caps' | 'power' | 'promotion' | 'attributes'> {
  const a = CLASS_TABLE + id * CLASS_STRIDE;
  const b = (k: number) => rom.u8(a + BASE_STATS + k);
  const g = (k: number) => rom.u8(a + GROWTHS + k);
  const m = (k: number) => rom.u8(a + MAX_STATS + k);
  return {
    base: { hp: b(0), str: b(1), skl: b(2), spd: b(3), def: b(4), res: b(5), lck: 0, con: b(6) },
    growths: { hp: g(0), str: g(1), skl: g(2), spd: g(3), def: g(4), res: g(5), lck: g(6), con: 0 },
    caps: { hp: m(0), str: m(1), skl: m(2), spd: m(3), def: m(4), res: m(5), lck: LUCK_CAP, con: m(6) },
    power: rom.u8(a + RELATIVE_POWER),
    promotion: rom.u8(a + PROMOTION),
    attributes: rom.u32(a + ATTRIBUTES),
  };
}

export function readClasses(rom: GbaRom, text: TextTable): RomClass[] {
  const out: RomClass[] = [];
  for (let id = 1; id <= LAST_CLASS_ID; id++) {
    const a = CLASS_TABLE + id * CLASS_STRIDE;
    // Like EC, keep printable characters only: some names end in control codes such as 0x1F.
    const name = String.fromCharCode(...decodeTextBytes(rom, text, rom.u16(a)).filter((b) => b >= 0x20 && b < 0x7f)).trim();
    out.push({
      id,
      name,
      mapSprite: rom.u8(a + 6),
      mov: rom.u8(a + BASE_MOV),
      moveCosts: terrainTable(rom, a + MOVE_COST_POINTER),
      weaponRanks: rom.bytes.slice(a + WEAPON_RANKS, a + WEAPON_RANKS + 8),
      ...readClassStats(rom, id),
      terrainAvoid: terrainTable(rom, a + TERRAIN_AVOID_POINTER),
      terrainDef: terrainTable(rom, a + TERRAIN_DEF_POINTER),
      terrainRes: terrainTable(rom, a + TERRAIN_RES_POINTER),
    });
  }
  return out;
}
