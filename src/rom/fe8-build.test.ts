import { describe, expect, it } from 'vitest';
import { mapRef, type ProjectChapter } from '../core/project';
import { AI_BYTES, buildFe8Rom, DEFEAT_BOSS_GOAL_CHAPTER, EXPANSION, findChapterChange, ROUT_GOAL_CHAPTER, SEIZE_THRONE_GOAL_CHAPTER } from './fe8-build';
import { FE8U_GET_DEFEAT_TALK_ENTRY, readDefeatTalks } from './fe8-death-quotes';
import { ASSET_TABLE, CHAPTER_STRIDE, CHAPTER_TABLE, EVENT_GROUP, readUnitList } from './fe8-chapters';
import { GENERIC_ENEMY } from './fe8-character-names';
import { CHARACTER_STRIDE, FE8_US_CHARACTER_TABLE } from './fe8-characters';
import { readRom, ROM_BASE, type GbaRom } from './gba-rom';
import { decodeTextBytes, FE8U_ROOT_POINTER_LITERAL, FE8U_TREE_LITERAL, type TextTable } from './text';
import { crc32 } from './crc32';
import { applyUps, createUps } from './ups';

// The stand-in's text: a Huffman tree with leaves "A", "B", the pair "AB" and the end marker, and a
// table of 0x20 entries. Franz's name is text 0x10.
const NODES = 0x250000;
const ROOT = NODES + 24;
const TEXT: TextTable = { root: ROOT, nodes: NODES, table: 0x251000, count: 0x20 };

