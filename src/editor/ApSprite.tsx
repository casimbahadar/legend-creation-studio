// FE8's AP sprite animations on the game screen (decision 35), drawn from the player's ROM: each
// frame is drawn once and kept, then shown at the animation's position.

import { toCanvas } from '../play/catalog';
import { apFrameAt, drawApFrame, readApAnimation, readApFrame, type ApAnimation } from '../rom/fe8-ap';
import type { Palette } from '../rom/gba-graphics';
import type { GbaRom } from '../rom/gba-rom';
import { gbaPx } from './FeWindow';

interface Drawn {
  readonly url: string;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

const animations = new WeakMap<GbaRom, Map<string, ApAnimation | null>>();
const frames = new WeakMap<GbaRom, Map<string, Drawn | null>>();

function animation(rom: GbaRom, at: number, index: number): ApAnimation | null {
  let byKey = animations.get(rom);
  if (!byKey) animations.set(rom, (byKey = new Map()));
  const key = `${at}:${index}`;
  if (!byKey.has(key)) byKey.set(key, readApAnimation(rom, at, index));
  return byKey.get(key)!;
}

export interface ApSpriteProps {
  readonly rom: GbaRom;
  /** The AP's ROM offset and which of its animations. */
  readonly at: number;
  readonly anim: number;
  /** Frames since the animation started. */
  readonly t: number;
  /** Where it is put on the screen (or in its container), in GBA pixels. */
  readonly x: number;
  readonly y: number;
  /** Its tiles (from sprite tile `firstTile`), the OAM2 base added to every piece, and its palettes. */
  readonly sheet: Uint8Array;
  readonly firstTile: number;
  readonly tileBase: number;
  readonly palettes: (n: number) => Palette | undefined;
  /** Tells apart drawings with different sheets or palettes. */
  readonly look: string;
}

/** One AP animation as it shows `t` frames in, or nothing once it has removed itself. */
export function ApSprite({ rom, at, anim, t, x, y, sheet, firstTile, tileBase, palettes, look }: ApSpriteProps) {
  const a = animation(rom, at, anim);
  const index = a ? apFrameAt(a, t) : null;
  if (index === null) return null;
  let byKey = frames.get(rom);
  if (!byKey) frames.set(rom, (byKey = new Map()));
  const key = `${at}:${index}:${tileBase}:${look}`;
  if (!byKey.has(key)) {
    const frame = readApFrame(rom, at, index);
    const drawn = frame && drawApFrame(frame, sheet, firstTile, tileBase, palettes);
    byKey.set(key, drawn ? { url: toCanvas(drawn.image).toDataURL(), originX: drawn.originX, originY: drawn.originY, width: drawn.image.width, height: drawn.image.height } : null);
  }
  const d = byKey.get(key);
  if (!d) return null;
  return (
    <img
      className="ap-sprite"
      src={d.url}
      alt=""
      style={{ left: gbaPx(x - d.originX), top: gbaPx(y - d.originY), width: gbaPx(d.width), height: gbaPx(d.height) }}
    />
  );
}
