// The windows on the game screen, in FE8's style (decision 35): the unit under the cursor, the goal,
// the battle forecast, HP during a battle, and the damage popup; and the hint line under the controls.

import { Fragment, useContext, type CSSProperties, type ReactNode } from 'react';
import type { BattleFrame } from '../core/battle-anim';
import type { Forecast } from '../core/combat';
import { cannotAct, type PlayState, type PlayUnit } from '../core/play';
import type { PlayView } from '../core/play-input';
import type { StatGains } from '../core/experience';
import { levelUpAt } from '../core/battle-anim';
import {
  FE8U_LEVEL_UP_TEXT_AP,
  FE8U_STAT_GAIN_AP,
  LEVEL_UP_LAYOUT,
  LEVEL_UP_SPRITE_PALETTE,
  LEVEL_UP_TEXT_TILE,
  STAT_GAIN_TILE,
  statGainPalettes,
  statGainTiles,
  type LevelUpSprites,
  type LevelUpStat,
} from '../rom/fe8-levelup';
import type { GbaRom } from '../rom/gba-rom';
import { ApSprite } from './ApSprite';
import type { GameItem } from '../play/catalog';
import type { TextColour } from '../rom/fe8-font';
import { FeText } from './FeText';
import { expBarUrl, gbaPx, goalBox, MapBox, Place, unitBox, WindowArtContext, type Box } from './FeWindow';
import { EXP_BAR_X, EXP_BAR_Y, expBarOpening, type ExpBarArt } from '../rom/fe8-expbar';
import { TEAM_LABELS } from './labels';

/** What the player is in the middle of, if anything. */
export type PlayPhase = 'walk' | 'menu' | 'weapon' | 'staves' | 'items' | 'item' | 'target' | 'heal' | 'tradeWith' | 'trade' | 'stealFrom' | 'steal' | 'staffTarget' | 'battle' | 'enemy' | 'ally' | 'over' | null;

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
  // Units asleep or berserk can't act, as FE8 counts (GetPhaseAbleUnitCount).
  const allMoved = yours.length > 0 && yours.every((u) => u.moved || cannotAct(u));
  let hint: string;
  if (phase === 'over') hint = 'The chapter is over.';
  else if (phase === 'enemy') hint = 'Enemy phase: the enemies are moving.';
  else if (phase === 'ally') hint = 'Ally phase: the green units are moving.';
  else if (phase === 'menu') hint = 'Choose an action with ▲▼ and A, or tap it. B takes the move back.';
  else if (phase === 'tradeWith') hint = 'Choose whom to trade with, then press A. B goes back.';
  else if (phase === 'trade') hint = 'Choose an item, then an item or empty slot on the other side to swap or give it. B steps back.';
  else if (phase === 'stealFrom') hint = 'Choose whom to steal from, then press A. B goes back.';
  else if (phase === 'steal') hint = "Choose the item to steal and press A; weapons and staves can't be stolen. B goes back.";
  else if (phase === 'staves') hint = 'Choose the staff to heal with, then whom to heal. B goes back.';
  else if (phase === 'staffTarget') hint = 'Choose a target for the staff with the arrows or by tapping it, then press A. B goes back.';
  else if (phase === 'heal') hint = 'Choose whom to heal with the arrows or by tapping them, then press A. B goes back.';
  else if (phase === 'weapon') hint = 'Choose the weapon to attack with, then a target. B goes back.';
  else if (phase === 'items') hint = 'Choose an item with ▲▼ and A, or tap it. B goes back.';
  else if (phase === 'item') hint = 'Equip puts a weapon first, so the unit fights with it. Use heals and ends the turn. B goes back.';
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
 * centred in 56 pixels at tile (5, 1) and HP on tile row 3. The game's HP bar is left out: the
 * numbers say the same.
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
            {/* In black like the name: white text on the light box shows only its outline. */}
            <FeText text={` ${unit.hp}/${unit.stats.hp}`} colour="black" />
          </span>
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
      </div>
    </div>
  );
}