// A clean-ROM stand-in: 16 MB with the Prologue's record and event group set up as the real ROM
// has them, as far as the builder reads them.
function fakeClean(): Uint8Array {
  const bytes = new Uint8Array(EXPANSION);
  const view = new DataView(bytes.buffer);
  const u32 = (o: number, v: number) => view.setUint32(o, v >>> 0, true);
  const prologue = CHAPTER_TABLE;
  bytes.set([1, 0, 2, 3, 4, 5, 0, 6], prologue + 4); // map ids
  bytes.set([0, 0, 0, 0, 1, 0, 0, 0], prologue + 0x0c); // fog .. battle tileset
  bytes[prologue + 0x74] = 0x20; // event data id
  const ch5 = CHAPTER_TABLE + 5 * CHAPTER_STRIDE;
  bytes.set([9, 10, 11, 12, 13, 14, 15, 16], ch5 + 4);
  bytes.set([3, 1, 7, 7, 4, 5, 2, 9], ch5 + 0x0c);
  const rout = CHAPTER_TABLE + ROUT_GOAL_CHAPTER * CHAPTER_STRIDE;
  bytes.set([0xac, 0x01, 0x9e, 0x01, 1, 0, 0, 0xff, 0], rout + 0x88);
  const throne = CHAPTER_TABLE + SEIZE_THRONE_GOAL_CHAPTER * CHAPTER_STRIDE;
  bytes.set([0xa5, 0x01, 0xa1, 0x01, 0, 0, 0, 0xff, 0], throne + 0x88);
  const boss = CHAPTER_TABLE + DEFEAT_BOSS_GOAL_CHAPTER * CHAPTER_STRIDE;
  bytes.set([0xbd, 0x01, 0x9d, 0x01, 3, 0, 0, 0xff, 0], boss + 0x88);
  // GetDefeatTalkEntry: a push, then "ldr r0, [pc, #4]" whose literal points to the death quotes:
  // O'Neill in the Prologue (as vanilla's first), Breguet in chapter 1, Seth anywhere, then the end.
  view.setUint16(FE8U_GET_DEFEAT_TALK_ENTRY, 0xb570, true);
  view.setUint16(FE8U_GET_DEFEAT_TALK_ENTRY + 2, 0x4801, true);
  u32(((FE8U_GET_DEFEAT_TALK_ENTRY + 2 + 4) & ~3) + 4, ROM_BASE + 0x260000);
  const quote = (k: number, pid: number, route: number, ch: number, flag: number, msg: number) => {
    const a = 0x260000 + k * 12;
    view.setUint16(a, pid, true);
    bytes[a + 2] = route;
    bytes[a + 3] = ch;
    view.setUint16(a + 4, flag, true);
    view.setUint16(a + 6, msg, true);
  };
  quote(0, 0x68, 0xff, 0, 2, 0x917);
  quote(1, 0x46, 0xff, 1, 2, 0x936);
  quote(2, 0x02, 0xff, 0xff, 0, 0xc25);
  view.setUint16(0x260000 + 3 * 12, 0xffff, true);

  const GROUP = 0x200000;
  u32(ASSET_TABLE + 0x20 * 4, ROM_BASE + GROUP);
  for (let k = 0; k < EVENT_GROUP.size / 4; k++) u32(GROUP + 4 * k, ROM_BASE + 0x300000 + k * 0x10); // stand-in pointers
  const ENDING = 0x210000;
  u32(GROUP + EVENT_GROUP.endingScene, ROM_BASE + ENDING);
  u32(ENDING, 0x00102221); // MUSC-like command
  u32(ENDING + 4, (1 << 16) | 0x2a22); // MNC2(1)
  u32(ENDING + 8, 0x0120); // ENDA
  const MISC = 0x220000;
  u32(GROUP + EVENT_GROUP.misc, ROM_BASE + MISC);
  u32(MISC, 0x00030001); // DefeatBoss
  u32(MISC + 4, ROM_BASE + 0x230000);
  u32(MISC + 8, 2);
  u32(MISC + 12, 0x00000001); // CauseGameOverIfLordDies
  u32(MISC + 16, ROM_BASE + 0x240000);
  u32(MISC + 20, 101);

  [0x41, 0x42, 0x4241, 0].forEach((v, i) => u32(NODES + i * 4, 0x80000000 | v));
  u32(NODES + 16, 0 | (1 << 16));
  u32(NODES + 20, 2 | (3 << 16));
  u32(ROOT, 4 | (5 << 16));
  for (let i = 0; i < TEXT.count; i++) u32(TEXT.table + i * 4, ROM_BASE + 0x252000);
  bytes[0x252000] = 0x0d; // "AB": the pair AB (1, 0), then the end (1, 1)
  // The text decoder's pointers to the tree and to the root pointer, which sits after the root.
  u32(ROOT + 4, ROM_BASE + ROOT);
  u32(FE8U_ROOT_POINTER_LITERAL, ROM_BASE + ROOT + 4);
  u32(FE8U_TREE_LITERAL, ROM_BASE + NODES);
  // The character table as on the real ROM: an empty record 0, then characters numbered from 1.
  for (let k = 0; k < 0x70; k++) bytes[FE8_US_CHARACTER_TABLE + k * CHARACTER_STRIDE + 4] = k + 1;
  view.setUint16(FE8_US_CHARACTER_TABLE + 3 * CHARACTER_STRIDE, 0x10, true);
  bytes.set([1, 2, 0, 0, 0, 0, 3, 0], FE8_US_CHARACTER_TABLE + 3 * CHARACTER_STRIDE + 0x0c); // Franz's personal bases
  bytes[FE8_US_CHARACTER_TABLE + 3 * CHARACTER_STRIDE + 0x1c] = 100; // and HP growth
  // The Cavalier class (5): base HP 20 and Con 9.
  bytes[0x807110 + 5 * 0x54 + 0x0b] = 20;
  bytes[0x807110 + 5 * 0x54 + 0x0b + 6] = 9;

  // Default classes: Seth a Paladin (7), Franz a Cavalier (5).
  bytes[FE8_US_CHARACTER_TABLE + 1 * CHARACTER_STRIDE + 5] = 7;
  bytes[FE8_US_CHARACTER_TABLE + 3 * CHARACTER_STRIDE + 5] = 5;
  return bytes;
}

