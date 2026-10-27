// FE8 US's item icons (decision 35), from the fireemblem8u decompilation (src/icon.c, data/data_item_icon.s):
// item_icon_tiles, 224 icons of 16 x 16 pixels stored as four 4bpp tiles each (top left, top right,
// bottom left, bottom right, as DrawIcon lays them), uncompressed, then item_icon_palette, two
// palettes of which item menus use the first (LoadIconPalettes, DrawItemMenuLine). The address follows
// from the decompilation's layout: the 224 icons and two palettes end where gUnknown_08599734 begins.

import { createImage, drawTile4bpp, readPalettes, type Image } from './gba-graphics';
import type { GbaRom } from './gba-rom';

export const FE8U_ITEM_ICONS = 0x5926f4;
export const FE8U_ITEM_ICON_PALETTE = 0x5996f4;
export const ITEM_ICON_COUNT = 224;
const ICON_BYTES = 0x80;

/** Icon `icon` (an item's iconId) as a 16 x 16 image, colour 0 transparent; null if it isn't in the ROM. */
export function readItemIcon(rom: GbaRom, icon: number): Image | null {
  if (icon < 0 || icon >= ITEM_ICON_COUNT || FE8U_ITEM_ICON_PALETTE + 0x20 > rom.size) return null;
  const [palette] = readPalettes(rom, FE8U_ITEM_ICON_PALETTE, 1);
  if (!palette) return null;
  const tiles = rom.bytes.subarray(FE8U_ITEM_ICONS + icon * ICON_BYTES, FE8U_ITEM_ICONS + (icon + 1) * ICON_BYTES);
  const image = createImage(16, 16);
  for (let t = 0; t < 4; t++) drawTile4bpp(image, tiles, t, palette, (t & 1) * 8, (t >> 1) * 8, false, false, true);
  return image;
}