/** The rest of what FE shows on its status screen, in a strip under the game screen: level, experience, weapon and its uses, and stats. */
export function UnitStrip({ unit, weapon }: { unit: PlayUnit | undefined; weapon: GameItem | undefined }) {
  const index = unit && weapon ? unit.items.indexOf(weapon.entry.name) : -1;
  const uses = unit && index >= 0 ? unit.uses[index] : null;
  return (
    <div className={`unit-strip${unit ? ` team-${unit.team}` : ''}`} aria-live="polite">
      {unit && (
        <span className="fe-line">
          <FeText text="Lv" colour="gold" />
          <FeText text={` ${unit.level} `} />
          <FeText text="E" colour="gold" />
          <FeText text={` ${unit.exp ?? '--'}  ${weapon?.entry.gameName ?? 'No weapon'}${uses !== null && uses !== undefined ? ` ${uses}` : ''}   `} />
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
/**
 * Text_DrawNumber at x `x` of a line of text (which starts 8 pixels into the box): the last digit
 * there, each earlier one 8 pixels to its left.
 */
function NumberAt({ box, x, y, n, colour }: { box: Box; x: number; y: number; n: number; colour: TextColour }) {
  return (
    <>
      {[...String(n)].reverse().map((d, i) => (
        <Place key={i} box={box} x={8 + x - 8 * i} y={y}>
          <FeText text={d} colour={colour} />
        </Place>
      ))}
    </>
  );
}

/**
 * FE8's goal window (GoalDisplay_Init): the goal's text, and on a second line the enemies left for
 * Rout, or for Survive the turn out of the last one ("Last Turn" once it comes). Seize and Defeat boss
 * have the one line. `text` is the first line (goalWindowText).
 */
export function GoalWindow({ play, text, corner }: { play: PlayState; text: string; corner: Corner }) {
  const goal = play.goal ?? { kind: 'rout' };
  const left = play.units.filter((u) => u.team === 'enemy').length;
  const lastTurn = goal.kind === 'survive' && play.turn >= goal.turns;
  const art = useContext(WindowArtContext);
  const b = art && goalBox(art, goal.kind === 'seize' || goal.kind === 'boss' ? 1 : 2);
  if (b)
    return (
      <MapBox box={b} className={`goal-box at-${corner}`}>
        <Place box={b} x={8} y={8} width={64}>
          <FeText text={text} />
        </Place>
        {goal.kind === 'rout' && (
          <>
            <Place box={b} x={24} y={24}>
              <FeText text="Left" />
            </Place>
            <NumberAt box={b} x={48} y={24} n={left} colour="blue" />
          </>
        )}
        {goal.kind === 'survive' &&
          (lastTurn ? (
            <Place box={b} x={8} y={24} width={64}>
              <FeText text="Last Turn" colour="green" />
            </Place>
          ) : (
            <>
              <NumberAt box={b} x={10} y={24} n={play.turn} colour="blue" />
              <Place box={b} x={26} y={24}>
                <FeText text="/" />
              </Place>
              <NumberAt box={b} x={34} y={24} n={goal.turns} colour="blue" />
              <Place box={b} x={50} y={24}>
                <FeText text="Turn" />
              </Place>
            </>
          ))}
      </MapBox>
    );
  return (
    <div className={`fe-window goal-window at-${corner}`}>
      <span className="fe-line">
        <FeText text={text} />
      </span>
      {goal.kind === 'rout' && (
        <span className="fe-line">
          <FeText text="Left" colour="gold" />
          <FeText text={` ${left}  `} />
          <FeText text="Turn" colour="gold" />
          <FeText text={` ${play.turn}`} />
        </span>
      )}
      {goal.kind === 'survive' && (
        <span className="fe-line">
          {lastTurn ? (
            <FeText text="Last Turn" colour="green" />
          ) : (
            <>
              <FeText text={play.turn} colour="blue" />
              <FeText text={`/${goal.turns} `} />
              <FeText text="Turn" colour="gold" />
            </>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * FE8's battle forecast: the unit attacked on top and the attacker below, each with its weapon, and
 * between them a row per stat, the label in the middle and each side's value beside it (damage ×2 if
 * it strikes twice). Each side's name and values are in its team's colour, so red and blue tell the
 * two apart.
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
            <span className={`forecast-value team-${d.team}`}>
              <FeText text={dv} />
            </span>
            <FeText text={k} colour="gold" />
            <span className={`forecast-value team-${a.team}`}>
              <FeText text={av} />
            </span>
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

/** FE's experience window after a fight: the bar filling as the unit gains experience. */
/**
 * FE8's experience bar: with the game's art, its box at the game's place on the screen (tile 6, 8),
 * opening from its middle row out; otherwise a look-alike window.
 */
export function ExpWindow({ exp, frame, art }: { exp: number; frame: number; art: ExpBarArt | null }) {
  if (art) {
    const hidden = ((1 - expBarOpening(frame)) / 2) * 100;
    return (
      <img
        className="exp-bar-box"
        src={expBarUrl(art, exp)}
        alt={`EXP ${exp}`}
        style={{ left: gbaPx(EXP_BAR_X), top: gbaPx(EXP_BAR_Y), width: gbaPx(136), height: gbaPx(24), clipPath: `inset(${hidden}% 0 ${hidden}% 0)` }}
      />
    );
  }
  return (
    <div className="fe-window exp-window">
      <span className="fe-line">
        <FeText text="EXP" colour="gold" />
        <span className="exp-bar">
          <span style={{ width: `${exp}%` }} />
        </span>
        <FeText text={exp} />
      </span>
    </div>
  );
}

const LEVEL_UP_STATS = [
  ['hp', 'HP'],
  ['str', 'Str'],
  ['skl', 'Skl'],
  ['spd', 'Spd'],
  ['lck', 'Lck'],
  ['def', 'Def'],
  ['res', 'Res'],
] as const;

/** The gains a level-up shows a label for, in FE8's order: the level's always, then each stat that rose. */
export function levelUpLabels(gains: StatGains): LevelUpStat[] {
  return LEVEL_UP_LAYOUT.map((l) => l.stat).filter((k) => k === 'level' || (k !== 'con' && gains[k] !== 0));
}

/**
 * FE8's map level-up with the game's box (decision 35): "LEVEL UP" over the unit, then the box
 * scrolling up with the class name, the level and stats written as the game writes them (gold labels,
 * blue values, a digit to a tile), each gain's value rising as its label appears, and the unit's
 * portrait. The game's own "LEVEL UP" and gain labels (sprite animations) come later; look-alikes
 * stand in for them.
 */
export function LevelUpScreen({
  box,
  unit,
  className,
  magic,
  level,
  gains,
  frame,
  at,
  face,
  sprites,
}: {
  box: string;
  unit: PlayUnit;
  className: string;
  magic: boolean;
  /** The level before. */
  level: number;
  gains: StatGains;
  frame: number;
  /** The unit's square on the screen. */
  at: readonly [number, number];
  /** Its full face, if it has one. */
  face?: string | null;
  /** The game's LEVEL UP and gain label animations, with the ROM they're read from; look-alikes without. */
  sprites?: { readonly rom: GbaRom; readonly art: LevelUpSprites } | null;
}) {
  const labels = levelUpLabels(gains);
  const f = levelUpAt(frame, labels.length);
  if (f.stage === 'text') {
    // Where ManimLevelUp_StartLevelUpText puts it: beside the unit, kept on the screen.
    const x = at[0] < 2 ? 48 : at[0] >= 13 ? 208 : at[0] * 16 + 16;
    const y = at[1] * 16 - 8 + (at[1] < 2 ? 32 : 0);
    if (sprites) {
      const pals = sprites.art.palettes;
      return (
        <ApSprite
          rom={sprites.rom}
          at={FE8U_LEVEL_UP_TEXT_AP}
          anim={0}
          t={frame - 2}
          x={x}
          y={y}
          sheet={sprites.art.text}
          firstTile={LEVEL_UP_TEXT_TILE}
          tileBase={LEVEL_UP_TEXT_TILE | (LEVEL_UP_SPRITE_PALETTE << 12)}
          palettes={(n) => pals[n - LEVEL_UP_SPRITE_PALETTE]}
          look="text"
        />
      );
    }
    return (
      <div className="level-up-text" style={{ left: gbaPx(x), top: gbaPx(y) }}>
        <FeText text="LEVEL UP" colour="gold" />
      </div>
    );
  }
  if (f.stage !== 'box') return null;
  const shown = new Set(labels.slice(0, f.labels));
  const valueOf = (k: LevelUpStat) => (k === 'level' ? level + (shown.has(k) ? 1 : 0) : unit.stats[k] + (k !== 'con' && shown.has(k) ? gains[k] : 0));
  const at8 = (x: number, y: number): CSSProperties => ({ left: gbaPx(x * 8), top: gbaPx(y * 8) });
  return (
    <div className="level-up-box" style={{ top: gbaPx(f.top), backgroundImage: `url(${box})` }} role="status" aria-label="Level up">
      {/* StartFace(0, ..., 184, 32 - scroll): its top centre at x 184, 32 below the box's top. */}
      {face && <img className="level-up-face" src={face} alt="" style={{ left: gbaPx(184 - 48), top: gbaPx(32), width: gbaPx(96), height: gbaPx(80) }} />}
      <span className="level-up-item" style={at8(3, 1)}>
        <FeText text={className} />
      </span>
      {LEVEL_UP_LAYOUT.map((l) => {
        const digits = [...String(valueOf(l.stat))].reverse();
        const gain = l.stat === 'level' || l.stat === 'con' ? 0 : gains[l.stat];
        return (
          <Fragment key={l.stat}>
            <span className="level-up-item centre" style={{ ...at8(1 + l.x, 1 + l.y), width: gbaPx(24) }}>
              <FeText text={magic && l.magic ? l.magic : l.label} colour="gold" />
            </span>
            {digits.map((d, i) => (
              <span key={i} className="level-up-item" style={at8(1 + l.x + 4 - i, 1 + l.y)}>
                <FeText text={d} colour="blue" />
              </span>
            ))}
            {shown.has(l.stat) && sprites && gainLabels(sprites, LEVEL_UP_LAYOUT.indexOf(l), gain, frame - labelStart(labels.indexOf(l.stat)), frame - 74, l.x * 8 + 62, l.y * 8 + 23)}
            {shown.has(l.stat) && !sprites && gain > 0 && (
              <span className="level-up-item gain" style={{ left: gbaPx((l.x + 5) * 8 + 10), top: gbaPx((1 + l.y) * 8) }}>
                <FeText text={`+${gain}`} colour="green" />
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** The frame the `k`th gain label appears on (ManimLevelUp_PutStatGainLabels, from frame 116, 21 apart). */
const labelStart = (k: number) => 116 + 21 * k;

/**
 * A stat's gain label as StartManimLevelUpStatGainLabelAnim puts it together at (x, y) on the box: for
 * the level, animation 0 (18 left and 4 up); for a stat that rose, animation 1 there, animation 3 with
 * the stat's own tiles holding the gain's digit 3 to the left, and animation 0. `t` counts from the
 * label's start, `clock` from the labels' (for the cycling colours).
 */
function gainLabels(sprites: { rom: GbaRom; art: LevelUpSprites }, stat: number, gain: number, t: number, clock: number, x: number, y: number) {
  const palettes = statGainPalettes(sprites.art, clock);
  const step = clock < 4 ? -1 : Math.floor(clock / 4) & 15;
  const common = STAT_GAIN_TILE | (LEVEL_UP_SPRITE_PALETTE << 12);
  const sprite = (anim: number, dx: number, dy: number, sheet: Uint8Array, tileBase: number, look: string) => (
    <ApSprite rom={sprites.rom} at={FE8U_STAT_GAIN_AP} anim={anim} t={t} x={x + dx} y={y + dy} sheet={sheet} firstTile={STAT_GAIN_TILE} tileBase={tileBase} palettes={palettes} look={`${look}:${step}`} />
  );
  if (stat === 0) return sprite(0, -18, -4, sprites.art.gain, common, 'gain');
  if (gain <= 0) return null;
  return (
    <>
      {sprite(1, 0, 0, sprites.art.gain, common, 'gain')}
      {sprite(3, -3, 0, statGainTiles(sprites.art, stat, gain), (STAT_GAIN_TILE + (stat - 1) * 2) | (LEVEL_UP_SPRITE_PALETTE << 12), `stat${stat}+${gain}`)}
      {sprite(0, -18, -4, sprites.art.gain, common, 'gain')}
    </>
  );
}

/** FE's level-up window: the unit's new level and stats, each stat that rose marked with its gain. */
export function LevelUpWindow({ unit, label, level, gains }: { unit: PlayUnit; label: string; level: number; gains: StatGains }) {
  return (
    <div className="fe-window level-up-window" role="status">
      <span className="fe-line level-up-head">
        <FeText text={label} />
        <FeText text="  Lv" colour="gold" />
        <FeText text={` ${level}`} />
      </span>
      <div className="level-up-stats">
        {LEVEL_UP_STATS.map(([k, name]) => (
          <span key={k} className="fe-line">
            <FeText text={name} colour="gold" />
            <FeText text={` ${unit.stats[k] + gains[k]}`} />
            {gains[k] > 0 && <FeText text={` +${gains[k]}`} colour="blue" />}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The heal a staff will give, shown while choosing whom to heal: the ally, its HP now and after. */
export function HealWindow({ unit, label, heal, staff, corner }: { unit: PlayUnit; label: string; heal: number; staff: string | undefined; corner: Corner }) {
  return (
    <div className={`fe-window heal-window at-${corner}`}>
      <span className="fe-line">
        <FeText text={label} />
      </span>
      {staff && (
        <span className="fe-line">
          <FeText text={staff} />
        </span>
      )}
      <span className="fe-line">
        <FeText text="HP" colour="gold" />
        <FeText text={` ${unit.hp} `} />
        <FeText text="->" colour="gold" />
        <FeText text={` ${Math.min(unit.stats.hp, unit.hp + heal)}`} />
      </span>
    </div>
  );
}
