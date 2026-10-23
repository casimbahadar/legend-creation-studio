import { describe, expect, it } from 'vitest';
import { mapRef, newProject } from '../core/project';
import { playFragment, PLAY_PREFIX, readPlayFragment } from './share';

describe('Play links', () => {
  const project = newProject('My First Chapter', mapRef(5));
  project.chapters[0]!.units.push(
    { id: 'eirika', name: 'Jasmine', class: 'lord-eirika', team: 'player', level: 1, at: [3, 8], items: ['rapier'], character: 'eirika' },
    { id: 'brigand-1', class: 'brigand', team: 'enemy', level: 2, at: [10, 4], ai: 'charge' },
  );

  it('round-trips a project through the link fragment', async () => {
    const fragment = await playFragment(project);
    expect(fragment.startsWith(PLAY_PREFIX)).toBe(true);
    expect(fragment).toMatch(/^#play=[A-Za-z0-9_-]+$/);
    expect(await readPlayFragment(fragment)).toEqual(project);
  });

  it('keeps links short by compressing', async () => {
    const big = structuredClone(project);
    for (let i = 0; i < 30; i++) big.chapters[0]!.units.push({ id: `fighter-${i}`, class: 'fighter', team: 'enemy', level: 3, at: [i % 15, 1 + Math.floor(i / 15)], items: ['iron-axe'] });
    const fragment = await playFragment(big);
    expect(fragment.length).toBeLessThan(JSON.stringify(big).length / 3);
  });

  it('refuses links that are not Play links or are damaged', async () => {
    await expect(readPlayFragment('#edit=abc')).rejects.toThrow("isn't a Play link");
    const fragment = await playFragment(project);
    await expect(readPlayFragment(fragment.slice(0, fragment.length / 2))).rejects.toThrow('damaged or cut short');
  });
});
