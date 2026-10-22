// FE8 US chapters: titles, event data and unit placements, as laid out in the fireemblem8u
// decompilation (include/chapterdata.h, include/bmunit.h). The chapter table sits directly before the
// map asset table: 79 records of 0x94 bytes from 0x8B0890 end exactly at 0x8B363C. Endless Chronicle's
// chapter address (0x8B0894) is the same table, 4 bytes in, where each record's map ids start.

import type { GbaRom } from './gba-rom';
import { decodeTextBytes, type TextTable } from './text';

export const CHAPTER_TABLE = 0x8b0890;
export const CHAPTER_STRIDE = 0x94;
export const CHAPTER_COUNT = 79;
/** gChapterDataAssetTable: maps, tilesets and chapter event groups, by index. */
export const ASSET_TABLE = 0x8b363c;

/** Offsets in a chapter record. */
const MAP_IDS = 0x04;
const TITLE_TEXT = 0x70;
const EVENT_DATA_ID = 0x74;

/** Offsets in a chapter event group (ChapterEventGroup). */
export const EVENT_GROUP = {
  turn: 0x00,
  character: 0x04,
  location: 0x08,
  misc: 0x0c,
  playerUnits: 0x28,
  playerUnitsHard: 0x2c,
  beginningScene: 0x48,
  endingScene: 0x4c,
  size: 0x50,
} as const;

export const UNIT_DEFINITION_SIZE = 20;

export interface ChapterInfo {
  readonly index: number;
  /** The chapter's title, printable characters only ("" if it has none). */
  readonly title: string;
  /** obj1, obj2, palette, tile config, main layer, object animation, palette animation, map changes. */
  readonly mapIds: readonly number[];
  readonly eventDataId: number;
  /** Offset of the chapter's event group, or null if its pointer isn't into the ROM. */
  readonly eventGroup: number | null;
}

const printable = (bytes: Uint8Array) => String.fromCharCode(...bytes.filter((b) => b >= 0x20 && b < 0x7f)).trim();

export function readChapter(rom: GbaRom, text: TextTable, index: number): ChapterInfo {
  const a = CHAPTER_TABLE + index * CHAPTER_STRIDE;
  const eventDataId = rom.u8(a + EVENT_DATA_ID);
  const p = rom.u32(ASSET_TABLE + eventDataId * 4);
  return {
    index,
    title: printable(decodeTextBytes(rom, text, rom.u16(a + TITLE_TEXT))),
    mapIds: Array.from(rom.bytes.subarray(a + MAP_IDS, a + MAP_IDS + 8)),
    eventDataId,
    eventGroup: rom.isPointer(p) ? rom.offsetOf(p) : null,
  };
}

export type Allegiance = 'player' | 'ally' | 'enemy';
const ALLEGIANCES: Allegiance[] = ['player', 'ally', 'enemy'];

/** A unit placement (UnitDefinition) as the game stores it. */
export interface UnitDefinition {
  readonly character: number;
  readonly classId: number;
  readonly leader: number;
  readonly autolevel: boolean;
  readonly allegiance: Allegiance;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  /** Item ids, without the empty slots. */
  readonly items: readonly number[];
  readonly ai: readonly number[];
}

/** One placement at `offset`. Byte 3 packs autolevel (bit 0), allegiance (bits 1-2) and level (bits 3-7); bytes 4-5 pack x (6 bits) and y (6 bits). */
export function readUnitDefinition(rom: GbaRom, offset: number): UnitDefinition {
  const b3 = rom.u8(offset + 3);
  const pos = rom.u16(offset + 4);
  return {
    character: rom.u8(offset),
    classId: rom.u8(offset + 1),
    leader: rom.u8(offset + 2),
    autolevel: (b3 & 1) === 1,
    allegiance: ALLEGIANCES[(b3 >> 1) & 3] ?? 'enemy',
    level: b3 >> 3,
    x: pos & 0x3f,
    y: (pos >> 6) & 0x3f,
    items: Array.from(rom.bytes.subarray(offset + 12, offset + 16)).filter((i) => i !== 0),
    ai: Array.from(rom.bytes.subarray(offset + 16, offset + 20)),
  };
}

/** A list of placements, ended by a record whose character is 0 (at most `max` read). */
export function readUnitList(rom: GbaRom, offset: number, max = 64): UnitDefinition[] {
  const out: UnitDefinition[] = [];
  for (let k = 0; k < max && offset + (k + 1) * UNIT_DEFINITION_SIZE <= rom.size; k++) {
    const a = offset + k * UNIT_DEFINITION_SIZE;
    if (rom.u8(a) === 0) break;
    out.push(readUnitDefinition(rom, a));
  }
  return out;
}

/** The player units a chapter's event group lists for normal mode, or [] if it has none. */
export function readPlayerUnits(rom: GbaRom, chapter: ChapterInfo): UnitDefinition[] {
  if (chapter.eventGroup === null) return [];
  const p = rom.u32(chapter.eventGroup + EVENT_GROUP.playerUnits);
  return rom.isPointer(p) ? readUnitList(rom, rom.offsetOf(p)) : [];
}
