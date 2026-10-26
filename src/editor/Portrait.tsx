// A unit's portrait from the player's ROM (decision 35): the chibi, as FE8 shows it in its unit
// window, sized in GBA pixels like the window text, and the full face.

import { useMemo } from 'react';
import { toCanvas } from '../play/catalog';
import { readChibi, readPortrait } from '../rom/fe8-portraits';
import type { GbaRom } from '../rom/gba-rom';

const cache = new WeakMap<GbaRom, Map<number, string | null>>();

/** Portrait `id`'s chibi as an image URL, or null if it has none. */
export function chibiUrl(rom: GbaRom, id: number): string | null {
  let urls = cache.get(rom);
  if (!urls) cache.set(rom, (urls = new Map()));
  if (!urls.has(id)) {
    const image = readChibi(rom, id);
    urls.set(id, image ? toCanvas(image).toDataURL() : null);
  }
  return urls.get(id)!;
}

const faces = new WeakMap<GbaRom, Map<number, string | null>>();

/** Portrait `id`'s full face (96 x 80) as an image URL, or null if it has none. */
export function faceUrl(rom: GbaRom, id: number): string | null {
  let urls = faces.get(rom);
  if (!urls) faces.set(rom, (urls = new Map()));
  if (!urls.has(id)) {
    const image = readPortrait(rom, id);
    urls.set(id, image ? toCanvas(image).toDataURL() : null);
  }
  return urls.get(id)!;
}

export function Chibi({ rom, id }: { rom: GbaRom; id: number }) {
  const url = useMemo(() => chibiUrl(rom, id), [rom, id]);
  if (!url) return null;
  return <img className="chibi" src={url} alt="" />;
}
