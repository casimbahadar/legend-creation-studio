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
// enemy and ally units, a misc list with vanilla's game over check, and an ending scene that moves on
// to the chapter the slot's vanilla ending moves on to. The goal (decision 36) is vanilla's too: Rout
// is the misc list's DefeatAll; Seize is a location-list Seize(x, y), which sets the win flag when the
// lord seizes, after which the game runs the ending scene itself (MaybeCallEndEvent); Defeat boss is
// the misc list's DefeatBoss, waiting for the flag the boss's death quote sets. The boss gets an entry
// of its own at the head of the death-quote list for the chapter's slot (the list is copied to the
// added area), silent unless the slot is the boss's own chapter, where it says its vanilla quote, and
// the replaced chapter's boss entries are dropped so no other boss's fall ends the chapter. Survive is vanilla's Survive turn event: on player phase of the
// turn after the last, set the win flag and run the ending scene; its objective "Survive N turns" is
// written over the replaced chapter's own objective text.
//
// Doors, chests, villages and houses (decision 38) are location-list entries as FE8's macros write
// them (include/EA_Standard_Library/Main_Code_Helpers.h): Door (DOOR, the door opening by its map's tile
// change), Chest (CHES, an item, or ITEM_GOLD and an amount), Village (VILL with a visit, and the LOCA
// one square up that its gate answers to) and House (LOCA with a visit). FE8's own are copied from the
// map's chapter as they are, scenes and all; a village or house of the user's own gets a scene that gives
// its item to the visitor (GIVEITEMTO the active unit) or its gold to the party (GIVEITEMTOMAIN), and an
// event flag of its own so it is visited once, as in test play. The map's tile changes come with its map
// ids. What the user's own villages and houses say isn't written yet.

import { characterStatsAtLevel, withBonus } from '../core/combat';
import { goalProblem, goalRule, goalWindowText } from '../core/goals';
import { mapEntry, mapRef, MAX_ITEMS, STAT_KEYS, type Behaviour, type ProjectChapter, type ProjectPlace, type ProjectUnit, type StatKey, type Team } from '../core/project';
import { ASSET_TABLE, CHAPTER_COUNT, CHAPTER_STRIDE, CHAPTER_TABLE, EVENT_GROUP, readChapter, UNIT_DEFINITION_SIZE } from './fe8-chapters';
import { readTileEvents, type TileEvent } from './fe8-tile-events';
import { FE8_BOSS_NAMES, FE8_CHARACTER_NAMES, GENERIC_ALLY, GENERIC_ENEMY, pickCharacter } from './fe8-character-names';
import { BASE_LEVEL, BASE_STATS, characterRecord, readCharacterStats } from './fe8-characters';
import { readClassStats } from './fe8-classes';
import { ANY, defeatTalkBytes, findDefeatTalkList, readDefeatTalks, type DefeatTalk } from './fe8-death-quotes';
import { FE8_ITEM_NAMES } from './fe8-item-names';
import { readChapterMap } from './fe8-maps';
import { FE8_CLASS_NAMES } from './fe8-names';
import { readRom, ROM_BASE, type GbaRom } from './gba-rom';
import { decodeTextBytes, FE8U_ROOT_POINTER_LITERAL, FE8U_TREE_LITERAL, type TextTable } from './text';
import { encodeTextBytes, readHuffmanCodes } from './text-encode';
import { changedTexts, extendTree } from './text-extend';

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
/**
 * Vanilla Seize chapters whose objective the patch reuses (src/data/chapter_settings.json): chapter
 * index 3, chapter 3 ("Seize the throne", goal window "Seize throne"), and chapter index 1, chapter 1
 * ("Seize the castle gate", "Seize gate") for a gate.
 */
export const SEIZE_THRONE_GOAL_CHAPTER = 3;
export const SEIZE_GATE_GOAL_CHAPTER = 1;
/**
 * A vanilla Survive chapter whose goal window ("Survive", type Defense, with the end turn) the patch
 * reuses: chapter index 13, Eirika's chapter 12, whose objective text names its own boss, so the
 * patch writes one of its own.
 */
export const SURVIVE_GOAL_CHAPTER = 13;
/** Chapter record fields: the objective text and the goal window's end turn. */
const OBJECTIVE_TEXT = 0x88;
const END_TURN = 0x8d;
/** A vanilla Defeat boss chapter whose objective ("Defeat boss", goal window "Defeat boss") the patch reuses: chapter index 25, Ephraim's chapter 11. */
export const DEFEAT_BOSS_GOAL_CHAPTER = 25;

