// The FE8 builder: writes one project chapter into a copy of the clean ROM, in the place of a vanilla
// chapter (decision 27). Formats are those of the fireemblem8u decompilation (include/chapterdata.h,
// include/bmunit.h, include/eventscript.h) and are cross-checked by reading the result back with
// fe8-chapters. Everything new goes in an area added after the clean ROM's 16 MB; inside the ROM only
// the slot's chapter record and its event-group pointer change.
//
// Player units' names and stats are written into their FE8 characters (decisions 30 and 31): the
// character's name text is repointed to the unit's name, encoded with the ROM's own Huffman tree, and
// its personal bases and base level are set so the unit loads with exactly the stats test play shows
// (custom stats included) and no random level-ups on loading.
//
// The chapter's events are FE's own building blocks: a beginning scene that loads the player,
// enemy and ally units, a misc list with vanilla's Rout check (DefeatAll) and game over check, and
// an ending scene that moves on to the chapter the slot's vanilla ending moves on to.

import { characterStatsAtLevel, withBonus } from '../core/combat';
import { mapEntry, mapRef, MAX_ITEMS, STAT_KEYS, type Behaviour, type ProjectChapter, type ProjectUnit, type StatKey, type Team } from '../core/project';
import { ASSET_TABLE, CHAPTER_COUNT, CHAPTER_STRIDE, CHAPTER_TABLE, EVENT_GROUP, UNIT_DEFINITION_SIZE } from './fe8-chapters';
import { FE8_CHARACTER_NAMES, GENERIC_ALLY, GENERIC_ENEMY, pickCharacter } from './fe8-character-names';
import { BASE_LEVEL, BASE_STATS, CHARACTER_STRIDE, FE8_US_CHARACTER_TABLE, readCharacterStats } from './fe8-characters';
import { readClassStats } from './fe8-classes';
import { FE8_ITEM_NAMES } from './fe8-item-names';
import { FE8_CLASS_NAMES } from './fe8-names';
import { ROM_BASE, type GbaRom } from './gba-rom';
import type { TextTable } from './text';
import { encodeTextBytes, readHuffmanCodes } from './text-encode';

/** Where the added area starts: just past the clean ROM. */
export const EXPANSION = 0x1000000;
/** The added area is padded to a multiple of this. */
const EXPANSION_ALIGN = 0x10000;

/** Chapter record fields that belong to the map, copied when the map comes from another chapter. */
const MAP_FIELDS = { start: 0x04, end: 0x14 }; // map ids, fog, (prep flag, title ids), camera start, weather, battle tileset
const PREP_FLAG = 0x0d;
const TITLE_IDS = { start: 0x0e, end: 0x10 };
/** Objective text and goal window type (statusObjectiveTextId to destPosY). */
const GOAL_FIELDS = { start: 0x88, end: 0x91 };
/**
 * A vanilla Rout chapter whose objective ("Defeat all enemy units", goal window "Defeat enemy",
 * type Defeat all) the patch reuses: chapter index 10, Eirika's chapter 9.
 */
export const ROUT_GOAL_CHAPTER = 10;

/** Event groups' remaining offsets (EVENT_GROUP has the ones the reader uses). */
const GROUP_SELECT_UNIT = 0x10;
const GROUP_DEST_SELECTED = 0x14;
const GROUP_AFTER_MOVED = 0x18;
const GROUP_TUTORIAL = 0x1c;
const GROUP_TRAPS = 0x20;
const GROUP_TRAPS_HARD = 0x24;

/** Event flags (include/constants/event-flags.h). */
const EVFLAG_WIN = 3;
const EVFLAG_DEFEAT_ALL = 6;
const EVFLAG_GAMEOVER = 101;

