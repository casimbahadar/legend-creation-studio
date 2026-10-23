// The windows on the game screen, in FE8's style (decision 35): the unit under the cursor, the goal,
// the battle forecast, HP during a battle, and the damage popup; and the hint line under the controls.

import type { BattleFrame } from '../core/battle-anim';
import type { Forecast } from '../core/combat';
import type { PlayState, PlayUnit } from '../core/play';
import type { PlayView } from '../core/play-input';
import { TEAM_LABELS } from './labels';

/** What the player is in the middle of, if anything. */
export type PlayPhase = 'walk' | 'menu' | 'target' | 'battle' | 'enemy' | 'ally' | 'over' | null;

/** One line under the controls saying what to do next. */
export function PlayHint({
  play,
  selected,
  canMove,
  phase,
  label,
}: {
  play: PlayState;
  selected: PlayUnit | undefined;
  canMove: boolean;
  phase: PlayPhase;
  label: (u: PlayUnit) => string;
}) {
  const yours = play.units.filter((u) => u.team === 'player');
  const allMoved = yours.length > 0 && yours.every((u) => u.moved);
  let hint: string;
  if (phase === 'over') hint = 'The chapter is over.';
  else if (phase === 'enemy') hint = 'Enemy phase: the enemies are moving.';
  else if (phase === 'ally') hint = 'Ally phase: the green units are moving.';
  else if (phase === 'menu') hint = 'Choose Attack or Wait with ▲▼ and A, or tap it. B takes the move back.';
  else if (phase === 'target') hint = 'Choose a target with the arrows or by tapping it, then press A to attack. B goes back.';
  else if (phase === 'battle' || phase === 'walk') hint = '…';
  else if (selected && canMove) hint = `Move to a blue square and press A to move your ${label(selected)} there. Red squares are in reach of its weapons. A on the unit itself acts without moving; B cancels.`;
  else if (selected && selected.team === 'player') hint = `Your ${label(selected)} has already acted this turn. Press B to go back.`;
  else if (selected) hint = `This ${TEAM_LABELS[selected.team].toLowerCase()} ${label(selected)} can move to the blue squares and attack the red ones. Press A or B to close.`;
  else if (allMoved) hint = 'All your units have acted. Press End turn.';
  else hint = 'Move the cursor onto one of your units and press A. A on an enemy shows how far it can move.';
  return <p className="play-hint">{hint}</p>;
}

/** Where a window sits on the game screen. */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function HpBar({ hp, max }: { hp: number; max: number }) {
  return (
    <div className="hp-bar">
      <div style={{ width: `${(100 * Math.max(0, hp)) / Math.max(1, max)}%` }} />
    </div>
  );
}

/** FE's unit window: the unit under the cursor. */
export function UnitWindow({ unit, label, weapon, corner }: { unit: PlayUnit; label: string; weapon: string | undefined; corner: Corner }) {
  return (
    <div className={`fe-window unit-window team-${unit.team} at-${corner}`}>
      <strong>{label}</strong>
      <span className="hp-line">
        HP <b>{unit.hp}</b>/{unit.stats.hp}
      </span>
      <HpBar hp={unit.hp} max={unit.stats.hp} />
      <span className="small">
        Lv {unit.level} · {weapon ?? 'No weapon'}
      </span>
      <span className="small">
        Str {unit.stats.str} Skl {unit.stats.skl} Spd {unit.stats.spd} Lck {unit.stats.lck} Def {unit.stats.def} Res {unit.stats.res}
      </span>
    </div>
  );
}

/** FE's goal window: the objective, enemies left and the turn. */
export function GoalWindow({ play, corner }: { play: PlayState; corner: Corner }) {
  const left = play.units.filter((u) => u.team === 'enemy').length;
  return (
    <div className={`fe-window goal-window at-${corner}`}>
      <span>Defeat enemy</span>
      <span>
        Left <b>{left}</b> · Turn <b>{play.turn}</b>
      </span>
    </div>
  );
}

/** FE's battle forecast: each side's name, weapon, HP, damage (×2 if it strikes twice), hit and crit. */
export function ForecastWindow({
  a,
  d,
  f,
  aWeapon,
  dWeapon,
  label,
  corner,
}: {
  a: PlayUnit;
  d: PlayUnit;
  f: Forecast;
  aWeapon?: string;
  dWeapon?: string;
  label: (u: PlayUnit) => string;
  corner: Corner;
}) {
  const side = (u: PlayUnit, s: Forecast['attacker'], weapon: string | undefined) => (
    <div className={`forecast-side team-${u.team}`}>
      <strong>{label(u)}</strong>
      <span className="small">{weapon ?? 'No weapon'}</span>
      <dl>
        <dt>HP</dt>
        <dd>{u.hp}</dd>
        <dt>Mt</dt>
        <dd>{s.canAttack ? `${s.damage}${s.doubles ? ' ×2' : ''}` : '--'}</dd>
        <dt>Hit</dt>
        <dd>{s.canAttack ? s.hit : '--'}</dd>
        <dt>Crit</dt>
        <dd>{s.canAttack ? s.crit : '--'}</dd>
      </dl>
    </div>
  );
  return (
    <div className={`fe-window forecast-window at-${corner}`}>
      {side(d, f.defender, dWeapon)}
      {side(a, f.attacker, aWeapon)}
    </div>
  );
}

/** HP for both units during a battle, along the bottom of the screen as in FE's map battles. */
export function BattleHud({
  battle,
  frame,
  units,
  maxHp,
  label,
}: {
  battle: NonNullable<PlayView['battle']>;
  frame: BattleFrame;
  units: readonly PlayUnit[];
  maxHp: (id: string) => number;
  label: (u: PlayUnit) => string;
}) {
  const attacker = units.find((u) => u.id === battle.attacker);
  const defender = units.find((u) => u.id === battle.defender);
  if (!attacker || !defender) return null;
  const bar = (u: PlayUnit, hp: number) => (
    <div className={`fe-window battle-side team-${u.team}`}>
      <strong>{label(u)}</strong>
      <span className="hp-line">
        HP <b>{Math.max(0, hp)}</b>
      </span>
      <HpBar hp={hp} max={maxHp(u.id)} />
    </div>
  );
  return (
    <div className="battle-hud">
      {bar(defender, frame.defenderHp)}
      {bar(attacker, frame.attackerHp)}
    </div>
  );
}

/** The result of the last blow, shown over the unit it hit; `left` and `top` are its square on screen. */
export function BattlePopup({
  battle,
  frame,
  units,
  position,
}: {
  battle: NonNullable<PlayView['battle']>;
  frame: BattleFrame;
  units: readonly PlayUnit[];
  /** The screen position, in percent, of the top middle of a map square. */
  position: (at: readonly [number, number]) => { left: string; top: string };
}) {
  const l = frame.landed;
  if (!l) return null;
  const target = units.find((u) => u.id === (l.by === 'attacker' ? battle.defender : battle.attacker));
  if (!target) return null;
  return (
    <div key={battle.strikes.indexOf(l)} className={`popup ${l.hit ? (l.crit ? 'crit' : 'hit') : 'miss'}`} style={position(target.at)}>
      {l.hit ? (l.crit ? `Critical! ${l.damage}` : l.damage) : 'Miss'}
    </div>
  );
}
