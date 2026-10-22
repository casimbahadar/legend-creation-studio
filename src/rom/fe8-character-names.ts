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
