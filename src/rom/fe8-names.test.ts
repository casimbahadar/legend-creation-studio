import { describe, expect, it } from 'vitest';
import { checkClassNames, FE8_CLASS_NAMES } from './fe8-names';

describe('FE8 class name list', () => {
  it('has unique names and ids in the class table range', () => {
    expect(new Set(FE8_CLASS_NAMES.map((c) => c.name)).size).toBe(FE8_CLASS_NAMES.length);
    expect(new Set(FE8_CLASS_NAMES.map((c) => c.id)).size).toBe(FE8_CLASS_NAMES.length);
    for (const c of FE8_CLASS_NAMES) {
      expect(c.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.id).toBeGreaterThanOrEqual(1);
      expect(c.id).toBeLessThanOrEqual(0x65);
    }
  });

  it('reports entries that the ROM names differently or lacks', () => {
    const list = [
      { name: 'knight-m', id: 9, gameName: 'Knight', label: 'Knight (male)' },
      { name: 'brigand', id: 0x41, gameName: 'Brigand', label: 'Brigand' },
      { name: 'soldier', id: 0x4e, gameName: 'Soldier', label: 'Soldier' },
    ];
    const rom = [
      { id: 9, name: 'Knight', mapSprite: 0 },
      { id: 0x41, name: 'Pirate', mapSprite: 0 },
    ];
    expect(checkClassNames(rom, list).map((m) => [m.entry.name, m.romName])).toEqual([
      ['brigand', 'Pirate'],
      ['soldier', null],
    ]);
  });
});
