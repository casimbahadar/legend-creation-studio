// The game's classes and items as play needs them: read once from the player's ROM, joined with the
// hand-written name lists (decision 18), with map sprites drawn for each team. Plus the rules that
// connect them: which weapons a class can use, starting weapons, stats at a level.

import type { Stats, Weapon } from '../core/combat';
import type { PlayUnit } from '../core/play';
import { readClasses, type ClassStats } from '../rom/fe8-classes';
import { checkItemNames, FE8_ITEM_NAMES, type ItemMismatch, type ItemName } from '../rom/fe8-item-names';
import { findItemTable, isStaff, isWeapon, readItems, WEAPON_TYPES, type RomItem } from '../rom/fe8-items';
import { readMapSprite, readTeamPalettes, renderMapSprite, type TeamColour } from '../rom/fe8-map-sprites';
import { checkClassNames, FE8_CLASS_NAMES, type ClassName, type NameMismatch } from '../rom/fe8-names';
import type { Image } from '../rom/gba-graphics';
import type { GbaRom } from '../rom/gba-rom';
import type { TextTable } from '../rom/text';
import { statsAtLevel } from '../core/combat';

/** A listed class with its standing frames in each team's colours, plus grey for units that have moved. */
export interface ClassArt {
  readonly entry: ClassName;
  readonly frames: Record<TeamColour, HTMLCanvasElement[]>;
  /** Base movement and move cost per terrain id from the ROM. */
  readonly mov: number;
  readonly moveCosts: Uint8Array | null;
  /** Starting rank per weapon type (sword, lance, axe, bow, staff, anima, light, dark); 0 = can't use. */
  readonly weaponRanks: Uint8Array;
  readonly base: ClassStats;
  readonly growths: ClassStats;
  readonly terrainAvoid: Uint8Array | null;
  readonly terrainDef: Uint8Array | null;
  readonly terrainRes: Uint8Array | null;
  readonly width: number;
  readonly height: number;
}

/** A listed item with its stats from the ROM. */
export interface GameItem {
  readonly entry: ItemName;
  readonly rom: RomItem;
}

export interface Catalog {
  readonly art: ClassArt[];
  readonly items: GameItem[];
  readonly classMismatches: NameMismatch[];
  readonly itemMismatches: ItemMismatch[];
}

/** An RGBA image as a canvas, ready to draw. */
export function toCanvas(image: Image): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  c.getContext('2d')?.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  return c;
}

/** The ROM's listed classes (with their map sprites) and items, and how the name lists compare with it. */
export function readCatalog(rom: GbaRom, text: TextTable): Catalog {
  const romClasses = readClasses(rom, text);
  const byId = new Map(romClasses.map((c) => [c.id, c]));
  const palettes = readTeamPalettes(rom);
  const art: ClassArt[] = [];
  for (const entry of FE8_CLASS_NAMES) {
    const c = byId.get(entry.id);
    if (!c) continue;
    try {
      const sprite = readMapSprite(rom, c.mapSprite);
      const framesFor = (colour: TeamColour) => [0, 1, 2].map((f) => toCanvas(renderMapSprite(sprite, palettes[colour], f)));
      art.push({
        entry,
        width: sprite.width,
        height: sprite.height,
        frames: { player: framesFor('player'), enemy: framesFor('enemy'), ally: framesFor('ally'), moved: framesFor('moved') },
        mov: c.mov,
        moveCosts: c.moveCosts,
        weaponRanks: c.weaponRanks,
        base: c.base,
        growths: c.growths,
        terrainAvoid: c.terrainAvoid,
        terrainDef: c.terrainDef,
        terrainRes: c.terrainRes,
      });
    } catch {
      // class without a usable map sprite
    }
  }
  const table = findItemTable(rom);
  const romItems = table === null ? [] : readItems(rom, text, table);
  const romItemById = new Map(romItems.map((i) => [i.id, i]));
  const items: GameItem[] = [];
  for (const entry of FE8_ITEM_NAMES) {
    const it = romItemById.get(entry.id);
    if (it) items.push({ entry, rom: it });
  }
  return { art, items, classMismatches: checkClassNames(romClasses), itemMismatches: checkItemNames(romItems) };
}

