// FE8 US's death quotes (gDefeatTalkList, src/data_battlequotes.c in the fireemblem8u decompilation):
// what happens when a character falls. Each 12-byte entry (DefeatTalkEnt) holds a character, a route
// and a chapter (0xFF: any), a flag the death sets, and a quote or event; the list ends at character
// 0xFFFF. GetDefeatTalkEntry takes the first entry that matches and whose flag isn't set yet. Bosses'
// entries set EVFLAG_DEFEAT_BOSS (2), which a Defeat boss chapter's misc list waits for.

import type { GbaRom } from './gba-rom';

/** GetDefeatTalkEntry, the only code that reads the list; its literal pool holds the list's address. */
export const FE8U_GET_DEFEAT_TALK_ENTRY = 0x846e4;
export const DEFEAT_TALK_SIZE = 12;
const LIST_END = 0xffff;
/** Any route or any chapter. */
export const ANY = 0xff;

export interface DefeatTalk {
  readonly pid: number;
  readonly route: number;
  readonly chapter: number;
  readonly flag: number;
  readonly msg: number;
  /** ROM pointer to an event, or 0. */
  readonly event: number;
}

function readEntry(rom: GbaRom, a: number): DefeatTalk {
  return { pid: rom.u16(a), route: rom.u8(a + 2), chapter: rom.u8(a + 3), flag: rom.u16(a + 4), msg: rom.u16(a + 6), event: rom.u32(a + 8) >>> 0 };
}

/** The list at `table`, without its end marker, or null if no end comes within `max` entries. */
export function readDefeatTalks(rom: GbaRom, table: number, max = 256): DefeatTalk[] | null {
  const out: DefeatTalk[] = [];
  for (let k = 0; k < max; k++) {
    const a = table + k * DEFEAT_TALK_SIZE;
    if (a + DEFEAT_TALK_SIZE > rom.size) return null;
    if (rom.u16(a) === LIST_END) return out;
    out.push(readEntry(rom, a));
  }
  return null;
}

/** The vanilla list's first entry: O'Neill in the Prologue, setting EVFLAG_DEFEAT_BOSS with quote 0x917. */
const FIRST: DefeatTalk = { pid: 0x68, route: ANY, chapter: 0, flag: 2, msg: 0x917, event: 0 };

/**
 * Where the list is: the literal in GetDefeatTalkEntry's pool that points to it, found through the
 * function's Thumb "ldr rN, [pc, #imm]" instructions and accepted only if it leads to a list starting
 * as the vanilla one does. Null if none does.
 */
export function findDefeatTalkList(rom: GbaRom, fn = FE8U_GET_DEFEAT_TALK_ENTRY): { literal: number; table: number } | null {
  for (let k = 0; k < 64; k++) {
    const at = fn + 2 * k;
    if (at + 2 > rom.size) break;
    const h = rom.u16(at);
    if ((h & 0xf800) !== 0x4800) continue;
    const literal = ((at + 4) & ~3) + (h & 0xff) * 4;
    if (literal + 4 > rom.size) continue;
    const p = rom.u32(literal);
    if (!rom.isPointer(p)) continue;
    const table = rom.offsetOf(p);
    const list = readDefeatTalks(rom, table);
    const first = list?.[0];
    if (first && (Object.keys(FIRST) as (keyof DefeatTalk)[]).every((key) => first[key] === FIRST[key])) return { literal, table };
  }
  return null;
}

/** A list's bytes, with its end marker. */
export function defeatTalkBytes(list: readonly DefeatTalk[]): number[] {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  for (const e of list) {
    u16(e.pid);
    out.push(e.route, e.chapter);
    u16(e.flag);
    u16(e.msg);
    out.push(e.event & 0xff, (e.event >>> 8) & 0xff, (e.event >>> 16) & 0xff, (e.event >>> 24) & 0xff);
  }
  u16(LIST_END);
  out.push(...new Array<number>(DEFEAT_TALK_SIZE - 2).fill(0));
  return out;
}
