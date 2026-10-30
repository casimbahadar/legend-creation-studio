// Project files in the editor: reading what the editor needs from the ROM, opening a file (checked
// against this ROM, older forms converted), and saving one.

import { checkProject, mapEntry, MAX_ITEMS, MAX_LEVEL, projectToJson, STAT_KEYS, toName, type Problem, type Project, type ProjectChapter, type ProjectPlace, type ProjectUnit } from '../core/project';
import { characterIds, ownsCharacter } from '../rom/fe8-build';
import { CHAPTER_COUNT, readChapter } from '../rom/fe8-chapters';
import { ALL_CHARACTER_NAMES, characterIdOf, checkCharacterNames, FE8_BOSS_NAMES, FE8_CHARACTER_NAMES, type CharacterMismatch } from '../rom/fe8-character-names';
import { findCharacterTable, readCharacters, type RomCharacter } from '../rom/fe8-characters';
import { readAllChapterMaps, readChapterMap, type ChapterMap } from '../rom/fe8-maps';
import { crc32, formatCrc32 } from '../rom/crc32';
import { FE8_US_CRC32 } from '../rom/fe8';
import { FE8U_SYSTEM_GLYPHS, readFont, readSpecialFont, readTextPalette, type Font } from '../rom/fe8-font';
import { readWindowArt, type WindowArt } from '../rom/fe8-windows';
import { readMapCursor } from '../rom/fe8-cursor';
import { readExpBarArt, type ExpBarArt } from '../rom/fe8-expbar';
import { readLevelUpBox, readLevelUpSprites, type LevelUpSprites } from '../rom/fe8-levelup';
import { readPhaseBanner, type PhaseBanner } from '../rom/fe8-phase';
import { readStatusIcons, type StatusIconArt } from '../rom/fe8-status-icons';
import { readGameOverArt, type GameOverArt } from '../rom/fe8-gameover';
import { readForecastMultipliers, type ForecastMultipliers } from '../rom/fe8-forecast';
import { readBattleBoxArt, type BattleBoxArt } from '../rom/fe8-battle-box';
import { readHitEffects, type HitEffects } from '../rom/fe8-hit-effects';
import { readMapChanges, readTileEvents } from '../rom/fe8-tile-events';
import { chapterPlaces, fe8Places, type Fe8Places } from '../play/places';
import type { PlayPlace } from '../core/play';
import type { Image, Palette } from '../rom/gba-graphics';
import { FE8_ITEM_NAMES, type ItemMismatch } from '../rom/fe8-item-names';
import type { NameMismatch } from '../rom/fe8-names';
import { readRom, type GbaRom } from '../rom/gba-rom';
import { decodeTextBytes, findTextTable, type TextTable } from '../rom/text';
import { readHuffmanCodes, type HuffmanCodes } from '../rom/text-encode';
import { classStats, readCatalog, type ClassArt, type GameItem } from '../play/catalog';

/** A chosen file: the clean ROM, read for the editor, or another file and its CRC32. */
export type ChosenRom = { state: 'clean'; rom: GbaRom; text: TextTable | null; editor: EditorRom | null } | { state: 'other'; crc: string };

/** Checks a chosen file is the clean FE8 US ROM and, if it is, reads what the editor and play need. */
export function readChosenRom(bytes: Uint8Array): ChosenRom {
  const crc = crc32(bytes);
  if (crc !== FE8_US_CRC32) return { state: 'other', crc: formatCrc32(crc) };
  const rom = readRom(bytes);
  const text = findTextTable(rom);
  return { state: 'clean', rom, text, editor: text ? readEditorRom(rom, text, readAllChapterMaps(rom)) : null };
}

