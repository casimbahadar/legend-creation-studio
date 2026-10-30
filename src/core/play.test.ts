import { describe, expect, it } from 'vitest';
import { applyBattle, areFoes, cannotAct, clearStatus, doorsBeside, endTurn, finishAction, moveUnit, openWithKey, outcomeOf, setBarrier, setStatus, spendUses, startPlay, tickStatuses, unitAt, visitPlace, type PlayPlace } from './play';
import type { Stats } from './combat';
import type { ProjectChapter } from './project';

const STATS: Stats = { hp: 18, str: 5, skl: 5, spd: 5, def: 3, res: 1, lck: 2, con: 6 };
const statsOf = () => STATS;

const chapter: ProjectChapter = {
  id: 'c',
  name: 'C',
  map: 'fe8-us/chapter-entry-0',
  goal: 'rout',
  units: [
    { id: 'eirika', class: 'lord-eirika', team: 'player', level: 1, at: [1, 1], items: ['rapier'] },
    { id: 'brigand-1', class: 'brigand', team: 'enemy', level: 1, at: [5, 5] },
  ],
};

describe('play session', () => {
  it('starts from the chapter without changing it', () => {
    const s = startPlay(chapter, statsOf);
    expect(unitAt(s, 1, 1)).toMatchObject({ id: 'eirika', hp: 18, level: 1, items: ['rapier'], moved: false });
    const moved = moveUnit(s, 'eirika', [2, 1]);
    expect(unitAt(moved, 2, 1)).toMatchObject({ id: 'eirika', moved: false });
    expect(unitAt(finishAction(moved, 'eirika'), 2, 1)?.moved).toBe(true);
    expect(chapter.units[0]!.at).toEqual([1, 1]);
  });

  it("spends an item's uses and drops it once none are left", () => {
    const two = { ...chapter, units: [{ ...chapter.units[0]!, items: ['rapier', 'vulnerary', 'iron-sword'] }, chapter.units[1]!] };
    const s = startPlay(two, statsOf, undefined, (item) => (item === 'rapier' ? 2 : item === 'iron-sword' ? 46 : null));
    expect(unitAt(s, 1, 1)?.uses).toEqual([2, null, 46]);
    const once = spendUses(s, 'eirika', 0, 1);
    expect(unitAt(once, 1, 1)).toMatchObject({ items: ['rapier', 'vulnerary', 'iron-sword'], uses: [1, null, 46] });
    const broken = spendUses(once, 'eirika', 0, 1);
    expect(unitAt(broken, 1, 1)).toMatchObject({ items: ['vulnerary', 'iron-sword'], uses: [null, 46] });
    // An item that never runs out stays as it is.
    expect(spendUses(broken, 'eirika', 0, 5)).toEqual(broken);
  });

  it('applies a fight and removes the fallen', () => {
    const s = applyBattle(startPlay(chapter, statsOf), 'eirika', 'brigand-1', 12, 0);
    expect(s.units).toHaveLength(1);
    expect(s.units[0]).toMatchObject({ id: 'eirika', hp: 12, moved: true });
  });

  it('readies every unit at the end of the turn', () => {
    const s = endTurn(finishAction(startPlay(chapter, statsOf), 'eirika'));
    expect(s.turn).toBe(2);
    expect(s.units.every((u) => !u.moved)).toBe(true);
  });

  it('puts player and ally on the same side', () => {
    expect(areFoes('player', 'ally')).toBe(false);
    expect(areFoes('player', 'enemy')).toBe(true);
    expect(areFoes('ally', 'enemy')).toBe(true);
    expect(areFoes('enemy', 'enemy')).toBe(false);
  });

  it('wins when every enemy has fallen and loses with a Must survive unit or the whole army', () => {
    const marked = { ...chapter, units: chapter.units.map((u) => (u.id === 'eirika' ? { ...u, mustSurvive: true } : u)) };
    const s = startPlay(marked, statsOf);
    expect(outcomeOf(s)).toBeNull();
    expect(outcomeOf(applyBattle(s, 'eirika', 'brigand-1', 18, 0))).toEqual({ result: 'victory' });
    const lost = outcomeOf(applyBattle(s, 'brigand-1', 'eirika', 18, 0));
    expect(lost).toMatchObject({ result: 'defeat', fallen: { id: 'eirika' } });
    const unmarked = startPlay(chapter, statsOf);
    expect(outcomeOf(applyBattle(unmarked, 'brigand-1', 'eirika', 18, 0))).toEqual({ result: 'defeat', fallen: null });
  });
});