function chapter(): ProjectChapter {
  return {
    id: 'chapter-1',
    name: 'Chapter 1',
    map: mapRef(0),
    goal: 'rout',
    units: [
      { id: 'eirika', class: 'lord-eirika', team: 'player', level: 1, at: [3, 4], items: ['rapier'], mustSurvive: true },
      { id: 'cavalier-m-1', class: 'cavalier-m', team: 'player', level: 3, at: [5, 6] },
      { id: 'fighter-1', class: 'fighter', team: 'enemy', level: 2, at: [10, 12], items: ['iron-axe', 'hand-axe'], ai: 'charge' },
      { id: 'archer-m-1', class: 'archer-m', team: 'enemy', level: 4, at: [63, 1], ai: 'hold' },
    ],
  };
}

const groupOf = (rom: GbaRom) => rom.offsetOf(rom.u32(ASSET_TABLE + 0x20 * 4));
const words = (rom: GbaRom, pointer: number, n: number) => Array.from({ length: n }, (_, k) => rom.u32(rom.offsetOf(pointer) + 4 * k) >>> 0);

describe('FE8 builder', () => {
  const clean = fakeClean();
  const built = buildFe8Rom(readRom(clean), TEXT, chapter());
  const rom = readRom(built.bytes);
  const group = groupOf(rom);

  it('adds everything after the clean ROM and points the Prologue at a new event group', () => {
    expect(built.bytes.length % 0x10000).toBe(0);
    expect(built.bytes.length).toBeGreaterThan(EXPANSION);
    expect(group).toBeGreaterThanOrEqual(EXPANSION);
    // Inside the clean ROM, only the asset-table entry, the Prologue's objective fields and the
    // player characters' base levels and personal bases (Eirika, Franz) changed.
    const changed: number[] = [];
    for (let i = 0; i < EXPANSION; i++) if (built.bytes[i] !== clean[i]) changed.push(i);
    const stats = (id: number, i: number) => i >= FE8_US_CHARACTER_TABLE + (id - 1) * CHARACTER_STRIDE + 0x0b && i < FE8_US_CHARACTER_TABLE + (id - 1) * CHARACTER_STRIDE + 0x14;
    const allowed = (i: number) =>
      (i >= ASSET_TABLE + 0x80 && i < ASSET_TABLE + 0x84) || (i >= CHAPTER_TABLE + 0x88 && i < CHAPTER_TABLE + 0x91) || stats(1, i) || stats(4, i);
    expect(changed.filter((i) => !allowed(i))).toEqual([]);
  });

  it('writes the units as FE8 unit definitions', () => {
    const players = readUnitList(rom, rom.offsetOf(rom.u32(group + EVENT_GROUP.playerUnits)));
    expect(players.map((u) => [u.character, u.classId, u.allegiance, u.level, u.autolevel, u.x, u.y, u.items])).toEqual([
      [0x01, 0x02, 'player', 1, false, 3, 4, [0x09]],
      [0x04, 0x05, 'player', 3, false, 5, 6, []],
    ]);
    const beginning = words(rom, rom.u32(group + EVENT_GROUP.beginningScene), 8);
    expect(beginning[0]).toBe(0x00012c40); // LOAD1(1, ...)
    expect(beginning[1]).toBe(rom.u32(group + EVENT_GROUP.playerUnits) >>> 0);
    expect(beginning[2]).toBe(0x3020); // ENUN
    expect(beginning[3]).toBe(0x00012c40);
    const enemies = readUnitList(rom, rom.offsetOf(beginning[4]!));
    expect(enemies.map((u) => [u.character, u.allegiance, u.level, u.x, u.y, u.ai])).toEqual([
      [GENERIC_ENEMY, 'enemy', 2, 10, 12, AI_BYTES.charge],
      [GENERIC_ENEMY, 'enemy', 4, 63, 1, AI_BYTES.hold],
    ]);
    expect(beginning.slice(5, 8)).toEqual([0x3020, 0x00070228, 0x0120]); // ENUN, EVBIT_T(7), ENDA
  });

  it("wins on Rout and moves on where vanilla's ending did, reusing vanilla's game over", () => {
    const misc = words(rom, rom.u32(group + EVENT_GROUP.misc), 7);
    const ending = rom.u32(group + EVENT_GROUP.endingScene) >>> 0;
    expect(misc).toEqual([0x00030001, ending, 6, 0x00000001, ROM_BASE + 0x240000, 101, 0]);
    expect(words(rom, ending, 3)).toEqual([0x00101721, 0x00012a22, 0x0120]); // FADI(16), MNC2(1), ENDA
    expect(Array.from(built.bytes.subarray(CHAPTER_TABLE + 0x88, CHAPTER_TABLE + 0x91))).toEqual([0xac, 0x01, 0x9e, 0x01, 1, 0, 0, 0xff, 0]);
    // The skirmish lists stay vanilla's.
    expect(rom.u32(group + 0x30) >>> 0).toBe(ROM_BASE + 0x300000 + 0x0c * 0x10);
  });

  it("wins on Seize with vanilla's Seize(x, y) on the chosen square, and no Rout check", () => {
    const c: ProjectChapter = { ...chapter(), goal: 'seize', seizeAt: [7, 9] };
    c.units[0]!.character = 'eirika';
    const out = readRom(buildFe8Rom(readRom(clean), TEXT, c).bytes);
    const g = groupOf(out);
    // LOCA(EVFLAG_WIN, EVENT_NOSCRIPT, 7, 9, TILE_COMMAND_SEIZE), then END.
    expect(words(out, out.u32(g + EVENT_GROUP.location), 4)).toEqual([0x00030005, 1, 0x00110907, 0]);
    expect(words(out, out.u32(g + EVENT_GROUP.misc), 4)).toEqual([0x00000001, ROM_BASE + 0x240000, 101, 0]);
    // "Seize the throne", goal window "Seize throne", type Seize.
    expect(Array.from(out.bytes.subarray(CHAPTER_TABLE + 0x88, CHAPTER_TABLE + 0x91))).toEqual([0xa5, 0x01, 0xa1, 0x01, 0, 0, 0, 0xff, 0]);
    // A Rout chapter's location list stays empty.
    expect(words(rom, rom.u32(group + EVENT_GROUP.location), 1)).toEqual([0]);
  });

  it("wins on Defeat boss when the boss's own death quote, first in a moved list, sets the boss flag", () => {
    const c: ProjectChapter = { ...chapter(), goal: 'boss', boss: 'fighter-1' };
    c.units[2]!.character = 'breguet';
    const out = readRom(buildFe8Rom(readRom(clean), TEXT, c).bytes);
    const g = groupOf(out);
    const ending = out.u32(g + EVENT_GROUP.endingScene) >>> 0;
    // DefeatBoss(ending): AFEV(EVFLAG_WIN, ending, EVFLAG_DEFEAT_BOSS), then the game over check.
    expect(words(out, out.u32(g + EVENT_GROUP.misc), 7)).toEqual([0x00030001, ending, 2, 0x00000001, ROM_BASE + 0x240000, 101, 0]);
    expect(Array.from(out.bytes.subarray(CHAPTER_TABLE + 0x88, CHAPTER_TABLE + 0x91))).toEqual([0xbd, 0x01, 0x9d, 0x01, 3, 0, 0, 0xff, 0]);
    // Breguet's entry for the Prologue comes first with his chapter 1 quote; O'Neill's Prologue entry is gone.
    const literal = ((FE8U_GET_DEFEAT_TALK_ENTRY + 2 + 4) & ~3) + 4;
    expect(out.u32(literal)).toBeGreaterThanOrEqual(ROM_BASE + EXPANSION);
    expect(readDefeatTalks(out, out.offsetOf(out.u32(literal)))!.map((e) => [e.pid, e.route, e.chapter, e.flag, e.msg])).toEqual([
      [0x46, 0xff, 0, 2, 0x936],
      [0x46, 0xff, 1, 2, 0x936],
      [0x02, 0xff, 0xff, 0, 0xc25],
    ]);
    // A Rout chapter leaves the death quotes alone.
    expect(rom.u32(literal)).toBe(ROM_BASE + 0x260000);
  });

  it("refuses a goal that still needs something, and goals the patch can't carry yet", () => {
    expect(() => buildFe8Rom(readRom(clean), TEXT, { ...chapter(), goal: 'seize' })).toThrow('Choose the square to seize.');
    expect(() => buildFe8Rom(readRom(clean), TEXT, { ...chapter(), goal: 'seize', seizeAt: [1, 1] })).toThrow(/Only Eirika can seize/);
    expect(() => buildFe8Rom(readRom(clean), TEXT, { ...chapter(), goal: 'survive' })).toThrow("The Survive goal isn't in the patch yet.");
  });

  it("copies another chapter's map fields, keeping the slot's title and prep setting", () => {
    const c = chapter();
    c.map = mapRef(5);
    const b = buildFe8Rom(readRom(clean), TEXT, c).bytes;
    expect(Array.from(b.subarray(CHAPTER_TABLE + 4, CHAPTER_TABLE + 0x14))).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 3, 0, 0, 0, 4, 5, 2, 9]);
  });

  it('tells what the patch leaves out', () => {
    const c = chapter();
    c.units[1]!.statBonus = { str: 2 };
    c.units[1]!.mustSurvive = true;
    c.units[0]!.mustSurvive = undefined;
    expect(buildFe8Rom(readRom(clean), TEXT, c).notes).toEqual([
      "eirika: as Eirika, the game is lost if this unit falls, even without Must survive.",
      'cavalier-m-1: Must survive only works for Eirika and Ephraim in the patch so far.',
    ]);
    expect(built.notes).toEqual([]);
    c.units[2]!.name = 'Brute';
    c.units[2]!.statBonus = { def: 1 };
    expect(buildFe8Rom(readRom(clean), TEXT, c).notes.slice(2)).toEqual([
      'Brute: custom stats need an FE8 character in the patch. Pick a boss for this enemy to keep them.',
      'Brute: names need an FE8 character in the patch. Pick a boss for this enemy to keep them.',
    ]);
    c.units[2]!.character = 'oneill';
    expect(buildFe8Rom(readRom(clean), TEXT, c).notes.slice(2)).toEqual([]);
  });

  it("gives a boss enemy its boss's record, with its name and exact stats", () => {
    const c = chapter();
    Object.assign(c.units[2]!, { character: 'oneill', name: 'BABA', statBonus: { def: 2 } });
    const out = readRom(buildFe8Rom(readRom(clean), TEXT, c).bytes);
    const enemies = readUnitList(out, out.offsetOf(words(out, out.u32(groupOf(out) + EVENT_GROUP.beginningScene), 5)[4]!));
    expect(enemies.map((u) => [u.character, u.autolevel, u.level])).toEqual([
      [0x68, false, 2],
      [GENERIC_ENEMY, true, 4],
    ]);
    const oneill = FE8_US_CHARACTER_TABLE + (0x68 - 1) * CHARACTER_STRIDE;
    expect(out.u8(oneill + 0x0b)).toBe(2);
    expect(out.u8(oneill + 0x0c + 4)).toBe(2); // Def: the class's 0 plus 2
    expect(String.fromCharCode(...decodeTextBytes(out, TEXT, out.u16(oneill)))).toBe('BABA');
  });

  it("writes a player unit's name and its exact stats at its level into its character", () => {
    const c = chapter();
    c.units[1]!.name = 'ABBA';
    c.units[1]!.statBonus = { hp: -1, str: 2, lck: -5 };
    const out = readRom(buildFe8Rom(readRom(clean), TEXT, c).bytes);
    expect(out.u32(TEXT.table + 0x10 * 4)).toBeGreaterThanOrEqual(ROM_BASE + EXPANSION);
    expect(String.fromCharCode(...decodeTextBytes(out, TEXT, 0x10))).toBe('ABBA');
    // Level 3 Cavalier: HP 20 + 1 + 2 level-ups at 100% - 1 custom = 22, so personal HP 2. Str 2 + 2 = 4.
    // Luck 3 - 5 stays at 0. Con stays the class's 9, so personal Con 0. Base level becomes 3.
    const franz = FE8_US_CHARACTER_TABLE + 3 * CHARACTER_STRIDE;
    expect(Array.from(out.bytes.subarray(franz + 0x0c, franz + 0x14)).map((b) => (b << 24) >> 24)).toEqual([2, 4, 0, 0, 0, 0, 0, 0]);
    expect(out.u8(franz + 0x0b)).toBe(3);
    // Another unit's character is untouched, and a name the tree can't write is refused.
    expect(out.u32(TEXT.table + 0x11 * 4)).toBe(ROM_BASE + 0x252000);
  });

  it("adds letters to the game's text for a name its pairs can't spell, leaving other text unchanged", () => {
    // Franz's own name text (0x10) is the only one using the single "A", so "A" is the leaf pushed down
    // and text 0x10 is re-encoded too; the new name must still win. Texts 0x11 and 0x12 are "B".
    const bytes = clean.slice();
    const view = new DataView(bytes.buffer);
    bytes.set([0x0c, 0, 0, 0, 0x0e], 0x252010); // "A" (0, 0, end) and "B" (0, 1, end)
    view.setUint32(TEXT.table + 0x10 * 4, ROM_BASE + 0x252010, true);
    view.setUint32(TEXT.table + 0x11 * 4, ROM_BASE + 0x252014, true);
    view.setUint32(TEXT.table + 0x12 * 4, ROM_BASE + 0x252014, true);
    const c = chapter();
    c.units[1]!.name = 'Franz B.';
    const out = readRom(buildFe8Rom(readRom(bytes), TEXT, c).bytes);
    // The decoder's pointers now lead to a tree in the added area.
    const nodes = out.offsetOf(out.u32(FE8U_TREE_LITERAL));
    const root = out.offsetOf(out.u32(out.offsetOf(out.u32(FE8U_ROOT_POINTER_LITERAL))));
    expect(nodes).toBeGreaterThanOrEqual(EXPANSION);
    const moved: TextTable = { ...TEXT, nodes, root };
    expect(String.fromCharCode(...decodeTextBytes(out, moved, 0x10))).toBe('Franz B.');
    expect(String.fromCharCode(...decodeTextBytes(out, moved, 0x11))).toBe('B');
    expect(String.fromCharCode(...decodeTextBytes(out, moved, 0x13))).toBe('AB');
    // Without such a name the tree stays where it was.
    expect(readRom(buildFe8Rom(readRom(clean), TEXT, chapter()).bytes).u32(FE8U_TREE_LITERAL)).toBe(ROM_BASE + NODES);
  });

  it('refuses slots whose next chapter it cannot find', () => {
    const c = chapter();
    c.replaces = mapRef(3);
    expect(() => buildFe8Rom(readRom(clean), TEXT, c)).toThrow("This chapter's place in the game has no events to replace.");
    expect(findChapterChange(readRom(clean), 0x400000, 4)).toBeNull();
  });

  it('round-trips through a UPS patch', () => {
    const patch = createUps(clean, built.bytes);
    expect(patch.length).toBeLessThan(4096);
    const applied = applyUps(patch, clean);
    expect(applied.length).toBe(built.bytes.length);
    expect(crc32(applied)).toBe(crc32(built.bytes));
  });
});
