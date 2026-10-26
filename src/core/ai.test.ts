import { describe, expect, it } from 'vitest';
import { dangerMap, isHealing, phaseOrder, planAction, type AiItem, type AiRules } from './ai';
import type { Forecast, Stats } from './combat';
import { searchMoves } from './movement';
import { startPlay, type PlayState, type PlayUnit } from './play';
import type { Behaviour, ProjectUnit } from './project';

// A 7 x 3 field where every step costs 1 and every unit has Mov 2. Each unit's weapons are set per
// test (by unit id); by default a sword: might 5, reaching 1 square. Fights deal `damage` at 100 hit,
// and the defender strikes back for 2 if its weapon reaches.
const W = 7;
const H = 3;
const STATS: Stats = { hp: 10, str: 5, skl: 5, spd: 5, def: 3, res: 1, lck: 2, con: 6 };
const SWORD: AiItem = { item: 0, staff: false, might: 5, min: 1, max: 1 };
const grid = { width: W, height: H, terrain: new Array(W * H).fill(0) };
const dist = (a: readonly [number, number], b: readonly [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

interface Setup {
  readonly items?: Record<string, readonly AiItem[]>;
  readonly damage?: (target: PlayUnit) => number;
  readonly terrain?: Record<number, number>;
  readonly lords?: readonly string[];
  readonly forts?: readonly number[];
}
function rules(setup: Setup = {}): AiRules {
  const itemsOf = (u: PlayUnit) => setup.items?.[u.id] ?? [SWORD];
  return {
    width: W,
    height: H,
    searchOf: (u, s, mov = 2) =>
      searchMoves(grid, () => 1, mov, u.at, (x, y) => {
        const o = s.units.find((p) => p.at[0] === x && p.at[1] === y && p.id !== u.id);
        return !o ? null : (o.team === 'enemy') !== (u.team === 'enemy') ? 'foe' : 'friend';
      }),
    costMapFrom: (_u, from) => searchMoves(grid, () => 1, 124, [from % W, Math.floor(from / W)], () => null).reached,
    aiItems: itemsOf,
    forecastWith: (u, at, item, target): Forecast => {
      const theirs = itemsOf(target).find((i) => !i.staff);
      const d = dist(at, target.at);
      return {
        attacker: { canAttack: true, damage: setup.damage?.(target) ?? 3, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
        defender: { canAttack: !!theirs && d >= theirs.min && d <= theirs.max, damage: 2, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
      };
    },
    terrainScore: (_u, cell) => setup.terrain?.[cell] ?? 0,
    terrainAt: (cell) => (setup.forts?.includes(cell) ? 0x0a : 0),
    isLord: (u) => setup.lords?.includes(u.id) ?? false,
    healStaves: (u) => itemsOf(u).filter((i) => i.staff).map((i) => ({ item: i.item, heal: 10, physic: false, reach: 1, rank: 1 })),
  };
}
const unit = (id: string, team: ProjectUnit['team'], at: [number, number], ai?: Behaviour): ProjectUnit => ({ id, class: 'c', team, level: 1, at, ...(ai ? { ai } : {}) });
const play = (...units: ProjectUnit[]): PlayState => startPlay({ id: 'c', name: 'C', map: 'fe8-us/chapter-entry-0', goal: 'rout', units }, () => STATS);
const get = (s: PlayState, id: string) => s.units.find((u) => u.id === id)!;
const withHp = (s: PlayState, hp: Record<string, number>, healing = false): PlayState => ({
  ...s,
  units: s.units.map((u) => (hp[u.id] !== undefined ? { ...u, hp: hp[u.id]!, ...(healing ? { healing: true } : {}) } : u)),
});
const cell = (x: number, y: number) => y * W + x;

describe("FE8's attack choice", () => {
  it('walks to a square in reach of the foe and attacks it', () => {
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1]));
    const plan = planAction(get(s, 'e'), s, rules());
    expect(plan).toMatchObject({ attack: 'p', attackItem: 0 });
    expect(dist([plan.to % W, Math.floor(plan.to / W)], [0, 1])).toBe(1);
  });

  it("takes the square the foe can't strike back from, worth 50, over a cheaper one", () => {
    // 'e' has a javelin reaching 1 to 2; 'p' a sword. (2,1) is 1 step away but in p's reach; squares 2
    // from p cost 1 or 2 more: still better.
    const javelin: AiItem = { item: 0, staff: false, might: 5, min: 1, max: 2 };
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1]));
    const plan = planAction(get(s, 'e'), s, rules({ items: { e: [javelin] } }));
    expect(dist([plan.to % W, Math.floor(plan.to / W)], [0, 1])).toBe(2);
  });

  it("weighs the square's terrain and, between equals, keeps the first the game's scan meets", () => {
    // Beside p at (4,1), e at (5,1) can stand where it is, or on (4,0) or (4,2) 2 steps away.
    const s = play(unit('p', 'player', [4, 1]), unit('e', 'enemy', [5, 1]));
    expect(planAction(get(s, 'e'), s, rules({ terrain: { [cell(4, 0)]: 30 } })).to).toBe(cell(4, 0));
    // Without terrain, (4,0) and (4,2) still beat staying (each has e's own square, an ally, within 3,
    // worth +5 against its 2 steps); between them, the scan from the bottom right meets (4,2) first.
    expect(planAction(get(s, 'e'), s, rules()).to).toBe(cell(4, 2));
  });

  it('goes for the foe it would defeat', () => {
    const s = play(unit('p', 'player', [2, 0]), unit('e', 'enemy', [3, 1]), unit('q', 'player', [4, 2]));
    const weak = withHp(s, { q: 3 });
    expect(planAction(get(weak, 'e'), weak, rules({ damage: () => 3 })).attack).toBe('q');
  });

  it('holds its square, attacking only what it reaches from there', () => {
    const far = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1], 'hold'));
    expect(planAction(get(far, 'e'), far, rules())).toEqual({ to: cell(3, 1), route: [cell(3, 1)], attack: null });
    const near = play(unit('p', 'player', [2, 1]), unit('e', 'enemy', [3, 1], 'hold'));
    expect(planAction(get(near, 'e'), near, rules())).toMatchObject({ to: cell(3, 1), attack: 'p' });
  });

  it('lets allies hunt enemies the same way', () => {
    const s = play(unit('a', 'ally', [0, 1]), unit('x', 'enemy', [3, 1]));
    expect(planAction(get(s, 'a'), s, rules())).toMatchObject({ attack: 'x' });
  });
});

