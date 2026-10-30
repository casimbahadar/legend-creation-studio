// FE8 US's doors, chests, villages and houses (decision 38), as the fireemblem8u decompilation reads
// them:
// - Map changes (include/types.h struct MapChange, src/bmtrick.c): a chapter's table is the asset its
//   record's eighth map id names (GetChapterMapChangesPointer), uncompressed. Each entry is 12 bytes:
//   an id (signed byte; a negative one ends the table), x, y, width and height, then a pointer to
//   width x height 16-bit tiles in the map layer's form, where 0 leaves a square as it is. Opening a
//   door or chest, or visiting a village, applies the change whose rectangle holds the square, the
//   last one listed if several do (GetMapChangeIdAt).
// - Location events (src/eventinfo.c, include/eventscript.h): the list the chapter's event group points
//   to at +0x08, entries of 32-bit words: a command (low half) and an event flag (high half), then the
//   command's words (gEventListCmdInfoTable gives each command's length), ended by command 0.
//   Village (VILL, then a LOCA one square up that the gate's tile change answers to), House (LOCA, visit),
//   Chest (CHES: an item and, for gold, an amount), a random chest (LOCA, chest: a list of item and
//   chance bytes, as Lagdou's and Valni's floors use) and Door (DOOR) are kept; seize squares and shops
//   aren't.
// - A village's or house's scene (src/eventscr.c): event commands of 16-bit halfwords, the first holding
//   the command (bits 8-15), its length in halfwords (bits 4-7) and a subcommand (bits 0-3). Text_BG
//   puts the background in slot 2 and the message in slot 3 and calls Event_TextWithBG, which adds
//   slot 3 into slot 2 and shows text -1 (slot 2's); an item or gold is given from slot 3. The scene is
//   followed through its calls with the slots kept, so its text, item and gold are found without knowing
//   where the helper scenes are.

import { ASSET_TABLE, EVENT_GROUP, type ChapterInfo } from './fe8-chapters';
import type { GbaRom } from './gba-rom';