/** Event groups' remaining offsets (EVENT_GROUP has the ones the reader uses). */
const GROUP_SELECT_UNIT = 0x10;
const GROUP_DEST_SELECTED = 0x14;
const GROUP_AFTER_MOVED = 0x18;
const GROUP_TUTORIAL = 0x1c;
const GROUP_TRAPS = 0x20;
const GROUP_TRAPS_HARD = 0x24;

/** Event flags (include/constants/event-flags.h). */
const EVFLAG_DEFEAT_BOSS = 2;
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
/**
 * Event list entries: END; FLAG (= AFEV: flag to set, script, flag to wait for); LOCA (flag to set,
 * script, then x, y and the tile command as bytes).
 */
const LIST_END = 0;
const LIST_FLAG = 1;
const LIST_TURN = 2;
const LIST_LOCA = 5;
const LIST_VILL = 6;
const LIST_CHES = 7;
const LIST_DOOR = 8;
/** Player phase, for turn events. */
const FACTION_BLUE = 0;
/** A list entry's script that sets its flag and runs nothing. */
const EVENT_NOSCRIPT = 1;
const TILE_COMMAND_SEIZE = 0x11;
const TILE_COMMAND_VISIT = 0x10;
const TILE_COMMAND_DOOR = 0x12;
const TILE_COMMAND_CHEST = 0x14;
/** The second entry of FE8's Village macro, one square up from the village. */
const TILE_COMMAND_20 = 0x20;
const ITEM_GOLD = 0x77;
/** Chapter-temporary event flags (EVFLAG_TMP): 7 to 100. Villages and houses of the user's own take them from the top. */
const FIRST_TEMP_FLAG = 7;
const LAST_TEMP_FLAG = 100;
const SVAL = (slot: number) => evt(0x05, 4, 0, slot);
/** GIVEITEMTO and GIVEITEMTOMAIN: slot 3's item to a unit, or its gold to the party; CHAR_EVT_ACTIVE_UNIT (-1) and CHAR_EVT_PLAYER_LEADER (0). */
const GIVE_ITEM_TO_ACTIVE = evt(0x37, 2, 0, 0xffff);
const GIVE_GOLD = evt(0x37, 2, 1, 0);

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
/** Player units and boss enemies: units whose FE8 character takes their name and stats (decisions 30, 31, 34). */
export const ownsCharacter = (u: ProjectUnit) => u.team === 'player' || (u.team === 'enemy' && u.character !== undefined);

