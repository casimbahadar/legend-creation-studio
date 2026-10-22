// Words the editor shows for teams, stats and behaviours.

import type { Behaviour, StatKey, Team } from '../core/project';

export const TEAM_LABELS: Record<Team, string> = { player: 'Player', enemy: 'Enemy', ally: 'Ally' };

export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export const STAT_LABELS: Record<StatKey, string> = { hp: 'HP', str: 'Str', skl: 'Skl', spd: 'Spd', lck: 'Lck', def: 'Def', res: 'Res', con: 'Con' };

export const BEHAVIOUR_LABELS: Record<Behaviour, string> = {
  'attack-in-range': 'Attack in range: waits until a target is within reach',
  charge: 'Charge: heads for the other side every turn',
  hold: 'Hold: never moves, attacks anything in reach',
};