/** Event commands: (cmd << 8 | length in halfwords << 4 | subcommand), with the first argument above. */
const evt = (cmd: number, len: number, sub: number, arg = 0) => ((arg & 0xffff) << 16) | (cmd << 8) | (len << 4) | sub;
const ENDA = evt(0x01, 2, 0);
const EVBIT_T = (bits: number) => evt(0x02, 2, 8, bits);
const FADI = (speed: number) => evt(0x17, 2, 1, speed);
const LOAD1 = evt(0x2c, 4, 0, 1); // restriction 1, as vanilla uses; followed by the units pointer
const ENUN = evt(0x30, 2, 0);
const CHANGE_CHAPTER = 0x2a;
/** Event list entries: END, and FLAG (= AFEV: flag to set, script, flag to wait for). */
const LIST_END = 0;
const LIST_FLAG = 1;

/** FE8 AI bytes for each behaviour (decision 23), from the decompilation's AI tables (src/cp_data.c). */
export const AI_BYTES: Record<Behaviour, readonly number[]> = {
  // Act on anything within reach (AI1 0x00), otherwise move toward the nearest foe (AI2 0x00).
  charge: [0x00, 0x00, 0, 0],
  // Act on anything within reach, otherwise stay put (AI2 0x03).
  'attack-in-range': [0x00, 0x03, 0, 0],
  // Act only without moving (AI1 0x03), and never move (AI2 0x03).
  hold: [0x03, 0x03, 0, 0],
};

/** Characters whose defeat ends the game in vanilla FE8 in every chapter (src/data_battlequotes.c). */
const GAME_OVER_CHARACTERS = new Set(['eirika', 'ephraim']);

const ALLEGIANCE: Record<Team, number> = { player: 0, ally: 1, enemy: 2 };

/** Where each stat sits among a character's personal bases (HP, Str, Skl, Spd, Def, Res, Lck, Con). */
const PERSONAL_ORDER: Record<StatKey, number> = { hp: 0, str: 1, skl: 2, spd: 3, def: 4, res: 5, lck: 6, con: 7 };

export interface BuiltRom {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** Things in the chapter the patch can't carry yet, in words for the person making it. */
  readonly notes: string[];
}

/** Allocates space in the added area and writes little-endian values into it. */
class Writer {
  readonly out: number[] = [];
  /** ROM pointer to the next byte written. */
  get here(): number {
    return ROM_BASE + EXPANSION + this.out.length;
  }
  align4() {
    while (this.out.length % 4) this.out.push(0);
  }
  words(ws: readonly number[]): number {
    this.align4();
    const at = this.here;
    for (const w of ws) this.out.push(w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff);
    return at;
  }
  bytes(bs: readonly number[]): number {
    this.align4();
    const at = this.here;
    this.out.push(...bs);
    return at;
  }
}

function idOf<T extends { name: string; id: number }>(list: readonly T[], name: string, what: string): number {
  const e = list.find((x) => x.name === name);
  if (!e) throw new Error(`This tool doesn't know the ${what} "${name}".`);
  return e.id;
}

/** The FE8 character id each unit will be: its own, one picked for it, or a generic Soldier or Frelian. */
export function characterIds(rom: GbaRom, units: readonly ProjectUnit[]): Map<string, number> {
  const defaultClassOf = (id: number) => rom.u8(FE8_US_CHARACTER_TABLE + (id - 1) * CHARACTER_STRIDE + 5);
  const taken = new Set(units.flatMap((u) => (u.team === 'player' && u.character ? [u.character] : [])));
  const out = new Map<string, number>();
  for (const u of units) {
    if (u.team === 'enemy') out.set(u.id, GENERIC_ENEMY);
    else if (u.team === 'ally') out.set(u.id, GENERIC_ALLY);
    else {
      let name = u.character ?? pickCharacter(u.class, idOf(FE8_CLASS_NAMES, u.class, 'class'), taken, defaultClassOf);
      if (name === null) throw new Error('There are more player units than FE8 has characters.');
      taken.add(name);
      out.set(u.id, idOf(FE8_CHARACTER_NAMES, name, 'character'));
    }
  }
  return out;
}

