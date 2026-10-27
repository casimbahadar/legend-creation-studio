// Text in FE8's own font (decision 35): each string drawn from the player's ROM into a small image,
// sized in GBA pixels (--gba-px, set by the game screen) so it scales with the screen. Without a font
// (a ROM where it isn't found) the text shows as ordinary text.

import { createContext, useContext, useMemo } from 'react';
import { toCanvas } from '../play/catalog';
import { drawSpecialChars, drawText, GLYPH_SIZE, textWidth, type TextColour } from '../rom/fe8-font';
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

/**
 * FE8's special characters `ids` (PutSpecialChar: big digits, dashes, "HP", "100"), 8 pixels a cell;
 * `fallback` as ordinary text when the ROM's special characters aren't found.
 */
export function FeSpecial({ ids, fallback, colour = 'white' }: { ids: readonly number[]; fallback: string; colour?: TextColour }) {
  const font = useContext(FontContext);
  const key = `special:${colour}:${ids.join(',')}`;
  const url = useMemo(() => {
    if (!font?.special) return null;
    let urls = cache.get(font);
    if (!urls) cache.set(font, (urls = new Map()));
    let u = urls.get(key);
    if (!u) urls.set(key, (u = toCanvas(drawSpecialChars(font.special, font.palette, ids, colour)).toDataURL()));
    return u;
  }, [font, key, ids, colour]);
  if (!url) return <FeText text={fallback} colour={colour} />;
  return <img className="fe-text" src={url} alt={fallback} style={{ width: `calc(${ids.length * 8} * var(--gba-px, 1.5px))`, height: `calc(${GLYPH_SIZE} * var(--gba-px, 1.5px))` }} />;
}