/** Everything the editor needs from the ROM, read once when the ROM is chosen. */
export function readEditorRom(rom: GbaRom, text: TextTable, maps: ChapterMap[]): EditorRom {
  const c = readCatalog(rom, text);
  const chapters = Array.from({ length: CHAPTER_COUNT }, (_, i) => readChapter(rom, text, i));
  const chapterTitles = chapters.map((ch) => ch.title);
  // A chapter whose events can't be read starts with none, rather than stopping the ROM loading.
  const placesOf = (ch: (typeof chapters)[number]): Fe8Places => {
    try {
      return { changes: readMapChanges(rom, ch), events: readTileEvents(rom, ch) };
    } catch {
      return { changes: [], events: [] };
    }
  };
  const table = findCharacterTable(rom);
  const characters = table === null ? [] : readCharacters(rom, text, table);
  return {
    rom,
    text,
    textCodes: readHuffmanCodes(rom, text),
    maps,
    art: c.art,
    items: c.items,
    mismatches: c.classMismatches,
    itemMismatches: c.itemMismatches,
    chapterTitles,
    fe8Places: chapters.map(placesOf),
    characters,
    characterMismatches: checkCharacterNames(characters, ALL_CHARACTER_NAMES),
    font: readGameFont(rom),
    windows: readWindowArt(rom),
    cursor: readMapCursor(rom),
    phaseBanners: readPhaseBanners(rom),
    expBar: readExpBarArt(rom),
    levelUpBox: readLevelUpBox(rom),
    levelUpSprites: readLevelUpSprites(rom),
    statusIcons: readStatusIcons(rom),
    gameOver: readGameOverArt(rom),
    forecastMultipliers: readForecastMultipliers(rom),
    battleBoxes: readBattleBoxArt(rom),
    hitEffects: readHitEffects(rom),
  };
}

export interface EditorRom {
  readonly rom: GbaRom;
  readonly text: TextTable;
  /** The ROM's text codes, to check that a unit's name can be written into the game. */
  readonly textCodes: HuffmanCodes;
  readonly maps: ChapterMap[];
  readonly art: ClassArt[];
  readonly mismatches: NameMismatch[];
  readonly items: GameItem[];
  readonly itemMismatches: ItemMismatch[];
  /** Each FE8 chapter's map changes and its doors, chests, villages and houses, by chapter index (decision 38). */
  readonly fe8Places: readonly Fe8Places[];
  /** Each FE8 chapter's title by chapter index ("" if it has none), to name the maps. */
  readonly chapterTitles: string[];
  /** FE8's character table by id - 1, or [] if it wasn't found. */
  readonly characters: RomCharacter[];
  readonly characterMismatches: CharacterMismatch[];
  /** FE8's system font and text palette, for drawing play's windows in the game's own text (decision 35); null if not found. */
  readonly font: GameFont | null;
  /** FE8's window frames and map window boxes, for drawing play's windows as the game does (decision 35); null if not found. */
  readonly windows: WindowArt | null;
  /** The top left corner of FE8's map cursor, for drawing the cursor as the game does (decision 35); null if not found. */
  readonly cursor: Image | null;
  /** FE8's phase banners by team, for play's phase intros (decision 35); null if not found. */
  readonly phaseBanners: Readonly<Record<'player' | 'enemy' | 'ally', PhaseBanner>> | null;
  /** FE8's experience bar, for play's experience display (decision 35); null if not found. */
  readonly expBar: ExpBarArt | null;
  /** FE8's level-up box, for play's level-ups (decision 35); null if not found. */
  readonly levelUpBox: Image | null;
  /** FE8's level-up sprites (LEVEL UP, the gain labels), for play's level-ups (decision 35); null if not found. */
  readonly levelUpSprites: LevelUpSprites | null;
  /** FE8's sleep, silence and berserk icons over units on the map (decision 35); null if not found. */
  readonly statusIcons: StatusIconArt | null;
  /** FE8's Game Over screen, shown when test play is lost (decision 35); null if not found. */
  readonly gameOver: GameOverArt | null;
  /** FE8's "x2" and "x4" marks for the battle forecast (decision 35); null if not found. */
  readonly forecastMultipliers: ForecastMultipliers | null;
  /** FE8's HP boxes for a battle on the map (decision 35); null if not found. */
  readonly battleBoxes: BattleBoxArt | null;
  /** FE8's MISS and NO DAMAGE over a unit in a map battle (decision 35); null if not found. */
  readonly hitEffects: HitEffects | null;
}

export interface GameFont {
  readonly glyphs: Font;
  readonly palette: Palette;
  /** FE8's special characters (big digits, dashes, "HP", "100"); null if not found. */
  readonly special?: Font | null;
}

function readPhaseBanners(rom: GbaRom): EditorRom['phaseBanners'] {
  const player = readPhaseBanner(rom, 'player');
  const enemy = readPhaseBanner(rom, 'enemy');
  const ally = readPhaseBanner(rom, 'ally');
  return player && enemy && ally ? { player, enemy, ally } : null;
}

function readGameFont(rom: GbaRom): GameFont | null {
  const glyphs = readFont(rom, FE8U_SYSTEM_GLYPHS);
  return glyphs ? { glyphs, palette: readTextPalette(rom), special: readSpecialFont(rom) } : null;
}

