import { describe, expect, it } from 'vitest';
import { checkCharacterNames, FE8_BOSS_NAMES, FE8_CHARACTER_NAMES, pickCharacter } from './fe8-character-names';

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

describe('FE8 boss list', () => {
  it('has unique names and ids, none shared with the cast', () => {
    const all = [...FE8_CHARACTER_NAMES, ...FE8_BOSS_NAMES];
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    for (const b of FE8_BOSS_NAMES) expect(b.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('picking a character', () => {
  const defaultClassOf = (id: number) => ({ 0x02: 7, 0x04: 5, 0x10: 5 })[id];
  it('gives Lords their own lord and others a free character of their class', () => {
    expect(pickCharacter('lord-eirika', 2, new Set(), defaultClassOf)).toBe('eirika');
    expect(pickCharacter('great-lord-ephraim', 3, new Set(), defaultClassOf)).toBe('ephraim');
    expect(pickCharacter('paladin-m', 7, new Set(), defaultClassOf)).toBe('seth');
    expect(pickCharacter('cavalier-m', 5, new Set(['franz']), defaultClassOf)).toBe('forde');
  });

  it('falls back to the first free character, never a lord for another class', () => {
    expect(pickCharacter('brigand', 0x45, new Set(), defaultClassOf)).toBe('seth');
    expect(pickCharacter('lord-eirika', 2, new Set(['eirika']), defaultClassOf)).toBe('seth');
    expect(pickCharacter('brigand', 0x45, new Set(FE8_CHARACTER_NAMES.map((c) => c.name)), defaultClassOf)).toBeNull();
  });
});
