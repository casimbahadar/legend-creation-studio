// Checks against a real clean FE8 US ROM. Set LCS_FE8_ROM to its path to run them; skipped otherwise.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { FE8_US_CRC32 } from './fe8';
import { readRom } from './gba-rom';
import { CA_BOSS, CA_PROMOTED, readClasses, readClassStats } from './fe8-classes';
import { checkClassNames } from './fe8-names';
import { FE8_US_ITEM_TABLE, findItemTable, readItems } from './fe8-items';
import { checkItemNames } from './fe8-item-names';
import { CHAPTER_STRIDE, CHAPTER_TABLE, EVENT_GROUP, readChapter, readPlayerUnits } from './fe8-chapters';
import { FE8_US_CHARACTER_TABLE, findCharacterTable, readCharacters } from './fe8-characters';
import { ALL_CHARACTER_NAMES, checkCharacterNames, GENERIC_ALLY, GENERIC_ENEMY } from './fe8-character-names';
import { FE8U_SYSTEM_GLYPHS, FE8U_TALK_GLYPHS, readFont } from './fe8-font';
import { readChibi, readPortrait } from './fe8-portraits';
import { readMapCursor, readMenuHand } from './fe8-cursor';
import { readPhaseBanner } from './fe8-phase';
import { drawExpBar, readExpBarArt } from './fe8-expbar';
import { FE8U_LEVEL_UP_TEXT_AP, FE8U_STAT_GAIN_AP, readLevelUpBox, readLevelUpSprites } from './fe8-levelup';
import { readApAnimation } from './fe8-ap';
import type { Team } from './fe8-windows';
import { contentBounds, drawFrame, drawGoalWindow, drawUnitWindow, readWindowArt } from './fe8-windows';
import { buildFe8Rom, readVillageScene, villageMessage, VILLAGER_OPENING, DEFEAT_BOSS_GOAL_CHAPTER, SURVIVE_GOAL_CHAPTER, findChapterChange, ROUT_GOAL_CHAPTER, SEIZE_GATE_GOAL_CHAPTER, SEIZE_THRONE_GOAL_CHAPTER } from './fe8-build';
import { FE8U_GET_DEFEAT_TALK_ENTRY, findDefeatTalkList, readDefeatTalks } from './fe8-death-quotes';
import { readMapSprite, readTeamPalettes, renderMapSprite } from './fe8-map-sprites';
import { readAllChapterMaps, readChapterMap, renderMap } from './fe8-maps';
import { mapChangeAt, readMapChanges, readTileEvents } from './fe8-tile-events';
import { decodeText, decodeTextBytes, FE8U_ROOT_POINTER_LITERAL, FE8U_TREE_LITERAL, findTextTable } from './text';
import { encodeTextBytes, readHuffmanCodes } from './text-encode';

const romPath = process.env.LCS_FE8_ROM;

