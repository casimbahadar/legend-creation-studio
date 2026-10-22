import { describe, expect, it } from 'vitest';
import { checkCharacterNames, FE8_CHARACTER_NAMES } from './fe8-character-names';

describe('FE8 character name list', () => {
  it('has unique names and ids', () => {
    expect(new Set(FE8_CHARACTER_NAMES.map((c) => c.name)).size).toBe(FE8_CHARACTER_NAMES.length);
    expect(new Set(FE8_CHARACTER_NAMES.map((c) => c.id)).size).toBe(FE8_CHARACTER_NAMES.length);
    for (const c of FE8_CHARACTER_NAMES) expect(c.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('reports entries the ROM names differently or lacks', () => {
    const list = [
      { name: 'eirika', id: 1, gameName: 'Eirika' },
      { name: 'seth', id: 2, gameName: 'Seth' },
      { name: 'tana', id: 0x22, gameName: 'Tana' },
    ];
    const rom = [
      { id: 1, name: 'Eirika' },
      { id: 2, name: 'Gilliam' },
    ];
    expect(checkCharacterNames(rom, list).map((m) => [m.entry.name, m.romName])).toEqual([
      ['seth', 'Gilliam'],
      ['tana', null],
    ]);
  });
});