/** Can this class use this item? Weapons and staves need a rank in their type; other items anyone can carry. */
export function usable(art: ClassArt, item: GameItem): boolean {
  if (!isWeapon(item.rom) && !isStaff(item.rom)) return true;
  return item.rom.type < WEAPON_TYPES.length && (art.weaponRanks[item.rom.type] ?? 0) > 0;
}

/** Starting weapon for a newly placed unit: an iron-tier weapon of the first type its class can use. */
export const DEFAULT_WEAPONS = ['iron-sword', 'iron-lance', 'iron-axe', 'iron-bow', 'fire', 'lightning', 'flux', 'heal'];
export function defaultItems(art: ClassArt, items: GameItem[]): string[] {
  for (const name of DEFAULT_WEAPONS) {
    const item = items.find((i) => i.entry.name === name);
    if (item && (isWeapon(item.rom) || isStaff(item.rom)) && usable(art, item)) return [name];
  }
  return [];
}

/** Weapon ranges [min, max] a unit can attack with: weapons it carries and its class can use, not staves. */
export function weaponRanges(art: ClassArt | undefined, itemNames: readonly string[], items: GameItem[]): [number, number][] {
  if (!art) return [];
  return itemNames
    .map((n) => items.find((i) => i.entry.name === n))
    .filter((i): i is GameItem => !!i && isWeapon(i.rom) && !isStaff(i.rom) && usable(art, i))
    .map((i) => [i.rom.minRange, i.rom.maxRange]);
}

/** Weapons a unit can fight with, in inventory order: weapons it carries that its class can use, not staves. */
export function weaponsOf(art: ClassArt | undefined, itemNames: readonly string[], items: GameItem[]): GameItem[] {
  if (!art) return [];
  return itemNames
    .map((n) => items.find((i) => i.entry.name === n))
    .filter((i): i is GameItem => !!i && isWeapon(i.rom) && !isStaff(i.rom) && usable(art, i));
}

export function toWeapon(item: GameItem): Weapon {
  const r = item.rom;
  const kind = r.type < WEAPON_TYPES.length ? WEAPON_TYPES[r.type]! : 'other';
  return {
    name: item.entry.gameName,
    kind,
    // Anima, light and dark target Res, as do weapons the ROM marks as magic.
    magic: kind === 'anima' || kind === 'light' || kind === 'dark' || (r.attributes & 2) !== 0,
    might: r.might,
    hit: r.hit,
    crit: r.crit,
    weight: r.weight,
    minRange: r.minRange,
    maxRange: r.maxRange,
  };
}

export const distance = (a: PlayUnit, b: PlayUnit) => Math.abs(a.at[0] - b.at[0]) + Math.abs(a.at[1] - b.at[1]);
export const inReach = (w: GameItem, d: number) => d >= w.rom.minRange && d <= w.rom.maxRange;

/** Stats for a class at a level, or a 1 HP stand-in if the class isn't known. */
export function classStats(art: ClassArt | undefined, level: number): Stats {
  return art ? statsAtLevel(art.base, art.growths, level) : { hp: 1, str: 0, skl: 0, spd: 0, def: 0, res: 0, lck: 0, con: 0 };
}

/** One-line stats for an item, e.g. "Mt 5 · Hit 90 · Rng 1 · 46 uses". */
export function itemStats(i: RomItem): string {
  const rng = i.minRange === i.maxRange ? `${i.minRange}` : `${i.minRange}-${i.maxRange}`;
  if (isWeapon(i) && !isStaff(i)) return `Mt ${i.might} · Hit ${i.hit} · Rng ${rng} · ${i.uses} uses`;
  return `${i.uses} uses`;
}
