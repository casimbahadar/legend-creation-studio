// Hand-written FE8 US item names (decision 18): each readable name maps to its item id.
// A draft written from memory: Endless Chronicle has no FE8 item ids to confirm it against.
// gameName is the name the clean ROM is expected to show, so checkItemNames can compare the list
// with a real ROM; the editor shows any mismatches. Kept to what early chapters need: the common
// weapons of each type, the standard staves, and Vulnerary and Elixir.

import type { RomItem } from './fe8-items';

export interface ItemName {
  /** The name used in project files. */
  readonly name: string;
  readonly id: number;
  /** The item name the clean ROM shows, also used as the editor label. */
  readonly gameName: string;
}

export const FE8_ITEM_NAMES: readonly ItemName[] = [
  { name: 'iron-sword', id: 0x01, gameName: 'Iron Sword' },
  { name: 'slim-sword', id: 0x02, gameName: 'Slim Sword' },
  { name: 'steel-sword', id: 0x03, gameName: 'Steel Sword' },
  { name: 'silver-sword', id: 0x04, gameName: 'Silver Sword' },
  { name: 'iron-blade', id: 0x05, gameName: 'Iron Blade' },
  { name: 'steel-blade', id: 0x06, gameName: 'Steel Blade' },
  { name: 'silver-blade', id: 0x07, gameName: 'Silver Blade' },
  { name: 'poison-sword', id: 0x08, gameName: 'Poison Sword' },
  { name: 'rapier', id: 0x09, gameName: 'Rapier' },
  { name: 'brave-sword', id: 0x0b, gameName: 'Brave Sword' },
  { name: 'shamshir', id: 0x0c, gameName: 'Shamshir' },
  { name: 'killing-edge', id: 0x0d, gameName: 'Killing Edge' },
  { name: 'armorslayer', id: 0x0e, gameName: 'Armorslayer' },
  { name: 'wyrmslayer', id: 0x0f, gameName: 'Wyrmslayer' },
  { name: 'light-brand', id: 0x10, gameName: 'Light Brand' },
  { name: 'runesword', id: 0x11, gameName: 'Runesword' },
  { name: 'lancereaver', id: 0x12, gameName: 'Lancereaver' },
  { name: 'zanbato', id: 0x13, gameName: 'Zanbato' },
  { name: 'iron-lance', id: 0x14, gameName: 'Iron Lance' },
  { name: 'slim-lance', id: 0x15, gameName: 'Slim Lance' },
  { name: 'steel-lance', id: 0x16, gameName: 'Steel Lance' },
  { name: 'silver-lance', id: 0x17, gameName: 'Silver Lance' },
  { name: 'toxin-lance', id: 0x18, gameName: 'Toxin Lance' },
  { name: 'brave-lance', id: 0x19, gameName: 'Brave Lance' },
  { name: 'killer-lance', id: 0x1a, gameName: 'Killer Lance' },
  { name: 'horseslayer', id: 0x1b, gameName: 'Horseslayer' },
  { name: 'javelin', id: 0x1c, gameName: 'Javelin' },
  { name: 'spear', id: 0x1d, gameName: 'Spear' },
  { name: 'axereaver', id: 0x1e, gameName: 'Axereaver' },
  { name: 'iron-axe', id: 0x1f, gameName: 'Iron Axe' },
  { name: 'steel-axe', id: 0x20, gameName: 'Steel Axe' },
  { name: 'silver-axe', id: 0x21, gameName: 'Silver Axe' },
  { name: 'poison-axe', id: 0x22, gameName: 'Poison Axe' },
  { name: 'brave-axe', id: 0x23, gameName: 'Brave Axe' },
  { name: 'killer-axe', id: 0x24, gameName: 'Killer Axe' },
  { name: 'halberd', id: 0x25, gameName: 'Halberd' },
  { name: 'hammer', id: 0x26, gameName: 'Hammer' },
  { name: 'devil-axe', id: 0x27, gameName: 'Devil Axe' },
  { name: 'hand-axe', id: 0x28, gameName: 'Hand Axe' },
  { name: 'tomahawk', id: 0x29, gameName: 'Tomahawk' },
  { name: 'swordreaver', id: 0x2a, gameName: 'Swordreaver' },
  { name: 'swordslayer', id: 0x2b, gameName: 'Swordslayer' },
  { name: 'hatchet', id: 0x2c, gameName: 'Hatchet' },
  { name: 'iron-bow', id: 0x2d, gameName: 'Iron Bow' },
  { name: 'steel-bow', id: 0x2e, gameName: 'Steel Bow' },
  { name: 'silver-bow', id: 0x2f, gameName: 'Silver Bow' },
  { name: 'poison-bow', id: 0x30, gameName: 'Poison Bow' },
  { name: 'killer-bow', id: 0x31, gameName: 'Killer Bow' },
  { name: 'brave-bow', id: 0x32, gameName: 'Brave Bow' },
  { name: 'short-bow', id: 0x33, gameName: 'Short Bow' },
  { name: 'longbow', id: 0x34, gameName: 'Longbow' },
  { name: 'fire', id: 0x38, gameName: 'Fire' },
  { name: 'thunder', id: 0x39, gameName: 'Thunder' },
  { name: 'elfire', id: 0x3a, gameName: 'Elfire' },
  { name: 'bolting', id: 0x3b, gameName: 'Bolting' },
  { name: 'fimbulvetr', id: 0x3c, gameName: 'Fimbulvetr' },
  { name: 'lightning', id: 0x3f, gameName: 'Lightning' },
  { name: 'shine', id: 0x40, gameName: 'Shine' },
  { name: 'divine', id: 0x41, gameName: 'Divine' },
  { name: 'purge', id: 0x42, gameName: 'Purge' },
  { name: 'flux', id: 0x45, gameName: 'Flux' },
  { name: 'luna', id: 0x46, gameName: 'Luna' },
  { name: 'nosferatu', id: 0x47, gameName: 'Nosferatu' },
  { name: 'eclipse', id: 0x48, gameName: 'Eclipse' },
  { name: 'fenrir', id: 0x49, gameName: 'Fenrir' },
  { name: 'heal', id: 0x4b, gameName: 'Heal' },
  { name: 'mend', id: 0x4c, gameName: 'Mend' },
  { name: 'recover', id: 0x4d, gameName: 'Recover' },
  { name: 'physic', id: 0x4e, gameName: 'Physic' },
  { name: 'fortify', id: 0x4f, gameName: 'Fortify' },
  { name: 'restore', id: 0x50, gameName: 'Restore' },
  { name: 'silence', id: 0x51, gameName: 'Silence' },
  { name: 'sleep', id: 0x52, gameName: 'Sleep' },
  { name: 'berserk', id: 0x53, gameName: 'Berserk' },
  { name: 'warp', id: 0x54, gameName: 'Warp' },
  { name: 'rescue', id: 0x55, gameName: 'Rescue' },
  { name: 'unlock', id: 0x58, gameName: 'Unlock' },
  { name: 'barrier', id: 0x59, gameName: 'Barrier' },
  { name: 'vulnerary', id: 0x6c, gameName: 'Vulnerary' },
  { name: 'elixir', id: 0x6d, gameName: 'Elixir' },
];

export interface ItemMismatch {
  readonly entry: ItemName;
  /** What the ROM shows for this id, or null if the ROM has no item with it. */
  readonly romName: string | null;
}

/** Entries whose expected game name differs from what the ROM shows. */
export function checkItemNames(romItems: readonly Pick<RomItem, 'id' | 'name'>[], list: readonly ItemName[] = FE8_ITEM_NAMES): ItemMismatch[] {
  const byId = new Map(romItems.map((i) => [i.id, i.name]));
  return list.filter((e) => byId.get(e.id) !== e.gameName).map((entry) => ({ entry, romName: byId.get(entry.id) ?? null }));
}
