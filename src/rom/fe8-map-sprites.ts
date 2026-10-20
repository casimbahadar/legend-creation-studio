// FE8 US standing map sprites and team palettes from a clean ROM.
// Ported from Endless Chronicle (index.html, sprite(), teamPalette() and its idle timing).

import { createImage, drawTile4bpp, readPalettes, type Image, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

/** 8-byte entries: u16 (unused here), u16 size (0 = 16x16, 1 = 16x32, 2 = 32x32), LZ77 pointer. */
const MAP_SPRITE_TABLE = 0x8af880;
const TEAM_PALETTES = 0x59ee20;
const FRAMES = 3;

export type TeamColour = 'player' | 'enemy' | 'ally' | 'moved';

/** Palette index in the ROM for each colour, as EC uses them. */
const TEAM_PALETTE_INDEX: Record<TeamColour, number> = { player: 0, enemy: 1, ally: 2, moved: 4 };

export interface MapSprite {
  readonly width: number;
  readonly height: number;
  /** 4bpp tile data for all frames, frame after frame. */
  readonly tiles: Uint8Array;
}

export function readTeamPalettes(rom: GbaRom): Record<TeamColour, Palette> {
  const all = readPalettes(rom, TEAM_PALETTES, 5);
  const pick = (c: TeamColour) => all[TEAM_PALETTE_INDEX[c]]!;
  return { player: pick('player'), enemy: pick('enemy'), ally: pick('ally'), moved: pick('moved') };
}

export function readMapSprite(rom: GbaRom, id: number): MapSprite {
  const entry = MAP_SPRITE_TABLE + id * 8;
  const size = rom.u16(entry + 2);
  const [width, height] = size === 0 ? [16, 16] : size === 1 ? [16, 32] : [32, 32];
  const tiles = decompressLz77(rom.bytes, rom.offsetOf(rom.u32(entry + 4)));
  return { width, height, tiles };
}

/** Draws one standing frame (0 to 2). Colour 0 is transparent. */
export function renderMapSprite(sprite: MapSprite, palette: Palette, frame: number): Image {
  const image = createImage(sprite.width, sprite.height);
  const tw = sprite.width / 8;
  const tilesPerFrame = (sprite.width / 8) * (sprite.height / 8);
  const f = Math.min(Math.max(0, Math.floor(frame)), FRAMES - 1);
  for (let ty = 0; ty < sprite.height / 8; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      drawTile4bpp(image, sprite.tiles, f * tilesPerFrame + ty * tw + tx, palette, tx * 8, ty * 8, false, false, true);
    }
  }
  return image;
}

/** Standing frame at time `ms`: frames 0, 1, 2, 1 for 533, 67, 533 and 67 ms, as in EC. */
export function idleFrame(ms: number): number {
  const t = ((ms % 1200) + 1200) % 1200;
  return t < 533 ? 0 : t < 600 ? 1 : t < 1133 ? 2 : 1;
}

/** Top-left pixel to draw a sprite so it stands bottom-centred on the 16x16 cell at (x, y). */
export function spriteOrigin(sprite: Pick<MapSprite, 'width' | 'height'>, x: number, y: number): [number, number] {
  return [x * 16 - (sprite.width - 16) / 2, y * 16 - (sprite.height - 16)];
}