/** One 20-byte unit definition. Byte 3 packs autolevel, allegiance and level; bytes 4-5 pack x and y. */
export function unitDefinition(u: ProjectUnit, character: number): number[] {
  const d = new Array<number>(UNIT_DEFINITION_SIZE).fill(0);
  d[0] = character;
  d[1] = idOf(FE8_CLASS_NAMES, u.class, 'class');
  // Enemies and allies autolevel: FE8 raises them from level 1 by their class's growths. Player units
  // don't, since their characters already hold their stats at this level (see playerStats).
  d[3] = (u.team === 'player' ? 0 : 1) | (ALLEGIANCE[u.team] << 1) | (u.level << 3);
  const pos = (u.at[0] & 0x3f) | ((u.at[1] & 0x3f) << 6);
  d[4] = pos & 0xff;
  d[5] = pos >> 8;
  (u.items ?? []).slice(0, MAX_ITEMS).forEach((item, i) => (d[12 + i] = idOf(FE8_ITEM_NAMES, item, 'item')));
  if (u.team !== 'player') AI_BYTES[u.ai ?? 'attack-in-range'].forEach((b, i) => (d[16 + i] = b));
  return d;
}

/**
 * The personal bases that make a player unit load at exactly its test-play stats (decision 31): its
 * class's bases plus its character's, grown by the character's growths to its level, with its custom
 * stats added, minus the class's bases. Written with the unit's level as the character's base level,
 * so FE8 adds nothing on loading.
 */
export function playerStats(rom: GbaRom, u: ProjectUnit, character: number): Record<StatKey, number> {
  const cls = readClassStats(rom, idOf(FE8_CLASS_NAMES, u.class, 'class'));
  const own = readCharacterStats(rom, FE8_US_CHARACTER_TABLE + (character - 1) * CHARACTER_STRIDE);
  const target = withBonus(characterStatsAtLevel(cls.base, own.base, own.growths, own.baseLevel, u.level), u.statBonus);
  return Object.fromEntries(STAT_KEYS.map((k) => [k, target[k] - cls.base[k]])) as Record<StatKey, number>;
}

/** The first "change chapter" command in a vanilla script, or null if none is found in its first words. */
export function findChapterChange(rom: GbaRom, script: number, maxWords = 256): number | null {
  for (let k = 0; k < maxWords && script + 4 * k + 4 <= rom.size; k++) {
    const w = rom.u32(script + 4 * k);
    if (((w >>> 8) & 0xff) === CHANGE_CHAPTER && ((w >>> 4) & 0xf) === 2) return w >>> 0;
  }
  return null;
}

/** The script of a vanilla misc-list entry that waits for `flag`, reading FLAG entries only. */
export function findFlagEvent(rom: GbaRom, list: number, flag: number, maxEntries = 32): number | null {
  for (let k = 0, a = list; k < maxEntries && a + 12 <= rom.size; k++, a += 12) {
    const head = rom.u32(a);
    if ((head & 0xffff) !== LIST_FLAG) return null;
    if (rom.u32(a + 8) === flag) return rom.u32(a + 4);
  }
  return null;
}

/** Reasons the patch will differ from test play for this chapter. */
export function patchNotes(chapter: ProjectChapter, names: ReadonlyMap<string, number>): string[] {
  const notes: string[] = [];
  const nameOf = (id: number) => FE8_CHARACTER_NAMES.find((c) => c.id === id)?.gameName ?? `character ${id}`;
  for (const u of chapter.units) {
    const who = u.name ?? u.id;
    const character = FE8_CHARACTER_NAMES.find((c) => c.id === names.get(u.id))?.name;
    if (u.team !== 'player') {
      if (u.statBonus && Object.values(u.statBonus).some((v) => v !== 0)) notes.push(`${who}: custom stats for enemies and allies aren't in the patch yet.`);
      if (u.name) notes.push(`${who}: names for enemies and allies aren't in the patch yet.`);
    }
    if (u.team === 'player') {
      const lord = character !== undefined && GAME_OVER_CHARACTERS.has(character);
      if (u.mustSurvive && !lord) notes.push(`${who}: Must survive only works for Eirika and Ephraim in the patch so far.`);
      if (!u.mustSurvive && lord) notes.push(`${who}: as ${nameOf(names.get(u.id)!)}, the game is lost if this unit falls, even without Must survive.`);
    }
    if (u.team === 'ally' && u.mustSurvive) notes.push(`${who}: Must survive for allies isn't in the patch yet.`);
  }
  return notes;
}