export function characterIds(rom: GbaRom, units: readonly ProjectUnit[]): Map<string, number> {
  const defaultClassOf = (id: number) => rom.u8(characterRecord(rom, id) + 5);
  const taken = new Set(units.flatMap((u) => (u.team === 'player' && u.character ? [u.character] : [])));
  const out = new Map<string, number>();
  for (const u of units) {
    if (u.team === 'enemy') out.set(u.id, u.character ? idOf(FE8_BOSS_NAMES, u.character, 'boss') : GENERIC_ENEMY);
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
  // Generic enemies and allies autolevel: FE8 raises them from level 1 by their class's growths. Units
  // with their own character don't, since it already holds their stats at this level (see ownStats).
  d[3] = (ownsCharacter(u) ? 0 : 1) | (ALLEGIANCE[u.team] << 1) | (u.level << 3);
  const pos = (u.at[0] & 0x3f) | ((u.at[1] & 0x3f) << 6);
  d[4] = pos & 0xff;
  d[5] = pos >> 8;
  (u.items ?? []).slice(0, MAX_ITEMS).forEach((item, i) => (d[12 + i] = idOf(FE8_ITEM_NAMES, item, 'item')));
  if (u.team !== 'player') AI_BYTES[u.ai ?? 'attack-in-range'].forEach((b, i) => (d[16 + i] = b));
  return d;
}

/**
 * The personal bases that make a unit with its own character load at exactly its test-play stats (decision 31): its
 * class's bases plus its character's, grown by the character's growths to its level, with its custom
 * stats added, minus the class's bases. Written with the unit's level as the character's base level,
 * so FE8 adds nothing on loading.
 */
export function ownStats(rom: GbaRom, u: ProjectUnit, character: number): Record<StatKey, number> {
  const cls = readClassStats(rom, idOf(FE8_CLASS_NAMES, u.class, 'class'));
  const own = readCharacterStats(rom, characterRecord(rom, character));
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

/**
 * The death-quote list for a Defeat boss chapter in `slot`, written into the added area: an entry for
 * the boss in this slot first, setting EVFLAG_DEFEAT_BOSS, then the vanilla list without the replaced
 * chapter's boss entries. The entry says the boss's vanilla quote only in the boss's own chapter (the
 * replaced chapter's entry for it); elsewhere it is silent. Returns the literal to repoint and the new
 * list's pointer.
 */
function bossDeathQuotes(clean: GbaRom, pid: number, slot: number, w: Writer): { literal: number; pointer: number } {
  const found = findDefeatTalkList(clean);
  const vanilla = found && readDefeatTalks(clean, found.table);
  if (!found || !vanilla) throw new Error("This ROM's death quotes aren't where this tool expects them, so it can't make a Defeat boss chapter.");
  const own = vanilla.find((e) => e.pid === pid && e.chapter === slot);
  const entry: DefeatTalk = { pid, route: ANY, chapter: slot, flag: EVFLAG_DEFEAT_BOSS, msg: own?.msg ?? 0, event: own?.event ?? 0 };
  const rest = vanilla.filter((e) => !(e.chapter === slot && e.flag === EVFLAG_DEFEAT_BOSS));
  return { literal: found.literal, pointer: w.bytes(defeatTalkBytes([entry, ...rest])) };
}

/** The turns a Survive chapter lasts. */
const goalTurns = (chapter: ProjectChapter) => {
  const rule = goalRule(chapter);
  return rule.kind === 'survive' ? rule.turns : 0;
};

/**
 * Survive's objective on the status screen: one line, which is 96 pixels wide, so kept shorter than
 * vanilla's one-line "Defeat all monsters".
 */
export function surviveObjective(turns: number): string {
  return `Survive ${turns} ${turns === 1 ? 'turn' : 'turns'}`;
}

/** Why the chapter's goal stops the patch from being made, in plain words; null if it doesn't. */
export function goalBlocker(chapter: ProjectChapter): string | null {
  const problem = goalProblem(chapter);
  if (problem) return problem;
  return null;
}

/** The vanilla chapter whose objective fields the chapter's goal reuses, its goal window text matching test play's. */
export function goalChapter(clean: GbaRom, chapter: ProjectChapter, source: number): number {
  if (chapter.goal === 'boss') return DEFEAT_BOSS_GOAL_CHAPTER;
  if (chapter.goal === 'survive') return SURVIVE_GOAL_CHAPTER;
  if (chapter.goal !== 'seize') return ROUT_GOAL_CHAPTER;
  const map = readChapterMap(clean, source);
  const text = goalWindowText({ kind: 'seize', at: chapter.seizeAt ?? null, lord: null }, (x, y) => map?.terrain[y * map.width + x] ?? 0);
  return text === 'Seize gate' ? SEIZE_GATE_GOAL_CHAPTER : SEIZE_THRONE_GOAL_CHAPTER;
}

/** Reasons the patch will differ from test play for this chapter. */
export function patchNotes(chapter: ProjectChapter, names: ReadonlyMap<string, number>, clean?: GbaRom): string[] {
  const notes: string[] = [];
  const slot = mapEntry(chapter.replaces ?? mapRef(0));
  if (clean && chapter.goal === 'survive' && slot !== null && slot < CHAPTER_COUNT) {
    const objective = (i: number) => clean.u16(CHAPTER_TABLE + i * CHAPTER_STRIDE + OBJECTIVE_TEXT);
    const shared = Array.from({ length: CHAPTER_COUNT }, (_, i) => i).some((i) => i !== slot && objective(i) === objective(slot));
    if (shared) notes.push("Survive's objective replaces this chapter's own objective text, which another chapter in the game shares, so it shows there too.");
  }
  const nameOf = (id: number) => FE8_CHARACTER_NAMES.find((c) => c.id === id)?.gameName ?? `character ${id}`;
  for (const u of chapter.units) {
    const who = u.name ?? u.id;
    const character = FE8_CHARACTER_NAMES.find((c) => c.id === names.get(u.id))?.name;
    if (!ownsCharacter(u)) {
      const fix = u.team === 'enemy' ? ' Pick a boss for this enemy to keep them.' : '';
      if (u.statBonus && Object.values(u.statBonus).some((v) => v !== 0)) notes.push(`${who}: custom stats need an FE8 character in the patch.${fix}`);
      if (u.name) notes.push(`${who}: names need an FE8 character in the patch.${fix}`);
    }
    if (u.team === 'player') {
      const lord = character !== undefined && GAME_OVER_CHARACTERS.has(character);
      if (u.mustSurvive && !lord) notes.push(`${who}: Must survive only works for Eirika and Ephraim in the patch so far.`);
      if (!u.mustSurvive && lord) notes.push(`${who}: as ${nameOf(names.get(u.id)!)}, the game is lost if this unit falls, even without Must survive.`);
    }
    if (u.team === 'ally' && u.mustSurvive) notes.push(`${who}: Must survive for allies isn't in the patch yet.`);
  }
  const said = (chapter.places ?? []).filter((p) => !p.fe8 && p.text?.trim());
  if (said.length) notes.push(`What your own ${said.length === 1 ? 'village or house says' : 'villages and houses say'} isn't in the patch yet; ${said.length === 1 ? 'it gives' : 'they give'} what you chose without words.`);
  return notes;
}

/** A list entry's head word: the command and the flag it sets. */
const listHead = (cmd: number, flag: number) => cmd | (flag << 16);
/** A list entry's position word: x, y and the tile command, as bytes. */
const tileWord = (x: number, y: number, command: number) => x | (y << 8) | (command << 16);

/**
 * The location-list entries for the chapter's doors, chests, villages and houses: its own list, or,
 * without one, FE8's own on the map's chapter (`fe8`, read from it). FE8's own are copied; the user's
 * get new scenes written with `w`.
 */
export function placeEntries(chapter: ProjectChapter, fe8: readonly TileEvent[], w: { words(ws: readonly number[]): number }): number[] {
  const own = (e: TileEvent): number[] => {
    if (e.kind === 'door') return [listHead(LIST_DOOR, e.flag), e.word, tileWord(e.x, e.y, TILE_COMMAND_DOOR)];
    if (e.kind === 'chest') return [listHead(LIST_CHES, e.flag), e.word, tileWord(e.x, e.y, TILE_COMMAND_CHEST)];
    if (e.kind === 'randomChest') return [listHead(LIST_LOCA, e.flag), e.word, tileWord(e.x, e.y, TILE_COMMAND_CHEST)];
    if (e.kind === 'house') return [listHead(LIST_LOCA, e.flag), e.word, tileWord(e.x, e.y, TILE_COMMAND_VISIT)];
    return village(e.flag, e.word, e.x, e.y);
  };
  const village = (flag: number, scene: number, x: number, y: number) => [listHead(LIST_VILL, flag), scene, tileWord(x, y, TILE_COMMAND_VISIT), listHead(LIST_LOCA, flag), EVENT_NOSCRIPT, tileWord(x, y - 1, TILE_COMMAND_20)];
  if (!chapter.places) return fe8.flatMap(own);
  const at = (p: ProjectPlace) => fe8.find((e) => e.x === p.at[0] && e.y === p.at[1] && e.kind !== 'door');
  // Flags for the user's villages and houses, from the top of the temporary ones, past FE8's own in use.
  const taken = new Set(chapter.places.flatMap((p) => (p.fe8 ? [at(p)?.flag ?? 0] : [])));
  let next = LAST_TEMP_FLAG;
  const flag = () => {
    while (taken.has(next)) next--;
    if (next < FIRST_TEMP_FLAG) throw new Error('This chapter has more villages and houses than the game has event flags for.');
    return next--;
  };
  return chapter.places.flatMap((p) => {
    const [x, y] = p.at;
    if (p.fe8) {
      const e = at(p);
      if (!e) throw new Error(`FE8's own ${p.kind} at ${x}, ${y} isn't on this map's chapter.`);
      return own(e);
    }
    const item = p.item === undefined ? null : idOf(FE8_ITEM_NAMES, p.item, 'item');
    if (p.kind === 'door') return [listHead(LIST_DOOR, 0), EVENT_NOSCRIPT, tileWord(x, y, TILE_COMMAND_DOOR)];
    if (p.kind === 'chest') return [listHead(LIST_CHES, 0), p.gold !== undefined ? ITEM_GOLD | (p.gold << 16) : (item ?? 0), tileWord(x, y, TILE_COMMAND_CHEST)];
    const gives = item !== null ? [SVAL(3), item, GIVE_ITEM_TO_ACTIVE] : p.gold !== undefined ? [SVAL(3), p.gold, GIVE_GOLD] : [];
    const scene = w.words([...gives, EVBIT_T(7), ENDA]);
    return p.kind === 'village' ? village(flag(), scene, x, y) : [listHead(LIST_LOCA, flag()), scene, tileWord(x, y, TILE_COMMAND_VISIT)];
  });
}

/** Throws unless every text entry but the renamed ones decodes the same with the moved, extended tree. */
function checkText(clean: GbaRom, text: TextTable, bytes: Uint8Array, moved: { base: number; root: number }, renamed: ReadonlySet<number>) {
  const built = readRom(bytes);
  const after: TextTable = { ...text, nodes: built.offsetOf(moved.base), root: built.offsetOf(moved.root) };
  for (let id = 0; id < text.count; id++) {
    if (renamed.has(id)) continue;
    const a = decodeTextBytes(clean, text, id);
    const b = decodeTextBytes(built, after, id);
    if (a.length !== b.length || a.some((x, k) => x !== b[k])) throw new Error(`Adding letters for the names changed the game's text ${id}, so the patch wasn't made.`);
  }
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
  const blocked = goalBlocker(chapter);
  if (blocked) throw new Error(blocked);

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
  const surviveTurns = chapter.goal === 'survive' ? goalTurns(chapter) : null;
  const turnList = surviveTurns === null ? emptyList : w.words([LIST_TURN | (EVFLAG_WIN << 16), endingScene, (surviveTurns + 1) | (FACTION_BLUE << 16), LIST_END]);
  const seizeAt = chapter.goal === 'seize' ? chapter.seizeAt : undefined;
  const seizeEntry = seizeAt ? [LIST_LOCA | (EVFLAG_WIN << 16), EVENT_NOSCRIPT, seizeAt[0] | (seizeAt[1] << 8) | (TILE_COMMAND_SEIZE << 16)] : [];
  const places = placeEntries(chapter, readTileEvents(clean, readChapter(clean, text, source)), w);
  const locationList = seizeEntry.length || places.length ? w.words([...seizeEntry, ...places, LIST_END]) : emptyList;
  const winOn = chapter.goal === 'rout' ? EVFLAG_DEFEAT_ALL : chapter.goal === 'boss' ? EVFLAG_DEFEAT_BOSS : null;
  const win = winOn === null ? [] : [LIST_FLAG | (EVFLAG_WIN << 16), endingScene, winOn];
  const miscList = w.words([...win, LIST_FLAG, gameOver, EVFLAG_GAMEOVER, LIST_END]);
  const bossId = chapter.goal === 'boss' && chapter.boss ? characters.get(chapter.boss) : undefined;
  const deathQuotes = bossId === undefined ? null : bossDeathQuotes(clean, bossId, slot, w);
  const noTutorial = w.words([0]);
  const noTraps = w.bytes([0]);

  // Names of units with their own character, encoded with the ROM's tree; each replaces its character's name text. When
  // a name needs letters the tree lacks, the tree is extended (text-extend) and moved here too, and
  // the few game texts whose code that changes are re-encoded with it. Survive's objective replaces the
  // slot's own objective text the same way.
  const ownUnits = chapter.units.filter(ownsCharacter);
  const wanted = ownUnits.flatMap((u) => {
    const name = u.name?.trim();
    return name ? [{ textId: clean.u16(characterRecord(clean, characters.get(u.id)!)), bytes: [...name].map((c) => c.charCodeAt(0)) }] : [];
  });
  if (surviveTurns !== null) wanted.push({ textId: clean.u16(record + OBJECTIVE_TEXT), bytes: [...surviveObjective(surviveTurns)].map((c) => c.charCodeAt(0)) });
  const vanillaCodes = wanted.length ? readHuffmanCodes(clean, text) : null;
  const spellable = (b: number[]) => {
    try {
      encodeTextBytes(vanillaCodes!, b);
      return true;
    } catch {
      return false;
    }
  };
  const tree = wanted.some((n) => !spellable(n.bytes)) ? extendTree(clean, text) : null;
  let moved: { base: number; root: number; texts: { id: number; pointer: number }[] } | null = null;
  if (tree) {
    if (clean.u32(FE8U_TREE_LITERAL) !== ROM_BASE + text.nodes || clean.u32(clean.offsetOf(clean.u32(FE8U_ROOT_POINTER_LITERAL))) !== ROM_BASE + text.root) {
      throw new Error("This ROM's text isn't where this tool expects it, so it can't add letters for these names.");
    }
    const base = w.words(tree.words);
    const texts = changedTexts(clean, text, tree).map((c) => ({ id: c.id, pointer: w.bytes(Array.from(encodeTextBytes(tree.codes, c.bytes, false))) }));
    moved = { base, root: base + tree.root * 4, texts };
  }
  const codes = tree?.codes ?? vanillaCodes;
  const names = wanted.map((n) => ({ textId: n.textId, pointer: w.bytes(Array.from(encodeTextBytes(codes!, n.bytes))) }));

  // The new event group starts as a copy of vanilla's, which keeps its skirmish lists.
  const group = Array.from({ length: EVENT_GROUP.size / 4 }, (_, k) => clean.u32(vanillaGroup + 4 * k));
  const set = (offset: number, value: number) => (group[offset / 4] = value);
  set(EVENT_GROUP.turn, turnList);
  for (const o of [EVENT_GROUP.character, GROUP_SELECT_UNIT, GROUP_DEST_SELECTED, GROUP_AFTER_MOVED]) set(o, emptyList);
  set(EVENT_GROUP.location, locationList);
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
  if (deathQuotes) view.setUint32(deathQuotes.literal, deathQuotes.pointer, true);
  // Re-encoded game texts first, then the names, which win where a name's text is one of them.
  if (moved) {
    for (const m of moved.texts) view.setUint32(text.table + m.id * 4, m.pointer, true);
    view.setUint32(FE8U_TREE_LITERAL, moved.base, true);
    view.setUint32(clean.offsetOf(clean.u32(FE8U_ROOT_POINTER_LITERAL)), moved.root, true);
  }
  for (const n of names) {
    if (n.textId >= text.count) throw new Error("A character's name isn't where this tool expects it.");
    view.setUint32(text.table + n.textId * 4, n.pointer, true);
  }
  if (moved) checkText(clean, text, bytes, moved, new Set(names.map((n) => n.textId)));
  // Their stats, as their characters' personal bases at their level (signed bytes). Read from the
  // clean ROM, since only the character's record changes.
  for (const u of ownUnits) {
    const id = characters.get(u.id)!;
    const record = characterRecord(clean, id);
    const personal = ownStats(clean, u, id);
    for (const k of STAT_KEYS) view.setInt8(record + BASE_STATS + PERSONAL_ORDER[k], Math.max(-128, Math.min(127, personal[k])));
    bytes[record + BASE_LEVEL] = u.level;
  }

  // The slot's chapter record: the map's own fields when it comes from another chapter (keeping the
  // slot's title and prep-screen setting), and the goal's objective.
  if (source !== slot) {
    const from = CHAPTER_TABLE + source * CHAPTER_STRIDE;
    const keep = [bytes[record + PREP_FLAG]!, ...bytes.slice(record + TITLE_IDS.start, record + TITLE_IDS.end)];
    bytes.set(clean.bytes.subarray(from + MAP_FIELDS.start, from + MAP_FIELDS.end), record + MAP_FIELDS.start);
    bytes[record + PREP_FLAG] = keep[0]!;
    bytes.set(keep.slice(1), record + TITLE_IDS.start);
  }
  const goal = CHAPTER_TABLE + goalChapter(clean, chapter, source) * CHAPTER_STRIDE;
  bytes.set(clean.bytes.subarray(goal + GOAL_FIELDS.start, goal + GOAL_FIELDS.end), record + GOAL_FIELDS.start);
  if (surviveTurns !== null) {
    // The slot's own objective text, now Survive's, and the goal window's last turn (shown as one less).
    view.setUint16(record + OBJECTIVE_TEXT, clean.u16(record + OBJECTIVE_TEXT), true);
    bytes[record + END_TURN] = surviveTurns + 1;
  }

  return { bytes, notes: patchNotes(chapter, characters, clean) };
}
