// Hand-written FE8 US cast list (decision 18): the 33 playable characters, each readable name mapped
// to its character id. Ids and names are taken from the fireemblem8u decompilation
// (include/constants/characters.h and texts/texts.txt). Id 0x1B is a placeholder ("Enemy") in the
// game and is left out. checkCharacterNames compares the list against a real ROM.

import type { RomCharacter } from './fe8-characters';

export interface CharacterName {
  /** The name used in project files. */
  readonly name: string;
  readonly id: number;
  /** The name the clean ROM shows, which is also what the editor shows. */
  readonly gameName: string;
}

export const FE8_CHARACTER_NAMES: readonly CharacterName[] = [
  { name: 'eirika', id: 0x01, gameName: 'Eirika' },
  { name: 'seth', id: 0x02, gameName: 'Seth' },
  { name: 'gilliam', id: 0x03, gameName: 'Gilliam' },
  { name: 'franz', id: 0x04, gameName: 'Franz' },
  { name: 'moulder', id: 0x05, gameName: 'Moulder' },
  { name: 'vanessa', id: 0x06, gameName: 'Vanessa' },
  { name: 'ross', id: 0x07, gameName: 'Ross' },
  { name: 'neimi', id: 0x08, gameName: 'Neimi' },
  { name: 'colm', id: 0x09, gameName: 'Colm' },
  { name: 'garcia', id: 0x0a, gameName: 'Garcia' },
  { name: 'innes', id: 0x0b, gameName: 'Innes' },
  { name: 'lute', id: 0x0c, gameName: 'Lute' },
  { name: 'natasha', id: 0x0d, gameName: 'Natasha' },
  { name: 'cormag', id: 0x0e, gameName: 'Cormag' },
  { name: 'ephraim', id: 0x0f, gameName: 'Ephraim' },
  { name: 'forde', id: 0x10, gameName: 'Forde' },
  { name: 'kyle', id: 0x11, gameName: 'Kyle' },
  { name: 'amelia', id: 0x12, gameName: 'Amelia' },
  { name: 'artur', id: 0x13, gameName: 'Artur' },
  { name: 'gerik', id: 0x14, gameName: 'Gerik' },
  { name: 'tethys', id: 0x15, gameName: 'Tethys' },
  { name: 'marisa', id: 0x16, gameName: 'Marisa' },
  { name: 'saleh', id: 0x17, gameName: 'Saleh' },
  { name: 'ewan', id: 0x18, gameName: 'Ewan' },
  { name: 'larachel', id: 0x19, gameName: "L'Arachel" },
  { name: 'dozla', id: 0x1a, gameName: 'Dozla' },
  { name: 'rennac', id: 0x1c, gameName: 'Rennac' },
  { name: 'duessel', id: 0x1d, gameName: 'Duessel' },
  { name: 'myrrh', id: 0x1e, gameName: 'Myrrh' },
  { name: 'knoll', id: 0x1f, gameName: 'Knoll' },
  { name: 'joshua', id: 0x20, gameName: 'Joshua' },
  { name: 'syrene', id: 0x21, gameName: 'Syrene' },
  { name: 'tana', id: 0x22, gameName: 'Tana' },
];

export interface BossName extends CharacterName {
  /** What the editor shows, telling apart bosses that share a name. */
  readonly label: string;
}

/**
 * FE8 US bosses with their own portraits, which named enemies take over (decision 34). Ids and names
 * from the fireemblem8u decompilation; some bosses appear twice, as different records.
 */