export const layoutKey = (m: ChapterMap) => `${m.width}x${m.height}:${m.cells.join(',')}`;

const ITEM_NAMES_BY_ID = new Map(FE8_ITEM_NAMES.map((i) => [i.id, i.name]));

/** FE8's own doors, chests, villages and houses on the map a reference points to, as a chapter starts with them (decision 38). */
export function startingPlaces(data: EditorRom, ref: string): ProjectPlace[] {
  const entry = mapEntry(ref);
  const fe8 = entry === null ? undefined : data.fe8Places[entry];
  if (!fe8 || entry === null) return [];
  // FE8's own data has entries off the map (a door at 23, 12 on Unbroken Heart's 22 x 19 map); they're left out.
  const map = readChapterMap(data.rom, entry);
  const onMap = (p: ProjectPlace) => !map || (p.at[0] < map.width && p.at[1] < map.height);
  return fe8Places(fe8, (id) => ITEM_NAMES_BY_ID.get(id)).filter(onMap);
}

/** One of the ROM's messages as plain text: line breaks as spaces, control codes left out; "" if unreadable. */
export function plainText(data: EditorRom, id: number): string {
  try {
    const bytes = decodeTextBytes(data.rom, data.text, id);
    return String.fromCharCode(...Array.from(bytes, (b) => (b === 1 ? 0x20 : b)).filter((b) => b >= 0x20 && b < 0x7f))
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/**
 * A chapter's doors, chests, villages and houses for test play, as plain values: FE8's own villages and
 * houses with their scene's text, item or gold, and `more` if the scene does more than that; FE8's own
 * random chest with one of its items, chosen with `rn` (0 to 99) by its chances, as the game does.
 */
export function playPlaces(data: EditorRom, chapter: ProjectChapter, rn: () => number): PlayPlace[] {
  const entry = mapEntry(chapter.map);
  const events = (entry === null ? undefined : data.fe8Places[entry])?.events ?? [];
  return chapterPlaces(chapter, startingPlaces(data, chapter.map)).map((p): PlayPlace => {
    const at: [number, number] = [p.at[0], p.at[1]];
    if (!p.fe8) return { kind: p.kind, at, ...(p.item !== undefined ? { item: p.item } : {}), ...(p.gold !== undefined ? { gold: p.gold } : {}), ...(p.text?.trim() ? { text: p.text.trim() } : {}) };
    const e = events.find((x) => x.x === at[0] && x.y === at[1] && x.kind !== 'door');
    const name = (id: number | null) => (id === null ? undefined : ITEM_NAMES_BY_ID.get(id));
    if (e?.kind === 'randomChest') {
      // The chest case of the tile command handler: walk the list until the chances passed exceed the roll.
      const roll = rn();
      let sum = 0;
      // A roll past every chance finds nothing.
      const pick = e.items.find((i) => roll < (sum += i.chance));
      const item = name(pick?.item ?? null);
      return { kind: 'chest', at, ...(item ? { item } : {}) };
    }
    if (e?.kind === 'chest') return { kind: 'chest', at, ...(e.gold ? { gold: e.gold } : name(e.item) ? { item: name(e.item)! } : {}) };
    const scene = e?.kind === 'village' || e?.kind === 'house' ? e.scene : null;
    if (!scene) return { kind: p.kind, at, more: true };
    const text = scene.texts.map((id) => plainText(data, id)).filter(Boolean).join(' ');
    const item = name(scene.item);
    return { kind: p.kind, at, ...(text ? { text } : {}), ...(item ? { item } : scene.gold ? { gold: scene.gold } : {}), ...(scene.custom ? { more: true } : {}) };
  });
}

/** Index in `maps` of the map a reference points to, or -1. Entries that reuse a listed layout resolve to it. */
export function findMap(data: EditorRom, ref: string): number {
  const entry = mapEntry(ref);
  if (entry === null) return -1;
  const direct = data.maps.findIndex((m) => m.chapter === entry);
  if (direct >= 0) return direct;
  const map = readChapterMap(data.rom, entry);
  return map ? data.maps.findIndex((m) => layoutKey(m) === layoutKey(map)) : -1;
}

/**
 * The FE8 character each player unit and boss enemy is, as the patch will have it (decisions 29 and
 * 34): its own or, for a player unit, the one the builder picks. Other units have none, since FE8
 * levels them by their class.
 */
export function unitCharacters(data: EditorRom, units: readonly ProjectUnit[]): Map<string, RomCharacter> {
  const out = new Map<string, RomCharacter>();
  let ids: Map<string, number>;
  try {
    ids = characterIds(data.rom, units);
  } catch {
    return out;
  }
  for (const u of units) {
    const c = ownsCharacter(u) ? data.characters[(ids.get(u.id) ?? 0) - 1] : undefined;
    if (c) out.set(u.id, c);
  }
  return out;
}

/** The level an FE8 character joins at in the vanilla game (Moulder 3, Gilliam 4), as a new unit's default; 1 without one. */
export function startingLevel(data: EditorRom, character: string | undefined): number {
  const id = characterIdOf(character);
  const level = id === undefined ? 1 : (data.characters[id - 1]?.baseLevel ?? 1);
  return Math.min(MAX_LEVEL, Math.max(1, level));
}

export function nextUnitId(units: ProjectUnit[], cls: string): string {
  const taken = new Set(units.map((u) => u.id));
  let n = 1;
  while (taken.has(`${cls}-${n}`)) n++;
  return `${cls}-${n}`;
}

/**
 * Converts custom stats from their first form (fixed values in `stats`) to changes from the class
 * value in `statBonus`, using this ROM's class stats. Files and autosaves from before the change open
 * as they looked.
 */
export function upgradeCustomStats(data: EditorRom, parsed: unknown): unknown {
  const p = parsed as { chapters?: { units?: Record<string, unknown>[] }[] } | null;
  for (const ch of p?.chapters ?? []) {
    for (const u of ch.units ?? []) {
      const fixed = u.stats as Record<string, unknown> | undefined;
      if (!fixed || typeof fixed !== 'object' || u.statBonus !== undefined) continue;
      const art = data.art.find((a) => a.entry.name === u.class);
      const level = typeof u.level === 'number' ? u.level : 1;
      const base = classStats(art, level);
      const bonus: Record<string, number> = {};
      for (const k of STAT_KEYS) {
        const v = fixed[k];
        if (typeof v === 'number' && v !== base[k]) bonus[k] = v - base[k];
      }
      delete u.stats;
      if (Object.keys(bonus).length) u.statBonus = bonus;
    }
  }
  return parsed;
}

/**
 * Keeps the first MAX_ITEMS items of units that carry more, from before the editor allowed four.
 * Returns what was changed, in words.
 */
export function limitItems(parsed: unknown): string[] {
  const p = parsed as { chapters?: { units?: Record<string, unknown>[] }[] } | null;
  const changed: string[] = [];
  for (const ch of p?.chapters ?? []) {
    for (const u of ch.units ?? []) {
      if (Array.isArray(u.items) && u.items.length > MAX_ITEMS) {
        changed.push(`"${String(u.id)}" carried ${u.items.length} items; kept the first ${MAX_ITEMS}, as a unit starts with at most ${MAX_ITEMS}.`);
        u.items = u.items.slice(0, MAX_ITEMS);
      }
    }
  }
  return changed;
}

/**
 * Checks a parsed project file against this ROM: the file itself, its class names, its maps and unit
 * positions. Notes say what was changed to bring an older file up to date.
 */
export function loadProject(data: EditorRom, raw: unknown): { project: Project | null; problems: Problem[]; notes: string[] } {
  const parsed = upgradeCustomStats(data, raw);
  const notes = limitItems(parsed);
  const { project, problems } = checkProject(parsed, {
    classes: new Set(data.art.map((a) => a.entry.name)),
    items: new Set(data.items.map((i) => i.entry.name)),
    characters: new Set(FE8_CHARACTER_NAMES.map((c) => c.name)),
    bosses: new Set(FE8_BOSS_NAMES.map((c) => c.name)),
  });
  if (project) {
    project.chapters.forEach((c, ci) => {
      const m = data.maps[findMap(data, c.map)];
      if (!m) problems.push({ path: `chapters[${ci}].map`, message: `The map for "${c.name}" isn't in your ROM.` });
      else
        c.units.forEach((u, ui) => {
          if (u.at[0] >= m.width || u.at[1] >= m.height) problems.push({ path: `chapters[${ci}].units[${ui}].at`, message: `"${u.id}" is outside the map.` });
        });
    });
  }
  return { project: project && !problems.length ? project : null, problems, notes };
}

export function saveFile(project: Project) {
  download(new Blob([projectToJson(project)], { type: 'application/json' }), `${toName(project.name)}.json`);
}

/** Hands a file to the browser to save. */
export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