export interface MapChange {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Metatile per square, row by row (the map's `cells` form), or null where the square stays. */
  readonly tiles: readonly (number | null)[];
}

/** Map change ids are bytes; a chapter has a few dozen at most. */
const MAX_MAP_CHANGES = 128;

/** The chapter's map changes, or [] if it has none. */
export function readMapChanges(rom: GbaRom, chapter: ChapterInfo): MapChange[] {
  const id = chapter.mapIds[7];
  if (id === undefined || id === 0) return [];
  const p = rom.u32(ASSET_TABLE + id * 4);
  if (!rom.isPointer(p)) return [];
  const out: MapChange[] = [];
  for (let at = rom.offsetOf(p); out.length < MAX_MAP_CHANGES && at + 12 <= rom.size; at += 12) {
    const changeId = rom.u8(at);
    if (changeId & 0x80) break;
    const [x, y, width, height] = [rom.u8(at + 1), rom.u8(at + 2), rom.u8(at + 3), rom.u8(at + 4)];
    const data = rom.u32(at + 8);
    if (!rom.isPointer(data) || rom.offsetOf(data) + width * height * 2 > rom.size) break;
    const from = rom.offsetOf(data);
    const tiles = Array.from({ length: width * height }, (_, i) => {
      const v = rom.u16(from + i * 2);
      return v === 0 ? null : v >> 2;
    });
    out.push({ id: changeId, x, y, width, height, tiles });
  }
  return out;
}

/** The id of the change a square opens (GetMapChangeIdAt): the last whose rectangle holds it, or null. */
export function mapChangeAt(changes: readonly MapChange[], x: number, y: number): number | null {
  let id: number | null = null;
  for (const c of changes) if (x >= c.x && y >= c.y && x <= c.x + c.width - 1 && y <= c.y + c.height - 1) id = c.id;
  return id;
}

/** What a village or house scene does, as far as decision 38's fields go. */
export interface VisitScene {
  /** The messages it shows, in order. */
  readonly texts: readonly number[];
  readonly item: number | null;
  readonly gold: number | null;
  /** It does more than show text and give an item or gold: it branches, brings in units, and so on. */
  readonly custom: boolean;
}

/** Every kind keeps its list entry's second word as stored (`word`): a scene's or list's pointer, a chest's item and gold, 1 for a door. */
export type TileEvent = { readonly x: number; readonly y: number; readonly flag: number; readonly word: number } & (
  | { readonly kind: 'door' }
  | { readonly kind: 'chest'; readonly item: number; readonly gold: number | null }
  | { readonly kind: 'randomChest'; readonly items: readonly { readonly item: number; readonly chance: number }[] }
  | { readonly kind: 'village' | 'house'; readonly scene: VisitScene | null }
);

/** Event list commands' lengths in words (gEventListCmdInfoTable), by command. */
const LIST_LENGTHS = [1, 3, 3, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4];
const LIST = { end: 0, loca: 5, vill: 6, ches: 7, door: 8 } as const;
const TILE = { visit: 0x10, chest: 0x14 } as const;
const ITEM_GOLD = 0x77;
const MAX_LIST_ENTRIES = 256;

/** The chapter's doors, chests, villages and houses, in list order. */
export function readTileEvents(rom: GbaRom, chapter: ChapterInfo): TileEvent[] {
  if (chapter.eventGroup === null) return [];
  const p = rom.u32(chapter.eventGroup + EVENT_GROUP.location);
  if (!rom.isPointer(p)) return [];
  const out: TileEvent[] = [];
  let at = rom.offsetOf(p);
  for (let n = 0; n < MAX_LIST_ENTRIES && at + 4 <= rom.size; n++) {
    const head = rom.u32(at);
    const cmd = head & 0xffff;
    const length = LIST_LENGTHS[cmd];
    if (cmd === LIST.end || length === undefined || at + length * 4 > rom.size) break;
    const flag = head >>> 16;
    if (length === 3) {
      const word = rom.u32(at + 4);
      const [x, y, tile] = [rom.u8(at + 8), rom.u8(at + 9), rom.u8(at + 10)];
      const scene = () => (rom.isPointer(word) ? readVisitScene(rom, rom.offsetOf(word)) : null);
      if (cmd === LIST.door) out.push({ kind: 'door', x, y, flag, word });
      else if (cmd === LIST.ches) {
        const item = word & 0xffff;
        out.push({ kind: 'chest', x, y, flag, word, item, gold: item === ITEM_GOLD ? word >>> 16 : null });
      } else if (cmd === LIST.vill && tile === TILE.visit) out.push({ kind: 'village', x, y, flag, word, scene: scene() });
      else if (cmd === LIST.loca && tile === TILE.visit) out.push({ kind: 'house', x, y, flag, word, scene: scene() });
      else if (cmd === LIST.loca && tile === TILE.chest && rom.isPointer(word)) out.push({ kind: 'randomChest', x, y, flag, word, items: readChestList(rom, rom.offsetOf(word)) });
    }
    at += length * 4;
  }
  return out;
}

/** A random chest's list (the chest case of the tile command handler): item and chance bytes, ended by item 0. */
function readChestList(rom: GbaRom, at: number): { item: number; chance: number }[] {
  const out: { item: number; chance: number }[] = [];
  for (let p = at; p + 2 <= rom.size && out.length < 64; p += 2) {
    const item = rom.u8(p);
    if (item === 0) break;
    out.push({ item, chance: rom.u8(p + 1) });
  }
  return out;
}

const EV = { end: 0x01, sval: 0x05, slotOps: 0x06, call: 0x0a, displayText: 0x1b, giveItem: 0x37 } as const;
/** Commands a plain scene may hold at its top level: flags, slots, calls, waits, music, sound, fades, text and portraits, backgrounds, giving, popups. */
const PLAIN = new Set([0x00, 0x01, 0x02, 0x05, 0x06, 0x0a, 0x0e, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x37, 0x3a]);
/** Commands that make a scene custom wherever they are: units loaded, moved, fought, warped or changed, or the chapter changed. */
const STAGING = new Set([0x2a, 0x2b, 0x2c, 0x2f, 0x32, 0x34, 0x35, 0x3f, 0x40, 0x41, 0x43]);
const MAX_COMMANDS = 512;
const MAX_DEPTH = 4;

/** What the scene at `at` shows and gives, or null if it can't be read. */
export function readVisitScene(rom: GbaRom, at: number): VisitScene | null {
  const slots = new Array<number>(14).fill(0);
  const texts: number[] = [];
  let item: number | null = null;
  let gold: number | null = null;
  let custom = false;
  let commands = 0;
  const run = (start: number, depth: number): boolean => {
    for (let p = start; ; ) {
      if (p + 2 > rom.size || ++commands > MAX_COMMANDS) return false;
      const h = rom.u16(p);
      const cmd = h >> 8;
      const length = (h >> 4) & 15;
      const sub = h & 15;
      if (length === 0 || p + length * 2 > rom.size) return false;
      const arg = length >= 2 ? rom.u16(p + 2) : 0;
      const word = length >= 4 ? rom.u32(p + 4) : 0;
      if (depth === 0 && !PLAIN.has(cmd)) custom = true;
      if (STAGING.has(cmd)) custom = true;
      if (cmd === EV.end) return true;
      if (cmd === EV.sval && arg < slots.length) slots[arg] = word;
      else if (cmd === EV.slotOps && sub === 0) {
        // SADD: to, a, b in the argument's low three nibbles.
        const [to, a, b] = [arg & 15, (arg >> 4) & 15, (arg >> 8) & 15];
        if (to < slots.length) slots[to] = ((slots[a] ?? 0) + (slots[b] ?? 0)) >>> 0;
      } else if (cmd === EV.call && rom.isPointer(word) && depth < MAX_DEPTH) {
        if (!run(rom.offsetOf(word), depth + 1)) return false;
      } else if (cmd === EV.displayText && (sub === 0 || sub === 1)) texts.push(arg === 0xffff ? slots[2]! & 0xffff : arg);
      else if (cmd === EV.giveItem) {
        if (sub === 0) item = slots[3]! & 0xffff;
        else gold = slots[3]!;
      }
      p += length * 2;
    }
  };
  return run(at, 0) ? { texts, item, gold, custom } : null;
}
