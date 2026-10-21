// Hand-written FE8 US class names (decision 18): each readable name maps to its class id.
// Written from memory, and partly confirmed by Endless Chronicle's own table (marked "also in EC").
// EC confirms the id belongs to that class, not which of a pair is male or female, or which Lord is whose.
// gameName is the name the clean ROM is expected to show, so checkClassNames can compare the list
// against a real ROM. Pairs that share a game name (male and female, bow variants) can't be told
// apart that way and need a look at their map sprites. Trainee, monster-egg and story-only classes
// are left out until they are confirmed.

import type { RomClass } from './fe8-classes';

export interface ClassName {
  /** The name used in project files. */
  readonly name: string;
  readonly id: number;
  /** The class name the clean ROM shows. */
  readonly gameName: string;
  /** What the editor shows. */
  readonly label: string;
}

export const FE8_CLASS_NAMES: readonly ClassName[] = [
  { name: 'lord-ephraim', id: 0x01, gameName: 'Lord', label: 'Lord (Ephraim)' }, // also in EC
  { name: 'lord-eirika', id: 0x02, gameName: 'Lord', label: 'Lord (Eirika)' }, // also in EC
  { name: 'great-lord-ephraim', id: 0x03, gameName: 'Great Lord', label: 'Great Lord (Ephraim)' },
  { name: 'great-lord-eirika', id: 0x04, gameName: 'Great Lord', label: 'Great Lord (Eirika)' },
  { name: 'cavalier-m', id: 0x05, gameName: 'Cavalier', label: 'Cavalier (male)' }, // also in EC
  { name: 'cavalier-f', id: 0x06, gameName: 'Cavalier', label: 'Cavalier (female)' }, // also in EC
  { name: 'paladin-m', id: 0x07, gameName: 'Paladin', label: 'Paladin (male)' },
  { name: 'paladin-f', id: 0x08, gameName: 'Paladin', label: 'Paladin (female)' },
  { name: 'knight-m', id: 0x09, gameName: 'Knight', label: 'Knight (male)' }, // also in EC
  { name: 'knight-f', id: 0x0a, gameName: 'Knight', label: 'Knight (female)' }, // also in EC
  { name: 'general-m', id: 0x0b, gameName: 'General', label: 'General (male)' },
  { name: 'general-f', id: 0x0c, gameName: 'General', label: 'General (female)' },
  { name: 'thief', id: 0x0d, gameName: 'Thief', label: 'Thief' },
  { name: 'mercenary-m', id: 0x0f, gameName: 'Mercenary', label: 'Mercenary (male)' }, // also in EC
  { name: 'mercenary-f', id: 0x10, gameName: 'Mercenary', label: 'Mercenary (female)' }, // also in EC
  { name: 'hero-m', id: 0x11, gameName: 'Hero', label: 'Hero (male)' },
  { name: 'hero-f', id: 0x12, gameName: 'Hero', label: 'Hero (female)' },
  { name: 'myrmidon-m', id: 0x13, gameName: 'Myrmidon', label: 'Myrmidon (male)' }, // also in EC
  { name: 'myrmidon-f', id: 0x14, gameName: 'Myrmidon', label: 'Myrmidon (female)' }, // also in EC
  { name: 'swordmaster-m', id: 0x15, gameName: 'Swordmaster', label: 'Swordmaster (male)' },
  { name: 'swordmaster-f', id: 0x16, gameName: 'Swordmaster', label: 'Swordmaster (female)' },
  { name: 'assassin-m', id: 0x17, gameName: 'Assassin', label: 'Assassin (male)' },
  { name: 'assassin-f', id: 0x18, gameName: 'Assassin', label: 'Assassin (female)' },
  { name: 'archer-m', id: 0x19, gameName: 'Archer', label: 'Archer (male)' }, // also in EC
  { name: 'archer-f', id: 0x1a, gameName: 'Archer', label: 'Archer (female)' }, // also in EC
  { name: 'sniper-m', id: 0x1b, gameName: 'Sniper', label: 'Sniper (male)' },
  { name: 'sniper-f', id: 0x1c, gameName: 'Sniper', label: 'Sniper (female)' },
  { name: 'ranger-m', id: 0x1d, gameName: 'Ranger', label: 'Ranger (male)' },
  { name: 'ranger-f', id: 0x1e, gameName: 'Ranger', label: 'Ranger (female)' },
  { name: 'wyvern-rider-m', id: 0x1f, gameName: 'Wyvern Rider', label: 'Wyvern Rider (male)' },
  { name: 'wyvern-rider-f', id: 0x20, gameName: 'Wyvern Rider', label: 'Wyvern Rider (female)' },
  { name: 'wyvern-lord-m', id: 0x21, gameName: 'Wyvern Lord', label: 'Wyvern Lord (male)' },
  { name: 'wyvern-lord-f', id: 0x22, gameName: 'Wyvern Lord', label: 'Wyvern Lord (female)' },
  { name: 'wyvern-knight-m', id: 0x23, gameName: 'Wyvern Kn.', label: 'Wyvern Knight (male)' },
  { name: 'wyvern-knight-f', id: 0x24, gameName: 'Wyvern Kn.', label: 'Wyvern Knight (female)' },
  { name: 'mage-m', id: 0x25, gameName: 'Mage', label: 'Mage (male)' }, // also in EC
  { name: 'mage-f', id: 0x26, gameName: 'Mage', label: 'Mage (female)' }, // also in EC
  { name: 'sage-m', id: 0x27, gameName: 'Sage', label: 'Sage (male)' },
  { name: 'sage-f', id: 0x28, gameName: 'Sage', label: 'Sage (female)' },
  { name: 'mage-knight-m', id: 0x29, gameName: 'Mage Knight', label: 'Mage Knight (male)' },
  { name: 'mage-knight-f', id: 0x2a, gameName: 'Mage Knight', label: 'Mage Knight (female)' },
  { name: 'bishop-m', id: 0x2b, gameName: 'Bishop', label: 'Bishop (male)' },
  { name: 'bishop-f', id: 0x2c, gameName: 'Bishop', label: 'Bishop (female)' },
  { name: 'shaman-m', id: 0x2d, gameName: 'Shaman', label: 'Shaman (male)' },
  { name: 'shaman-f', id: 0x2e, gameName: 'Shaman', label: 'Shaman (female)' },
  { name: 'druid-m', id: 0x2f, gameName: 'Druid', label: 'Druid (male)' },
  { name: 'druid-f', id: 0x30, gameName: 'Druid', label: 'Druid (female)' },
  { name: 'summoner-m', id: 0x31, gameName: 'Summoner', label: 'Summoner (male)' },
  { name: 'summoner-f', id: 0x32, gameName: 'Summoner', label: 'Summoner (female)' },
  { name: 'rogue', id: 0x33, gameName: 'Rogue', label: 'Rogue' },
  { name: 'great-knight-m', id: 0x35, gameName: 'Great Knight', label: 'Great Knight (male)' },
  { name: 'great-knight-f', id: 0x36, gameName: 'Great Knight', label: 'Great Knight (female)' },
  { name: 'fighter', id: 0x3f, gameName: 'Fighter', label: 'Fighter' }, // also in EC
  { name: 'warrior', id: 0x40, gameName: 'Warrior', label: 'Warrior' },
  { name: 'brigand', id: 0x41, gameName: 'Brigand', label: 'Brigand' }, // also in EC
  { name: 'pirate', id: 0x42, gameName: 'Pirate', label: 'Pirate' },
  { name: 'berserker', id: 0x43, gameName: 'Berserker', label: 'Berserker' },
  { name: 'monk', id: 0x44, gameName: 'Monk', label: 'Monk' },
  { name: 'priest', id: 0x45, gameName: 'Priest', label: 'Priest' }, // also in EC
  { name: 'bard', id: 0x46, gameName: 'Bard', label: 'Bard' },
  { name: 'pegasus-knight', id: 0x48, gameName: 'Pegasus Kn.', label: 'Pegasus Knight' }, // also in EC
  { name: 'falcoknight', id: 0x49, gameName: 'Falcoknight', label: 'Falcoknight' },
  { name: 'cleric', id: 0x4a, gameName: 'Cleric', label: 'Cleric' }, // also in EC
  { name: 'troubadour', id: 0x4b, gameName: 'Troubadour', label: 'Troubadour' },
  { name: 'valkyrie', id: 0x4c, gameName: 'Valkyrie', label: 'Valkyrie' },
  { name: 'dancer', id: 0x4d, gameName: 'Dancer', label: 'Dancer' },
  { name: 'soldier', id: 0x4e, gameName: 'Soldier', label: 'Soldier' }, // also in EC
  { name: 'necromancer', id: 0x4f, gameName: 'Necromancer', label: 'Necromancer' },
  { name: 'phantom', id: 0x51, gameName: 'Phantom', label: 'Phantom' },
  { name: 'revenant', id: 0x52, gameName: 'Revenant', label: 'Revenant' },
  { name: 'entombed', id: 0x53, gameName: 'Entombed', label: 'Entombed' },
  { name: 'bonewalker', id: 0x54, gameName: 'Bonewalker', label: 'Bonewalker' },
  { name: 'bonewalker-bow', id: 0x55, gameName: 'Bonewalker', label: 'Bonewalker (bow)' },
  { name: 'wight', id: 0x56, gameName: 'Wight', label: 'Wight' },
  { name: 'wight-bow', id: 0x57, gameName: 'Wight', label: 'Wight (bow)' },
  { name: 'bael', id: 0x58, gameName: 'Bael', label: 'Bael' },
  { name: 'elder-bael', id: 0x59, gameName: 'Elder Bael', label: 'Elder Bael' },
  { name: 'cyclops', id: 0x5a, gameName: 'Cyclops', label: 'Cyclops' },
  { name: 'mauthe-doog', id: 0x5b, gameName: 'Mauthe Doog', label: 'Mauthe Doog' },
  { name: 'gwyllgi', id: 0x5c, gameName: 'Gwyllgi', label: 'Gwyllgi' },
  { name: 'tarvos', id: 0x5d, gameName: 'Tarvos', label: 'Tarvos' },
  { name: 'maelduin', id: 0x5e, gameName: 'Maelduin', label: 'Maelduin' },
  { name: 'mogall', id: 0x5f, gameName: 'Mogall', label: 'Mogall' },
  { name: 'arch-mogall', id: 0x60, gameName: 'Arch Mogall', label: 'Arch Mogall' },
  { name: 'gorgon', id: 0x61, gameName: 'Gorgon', label: 'Gorgon' },
  { name: 'gargoyle', id: 0x63, gameName: 'Gargoyle', label: 'Gargoyle' },
  { name: 'deathgoyle', id: 0x64, gameName: 'Deathgoyle', label: 'Deathgoyle' },
  { name: 'draco-zombie', id: 0x65, gameName: 'Draco Zombie', label: 'Draco Zombie' },
];

export interface NameMismatch {
  readonly entry: ClassName;
  /** What the ROM shows for this id, or null if the ROM has no class with it. */
  readonly romName: string | null;
}

/** Entries whose expected game name differs from what the ROM shows. */
export function checkClassNames(romClasses: readonly Pick<RomClass, 'id' | 'name'>[], list: readonly ClassName[] = FE8_CLASS_NAMES): NameMismatch[] {
  const byId = new Map(romClasses.map((c) => [c.id, c.name]));
  return list.filter((e) => byId.get(e.id) !== e.gameName).map((entry) => ({ entry, romName: byId.get(entry.id) ?? null }));
}
