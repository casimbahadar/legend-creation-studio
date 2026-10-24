// FE8's window art from the player's ROM (decision 35): the frame every window is drawn in, and the
// boxes of the map's unit and goal windows. Images are drawn once, enlarged 4 times pixel for pixel so
// they stay sharp when scaled, and sized in GBA pixels (--gba-px) like the text. Without the art (a ROM
// where it isn't found) windows keep the look-alike style.

import { createContext, type CSSProperties, type ReactNode } from 'react';
import { toCanvas } from '../play/catalog';
import { contentBounds, drawFrame, drawGoalWindow, drawUnitWindow, type Team, type WindowArt } from '../rom/fe8-windows';
import type { Image } from '../rom/gba-graphics';

export const WindowArtContext = createContext<WindowArt | null>(null);

const SCALE = 4;
/** The frame drawn for border-image: its top left corner is 2 tiles square, the other edges 1 tile. */
const FRAME_TILES = 4;

/** A length of `n` GBA pixels. */
export const gbaPx = (n: number) => `calc(${n} * var(--gba-px, 1.5px))`;

function scaledUrl(image: Image): string {
  const c = document.createElement('canvas');
  c.width = image.width * SCALE;
  c.height = image.height * SCALE;
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    g.drawImage(toCanvas(image), 0, 0, c.width, c.height);
  }
  return c.toDataURL();
}

/** A box image cropped to what it draws; `x` and `y` are where the crop starts in the full box. */
export interface Box {
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const boxes = new WeakMap<WindowArt, Map<string, Box | null>>();

function box(art: WindowArt, key: string, draw: () => Image): Box | null {
  let byKey = boxes.get(art);
  if (!byKey) boxes.set(art, (byKey = new Map()));
  if (!byKey.has(key)) {
    const full = draw();
    const b = contentBounds(full);
    let cropped: Box | null = null;
    if (b) {
      const image = { width: b.width, height: b.height, rgba: new Uint8ClampedArray(b.width * b.height * 4) };
      for (let y = 0; y < b.height; y++) {
        const from = ((b.y + y) * full.width + b.x) * 4;
        image.rgba.set(full.rgba.subarray(from, from + b.width * 4), y * b.width * 4);
      }
      cropped = { url: scaledUrl(image), ...b };
    }
    byKey.set(key, cropped);
  }
  return byKey.get(key)!;
}

export const unitBox = (art: WindowArt, team: Team) => box(art, `unit:${team}`, () => drawUnitWindow(art, team));
export const goalBox = (art: WindowArt, lines: 1 | 2) => box(art, `goal:${lines}`, () => drawGoalWindow(art, lines));

const frames = new WeakMap<WindowArt, string>();

/** The style that gives the game screen's windows FE8's frame (see .real-frames in app.css). */
export function frameStyle(art: WindowArt): CSSProperties {
  let url = frames.get(art);
  if (!url) frames.set(art, (url = scaledUrl(drawFrame(art, FRAME_TILES, FRAME_TILES))));
  return { ['--fe-frame' as string]: `url(${url})` };
}

/** One of the map's boxes with its contents placed by GBA pixel from the box's top left, as the game places them. */
export function MapBox({ box: b, className, children }: { box: Box; className: string; children: ReactNode }) {
  return (
    <div className={`map-box ${className}`} style={{ width: gbaPx(b.width), height: gbaPx(b.height), backgroundImage: `url(${b.url})` }}>
      {children}
    </div>
  );
}

/** Contents of a MapBox at (`x`, `y`) in the full box, centred (or set right) in `width` pixels if given. */
export function Place({
  box: b,
  x,
  y,
  width,
  align = 'centre',
  children,
}: {
  box: Box;
  x: number;
  y: number;
  width?: number;
  align?: 'centre' | 'right';
  children: ReactNode;
}) {
  const style: CSSProperties = { left: gbaPx(x - b.x), top: gbaPx(y - b.y) };
  if (width !== undefined) style.width = gbaPx(width);
  return (
    <div className={width !== undefined ? `map-box-item ${align}` : 'map-box-item'} style={style}>
      {children}
    </div>
  );
}