describe("FE8's movement toward enemies", () => {
  it('waits in Attack in range with nothing in reach, and charges toward the nearest enemy otherwise', () => {
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [6, 1]));
    expect(planAction(get(s, 'e'), s, rules()).to).toBe(cell(6, 1));
    const c = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [6, 1], 'charge'));
    // Of the squares it can reach, (4,1) costs the least (4) from there to p.
    expect(planAction(get(c, 'e'), c, rules())).toMatchObject({ to: cell(4, 1), attack: null });
  });
});

describe("FE8's staff use", () => {
  const staff: AiItem = { item: 0, staff: true, might: 0, min: 1, max: 1 };

  it('heals the ally set on healing with the lowest share of its HP, over attacking', () => {
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1]), unit('f', 'enemy', [4, 1]), unit('g', 'enemy', [3, 2]));
    const hurt = withHp(s, { f: 4, g: 2 }, true);
    expect(planAction(get(hurt, 'e'), hurt, rules({ items: { e: [staff, { ...SWORD, item: 1 }] } })).heal).toEqual({ target: 'g', item: 0, heal: 10 });
  });

  it("leaves alone hurt allies that aren't set on healing", () => {
    const s = withHp(play(unit('e', 'enemy', [3, 1]), unit('f', 'enemy', [4, 1])), { f: 6 });
    expect(planAction(get(s, 'e'), s, rules({ items: { e: [staff] } })).heal).toBeUndefined();
  });
});

describe('the order a phase acts in', () => {
  it('goes by movement plus 20 for melee, 40 for ranged, 72 for a staff, 87 for a lord or no weapon', () => {
    const s = play(
      unit('lord', 'enemy', [0, 0]),
      unit('healer', 'enemy', [1, 0]),
      unit('archer', 'enemy', [2, 0]),
      unit('fighter', 'enemy', [3, 0]),
      unit('hurt', 'enemy', [4, 0]),
    );
    const bow: AiItem = { item: 0, staff: false, might: 5, min: 2, max: 2 };
    const set = withHp(s, { hurt: 2 }, true);
    const r = rules({ lords: ['lord'], items: { healer: [{ ...bow, staff: true }], archer: [bow] } });
    expect(phaseOrder(set.units, set, r)).toEqual(['hurt', 'fighter', 'archer', 'healer', 'lord']);
  });
});

describe('healing itself', () => {
  it('sets on healing under half its HP and keeps on until whole', () => {
    const s = play(unit('e', 'enemy', [3, 1]));
    expect(isHealing(get(withHp(s, { e: 5 }), 'e'))).toBe(false); // 50%
    expect(isHealing(get(withHp(s, { e: 4 }), 'e'))).toBe(true);
    expect(isHealing(get(withHp(s, { e: 9 }, true), 'e'))).toBe(true); // 90%, already healing
    expect(isHealing(get(withHp(s, { e: 10 }, true), 'e'))).toBe(false);
  });

  it("adds each foe's (power + might) / 2 where it could strike, keeping the strongest weapon seen so far", () => {
    // 'p' at (0,1) with might 6 reaches 2 squares and strikes 3 away: (5 + 6) / 2 = 5. 'q' has no
    // weapon of its own but counts with p's, as in the game.
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1]), unit('q', 'player', [6, 1]));
    const danger = dangerMap(get(s, 'e'), s, rules({ items: { p: [{ ...SWORD, might: 6 }], q: [] } }), 2);
    expect(danger[cell(3, 1)]).toBe(5 + 5);
    expect(danger[cell(0, 0)]).toBe(5);
    expect(danger[cell(6, 1)]).toBe(5);
  });

  it('walks to the safest square it can reach and uses its Vulnerary there, Hold units too', () => {
    const s = withHp(play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1], 'hold')), { e: 3 }, true);
    const r = { ...rules(), selfHealItem: (u: PlayUnit) => (u.id === 'e' ? { item: 0, heal: 10 } : null) };
    const plan = planAction(get(s, 'e'), s, r);
    expect(plan.useItem).toEqual({ item: 0, heal: 10 });
    expect(dist([plan.to % W, Math.floor(plan.to / W)], [0, 1])).toBeGreaterThan(3);
  });

  it('without one, heads for a fort, attacking on arrival only a foe that can\'t strike back', () => {
    const s = withHp(play(unit('p', 'player', [0, 0]), unit('e', 'enemy', [3, 1])), { e: 3 }, true);
    const plan = planAction(get(s, 'e'), s, rules({ forts: [cell(6, 1)] }));
    expect(plan).toMatchObject({ to: cell(5, 1), attack: null });
    // Lords stay put and fight on.
    expect(planAction(get(s, 'e'), s, rules({ forts: [cell(6, 1)], lords: ['e'] })).to).not.toBe(cell(5, 1));
  });
});
