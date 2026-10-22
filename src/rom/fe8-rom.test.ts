// Checks against a real clean FE8 US ROM. Set LCS_FE8_ROM to its path to run them; skipped otherwise.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { FE8_US_CRC32 } from './fe8';
import { readRom } from './gba-rom';
import { readClasses } from './fe8-classes';
import { checkClassNames } from './fe8-names';
import { FE8_US_ITEM_TABLE, findItemTable, readItems } from './fe8-items';
import { checkItemNames } from './fe8-item-names';
import { CHAPTER_STRIDE, CHAPTER_TABLE, EVENT_GROUP, readChapter, readPlayerUnits } from './fe8-chapters';
import { FE8_US_CHARACTER_TABLE, findCharacterTable, readCharacters } from './fe8-characters';
import { checkCharacterNames, GENERIC_ALLY, GENERIC_ENEMY } from './fe8-character-names';
import { buildFe8Rom, findChapterChange, ROUT_GOAL_CHAPTER } from './fe8-build';
import { readMapSprite, readTeamPalettes, renderMapSprite } from './fe8-map-sprites';
import { readAllChapterMaps, renderMap } from './fe8-maps';
import { decodeText, decodeTextBytes, findTextTable } from './text';
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
      expect(c.base.hp).toBeLessThanOrEqual(40);
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
    expect(checkCharacterNames(characters)).toEqual([]);
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

  it("finds what the patch reuses: the Prologue's next chapter and the Rout objective", () => {
    const text = findTextTable(rom)!;
    const group = readChapter(rom, text, 0).eventGroup!;
    expect(findChapterChange(rom, rom.offsetOf(rom.u32(group + EVENT_GROUP.endingScene)))).toBe(0x00012a22); // MNC2(1)
    const rout = CHAPTER_TABLE + ROUT_GOAL_CHAPTER * CHAPTER_STRIDE;
    expect(decodeText(rom, text, rom.u16(rout + 0x88))).toMatch(/^Defeat all\s*enemy units/);
    expect(decodeText(rom, text, rom.u16(rout + 0x8a))).toMatch(/^Defeat enemy/);
    expect(rom.u8(rout + 0x8c)).toBe(1); // goal window type: Defeat all
  });

  it('builds a chapter into the Prologue and reads it back', () => {
    const text = findTextTable(rom)!;
    const built = readRom(
      buildFe8Rom(rom, {
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

  it("encodes names with the ROM's own Huffman tree so they decode back", () => {
    const text = findTextTable(rom)!;
    const codes = readHuffmanCodes(rom, text);
    const copy = new Uint8Array(rom.size + 0x10000);
    copy.set(bytes);
    const view = new DataView(copy.buffer);
    const names = ['Bram', "L'Arachel", 'Mira-7', 'Zed Q'];
    names.forEach((name, i) => {
      const at = rom.size + i * 0x100;
      copy.set(encodeTextBytes(codes, [...name].map((c) => c.charCodeAt(0))), at);
      view.setUint32(text.table + i * 4, 0x08000000 + at, true);
    });
    const out = readRom(copy);
    expect(names.map((_, i) => String.fromCharCode(...decodeTextBytes(out, text, i)))).toEqual(names);
  });
});
