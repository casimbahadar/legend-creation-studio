import { describe, expect, it } from 'vitest';
import { planAction, type AiRules } from './ai';
import type { Forecast, Stats } from './combat';
import { searchMoves } from './movement';
import { startPlay, type PlayState, type PlayUnit } from './play';
import type { Behaviour, ProjectUnit } from './project';

// 9x1 corridor, every step costs 1, Mov 2, weapons reach 1 square. Every fight deals 5 damage at 100 hit.
const W = 9;
const STATS: Stats = { hp: 10, str: 5, skl: 5, spd: 5, def: 3, res: 1, lck: 2, con: 6 };
const f = (damage: number): Forecast => ({
  attacker: { canAttack: true, damage, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
  defender: { canAttack: true, damage: 2, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
});
const rules = (damageTo: (target: PlayUnit) => number = () => 5): AiRules => ({
  width: W,
  searchOf: (u: PlayUnit, s: PlayState, mov = 2) =>
    searchMoves({ width: W, height: 1, terrain: new Array(W).fill(0) }, () => 1, mov, u.at, (x) => {
      const o = s.units.find((p) => p.at[0] === x && p.id !== u.id);
      return !o ? null : (o.team === 'enemy') !== (u.team === 'enemy') ? 'foe' : 'friend';
    }),
  targetsAt: (u, at, s) => s.units.filter((o) => (o.team === 'enemy') !== (u.team === 'enemy') && Math.abs(o.at[0] - at[0]) === 1),
  forecastAt: (_u, _at, t) => f(damageTo(t)),
});
const unit = (id: string, team: ProjectUnit['team'], x: number, ai?: Behaviour): ProjectUnit => ({ id, class: 'c', team, level: 1, at: [x, 0], ...(ai ? { ai } : {}) });
const play = (...units: ProjectUnit[]) => startPlay({ id: 'c', name: 'C', map: 'fe8-us/chapter-entry-0', goal: 'rout', units }, () => STATS);
const enemy = (s: PlayState) => s.units.find((u) => u.id === 'e')!;

describe('planAction', () => {
  it('walks up to a foe in reach and attacks it', () => {
    const s = play(unit('p', 'player', 0), unit('e', 'enemy', 3));
    expect(planAction(enemy(s), s, rules())).toEqual({ to: 1, route: [3, 2, 1], attack: 'p' });
  });

  it('waits when nothing is in reach, unless it charges', () => {
    const s = play(unit('p', 'player', 0), unit('e', 'enemy', 6));
    expect(planAction(enemy(s), s, rules())).toEqual({ to: 6, route: [6], attack: null });
    const c = play(unit('p', 'player', 0), unit('e', 'enemy', 6, 'charge'));
    expect(planAction(enemy(c), c, rules())).toEqual({ to: 4, route: [6, 5, 4], attack: null });
  });

  it('holds its square but still attacks what it can reach from there', () => {
    const far = play(unit('p', 'player', 0), unit('e', 'enemy', 3, 'hold'));
    expect(planAction(enemy(far), far, rules()).to).toBe(3);
    expect(planAction(enemy(far), far, rules()).attack).toBeNull();
    const near = play(unit('p', 'player', 2), unit('e', 'enemy', 3, 'hold'));
    expect(planAction(enemy(near), near, rules())).toEqual({ to: 3, route: [3], attack: 'p' });
  });

  it('prefers the target it can defeat', () => {
    // Both players are in reach; only 'weak' would fall to the blow.
    const s = play(unit('strong', 'player', 2), unit('e', 'enemy', 3), unit('weak', 'player', 4));
    const weakHp = { ...s, units: s.units.map((u) => (u.id === 'weak' ? { ...u, hp: 4 } : u)) };
    expect(planAction(enemy(weakHp), weakHp, rules()).attack).toBe('weak');
  });

  it('lets allies hunt enemies the same way', () => {
    const s = play(unit('a', 'ally', 0), unit('x', 'enemy', 3));
    const ally = s.units.find((u) => u.id === 'a')!;
    expect(planAction(ally, s, rules())).toEqual({ to: 2, route: [0, 1, 2], attack: 'x' });
  });
});

describe('planAction with a healing staff', () => {
  // The healer 'e' heals 8 a neighbour that is hurt.
  const healRules: AiRules = {
    ...rules(),
    staffChoices: (u, s) => {
      if (u.id !== 'e') return [];
      const hurt = s.units.filter((o) => o.id !== u.id && o.team === u.team && o.hp < o.stats.hp && Math.abs(o.at[0] - u.at[0]) === 1);
      return hurt.length ? [{ item: 0, targets: hurt.map((o) => o.id), heal: 8 }] : [];
    },
  };
  const hurt = (s: PlayState, hp: Record<string, number>) => ({ ...s, units: s.units.map((u) => (hp[u.id] !== undefined ? { ...u, hp: hp[u.id]! } : u)) });

  it('walks up to a hurt ally and heals it rather than attacking', () => {
    // 'p' could be attacked from square 2, but the healer goes to 5 to heal 'f'.
    const s = hurt(play(unit('p', 'player', 1), unit('e', 'enemy', 3), unit('f', 'enemy', 6)), { f: 3 });
    expect(planAction(enemy(s), s, healRules)).toEqual({ to: 5, route: [3, 4, 5], attack: null, heal: { target: 'f', item: 0, heal: 8 } });
  });

  it('heals where it does most good, then the ally with the least HP left', () => {
    // 'f' is missing 2 HP, 'g' 7: healing 'g' gives back more.
    const s = hurt(play(unit('f', 'enemy', 2), unit('e', 'enemy', 3), unit('g', 'enemy', 4)), { f: 8, g: 3 });
    expect(planAction(enemy(s), s, healRules).heal?.target).toBe('g');
    // Both missing at least 8: the one with less HP left.
    const t = hurt(play(unit('f', 'enemy', 2), unit('e', 'enemy', 3), unit('g', 'enemy', 4)), { f: 1, g: 2 });
    expect(planAction(enemy(t), t, healRules).heal?.target).toBe('f');
  });

  it('attacks as usual with nobody to heal, and a holding healer only heals next to it', () => {
    const s = play(unit('p', 'player', 2), unit('e', 'enemy', 3), unit('f', 'enemy', 6));
    expect(planAction(enemy(s), s, healRules)).toMatchObject({ attack: 'p' });
    const held = hurt(play(unit('e', 'enemy', 3, 'hold'), unit('f', 'enemy', 6)), { f: 3 });
    expect(planAction(enemy(held), held, healRules)).toEqual({ to: 3, route: [3], attack: null });
  });
});
