// The windows on the game screen, in FE8's style (decision 35): the unit under the cursor, the goal,
// the battle forecast, HP during a battle, and the damage popup; and the hint line under the controls.

import { useContext, type ReactNode } from 'react';
import type { BattleFrame } from '../core/battle-anim';
import type { Forecast } from '../core/combat';
import type { PlayState, PlayUnit } from '../core/play';
import type { PlayView } from '../core/play-input';
import { FeText } from './FeText';
import { goalBox, MapBox, Place, unitBox, WindowArtContext } from './FeWindow';
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

/**
 * FE's unit window: the unit under the cursor, its portrait (when it has one), name and HP. With the
 * ROM's art, laid out as DrawUnitMapUi lays it out: the portrait at tile (1, 1), the name in black
 * centred in 56 pixels at tile (5, 1), HP on tile row 3 and its bar on row 4.
 */
export function UnitWindow({ unit, label, corner, portrait }: { unit: PlayUnit; label: string; corner: Corner; portrait?: ReactNode }) {
  const art = useContext(WindowArtContext);
  const b = art && unitBox(art, unit.team);
  if (b)
    return (
      <MapBox box={b} className={`unit-box at-${corner}`}>
        <Place box={b} x={8} y={8}>
          {portrait}
        </Place>
        <Place box={b} x={40} y={8} width={56}>
          <FeText text={label} colour="black" />
        </Place>
        <Place box={b} x={40} y={20}>
          <span className="fe-line">
            <FeText text="HP" colour="gold" />
            <FeText text={` ${unit.hp}/${unit.stats.hp}`} />
          </span>
        </Place>
        <Place box={b} x={40} y={33} width={56}>
          <HpBar hp={unit.hp} max={unit.stats.hp} />
        </Place>
      </MapBox>
    );
  return (
    <div className={`fe-window unit-window team-${unit.team} at-${corner}`}>
      {portrait}
      <div className="unit-window-text">
        <span className="fe-line">
          <FeText text={label} />
        </span>
        <span className="fe-line">
          <FeText text="HP" colour="gold" />
          <FeText text={` ${unit.hp}/${unit.stats.hp}`} />
        </span>
        <HpBar hp={unit.hp} max={unit.stats.hp} />
      </div>
    </div>
  );
}

/** The rest of what FE shows on its status screen, in a strip under the game screen: level, weapon and stats. */
export function UnitStrip({ unit, weapon }: { unit: PlayUnit | undefined; weapon: string | undefined }) {
  return (
    <div className={`unit-strip${unit ? ` team-${unit.team}` : ''}`} aria-live="polite">
      {unit && (
        <span className="fe-line">
          <FeText text="Lv" colour="gold" />
          <FeText text={` ${unit.level}  ${weapon ?? 'No weapon'}   `} />
          {(['str', 'skl', 'spd', 'lck', 'def', 'res'] as const).map((k) => (
            <span key={k} className="fe-stat">
              <FeText text={k[0]!.toUpperCase() + k.slice(1)} colour="gold" />
              <FeText text={` ${unit.stats[k]}  `} />
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * FE's goal window: the objective, enemies left and (in the look-alike) the turn. With the ROM's art, as GoalDisplay_Init
 * draws a rout goal: the objective centred in 64 pixels at tile (1, 1) of the box (its text buffer is
 * copied two rows above the box's), and below it "Left" at 16 pixels and the count in blue ending in
 * the 8 pixels from 48.
 */
export function GoalWindow({ play, corner }: { play: PlayState; corner: Corner }) {
  const left = play.units.filter((u) => u.team === 'enemy').length;
  const art = useContext(WindowArtContext);
  const b = art && goalBox(art, 2);
  if (b)
    return (
      <MapBox box={b} className={`goal-box at-${corner}`}>
        <Place box={b} x={8} y={8} width={64}>
          <FeText text="Defeat enemy" />
        </Place>
        <Place box={b} x={24} y={24}>
          <FeText text="Left" />
        </Place>
        {/* Text_DrawNumber puts the last digit at 48 and each earlier one 8 pixels to its left. */}
        <Place box={b} x={40} y={24} width={16} align="right">
          <FeText text={left} colour="blue" />
        </Place>
      </MapBox>
    );
  return (
    <div className={`fe-window goal-window at-${corner}`}>
      <span className="fe-line">
        <FeText text="Defeat enemy" />
      </span>
      <span className="fe-line">
        <FeText text="Left" colour="gold" />
        <FeText text={` ${left}  `} />
        <FeText text="Turn" colour="gold" />
        <FeText text={` ${play.turn}`} />
      </span>
    </div>
  );
}

/**
 * FE8's battle forecast: the unit attacked on top and the attacker below, each with its weapon, and
 * between them a row per stat, the label in the middle and each side's value beside it (damage ×2 if
 * it strikes twice).
 */
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
  const value = (s: Forecast['attacker'], v: number | string) => (s.canAttack ? String(v) : '--');
  const rows: [string, string, string][] = [
    ['HP', String(d.hp), String(a.hp)],
    ['Mt', value(f.defender, `${f.defender.damage}${f.defender.doubles ? 'x2' : ''}`), value(f.attacker, `${f.attacker.damage}${f.attacker.doubles ? 'x2' : ''}`)],
    ['Hit', value(f.defender, f.defender.hit), value(f.attacker, f.attacker.hit)],
    ['Crit', value(f.defender, f.defender.crit), value(f.attacker, f.attacker.crit)],
  ];
  return (
    <div className={`fe-window forecast-window at-${corner}`}>
      <div className={`forecast-head team-${d.team}`}>
        <FeText text={label(d)} />
        <FeText text={dWeapon ?? 'No weapon'} />
      </div>
      <div className="forecast-rows">
        {rows.map(([k, dv, av]) => (
          <div key={k} className="forecast-row">
            <FeText text={dv} />
            <FeText text={k} colour="gold" />
            <FeText text={av} />
          </div>
        ))}
      </div>
      <div className={`forecast-head team-${a.team}`}>
        <FeText text={aWeapon ?? 'No weapon'} />
        <FeText text={label(a)} />
      </div>
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
      <span className="fe-line">
        <FeText text={label(u)} />
      </span>
      <span className="fe-line">
        <FeText text="HP" colour="gold" />
        <FeText text={` ${Math.max(0, hp)}`} />
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