export const FE8_BOSS_NAMES: readonly BossName[] = [
  { name: 'oneill', id: 0x68, gameName: "O'Neill", label: "O'Neill" },
  { name: 'breguet', id: 0x46, gameName: 'Breguet', label: 'Breguet' },
  { name: 'bone', id: 0x47, gameName: 'Bone', label: 'Bone' },
  { name: 'bazba', id: 0x48, gameName: 'Bazba', label: 'Bazba' },
  { name: 'saar', id: 0x4a, gameName: 'Saar', label: 'Saar' },
  { name: 'novala', id: 0x4b, gameName: 'Novala', label: 'Novala' },
  { name: 'murray', id: 0x4c, gameName: 'Murray', label: 'Murray' },
  { name: 'tirado', id: 0x4d, gameName: 'Tirado', label: 'Tirado' },
  { name: 'binks', id: 0x4e, gameName: 'Binks', label: 'Binks' },
  { name: 'pablo', id: 0x4f, gameName: 'Pablo', label: 'Pablo' },
  { name: 'pablo-2', id: 0x54, gameName: 'Pablo', label: 'Pablo (second)' },
  { name: 'aias', id: 0x51, gameName: 'Aias', label: 'Aias' },
  { name: 'carlyle', id: 0x52, gameName: 'Carlyle', label: 'Carlyle' },
  { name: 'caellach', id: 0x53, gameName: 'Caellach', label: 'Caellach' },
  { name: 'riev', id: 0x57, gameName: 'Riev', label: 'Riev' },
  { name: 'gheb', id: 0x5a, gameName: 'Gheb', label: 'Gheb' },
  { name: 'beran', id: 0x5b, gameName: 'Beran', label: 'Beran' },
  { name: 'glen', id: 0x69, gameName: 'Glen', label: 'Glen' },
  { name: 'zonta', id: 0x6a, gameName: 'Zonta', label: 'Zonta' },
  { name: 'vigarde', id: 0x6b, gameName: 'Vigarde', label: 'Vigarde' },
  { name: 'selena', id: 0x44, gameName: 'Selena', label: 'Selena' },
  { name: 'valter', id: 0x43, gameName: 'Valter', label: 'Valter' },
  { name: 'valter-prologue', id: 0x45, gameName: 'Valter', label: 'Valter (Prologue)' },
  { name: 'orson', id: 0x6d, gameName: 'Orson', label: 'Orson' },
  { name: 'orson-5x', id: 0x42, gameName: 'Orson', label: 'Orson (chapter 5x)' },
  { name: 'lyon', id: 0x40, gameName: 'Lyon', label: 'Lyon' },
  { name: 'lyon-final', id: 0x6c, gameName: 'Lyon', label: 'Lyon (final)' },
];

/** The cast and the bosses together, for checks against the ROM and looking up ids by name. */
export const ALL_CHARACTER_NAMES: readonly CharacterName[] = [...FE8_CHARACTER_NAMES, ...FE8_BOSS_NAMES];

/** The FE8 character id for a name from either list, or undefined. */
export function characterIdOf(name: string | undefined): number | undefined {
  return ALL_CHARACTER_NAMES.find((c) => c.name === name)?.id;
}

/** Generic characters for units without one of the cast: the "Soldier" vanilla's Prologue enemies use, and a "Frelian". */
export const GENERIC_ENEMY = 0x80;
export const GENERIC_ALLY = 0xc0;

export interface CharacterMismatch {
  readonly entry: CharacterName;
  /** What the ROM shows for this id, or null if the ROM has no character with it. */
  readonly romName: string | null;
}

/** Entries whose expected game name differs from what the ROM shows. */
export function checkCharacterNames(
  romCharacters: readonly Pick<RomCharacter, 'id' | 'name'>[],
  list: readonly CharacterName[] = FE8_CHARACTER_NAMES,
): CharacterMismatch[] {
  const byId = new Map(romCharacters.map((c) => [c.id, c.name]));
  return list.filter((e) => byId.get(e.id) !== e.gameName).map((entry) => ({ entry, romName: byId.get(entry.id) ?? null }));
}

/**
 * A character for a player unit that has none (decision 28): Eirika or Ephraim for their Lord and
 * Great Lord classes, otherwise the first cast member not yet taken whose own class in the ROM is
 * the unit's class, otherwise the first one not taken. Null when the whole cast is taken.
 */
export function pickCharacter(cls: string, classId: number, taken: ReadonlySet<string>, defaultClassOf: (id: number) => number | undefined): string | null {
  const lord = /^(?:great-)?lord-(eirika|ephraim)$/.exec(cls)?.[1];
  if (lord && !taken.has(lord)) return lord;
  const free = FE8_CHARACTER_NAMES.filter((c) => !taken.has(c.name) && c.name !== 'eirika' && c.name !== 'ephraim');
  return (free.find((c) => defaultClassOf(c.id) === classId) ?? free[0])?.name ?? null;
}
