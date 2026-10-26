// FE8's "AP" sprite animations (decision 35), read and drawn as the fireemblem8u decompilation's
// src/ap.c runs them. A definition starts with two byte offsets (to its frame table and its animation
// table); each table holds byte offsets from its own start. A frame is a count of sprite pieces (with
// bit 15 set, first that many scale/rotate entries of 3 halfwords: angle, x scale, y scale in 1/256s),
// then each piece's OAM attributes, positions relative to where the animation is put. An animation is
// a list of (frames to show, frame index) pairs ended by (0, end): 0xFFFF loops, 1 removes it, 0 stops
// on the last frame. Pieces' tiles are counted in the game's 2D sprite memory, 32 tiles to a row.

import { createImage, type Image, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';

/** One sprite piece of a frame. */
export interface ApPiece {
  readonly x: number;
  readonly y: number;
  /** In pixels. */
  readonly width: number;
  readonly height: number;
  /** Tile number (OAM2 bits 0-9) and palette (bits 12-15), before the animation's base is added. */
  readonly tile: number;
  readonly palette: number;
  readonly hflip: boolean;
  readonly vflip: boolean;
  /** Scale/rotate: the inverse matrix in 1/256s (pa, pb, pc, pd), and whether its box is doubled. */
  readonly affine: readonly [number, number, number, number] | null;
  readonly doubleSize: boolean;
}

export type ApFrame = readonly ApPiece[];

export interface ApStep {
  readonly frames: number;
  readonly frame: number;
}

export interface ApAnimation {
  readonly steps: readonly ApStep[];
  /** What happens after the last step (AP_ExecFrame). */
  readonly end: 'loop' | 'remove' | 'stop';
}

/** OAM shapes and sizes in tiles (sOamTileSizeLut), by shape * 4 + size. */
const SIZES: readonly (readonly [number, number])[] = [
  [1, 1], [2, 2], [4, 4], [8, 8],
  [2, 1], [4, 1], [4, 2], [8, 4],
  [1, 2], [1, 4], [2, 4], [4, 8],
];

const signed = (v: number, bits: number) => (v & (1 << (bits - 1)) ? v - (1 << bits) : v);

/** FE's sine and cosine (COS, SIN) on a circle of 256, in 1/4096s. */
const sin = (a: number) => Math.round(Math.sin(((a & 0xff) * Math.PI) / 128) * 4096);
const cos = (a: number) => sin(a + 64);

/** Frame `index` of the AP at `at`, or null if it isn't readable. */
export function readApFrame(rom: GbaRom, at: number, index: number): ApFrame | null {
  const table = at + rom.u16(at);
  if (table + index * 2 + 2 > rom.size) return null;
  let p = table + rom.u16(table + index * 2);
  if (p + 2 > rom.size) return null;
  const head = rom.u16(p);
  p += 2;
  const matrices: [number, number, number, number][] = [];
  if (head & 0x8000) {
    // AP_QueueObjRotScale: pa = cos * 16 / sx, pb = -sin * 16 / sy, pc = sin * 16 / sx, pd = cos * 16 / sy.
    for (let i = 0; i < (head & 0x7fff); i++, p += 6) {
      const [angle, sx, sy] = [rom.u16(p), rom.u16(p + 2) || 1, rom.u16(p + 4) || 1];
      // Div truncates toward zero; `| 0` also turns -0 into 0.
      matrices.push([((cos(angle) * 16) / sx) | 0, ((-sin(angle) * 16) / sy) | 0, ((sin(angle) * 16) / sx) | 0, ((cos(angle) * 16) / sy) | 0]);
    }
  }
  const count = head & 0x8000 ? rom.u16(p) : head;
  if (head & 0x8000) p += 2;
  const pieces: ApPiece[] = [];
  for (let i = 0; i < count; i++, p += 6) {
    if (p + 6 > rom.size) return null;
    const [a0, a1, a2] = [rom.u16(p), rom.u16(p + 2), rom.u16(p + 4)];
    const [w, h] = SIZES[((a0 >> 14) & 3) * 4 + ((a1 >> 14) & 3)] ?? [1, 1];
    const affine = (a0 & 0x100) !== 0;
    pieces.push({
      x: signed(a1 & 0x1ff, 9),
      y: signed(a0 & 0xff, 8),
      width: w * 8,
      height: h * 8,
      tile: a2 & 0x3ff,
      palette: (a2 >> 12) & 15,
      hflip: !affine && (a1 & 0x1000) !== 0,
      vflip: !affine && (a1 & 0x2000) !== 0,
      affine: affine ? (matrices[(a1 >> 9) & 31] ?? [256, 0, 0, 256]) : null,
      doubleSize: affine && (a0 & 0x200) !== 0,
    });
  }
  return pieces;
}

/** Animation `index` of the AP at `at`, or null if it isn't readable. */
export function readApAnimation(rom: GbaRom, at: number, index: number): ApAnimation | null {
  const table = at + rom.u16(at + 2);
  if (table + index * 2 + 2 > rom.size) return null;
  let p = table + rom.u16(table + index * 2);
  const steps: ApStep[] = [];
  for (let n = 0; n < 256; n++, p += 4) {
    if (p + 4 > rom.size) return null;
    const frames = rom.u16(p);
    const frame = rom.u16(p + 2);
    if (frames === 0) return { steps, end: frame === 0xffff ? 'loop' : frame === 1 ? 'remove' : 'stop' };
    steps.push({ frames, frame });
  }
  return null;
}

/** The frame index showing `t` frames after the animation starts, or null once it has removed itself. */
export function apFrameAt(anim: ApAnimation, t: number): number | null {
  const total = anim.steps.reduce((n, s) => n + s.frames, 0);
  if (!anim.steps.length) return null;
  let f = Math.max(0, Math.floor(t));
  if (f >= total) {
    if (anim.end === 'remove') return null;
    if (anim.end === 'stop') return anim.steps[anim.steps.length - 1]!.frame;
    f %= total;
  }
  for (const s of anim.steps) {
    if (f < s.frames) return s.frame;
    f -= s.frames;
  }
  return null;
}

/** A frame drawn: its image and where in it the animation's position falls. */
export interface DrawnFrame {
  readonly image: Image;
  readonly originX: number;
  readonly originY: number;
}

/**
 * `frame` drawn with tiles from `sheet` (4bpp, 32 tiles to a row, its first tile being sprite tile
 * `firstTile`), `tileBase` (OAM2: tile and palette) added to every piece as PutSpriteExt adds it, and
 * `palettes` giving each palette number. Colour 0 is transparent. Later pieces are drawn under earlier
 * ones, as the GBA draws lower-numbered sprites on top.
 */
export function drawApFrame(frame: ApFrame, sheet: Uint8Array, firstTile: number, tileBase: number, palettes: (n: number) => Palette | undefined): DrawnFrame {
  const boxes = frame.map((p) => {
    const scale = p.doubleSize ? 2 : 1;
    return { p, bw: p.width * scale, bh: p.height * scale };
  });
  const minX = boxes.length ? Math.min(...boxes.map((b) => b.p.x)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((b) => b.p.y)) : 0;
  const maxX = boxes.length ? Math.max(...boxes.map((b) => b.p.x + b.bw)) : 1;
  const maxY = boxes.length ? Math.max(...boxes.map((b) => b.p.y + b.bh)) : 1;
  const image = createImage(maxX - minX, maxY - minY);
  const tiles = sheet.length / 32;
  for (const { p, bw, bh } of [...boxes].reverse()) {
    const oam2 = ((p.palette << 12) | p.tile) + tileBase;
    const colours = palettes((oam2 >> 12) & 15);
    if (!colours) continue;
    const first = (oam2 & 0x3ff) - firstTile;
    const texel = (u: number, v: number) => {
      if (u < 0 || v < 0 || u >= p.width || v >= p.height) return 0;
      const t = first + Math.floor(v / 8) * 32 + Math.floor(u / 8);
      if (t < 0 || t >= tiles) return 0;
      const byte = sheet[t * 32 + (v % 8) * 4 + Math.floor((u % 8) / 2)]!;
      return u & 1 ? byte >> 4 : byte & 15;
    };
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let u: number;
        let v: number;
        if (p.affine) {
          // The GBA maps each screen pixel back through the matrix from the box's centre.
          const [pa, pb, pc, pd] = p.affine;
          const dx = x - bw / 2;
          const dy = y - bh / 2;
          u = ((pa * dx + pb * dy) >> 8) + p.width / 2;
          v = ((pc * dx + pd * dy) >> 8) + p.height / 2;
        } else {
          u = p.hflip ? p.width - 1 - x : x;
          v = p.vflip ? p.height - 1 - y : y;
        }
        const c = texel(u, v);
        if (!c) continue;
        const rgb = colours[c]!;
        const i = ((p.y - minY + y) * image.width + (p.x - minX + x)) * 4;
        image.rgba[i] = rgb[0];
        image.rgba[i + 1] = rgb[1];
        image.rgba[i + 2] = rgb[2];
        image.rgba[i + 3] = 255;
      }
    }
  }
  return { image, originX: -minX, originY: -minY };
}
