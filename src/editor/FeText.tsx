// Text in FE8's own font (decision 35): each string drawn from the player's ROM into a small image,
// sized in GBA pixels (--gba-px, set by the game screen) so it scales with the screen. Without a font
// (a ROM where it isn't found) the text shows as ordinary text.

import { createContext, useContext, useMemo } from 'react';
import { toCanvas } from '../play/catalog';
import { drawText, GLYPH_SIZE, textWidth, type TextColour } from '../rom/fe8-font';
import type { GameFont } from './project-io';

export const FontContext = createContext<GameFont | null>(null);

const cache = new WeakMap<GameFont, Map<string, string>>();

function imageUrl(font: GameFont, text: string, colour: TextColour): string {
  let urls = cache.get(font);
  if (!urls) cache.set(font, (urls = new Map()));
  const key = `${colour}:${text}`;
  let url = urls.get(key);
  if (!url) urls.set(key, (url = toCanvas(drawText(font.glyphs, font.palette, text, colour)).toDataURL()));
  return url;
}

export function FeText({ text, colour = 'white' }: { text: string | number; colour?: TextColour }) {
  const font = useContext(FontContext);
  const s = String(text);
  const url = useMemo(() => (font ? imageUrl(font, s, colour) : null), [font, s, colour]);
  if (!font || !url) return <span className={`fe-fallback fe-${colour}`}>{s}</span>;
  return (
    <img
      className="fe-text"
      src={url}
      alt={s}
      style={{ width: `calc(${Math.max(1, textWidth(font.glyphs, s))} * var(--gba-px, 1.5px))`, height: `calc(${GLYPH_SIZE} * var(--gba-px, 1.5px))` }}
    />
  );
}