/**
 * The clean ROM with `chapter` in place of the vanilla chapter it replaces (the Prologue by default).
 * Throws with a plain-words message when the chapter can't be built.
 */
export function buildFe8Rom(clean: GbaRom, text: TextTable, chapter: ProjectChapter): BuiltRom {
  const slot = mapEntry(chapter.replaces ?? mapRef(0));
  const source = mapEntry(chapter.map);
  if (slot === null || slot >= CHAPTER_COUNT) throw new Error("The chapter's place in the game isn't one this tool knows.");
  if (source === null || source >= CHAPTER_COUNT) throw new Error("The chapter's map isn't one this tool knows.");
  if (clean.size !== EXPANSION) throw new Error('The patch needs the clean 16 MB ROM.');

  const record = CHAPTER_TABLE + slot * CHAPTER_STRIDE;
  const groupEntry = ASSET_TABLE + clean.u8(record + 0x74) * 4;
  const vanillaGroupPointer = clean.u32(groupEntry);
  if (!clean.isPointer(vanillaGroupPointer)) throw new Error("This chapter's place in the game has no events to replace.");
  const vanillaGroup = clean.offsetOf(vanillaGroupPointer);

  const ending = clean.u32(vanillaGroup + EVENT_GROUP.endingScene);
  const nextChapter = clean.isPointer(ending) ? findChapterChange(clean, clean.offsetOf(ending)) : null;
  if (nextChapter === null) throw new Error("This tool can't yet tell which chapter comes after this one, so it can't take its place.");
  const misc = clean.u32(vanillaGroup + EVENT_GROUP.misc);
  const gameOver = clean.isPointer(misc) ? findFlagEvent(clean, clean.offsetOf(misc), EVFLAG_GAMEOVER) : null;
  if (gameOver === null) throw new Error("This chapter's place in the game has no game over event to reuse.");

  const characters = characterIds(clean, chapter.units);
  const w = new Writer();

  // Unit lists, each ended by an empty definition.
  const list = (team: Team) => {
    const units = chapter.units.filter((u) => u.team === team);
    return units.length ? w.bytes([...units.flatMap((u) => unitDefinition(u, characters.get(u.id)!)), ...new Array(UNIT_DEFINITION_SIZE).fill(0)]) : null;
  };
  const players = list('player');
  const enemies = list('enemy');
  const allies = list('ally');
  const noUnits = w.bytes(new Array(UNIT_DEFINITION_SIZE).fill(0));

  const beginning = w.words([...[players, enemies, allies].flatMap((p) => (p === null ? [] : [LOAD1, p, ENUN])), EVBIT_T(7), ENDA]);
  const endingScene = w.words([FADI(16), nextChapter, ENDA]);
  const emptyList = w.words([LIST_END]);
  const miscList = w.words([LIST_FLAG | (EVFLAG_WIN << 16), endingScene, EVFLAG_DEFEAT_ALL, LIST_FLAG, gameOver, EVFLAG_GAMEOVER, LIST_END]);
  const noTutorial = w.words([0]);
  const noTraps = w.bytes([0]);

  // Player units' names, encoded with the ROM's tree; each replaces its character's name text.
  const playerUnits = chapter.units.filter((u) => u.team === 'player');
  const codes = playerUnits.some((u) => u.name) ? readHuffmanCodes(clean, text) : null;
  const names = playerUnits.flatMap((u) => {
    const name = u.name?.trim();
    if (!name || !codes) return [];
    const record = FE8_US_CHARACTER_TABLE + (characters.get(u.id)! - 1) * CHARACTER_STRIDE;
    const encoded = encodeTextBytes(codes, [...name].map((c) => c.charCodeAt(0)));
    return [{ textId: clean.u16(record), pointer: w.bytes(Array.from(encoded)) }];
  });

  // The new event group starts as a copy of vanilla's, which keeps its skirmish lists.
  const group = Array.from({ length: EVENT_GROUP.size / 4 }, (_, k) => clean.u32(vanillaGroup + 4 * k));
  const set = (offset: number, value: number) => (group[offset / 4] = value);
  for (const o of [EVENT_GROUP.turn, EVENT_GROUP.character, EVENT_GROUP.location, GROUP_SELECT_UNIT, GROUP_DEST_SELECTED, GROUP_AFTER_MOVED]) set(o, emptyList);
  set(EVENT_GROUP.misc, miscList);
  set(GROUP_TUTORIAL, noTutorial);
  set(GROUP_TRAPS, noTraps);
  set(GROUP_TRAPS_HARD, noTraps);
  set(EVENT_GROUP.playerUnits, players ?? noUnits);
  set(EVENT_GROUP.playerUnitsHard, players ?? noUnits);
  set(EVENT_GROUP.beginningScene, beginning);
  set(EVENT_GROUP.endingScene, endingScene);
  const newGroup = w.words(group);

  w.align4();
  const size = EXPANSION + Math.ceil(w.out.length / EXPANSION_ALIGN) * EXPANSION_ALIGN;
  const bytes = new Uint8Array(size);
  bytes.set(clean.bytes);
  bytes.set(w.out, EXPANSION);
  const view = new DataView(bytes.buffer);
  view.setUint32(groupEntry, newGroup, true);
  for (const n of names) {
    if (n.textId >= text.count) throw new Error("A character's name isn't where this tool expects it.");
    view.setUint32(text.table + n.textId * 4, n.pointer, true);
  }
  // Player units' stats, as their characters' personal bases at their level (signed bytes). Read
  // from the clean ROM, since only the character's record changes.
  for (const u of playerUnits) {
    const id = characters.get(u.id)!;
    const record = FE8_US_CHARACTER_TABLE + (id - 1) * CHARACTER_STRIDE;
    const personal = playerStats(clean, u, id);
    for (const k of STAT_KEYS) view.setInt8(record + BASE_STATS + PERSONAL_ORDER[k], Math.max(-128, Math.min(127, personal[k])));
    bytes[record + BASE_LEVEL] = u.level;
  }

  // The slot's chapter record: the map's own fields when it comes from another chapter (keeping the
  // slot's title and prep-screen setting), and a Rout objective.
  if (source !== slot) {
    const from = CHAPTER_TABLE + source * CHAPTER_STRIDE;
    const keep = [bytes[record + PREP_FLAG]!, ...bytes.slice(record + TITLE_IDS.start, record + TITLE_IDS.end)];
    bytes.set(clean.bytes.subarray(from + MAP_FIELDS.start, from + MAP_FIELDS.end), record + MAP_FIELDS.start);
    bytes[record + PREP_FLAG] = keep[0]!;
    bytes.set(keep.slice(1), record + TITLE_IDS.start);
  }
  const rout = CHAPTER_TABLE + ROUT_GOAL_CHAPTER * CHAPTER_STRIDE;
  bytes.set(clean.bytes.subarray(rout + GOAL_FIELDS.start, rout + GOAL_FIELDS.end), record + GOAL_FIELDS.start);

  return { bytes, notes: patchNotes(chapter, characters) };
}
