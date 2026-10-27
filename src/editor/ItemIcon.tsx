// An item's icon from the player's ROM (fe8-item-icons.ts), drawn before its name in menus and notices
// as FE8's DrawItemMenuLine does; nothing if the ROM's icons aren't found.

import { useMemo } from 'react';
import type { GameItem } from '../play/catalog';
import { readItemIcon } from '../rom/fe8-item-icons';
import type { GbaRom } from '../rom/gba-rom';
import { gbaPx, imageUrl } from './FeWindow';

const icons = new WeakMap<GbaRom, Map<number, string | null>>();

/** Icon `icon`'s image URL, read once per ROM; null if it isn't readable. */
function iconUrl(rom: GbaRom, icon: number): string | null {
  let byIcon = icons.get(rom);
  if (!byIcon) icons.set(rom, (byIcon = new Map()));
  if (!byIcon.has(icon)) {
    const image = readItemIcon(rom, icon);
    byIcon.set(icon, image ? imageUrl(image) : null);
  }
  return byIcon.get(icon) ?? null;
}

export function ItemIcon({ rom, item }: { rom: GbaRom; item: GameItem | undefined }) {
  const url = useMemo(() => (item ? iconUrl(rom, item.rom.icon) : null), [rom, item]);
  return url ? <img className="item-icon" src={url} alt="" style={{ width: gbaPx(16), height: gbaPx(16) }} /> : null;
}
