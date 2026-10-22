import { describe, expect, it } from 'vitest';
import { checkProject, isLordClass, mapEntry, mapRef, newProject, projectToJson, toName, type Project } from './project';

function sample(): Project {
  const p = newProject('My First Chapter', mapRef(5));
  p.chapters[0]!.units.push(
    { id: 'eirika', name: 'Eirika', class: 'lord-eirika', team: 'player', level: 1, at: [3, 8], items: ['rapier'] },
    { id: 'brigand-1', class: 'brigand', team: 'enemy', level: 2, at: [10, 4] },
  );
  return p;
}

const roundTrip = (p: Project): unknown => JSON.parse(projectToJson(p));

describe('project file', () => {
  it('accepts a valid project after saving and loading', () => {
    const { project, problems } = checkProject(roundTrip(sample()));
    expect(problems).toEqual([]);
    expect(project).toEqual(sample());
  });

  it('checks names against a catalog when given one', () => {
    const catalog = { classes: new Set(['lord-eirika']), items: new Set(['rapier']) };
    const { project, problems } = checkProject(roundTrip(sample()), catalog);
    expect(project).toBeNull();
    expect(problems).toEqual([{ path: 'chapters[0].units[1].class', message: '"brigand-1" has a class this tool doesn\'t know: "brigand".' }]);
  });

  it('rejects files that are not projects', () => {
    expect(checkProject(null).problems[0]!.message).toMatch("isn't a Legend Creation Studio project");
    expect(checkProject({ format: 'other' }).problems).toHaveLength(1);
    expect(checkProject({ ...sample(), version: 9 }).problems[0]!.path).toBe('version');
  });

  it('reports each broken field with its path', () => {
    const data = roundTrip(sample()) as { chapters: { units: Record<string, unknown>[] }[] };
    const [a, b] = data.chapters[0]!.units;
    Object.assign(a!, { id: 'Eirika!', team: 'villain', level: 0 });
    Object.assign(b!, { at: [3, 8], items: [7] });
    data.chapters[0]!.units[1]!.id = 'eirika';
    const paths = checkProject(data).problems.map((p) => p.path);
    expect(paths).toEqual([
      'chapters[0].units[0].id',
      'chapters[0].units[0].team',
      'chapters[0].units[0].level',
      'chapters[0].units[1].at',
      'chapters[0].units[1].items[0]',
    ]);
  });

  it('catches duplicate unit ids', () => {
    const p = sample();
    p.chapters[0]!.units[1]!.id = 'eirika';
    expect(checkProject(roundTrip(p)).problems.map((x) => x.message)).toEqual(['Two units are both called "eirika".']);
  });

  it('needs a map reference it understands', () => {
    const p = sample();
    p.chapters[0]!.map = 'chapter 5';
    expect(checkProject(roundTrip(p)).problems.map((x) => x.path)).toEqual(['chapters[0].map']);
  });
});

describe('inventories', () => {
  it('allows up to five items', () => {
    const p = sample();
    p.chapters[0]!.units[0]!.items = ['rapier', 'rapier', 'rapier', 'rapier', 'rapier'];
    expect(checkProject(roundTrip(p)).problems).toEqual([]);
    p.chapters[0]!.units[0]!.items.push('rapier');
    expect(checkProject(roundTrip(p)).problems.map((x) => x.message)).toEqual(['"eirika" carries 6 items; a unit can carry at most 5.']);
  });
});

describe('behaviours', () => {
  it('accepts the three behaviours and rejects others', () => {
    const p = sample();
    p.chapters[0]!.units[1]!.ai = 'charge';
    expect(checkProject(roundTrip(p)).problems).toEqual([]);
    (p.chapters[0]!.units[1] as { ai: string }).ai = 'berserk';
    expect(checkProject(roundTrip(p)).problems.map((x) => x.path)).toEqual(['chapters[0].units[1].ai']);
  });
});

describe('custom stats', () => {
  it('accepts known stat changes in range and rejects the rest', () => {
    const p = sample();
    p.chapters[0]!.units[0]!.statBonus = { hp: 5, str: -2, con: 99 };
    expect(checkProject(roundTrip(p)).problems).toEqual([]);
    (p.chapters[0]!.units[0]! as { statBonus: unknown }).statBonus = { hp: 100, mag: 5, spd: 4.5 };
    expect(checkProject(roundTrip(p)).problems.map((x) => x.message)).toEqual([
      '"eirika" has a custom HP change outside -99 to +99.',
      '"eirika" has a stat this tool doesn\'t know: "mag".',
      '"eirika" has a custom SPD change outside -99 to +99.',
    ]);
  });
});

describe('must survive', () => {
  it('can be set on player and ally units but not enemies', () => {
    const p = sample();
    p.chapters[0]!.units[0]!.mustSurvive = true;
    expect(checkProject(roundTrip(p)).problems).toEqual([]);
    p.chapters[0]!.units[1]!.mustSurvive = true;
    expect(checkProject(roundTrip(p)).problems.map((x) => x.message)).toEqual(['"brigand-1" is an enemy, so it can\'t be marked Must survive.']);
  });

  it('knows the lord classes', () => {
    expect(['lord-eirika', 'great-lord-ephraim', 'brigand', 'lord'].map(isLordClass)).toEqual([true, true, false, false]);
  });
});

describe('helpers', () => {
  it('reads and writes map references', () => {
    expect(mapRef(12)).toBe('fe8-us/chapter-entry-12');
    expect(mapEntry('fe8-us/chapter-entry-12')).toBe(12);
    expect(mapEntry('fe8-us/chapter-entry-x')).toBeNull();
  });

  it('makes ids from any text', () => {
    expect(toName('My First Chapter!')).toBe('my-first-chapter');
    expect(toName('  ')).toBe('untitled');
  });
});
