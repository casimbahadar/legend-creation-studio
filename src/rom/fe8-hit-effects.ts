// FE8 US's "MISS" and "NO DAMAGE" over a unit in a map battle (decision 35), from the fireemblem8u
// decompilation (src/mapanim_specialeffect.c, src/mapanim_spellassoc.c MapAnim_BeginRoundSpecificAnims,
// data/data_9A31F8.s, src/bm.c): when a blow misses, or hits for no damage, its tiles (Img_MapAnimMISS,
// Img_MapAnimNODAMAGE, LZ77) are loaded at sprite tile 384 and its AP (Obj_MapAnimMISS,
// obj_MapAnimNODAMAGE) plays animation 0 from the middle of the bottom of the target's square, in
// sprite palette 0 (gPal_MiscUiGraphics' first). A blow that does damage shows nothing there; the HP
// boxes show it.

import { readApAnimation } from './fe8-ap';
import { FE8U_MISC_UI_PALETTE } from './fe8-cursor';
import { readPalettes, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

export const FE8U_MISS_TILES = 0x9ac0a4;
export const FE8U_MISS_AP = 0x9ac194;
export const FE8U_NO_DAMAGE_TILES = 0x9ac2fc;
export const FE8U_NO_DAMAGE_AP = 0x9ac440;
/** Where the tiles are loaded (BM_OBJCHR_BANIM_EFFECT), in sprite palette 0. */
export const HIT_EFFECT_TILE = 384;

export interface HitEffects {
  readonly rom: GbaRom;
  readonly miss: Uint8Array;
  readonly noDamage: Uint8Array;
  readonly palette: Palette;
}

/** The two effects, or null if either isn't readable. */
export function readHitEffects(rom: GbaRom): HitEffects | null {
  let miss: Uint8Array;
  let noDamage: Uint8Array;
  try {
    miss = decompressLz77(rom.bytes, FE8U_MISS_TILES);
    noDamage = decompressLz77(rom.bytes, FE8U_NO_DAMAGE_TILES);
  } catch {
    return null;
  }
  const plays = (at: number) => (readApAnimation(rom, at, 0)?.steps.length ?? 0) > 0;
  if (!miss.length || !noDamage.length || !plays(FE8U_MISS_AP) || !plays(FE8U_NO_DAMAGE_AP)) return null;
  const [palette] = readPalettes(rom, FE8U_MISC_UI_PALETTE, 1);
  return palette ? { rom, miss, noDamage, palette } : null;
}

/** Which effect a blow shows, if any: a miss, or a hit that does no damage. */
export function hitEffect(blow: { readonly hit: boolean; readonly damage: number }): 'miss' | 'noDamage' | null {
  if (!blow.hit) return 'miss';
  return blow.damage === 0 ? 'noDamage' : null;
}
