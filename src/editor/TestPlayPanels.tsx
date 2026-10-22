// The windows around the map in test play: the turn and hint line, the battle forecast, HP bars
// during a battle, and the damage popup.

import type { BattleFrame } from '../core/battle-anim';
import type { Forecast } from '../core/combat';
import type { PlayState, PlayUnit } from '../core/play';
import type { PlayView } from '../core/play-input';
import { TEAM_LABELS } from './labels';

export function PlayStatus({
  play,
  selected,
  canMove,
  phase,
  label,
  onEndTurn,
}: {
  play: PlayState;
  selected: PlayUnit | undefined;
  canMove: boolean;
  /** What the player is in the middle of, if anything. */
  phase: 'walk' | 'menu' | 'target' | 'battle' | 'enemy' | 'ally' | 'over' | null;
  label: (u: PlayUnit) => string;
  onEndTurn: () => void;
}) {
  const yours = play.units.filter((u) => u.team === 'player');
  const allMoved = yours.length > 0 && yours.every((u) => u.moved);
  let hint: string;
  if (phase === 'over') hint = 'The chapter is over. Play again, or go back to editing.';
  else if (phase === 'enemy') hint = 'Enemy phase: the enemies are moving.';
  else if (phase === 'ally') hint = 'Ally phase: the green units are moving.';
  else if (phase === 'menu') hint = 'Choose Attack or Wait with ▲▼ and A, or tap it. B takes the move back.';
  else if (phase === 'target') hint = 'Choose a target with the arrows or by tapping it, then press A to attack. B goes back.';
  else if (phase === 'battle' || phase === 'walk') hint = '…';
  else if (selected && canMove) hint = `Move the cursor to a blue square and press A to move your ${label(selected)} there. Red squares are in reach of its weapons. Press A on the unit itself to act without moving, or B to cancel.`;
  else if (selected && selected.team === 'player') hint = `Your ${label(selected)} has already acted this turn. Press B to go back.`;
  else if (selected) hint = `This ${TEAM_LABELS[selected.team].toLowerCase()} ${label(selected)} can move to the blue squares and attack the red ones. Press A or B to close.`;
  else if (allMoved) hint = 'All your units have acted. Tap End turn.';
  else hint = 'Move the cursor onto one of your units and press A. Press A on an enemy to see how far it can move.';
  return (
    <div className="play-status">
      <p>
        <strong>Turn {play.turn}.</strong> {hint}
      </p>
      <div className="stepper">
        <button type="button" className="button" disabled={phase !== null} onClick={onEndTurn}>
          End turn
        </button>
      </div>
    </div>
  );
}

/** FE's battle forecast: each side's weapon, HP, damage (×2 if it strikes twice), hit and crit. */
export function ForecastBox({
  a,
  d,
  f,
  aWeapon,
  dWeapon,
  label,
}: {
  a: PlayUnit;
  d: PlayUnit;
  f: Forecast;
  aWeapon?: string;
  dWeapon?: string;
  label: (u: PlayUnit) => string;
}) {
  const col = (u: PlayUnit, s: Forecast['attacker'], weapon: string | undefined) => (
    <div className={`window-side team-${u.team}`}>
      <strong>{label(u)}</strong>
      <span>
        {weapon ?? 'No weapon'} · HP {u.hp}
      </span>
      <span>{s.canAttack ? `Dmg ${s.damage}${s.doubles ? ' ×2' : ''} · Hit ${s.hit} · Crit ${s.crit}` : "Can't counter"}</span>
    </div>
  );
  return (
    <>
      {col(a, f.attacker, aWeapon)}
      {col(d, f.defender, dWeapon)}
    </>
  );
}

/** HP bars for both units during a battle. */
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
    <div className={`window-side team-${u.team}`}>
      <strong>{label(u)}</strong>
      <span>HP {hp}</span>
      <div className="hp-bar">
        <div style={{ width: `${(100 * hp) / maxHp(u.id)}%` }} />
      </div>
    </div>
  );
  return (
    <>
      {bar(attacker, frame.attackerHp)}
      {bar(defender, frame.defenderHp)}
    </>
  );
}

/** The result of the last blow, shown over the unit it hit. */
export function BattlePopup({
  battle,
  frame,
  units,
  width,
  height,
}: {
  battle: NonNullable<PlayView['battle']>;
  frame: BattleFrame;
  units: readonly PlayUnit[];
  width: number;
  height: number;
}) {
  const l = frame.landed;
  if (!l) return null;
  const target = units.find((u) => u.id === (l.by === 'attacker' ? battle.defender : battle.attacker));
  if (!target) return null;
  return (
    <div
      key={battle.strikes.indexOf(l)}
      className={`popup ${l.hit ? (l.crit ? 'crit' : 'hit') : 'miss'}`}
      style={{ left: `${((target.at[0] + 0.5) / width) * 100}%`, top: `${(target.at[1] / height) * 100}%` }}
    >
      {l.hit ? (l.crit ? `Critical! ${l.damage}` : l.damage) : 'Miss'}
    </div>
  );
}