describe('statuses', () => {
  it("last five of the unit's own phases: each start takes one off, and the fifth ends it", () => {
    let s = setStatus(startPlay(chapter, statsOf), 'eirika', 'sleep');
    expect(unitAt(s, 1, 1)?.status).toEqual({ kind: 'sleep', turns: 5 });
    s = tickStatuses(s, 'enemy');
    expect(unitAt(s, 1, 1)?.status?.turns).toBe(5);
    for (const left of [4, 3, 2, 1]) {
      s = tickStatuses(s, 'player');
      expect(unitAt(s, 1, 1)?.status).toEqual({ kind: 'sleep', turns: left });
    }
    s = tickStatuses(s, 'player');
    expect(unitAt(s, 1, 1)).not.toHaveProperty('status');
  });

  it('Restore clears a status; Barrier gives 7 Res, a point less at each of its side\'s phase starts', () => {
    const s = setBarrier(setStatus(startPlay(chapter, statsOf), 'eirika', 'silence'), 'eirika');
    expect(unitAt(clearStatus(s, 'eirika'), 1, 1)).not.toHaveProperty('status');
    expect(unitAt(s, 1, 1)?.barrier).toBe(7);
    expect(unitAt(tickStatuses(s, 'enemy'), 1, 1)?.barrier).toBe(7);
    expect(unitAt(tickStatuses(tickStatuses(s, 'player'), 'player'), 1, 1)?.barrier).toBe(5);
  });

  it('keeps asleep and berserk units from acting, but not silenced ones', () => {
    const s = startPlay(chapter, statsOf);
    expect(cannotAct(unitAt(setStatus(s, 'eirika', 'sleep'), 1, 1)!)).toBe(true);
    expect(cannotAct(unitAt(setStatus(s, 'eirika', 'berserk'), 1, 1)!)).toBe(true);
    expect(cannotAct(unitAt(setStatus(s, 'eirika', 'silence'), 1, 1)!)).toBe(false);
  });
});

describe('doors, chests, villages and houses', () => {
  // Eirika at (1, 1) with a key of 3 uses: doors left of and above her, one further off, a chest of a
  // Vulnerary under her, a village of 500 gold and a house that says something and gives an Elixir.
  const places: PlayPlace[] = [
    { kind: 'door', at: [0, 1] },
    { kind: 'door', at: [1, 0] },
    { kind: 'door', at: [3, 1] },
    { kind: 'chest', at: [1, 1], item: 'vulnerary' },
    { kind: 'village', at: [2, 2], gold: 500, text: 'Take this.' },
    { kind: 'house', at: [3, 3], item: 'elixir', text: 'Hello.' },
  ];
  const keyed: ProjectChapter = { ...chapter, units: [{ ...chapter.units[0]!, items: ['rapier', 'door-key'] }, chapter.units[1]!] };
  const usesOf = (item: string) => (item === 'door-key' ? 3 : item === 'vulnerary' ? 3 : null);
  const s = startPlay(keyed, statsOf, () => null, usesOf, places);

  it('opens every closed door beside the unit and its chest with one use of a key (ExecKeyItem)', () => {
    expect(doorsBeside(s, [1, 1]).map((p) => p.at)).toEqual([[0, 1], [1, 0]]);
    const { state, found } = openWithKey(s, 'eirika', 1, usesOf);
    expect(state.places!.filter((p) => p.done).map((p) => p.at)).toEqual([[0, 1], [1, 0], [1, 1]]);
    expect(unitAt(state, 1, 1)).toMatchObject({ items: ['rapier', 'door-key', 'vulnerary'], uses: [null, 2, 3] });
    expect(found).toEqual({ kind: 'chest', unit: 'eirika', item: 'vulnerary' });
    expect(doorsBeside(state, [1, 1])).toEqual([]);
  });

  it('gives a village\'s gold to the party, once, and leaves an item behind when the unit has no room', () => {
    const there = moveUnit(s, 'eirika', [2, 2]);
    const { state, found } = visitPlace(there, 'eirika');
    expect([state.gold, found]).toEqual([500, { kind: 'village', unit: 'eirika', text: 'Take this.', gold: 500 }]);
    expect(visitPlace(state, 'eirika').found).toBeNull();
    const full = { ...moveUnit(s, 'eirika', [3, 3]) };
    const packed = { ...full, units: full.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['a', 'b', 'c', 'd', 'e'], uses: [null, null, null, null, null] } : u)) };
    const visit = visitPlace(packed, 'eirika');
    expect(visit.found).toEqual({ kind: 'house', unit: 'eirika', text: 'Hello.', item: 'elixir', full: true });
    expect(unitAt(visit.state, 3, 3)!.items).toHaveLength(5);
  });
});