describe.skipIf(!romPath)('clean FE8 US ROM (LCS_FE8_ROM)', () => {
  const bytes = romPath ? new Uint8Array(readFileSync(romPath)) : new Uint8Array();
  const rom = readRom(bytes);

  it('is the clean ROM', () => {
    expect(crc32(bytes)).toBe(FE8_US_CRC32);
    expect(rom.gameCode).toBe('BE8E');
  });

  it('decodes text, including a known name', () => {
    const table = findTextTable(rom);
    expect(table).not.toBeNull();
    const all = Array.from({ length: table!.count }, (_, id) => decodeText(rom, table!, id));
    expect(all).toContain('Eirika');
  });

  it('reads and draws the chapter maps', () => {
    const maps = readAllChapterMaps(rom);
    expect(maps.length).toBeGreaterThan(10);
    for (const map of maps) {
      expect(map.cells.length).toBe(map.width * map.height);
      const image = renderMap(map);
      expect(image.rgba.length).toBe(map.width * 16 * map.height * 16 * 4);
    }
  });

  it('reads class names and draws class map sprites', () => {
    const classes = readClasses(rom, findTextTable(rom)!);
    expect(classes.map((c) => c.name)).toContain('Lord');
    const palettes = readTeamPalettes(rom);
    let drawn = 0;
    for (const c of classes) {
      try {
        const sprite = readMapSprite(rom, c.mapSprite);
        renderMapSprite(sprite, palettes.enemy, 2);
        drawn++;
      } catch {
        // some class slots may have no usable sprite; the page skips those too
      }
    }
    expect(drawn).toBeGreaterThan(50);
  });

  it('matches every class name in the hand-written list', () => {
    expect(checkClassNames(readClasses(rom, findTextTable(rom)!))).toEqual([]);
  });

  it('reads class movement', () => {
    const lord = readClasses(rom, findTextTable(rom)!).find((c) => c.id === 2)!;
    expect(lord.mov).toBe(5);
    expect(lord.moveCosts?.length).toBe(0x41);
  });

  it('finds the item table and reads Iron Sword', () => {
    const table = findItemTable(rom);
    expect(table).toBe(FE8_US_ITEM_TABLE);
    const iron = readItems(rom, findTextTable(rom)!, table!).find((i) => i.id === 1)!;
    expect(iron).toMatchObject({ name: 'Iron Sword', type: 0, uses: 46, might: 5, hit: 90, weight: 5, crit: 0, minRange: 1, maxRange: 1 });
  });

  it('reads class weapon ranks', () => {
    const lord = readClasses(rom, findTextTable(rom)!).find((c) => c.id === 2)!;
    expect(lord.weaponRanks[0]).toBeGreaterThan(0);
  });

  it('matches every item name in the hand-written list', () => {
    expect(checkItemNames(readItems(rom, findTextTable(rom)!, findItemTable(rom)!))).toEqual([]);
  });

  it('reads plausible class stats and terrain bonus tables', () => {
    for (const c of readClasses(rom, findTextTable(rom)!).filter((c) => c.id <= 0x4e)) {
      expect(c.base.hp).toBeGreaterThanOrEqual(10);
      // The Gorgon Egg (class 0x34) starts with 50 HP; every other class with at most 40.
      expect(c.base.hp).toBeLessThanOrEqual(c.id === 0x34 ? 50 : 40);
      expect(c.terrainAvoid).not.toBeNull();
      expect(c.terrainDef).not.toBeNull();
    }
  });

  it('finds the character table with Eirika first', () => {
    const table = findCharacterTable(rom);
    expect(table).toBe(FE8_US_CHARACTER_TABLE);
    const characters = readCharacters(rom, findTextTable(rom)!, table!);
    expect(characters[0]).toMatchObject({ id: 1, name: 'Eirika', defaultClass: 2, baseLevel: 1 });
    // Seth's personal bases and growths, as the decompilation lists them.
    expect(characters[1]).toMatchObject({
      base: { hp: 7, str: 7, skl: 9, spd: 5, def: 3, res: 5, lck: 13, con: 0 },
      growths: { hp: 90, str: 50, skl: 45, spd: 45, def: 40, res: 30, lck: 25 },
    });
    expect(checkCharacterNames(characters, ALL_CHARACTER_NAMES)).toEqual([]);
    // The generic characters the patch uses for enemies and allies.
    expect(characters[GENERIC_ENEMY - 1]?.name).toBe('Soldier');
    expect(characters[GENERIC_ALLY - 1]?.name).toBe('Frelian');
  });

  it("reads the Prologue's player units as the decompilation lists them: Seth, then Eirika", () => {
    const text = findTextTable(rom)!;
    const units = readPlayerUnits(rom, readChapter(rom, text, 0));
    expect(units.map((u) => [u.character, u.classId, u.allegiance, u.level, u.x, u.y])).toEqual([
      [2, 7, 'player', 1, 13, 9],
      [1, 2, 'player', 1, 8, 5],
    ]);
  });

  it("reads Chapter 4's villages as the decompilation lists them (ch4-eventinfo.h)", () => {
    const text = findTextTable(rom)!;
    const events = readTileEvents(rom, readChapter(rom, text, 4)); // CHAPTER_L_4
    expect(events.map((e) => [e.kind, e.x, e.y])).toEqual([
      ['village', 1, 11],
      ['village', 8, 2],
    ]);
    // EventScr_089F1B38 checks who visits and brings in a unit; EventScr_089F1BD8 shows 0x9b5 and gives item 0x1f.
    expect(events[0]).toMatchObject({ scene: { custom: true } });
    expect(events[1]).toMatchObject({ scene: { texts: [0x9b5], item: 0x1f, gold: null, custom: false } });
  });

  it("finds a chapter with Ch11a's chests and doors, and a map change under every door, chest and village", () => {
    const text = findTextTable(rom)!;
    const chapters = Array.from({ length: 79 }, (_, i) => readChapter(rom, text, i));
    const ch11a = [
      ['chest', 3, 8, 0x50],
      ['chest', 12, 11, 0x96],
      ['chest', 17, 5, 0x5d],
      ['door', 4, 11, null],
      ['door', 17, 13, null],
      ['door', 18, 13, null],
    ];
    const lists = chapters.map((c) => readTileEvents(rom, c).map((e) => [e.kind, e.x, e.y, e.kind === 'chest' ? e.item : null]));
    expect(lists.some((l) => JSON.stringify(l) === JSON.stringify(ch11a))).toBe(true);
    for (const c of chapters) {
      const changes = readMapChanges(rom, c);
      const map = readChapterMap(rom, c.index);
      // Unbroken Heart (entry 5) lists a door at (23, 12), off its 22 x 19 map: FE8's own leftover.
      const onMap = (e: { x: number; y: number }) => !map || (e.x < map.width && e.y < map.height);
      for (const e of readTileEvents(rom, c)) if (e.kind !== 'house' && onMap(e)) expect([c.index, e.kind, e.x, e.y, mapChangeAt(changes, e.x, e.y) !== null]).toEqual([c.index, e.kind, e.x, e.y, true]);
    }
  });

  it("finds what the patch reuses: the Prologue's next chapter and the Rout objective", () => {
    const text = findTextTable(rom)!;
    const group = readChapter(rom, text, 0).eventGroup!;
    expect(findChapterChange(rom, rom.offsetOf(rom.u32(group + EVENT_GROUP.endingScene)))).toBe(0x00012a22); // MNC2(1)
    const rout = CHAPTER_TABLE + ROUT_GOAL_CHAPTER * CHAPTER_STRIDE;
    // Its two lines are split by FE8's line break (control code 0x01).
    expect(decodeText(rom, text, rom.u16(rout + 0x88))).toMatch(/^Defeat all\[0x01\]enemy units/);
    expect(decodeText(rom, text, rom.u16(rout + 0x8a))).toMatch(/^Defeat enemy/);
    expect(rom.u8(rout + 0x8c)).toBe(1); // goal window type: Defeat all
  });

  it('builds a chapter into the Prologue and reads it back', () => {
    const text = findTextTable(rom)!;
    const built = readRom(
      buildFe8Rom(rom, text, {
        id: 'c',
        name: 'C',
        map: 'fe8-us/chapter-entry-0',
        goal: 'rout',
        units: [
          { id: 'eirika', class: 'lord-eirika', team: 'player', level: 1, at: [8, 5], items: ['rapier'], mustSurvive: true },
          { id: 'f', class: 'fighter', team: 'enemy', level: 3, at: [10, 5], items: ['iron-axe'] },
        ],
      }).bytes,
    );
    const units = readPlayerUnits(built, readChapter(built, text, 0));
    expect(units.map((u) => [u.character, u.classId, u.allegiance, u.level, u.x, u.y, u.items])).toEqual([[1, 2, 'player', 1, 8, 5, [9]]]);
  });

  it("builds a chapter on Chapter 4's map into the Prologue with Chapter 4's own villages, and its map changes", () => {
    const text = findTextTable(rom)!;
    const built = readRom(
      buildFe8Rom(rom, text, {
        id: 'c',
        name: 'C',
        map: 'fe8-us/chapter-entry-4',
        goal: 'rout',
        units: [
          { id: 'eirika', class: 'lord-eirika', team: 'player', level: 1, at: [3, 3], items: ['rapier'], mustSurvive: true },
          { id: 'f', class: 'fighter', team: 'enemy', level: 3, at: [10, 5], items: ['iron-axe'] },
        ],
      }).bytes,
    );
    const strip = (es: ReturnType<typeof readTileEvents>) => es.map((e) => [e.kind, e.x, e.y, e.flag, e.word >>> 0]);
    const slot = readChapter(built, text, 0);
    expect(strip(readTileEvents(built, slot))).toEqual(strip(readTileEvents(rom, readChapter(rom, text, 4))));
    expect(readMapChanges(built, slot)).toEqual(readMapChanges(rom, readChapter(rom, text, 4)));
  });

  it("adds what a village of the user's says as a new message, played in Chapter 4's village scene, keeping every other text", () => {
    const text = findTextTable(rom)!;
    expect(readVillageScene(rom)).not.toBeNull();
    // Chapter 4's message starts with the faces the user's villages use.
    expect(Array.from(decodeTextBytes(rom, text, 0x9b5).subarray(0, VILLAGER_OPENING.length))).toEqual(VILLAGER_OPENING);
    const say = 'Welcome, traveller! Take this with you, and mind the river to the south.';
    const built = readRom(
      buildFe8Rom(rom, text, {
        id: 'c',
        name: 'C',
        map: 'fe8-us/chapter-entry-4',
        goal: 'rout',
        units: [
          { id: 'eirika', class: 'lord-eirika', team: 'player', level: 1, at: [3, 3], items: ['rapier'], mustSurvive: true },
          { id: 'f', class: 'fighter', team: 'enemy', level: 3, at: [10, 5], items: ['iron-axe'] },
        ],
        places: [{ kind: 'village', at: [8, 2], text: say, item: 'vulnerary' }],
      }).bytes,
    );
    const after = findTextTable(built)!;
    expect(after.count).toBe(text.count + 1);
    const strip = (b: Uint8Array) => Array.from(b).filter((x, i, a) => !(x === 0x1f && a.slice(i).every((y) => y === 0x1f)));
    expect(strip(decodeTextBytes(built, after, text.count))).toEqual(villageMessage(say));
    for (const id of [1, 0x9b5, text.count - 1]) expect(Array.from(decodeTextBytes(built, after, id))).toEqual(Array.from(decodeTextBytes(rom, text, id)));
    // The village plays Chapter 4's scene with the new message, then gives the Vulnerary.
    const events = readTileEvents(built, readChapter(built, after, 0));
    const village = events.find((e) => e.kind === 'village')!;
    expect(village).toMatchObject({ x: 8, y: 2, flag: 100, scene: { texts: [text.count], item: 0x6c, custom: false } });
  });

  it("encodes names with the ROM's own Huffman tree so they decode back", () => {
    const text = findTextTable(rom)!;
    const codes = readHuffmanCodes(rom, text);
    const copy = new Uint8Array(rom.size + 0x10000);
    copy.set(bytes);
    const view = new DataView(copy.buffer);
    // Odd-length names end with FE8's filler, which the game drops after decoding.
    const names = ['Bram', "L'Arachel", 'Jasmine', 'Quill'];
    names.forEach((name, i) => {
      const at = rom.size + i * 0x100;
      copy.set(encodeTextBytes(codes, [...name].map((c) => c.charCodeAt(0))), at);
      view.setUint32(text.table + i * 4, 0x08000000 + at, true);
    });
    const out = readRom(copy);
    expect(names.map((_, i) => String.fromCharCode(...decodeTextBytes(out, text, i)).replace(/\x1f+$/, ''))).toEqual(names);
  });

  it("has the text decoder's pointers to the tree where the decompilation puts them", () => {
    const text = findTextTable(rom)!;
    expect(rom.u32(FE8U_TREE_LITERAL)).toBe(0x08000000 + text.nodes);
    expect(rom.u32(rom.offsetOf(rom.u32(FE8U_ROOT_POINTER_LITERAL)))).toBe(0x08000000 + text.root);
  });

  it('adds letters for a name the game can\'t spell, keeping every other text entry', () => {
    const text = findTextTable(rom)!;
    // The builder refuses to finish unless every other entry decodes as before.
    const built = readRom(
      buildFe8Rom(rom, text, {
        id: 'c',
        name: 'C',
        map: 'fe8-us/chapter-entry-0',
        goal: 'rout',
        units: [{ id: 'x', class: 'lord-eirika', team: 'player', level: 1, at: [8, 5], name: 'Xavier', character: 'eirika' }],
      }).bytes,
    );
    const moved = findTextTable(built)!;
    expect(moved.nodes).toBeGreaterThanOrEqual(rom.size);
    const eirikaName = rom.u16(findCharacterTable(rom)!);
    expect(String.fromCharCode(...decodeTextBytes(built, moved, eirikaName)).replace(/\x1f+$/, '')).toBe('Xavier');
  });

  it('reads the system and talk fonts, with the "A" the decompilation shows', () => {
    const system = readFont(rom, FE8U_SYSTEM_GLYPHS)!;
    expect(system.get(0x41)!.width).toBe(5);
    expect(Array.from(system.get(0x41)!.pixels.subarray(4 * 16, 4 * 16 + 6))).toEqual([0, 3, 2, 2, 3, 0]);
    expect(readFont(rom, FE8U_TALK_GLYPHS)).not.toBeNull();
  });

  it("reads Eirika's chibi portrait through her character", () => {
    const eirika = readCharacters(rom, findTextTable(rom)!, findCharacterTable(rom)!)[0]!;
    expect(eirika.portrait).toBe(2); // portraitId 0x2 in the decompilation
    const chibi = readChibi(rom, eirika.portrait)!;
    expect([chibi.width, chibi.height]).toEqual([32, 32]);
    // Most of it is drawn.
    let opaque = 0;
    for (let i = 3; i < chibi.rgba.length; i += 4) if (chibi.rgba[i]) opaque++;
    expect(opaque).toBeGreaterThan(400);
  });

  it('reads the window art and draws the windows', () => {
    const art = readWindowArt(rom)!;
    expect(art).not.toBeNull();
    // The interface tiles are 256 x 32 pixels in the decompilation (player_interface_font_tiles.png).
    expect(art.tiles.length).toBe((0x100 + 128) * 32);
    // player_interface_blue.pal: colour 1 is white.
    expect(art.teamPalettes.player[1]).toEqual([248, 248, 248]);
    for (const map of [art.unitWindow, art.goalOneLine, art.goalTwoLines]) {
      expect(map.width).toBeLessThanOrEqual(30);
      expect(map.height).toBeLessThanOrEqual(20);
    }
    // Every window draws something, and a frame is drawn all over.
    for (const img of [drawUnitWindow(art, 'player'), drawGoalWindow(art, 1), drawGoalWindow(art, 2)]) expect(contentBounds(img)).not.toBeNull();
    // FE8's frame stops short of the tiles' edges at the left, right and bottom (its corner ornament
    // and shadow), as drawn from the clean ROM.
    expect(contentBounds(drawFrame(art, 7, 6))).toEqual({ x: 3, y: 0, width: 48, height: 45 });
  });

  it('reads the map cursor corner', () => {
    const corner = readMapCursor(rom)!;
    expect([corner.width, corner.height]).toEqual([8, 8]);
    let opaque = 0;
    for (let i = 3; i < corner.rgba.length; i += 4) if (corner.rgba[i]) opaque++;
    expect(opaque).toBeGreaterThan(4);
    expect(contentBounds(readMenuHand(rom)!)).not.toBeNull();
  });

  it('reads each phase banner', () => {
    for (const team of ['player', 'enemy', 'ally'] as Team[]) {
      const b = readPhaseBanner(rom, team)!;
      expect(contentBounds(b.band)).not.toBeNull();
      expect(contentBounds(b.name)).not.toBeNull();
    }
  });

  it('reads what classes and characters count for in experience', () => {
    // src/data_classes.c: Eirika's Lord (class 2; class 1 is Ephraim's) caps most stats at 20, has
    // relative power 3 and promotes to class 4, her Great Lord.
    const lord = readClassStats(rom, 2);
    expect([lord.caps.hp, lord.caps.str, lord.power, lord.promotion]).toEqual([60, 20, 3, 4]);
    expect(lord.attributes & CA_PROMOTED).toBe(0);
    expect(readClassStats(rom, 7).attributes & CA_PROMOTED).toBe(CA_PROMOTED); // Paladin
    const oneill = readCharacters(rom, findTextTable(rom)!, findCharacterTable(rom)!).find((c) => c.id === 0x68)!;
    expect(oneill.attributes & CA_BOSS).toBe(CA_BOSS);
  });

  it('holds the goals the patch copies in the vanilla chapters it copies them from', () => {
    // src/data/chapter_settings.json: objective text, goal window text, type, end turn.
    const goal = (index: number) => {
      const r = CHAPTER_TABLE + index * CHAPTER_STRIDE;
      return [rom.u16(r + 0x88), rom.u16(r + 0x8a), rom.u8(r + 0x8c), rom.u8(r + 0x8d)];
    };
    expect(goal(ROUT_GOAL_CHAPTER)).toEqual([0x1ac, 0x19e, 1, 0]); // Defeat all enemy units / Defeat enemy
    expect(goal(SEIZE_THRONE_GOAL_CHAPTER)).toEqual([0x1a5, 0x1a1, 0, 0]); // Seize the throne / Seize throne
    expect(goal(SEIZE_GATE_GOAL_CHAPTER)).toEqual([0x1a3, 0x19f, 0, 0]); // Seize the castle gate / Seize gate
    expect(goal(DEFEAT_BOSS_GOAL_CHAPTER)).toEqual([0x1bd, 0x19d, 3, 0]); // Defeat boss / Defeat boss
    expect(goal(SURVIVE_GOAL_CHAPTER)).toEqual([0x1b0, 0x19c, 2, 12]); // Survive for 11 turns or defeat Aias / Survive, to turn 12
  });

  it("finds the death quotes through GetDefeatTalkEntry's literal pool", () => {
    const found = findDefeatTalkList(rom)!;
    expect(found).not.toBeNull();
    // The pool sits inside the function, before the next one (GetSupportTalkEntry, 0x84748).
    expect(found.literal).toBeGreaterThan(FE8U_GET_DEFEAT_TALK_ENTRY);
    expect(found.literal).toBeLessThan(0x84748);
    const list = readDefeatTalks(rom, found.table)!;
    expect(list).toHaveLength(79); // src/data_battlequotes.c
    expect(list.at(-1)).toMatchObject({ pid: 0x21, route: 0xff, chapter: 0xff, msg: 0xc43 }); // Syrene
  });

  it('reads the map experience bar', () => {
    const art = readExpBarArt(rom)!;
    expect(art).not.toBeNull();
    expect([art.box.width, art.box.height]).toEqual([17, 3]);
    // The box spans most of its 136 x 24 pixels.
    expect(contentBounds(drawExpBar(art, 50))!.width).toBeGreaterThan(120);
  });

  it('reads the map level-up box', () => {
    const box = readLevelUpBox(rom)!;
    expect([box.width, box.height]).toEqual([240, 224]);
    expect(contentBounds(box)).not.toBeNull();
  });

  it("puts Eirika's full face together", () => {
    const eirika = readCharacters(rom, findTextTable(rom)!, findCharacterTable(rom)!).find((c) => c.id === 1)!;
    const face = readPortrait(rom, eirika.portrait)!;
    expect([face.width, face.height]).toEqual([96, 80]);
    expect(contentBounds(face)!.height).toBeGreaterThan(60);
  });

  it("reads the level-up's sprite animations", () => {
    const sprites = readLevelUpSprites(rom)!;
    // The decompilation's sheets: LEVEL UP 256 x 16, the gain labels 256 x 24.
    expect([sprites.text.length, sprites.gain.length]).toEqual([64 * 32, 96 * 32]);
    expect(readApAnimation(rom, FE8U_LEVEL_UP_TEXT_AP, 0)).not.toBeNull();
    for (const anim of [0, 1, 3]) expect(readApAnimation(rom, FE8U_STAT_GAIN_AP, anim)!.steps.length).toBeGreaterThan(0);
  });
});

