// Playing a chapter on an FE8-style game screen (decision 35): 15 x 10 squares of the map that scroll
// with the cursor, with units, ranges and walking, battles, the computer's phases and FE's windows
// over it, and the GBA controls below. Shared by the editor's test play and the web game's
// Play page (decision 33). Play's rules, drawing and the ROM catalog live in src/play.

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { battleFrame, expBarEnd, expFrame, levelUpFrames, levelUpStart, type BattleFrame } from '../core/battle-anim';
import { startingExp } from '../core/experience';
import { hpCapFor, randomNumbers, withBonus, withinCaps } from '../core/combat';
import { goalWindowText } from '../core/goals';
import { attackRange } from '../core/movement';
import { startPlay, unitAt, type PlayState, type PlayUnit } from '../core/play';
import {
  brokenWeapons,
  canMove as unitCanMove,
  chooseItem,
  chooseItemOption,
  chooseOption,
  chooseStealItem,
  chooseTradeSlot,
  chooseWeapon,
  endPlayerTurn,
  finishBattle,
  finishWalk,
  itemOptions,
  menuOptions,
  moveCursor,
  pressA,
  pressB,
  selectedUnit as selectedOf,
  startView,
  stepAI,
  tapAt,
  tradeSlotOpen,
  optionDisabled,
  TRADE_SLOTS,
  visibleRoute,
  walkPosition,
  weaponChoices,
  type ItemOption,
  type MenuOption,
  type PlayView,
} from '../core/play-input';
import type { ProjectChapter } from '../core/project';
import { fullUses, toCanvas, unitStats, weaponRanges, weaponsOf, type ClassArt } from '../play/catalog';
import { ATTACK_COLOURS, drawArrow, drawCursor, drawRangeSquare, MOVE_COLOURS } from '../play/draw';
import { followCamera, VIEW_HEIGHT, VIEW_WIDTH } from '../play/camera';
import { chapterRules, maxLevel } from '../play/rules';
import { idleFrame, spriteOrigin } from '../rom/fe8-map-sprites';
import { PHASE_INTRO_FRAMES } from '../rom/fe8-phase';
import type { ChapterMap } from '../rom/fe8-maps';
import { GbaControls } from './controls';
import { FeText, FontContext } from './FeText';
import { frameStyle, imageUrl, WindowArtContext } from './FeWindow';
import { PhaseIntro } from './PhaseIntro';
import { Chibi, faceUrl } from './Portrait';
import { shortClassLabel } from './labels';
import { unitCharacters, type EditorRom } from './project-io';
import { BattleHud, BattlePopup, ExpWindow, ForecastWindow, GoalWindow, HealWindow, LevelUpScreen, levelUpLabels, LevelUpWindow, PlayHint, UnitStrip, UnitWindow, type Corner, type PlayPhase } from './TestPlayPanels';

/** How long a phase banner shows (as long as FE8's phase intro), and the pause between computer units' actions. */
const BANNER_MS = Math.ceil((PHASE_INTRO_FRAMES * 1000) / 60);
const PHASE_NAMES = { player: 'Player Phase', enemy: 'Enemy Phase', ally: 'Ally Phase' } as const;
/** How long the notice that a weapon broke shows (A closes it sooner). */
const BROKE_MS = 1500;
const MENU_LABELS: Record<MenuOption, string> = { seize: 'Seize', attack: 'Attack', staff: 'Staff', steal: 'Steal', item: 'Item', trade: 'Trade', wait: 'Wait' };
const ITEM_OPTION_LABELS: Record<ItemOption, string> = { equip: 'Equip', use: 'Use', discard: 'Discard' };
const AI_PAUSE_MS = 700;

/** What won the chapter, by its goal (decision 36). */
function victoryText(play: PlayState, label: (u: PlayUnit) => string): string {
  const goal = play.goal ?? { kind: 'rout' };
  switch (goal.kind) {
    case 'seize': {
      const lord = play.units.find((u) => u.id === goal.lord);
      return `${lord ? label(lord) : 'Your lord'} seized the square on turn ${play.turn}.`;
    }
    case 'boss': {
      const boss = play.fallen.find((u) => u.id === goal.unit);
      return `${boss ? label(boss) : 'The boss'} defeated on turn ${play.turn}.`;
    }
    case 'survive':
      return `Held out for ${goal.turns} ${goal.turns === 1 ? 'turn' : 'turns'}.`;
    default:
      return `Every enemy defeated on turn ${play.turn}.`;
  }
}

export function PlayScreen({
  data,
  chapter,
  map,
  mapImage,
  artByName,
  exitLabel,
  onExit,
  note,
}: {
  data: EditorRom;
  chapter: ProjectChapter;
  map: ChapterMap;
  mapImage: HTMLCanvasElement;
  artByName: ReadonlyMap<string, ClassArt>;
  /** The second button on the result screen, beside Play again. */
  exitLabel: string;
  onExit: () => void;
  /** A line under the controls. */
  note?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // How many CSS pixels one GBA pixel takes on this screen, for windows sized as in the game.
  const screen = useRef<HTMLDivElement>(null);
  const [gbaPx, setGbaPx] = useState(1.5);
  // One stream of random numbers per play session.
  const rng = useRef(randomNumbers(Date.now()));
  const characters = useMemo(() => unitCharacters(data, chapter.units), [data, chapter.units]);
  const cursorCorner = useMemo(() => (data.cursor ? toCanvas(data.cursor) : null), [data.cursor]);
  const start = () => {
    rng.current = randomNumbers(Date.now());
    return startView(
      startPlay(
        chapter,
        // Cut to the class's caps, as FE8 cuts a unit's stats when it loads, so test play matches the patched game.
        (u) => {
          const art = artByName.get(u.class);
          const stats = withBonus(unitStats(art, characters.get(u.id), u.level), u.statBonus);
          return art ? withinCaps(stats, art.caps, hpCapFor(u.team)) : stats;
        },
        // Only player units gain experience, as in FE8.
        (u) => (u.team === 'player' ? startingExp(u.level, maxLevel(artByName.get(u.class), characters.get(u.id))) : null),
        (item) => fullUses(item, data.items),
      ),
    );
  };
  const [view, setView] = useState<PlayView>(start);
  const play = view.state;
  const selectedUnit = selectedOf(view);

  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const measure = () => setGbaPx(el.clientWidth / (Math.min(VIEW_WIDTH, map.width) * 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [map.width]);

  // The rules change only with the map or the ROM data.
  const chapterPlay = useMemo(
    () => chapterRules(map, artByName, data.items, () => rng.current(), (u) => characters.get(u.id)),
    [map, artByName, data.items, characters],
  );
  const rules = chapterPlay.rules;
  const canMove = unitCanMove(selectedUnit);
  // A unit of yours that has already moved shows no range, as in FE.
  const showRange = !!selectedUnit && (selectedUnit.team !== 'player' || canMove);
  const range = useMemo(() => {
    if (!selectedUnit || !showRange) return null;
    const stops = rules.searchOf(selectedUnit, play).stops;
    const attack = attackRange(stops, map.width, map.height, weaponRanges(artByName.get(selectedUnit.class), selectedUnit.items, data.items));
    return { stops, attack };
  }, [play, selectedUnit, showRange, map, artByName, rules, data.items]);
  /** A unit's name: its own, its character's, or its class's. */
  const unitLabel = (u: { id: string; class: string }) =>
    chapter.units.find((x) => x.id === u.id)?.name ?? characters.get(u.id)?.name ?? shortClassLabel(artByName.get(u.class)?.entry.label ?? u.class);

  // The view follows a unit on the move, the unit being hit, or else the cursor. It is worked out here
  // so the windows can sit away from what it follows; the draw loop scrolls to it smoothly.
  const viewW = Math.min(VIEW_WIDTH, map.width);
  const viewH = Math.min(VIEW_HEIGHT, map.height);
  const followed: readonly [number, number] = view.walking
    ? [view.walking.route[view.walking.route.length - 1]! % map.width, Math.floor(view.walking.route[view.walking.route.length - 1]! / map.width)]
    : (view.battle && play.units.find((u) => u.id === view.battle!.defender)?.at) || view.cursor;
  const camera = useRef<[number, number]>(followCamera([0, 0], view.cursor, map.width, map.height));
  camera.current = followCamera(camera.current, followed, map.width, map.height);
  const cam = camera.current;
  const shown = useRef<[number, number]>([cam[0] * 16, cam[1] * 16]);
  /** Which side of the screen the cursor is on, to put windows on the other. */
  const cursorRight = view.cursor[0] - cam[0] >= viewW / 2;
  const cursorLow = view.cursor[1] - cam[1] >= viewH / 2;
  const side = cursorRight ? 'left' : 'right';
  const unitCorner: Corner = `${cursorLow ? 'top' : 'bottom'}-${side}`;
  const goalCorner: Corner = `${cursorLow ? 'bottom' : 'top'}-${side}`;

  const arrow = visibleRoute(view, rules);
  // When a walk starts, note the time; the draw loop moves the unit along its route from then on.
  const walk = view.walking;
  const walkStart = useRef(0);
  useEffect(() => {
    if (walk) walkStart.current = performance.now();
  }, [walk]);
  // The same for a battle; the HUD (HP bars, damage) updates only when a blow lands, not every frame.
  const battle = view.battle;
  const battleStart = useRef(0);
  const battleFrom = useRef({ attackerHp: 0, defenderHp: 0 });
  const [hud, setHud] = useState<BattleFrame | null>(null);
  const hudKey = useRef('');
  // After a fight: the experience it gave (expFrame), then any weapon that broke, then the fight is applied.
  const expShown = useRef(false);
  const [expStart, setExpStart] = useState<number | null>(null);
  const expOffset = useRef(0);
  const [expNow, setExpNow] = useState(0);
  const ending = useRef(false);
  const [broke, setBroke] = useState<readonly { unit: string; item: string }[] | null>(null);
  useEffect(() => {
    expShown.current = false;
    ending.current = false;
    if (!battle) {
      setHud(null);
      hudKey.current = '';
      return;
    }
    battleStart.current = performance.now();
    battleFrom.current = {
      attackerHp: play.units.find((u) => u.id === battle.attacker)?.hp ?? 0,
      defenderHp: play.units.find((u) => u.id === battle.defender)?.hp ?? 0,
    };
  }, [battle]); // play is read only when a battle starts

  useEffect(() => {
    if (expStart === null) return;
    let raf = 0;
    const tick = (t: number) => {
      setExpNow(t - expStart + expOffset.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [expStart]);
  const award = battle?.exp ?? null;
  const levelUpLabelCount = award?.result.levelUp ? levelUpLabels(award.result.levelUp).length : 0;
  const expShow = award && expStart !== null ? expFrame(award.exp, award.result.gain, levelUpLabelCount, expNow) : null;
  /** The fight and its experience have been shown: show any broken weapon, or apply the fight. Once per battle. */
  const endFight = useRef(() => {});
  endFight.current = () => {
    if (ending.current || !battle) return;
    ending.current = true;
    const list = brokenWeapons(play, battle);
    if (list.length) setBroke(list);
    else setView((v) => finishBattle(v));
  };
  useEffect(() => {
    if (expStart === null || expShow) return;
    setExpStart(null);
    endFight.current();
  }, [expStart, expShow]);
  const closeBroke = () => {
    setBroke(null);
    setView((v) => finishBattle(v));
  };
  useEffect(() => {
    if (!broke) return;
    const t = window.setTimeout(closeBroke, BROKE_MS);
    return () => window.clearTimeout(t);
  }, [broke]);

  /** A: skips ahead through the experience display or the broken weapon notice while they show, otherwise as in the game. */
  const onAPress = useRef(() => {});
  onAPress.current = () => {
    if (award && expShow) {
      expOffset.current +=
        expShow.phase === 'bar'
          ? Math.max(0, expBarEnd(award.result.gain) - expNow)
          : expShow.phase === 'gap'
            ? Math.max(0, levelUpStart(award.result.gain) - expNow)
            : (levelUpFrames(levelUpLabelCount) * 1000) / 60;
      return;
    }
    if (broke) {
      closeBroke();
      return;
    }
    setView((v) => pressA(v, rules));
  };

  // Arrow keys, Z (A) and X (B) for playing on a computer, like an emulator.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[e.key];
      if (dir) setView((v) => moveCursor(v, dir[0], dir[1], rules));
      else if (e.key === 'z' || e.key === 'Z' || e.key === 'Enter') onAPress.current();
      else if (e.key === 'x' || e.key === 'X' || e.key === 'Escape') setView((v) => pressB(v, rules));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rules]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    c.width = viewW * 16;
    c.height = viewH * 16;
    g.imageSmoothingEnabled = false;
    let raf = 0;
    const draw = (now: number) => {
      // Scroll toward the camera a few pixels a frame, as FE does.
      const step = (from: number, to: number) => from + Math.sign(to - from) * Math.min(Math.abs(to - from), 6);
      shown.current = [step(shown.current[0], camera.current[0] * 16), step(shown.current[1], camera.current[1] * 16)];
      g.setTransform(1, 0, 0, 1, -shown.current[0], -shown.current[1]);
      g.drawImage(mapImage, 0, 0);
      if (range) {
        const w = map.width;
        for (const k of range.stops.keys()) drawRangeSquare(g, k % w, Math.floor(k / w), MOVE_COLOURS);
        for (const k of range.attack) drawRangeSquare(g, k % w, Math.floor(k / w), ATTACK_COLOURS);
      }
      if (arrow) drawArrow(g, arrow, map.width);
      const frame = idleFrame(now);
      let walkDone = false;
      const bf = battle ? battleFrame(battle.strikes, battleFrom.current, now - battleStart.current) : null;
      const striking = bf && bf.index >= 0 ? battle!.strikes[bf.index]! : null;
      const placed = play.units.map((u) => {
        if (battle && bf && striking) {
          // The striker lunges a quarter square toward the unit it hits.
          const strikerId = striking.by === 'attacker' ? battle.attacker : battle.defender;
          const otherId = striking.by === 'attacker' ? battle.defender : battle.attacker;
          const other = play.units.find((p) => p.id === otherId);
          if (u.id === strikerId && other) {
            const dx = Math.sign(other.at[0] - u.at[0]);
            const dy = Math.sign(other.at[1] - u.at[1]);
            return { u, x: u.at[0] + dx * bf.lunge * 0.25, y: u.at[1] + dy * bf.lunge * 0.25, walking: false };
          }
        }
        if (!walk || walk.id !== u.id) return { u, x: u.at[0], y: u.at[1], walking: false };
        const pos = walkPosition(walk.route, map.width, now - walkStart.current);
        walkDone = pos.done;
        return { u, x: pos.x, y: pos.y, walking: !pos.done };
      });
      // Top rows first, so taller sprites lower down overlap the ones behind them.
      for (const { u, x, y, walking } of placed.sort((a, b) => a.y - b.y)) {
        const art = artByName.get(u.class);
        if (!art) continue;
        const [sx, sy] = spriteOrigin(art, x, y);
        // Walking units cycle their frames quickly, as EC does; units that have moved are grey and still, as in FE.
        const img = walking ? art.frames[u.team][[0, 1, 2, 1][Math.floor(now / 110) % 4]!]! : u.moved ? art.frames.moved[0]! : art.frames[u.team][frame]!;
        g.drawImage(img, Math.round(sx), Math.round(sy));
      }
      if (walkDone) setView((v) => finishWalk(v, rules));
      if (bf) {
        const key = `${bf.index}:${bf.landed ? battle!.strikes.indexOf(bf.landed) : -1}`;
        if (key !== hudKey.current) {
          hudKey.current = key;
          setHud(bf);
        }
        if (bf.done) {
          if (!battle!.exp) endFight.current();
          else if (!expShown.current) {
            expShown.current = true;
            expOffset.current = 0;
            setExpNow(0);
            setExpStart(performance.now());
          }
        }
      }
      if (!battle) drawCursor(g, view.cursor[0], view.cursor[1], now, cursorCorner);
      g.setTransform(1, 0, 0, 1, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [mapImage, artByName, play, range, view, arrow, walk, battle, rules, map.width, viewW, viewH, cursorCorner]);

  // The computer's phases: a pause on each phase banner, then one unit at a time.
  const aiTurn = (view.phase !== 'player' || !!view.banner) && !view.walking && !view.battle;
  useEffect(() => {
    if (!aiTurn) return;
    const t = window.setTimeout(() => setView((v) => stepAI(v, rules)), view.banner ? BANNER_MS : AI_PAUSE_MS);
    return () => window.clearTimeout(t);
  }, [aiTurn, view, rules]);

  function onMapTap(event: MouseEvent<HTMLCanvasElement>) {
    const c = event.currentTarget;
    const rect = c.getBoundingClientRect();
    const x = cam[0] + Math.floor(((event.clientX - rect.left) / rect.width) * viewW);
    const y = cam[1] + Math.floor(((event.clientY - rect.top) / rect.height) * viewH);
    // A tap moves the cursor there and presses A.
    setView(tapAt(view, x, y, rules));
  }

  const phase: PlayPhase = view.outcome
    ? 'over'
    : view.phase !== 'player'
      ? view.phase
      : view.battle
        ? 'battle'
        : view.walking
          ? 'walk'
          : view.action?.kind === 'target' && view.action.staff
            ? 'heal'
            : view.action?.kind === 'target' && view.action.trade
              ? 'tradeWith'
            : view.action?.kind === 'target' && view.action.steal
              ? 'stealFrom'
            : view.action?.kind === 'weapon' && view.action.staff
              ? 'staves'
              : (view.action?.kind ?? null);
  /** The screen position, in percent, of the top middle of a map square. */
  const position = (at: readonly [number, number]) => ({ left: `${((at[0] - cam[0] + 0.5) / viewW) * 100}%`, top: `${((at[1] - cam[1]) / viewH) * 100}%` });
  const under = unitAt(play, view.cursor[0], view.cursor[1]);
  const a = view.action;

  return (
    <FontContext.Provider value={data.font}>
    <WindowArtContext.Provider value={data.windows}>
    <div className={data.windows ? 'game real-frames' : 'game'} style={{ ['--gba-px' as string]: `${gbaPx}px`, ...(data.windows ? frameStyle(data.windows) : {}) }}>
      <div className="game-screen" ref={screen} style={{ aspectRatio: `${viewW} / ${viewH}` }}>
        <canvas ref={canvas} className="map" aria-label="Chapter map" onClick={onMapTap} />
        {!battle && !view.banner && !view.outcome && !a && (
          <>
            {under && (
              <UnitWindow
                unit={under}
                label={unitLabel(under)}
                corner={unitCorner}
                portrait={characters.get(under.id)?.portrait ? <Chibi rom={data.rom} id={characters.get(under.id)!.portrait} /> : undefined}
              />
            )}
            {!view.walking && <GoalWindow play={play} text={goalWindowText(play.goal ?? { kind: 'rout' }, (x, y) => map.terrain[y * map.width + x] ?? 0)} corner={goalCorner} />}
          </>
        )}
        {a?.kind === 'target' &&
          (() => {
            const atk = play.units.find((u) => u.id === a.unit);
            const def = play.units.find((u) => u.id === a.targets[a.index]);
            if (!atk || !def) return null;
            if (a.trade)
              return (
                <div className={`fe-window heal-window at-top-${side}`}>
                  <span className="fe-line">
                    <FeText text="Trade with" colour="gold" />
                  </span>
                  <span className="fe-line">
                    <FeText text={unitLabel(def)} />
                  </span>
                </div>
              );
            if (a.steal)
              // StealMapSelect: the target's items, the ones that can be stolen in white.
              return (
                <div className={`fe-window heal-window at-top-${side}`}>
                  <span className="fe-line">
                    <FeText text={unitLabel(def)} colour="gold" />
                  </span>
                  {def.items.map((name, i) => (
                    <span key={`${i}:${name}`} className="fe-line">
                      <FeText text={data.items.find((x) => x.entry.name === name)?.entry.gameName ?? name} colour={rules.stealable?.(def, i) ? 'white' : 'gray'} />
                    </span>
                  ))}
                </div>
              );
            if (a.staff) return <HealWindow unit={def} label={unitLabel(def)} heal={a.staff.heal} staff={data.items.find((x) => x.entry.name === atk.items[a.staff!.item])?.entry.gameName} corner={`top-${side}`} />;
            const f = chapterPlay.preview(atk, def);
            return <ForecastWindow a={atk} d={def} f={f.forecast} aWeapon={f.attackerWeapon?.entry.gameName} dWeapon={f.defenderWeapon?.entry.gameName} label={unitLabel} corner={`top-${side}`} />;
          })()}
        {a?.kind === 'menu' &&
          (() => {
            const u = play.units.find((x) => x.id === a.unit);
            // The menu opens on the side of the screen away from the unit, as in FE.
            const menuSide = u && u.at[0] - cam[0] >= viewW / 2 ? 'left' : 'right';
            return (
              <div className={`fe-window action-menu ${menuSide}`} role="menu">
                {menuOptions(view, rules).map((o, i) => (
                  <button key={o} type="button" role="menuitem" aria-current={a.index === i} aria-disabled={optionDisabled(view, o)} onClick={() => setView((v) => chooseOption(v, o, rules))}>
                    <FeText text={MENU_LABELS[o]} colour={optionDisabled(view, o) ? 'gray' : 'white'} />
                  </button>
                ))}
              </div>
            );
          })()}
        {a?.kind === 'weapon' &&
          (() => {
            const u = play.units.find((x) => x.id === a.unit);
            if (!u) return null;
            const menuSide = u.at[0] - cam[0] >= viewW / 2 ? 'left' : 'right';
            return (
              <div className={`fe-window action-menu item-list ${menuSide}`} role="menu" aria-label={a.staff ? 'Staves' : 'Weapons'}>
                {weaponChoices(view, rules).map((c, i) => {
                  const name = u.items[c.item]!;
                  const uses = u.uses[c.item];
                  return (
                    <button key={`${c.item}:${name}`} type="button" role="menuitem" aria-current={a.index === i} onClick={() => setView((v) => chooseWeapon(v, i, rules))}>
                      <FeText text={data.items.find((x) => x.entry.name === name)?.entry.gameName ?? name} />
                      <span className="item-uses">{uses !== null && uses !== undefined && <FeText text={uses} colour="blue" />}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        {a?.kind === 'trade' &&
          (() => {
            const sides = [a.unit, a.partner].map((id) => play.units.find((u) => u.id === id));
            return (
              <div className="trade-window" role="menu" aria-label="Trade">
                {sides.map((u, s) =>
                  u ? (
                    <div key={u.id} className="fe-window action-menu trade-side">
                      <span className="fe-line trade-name">
                        <FeText text={unitLabel(u)} colour="gold" />
                      </span>
                      {Array.from({ length: TRADE_SLOTS }, (_, row) => {
                        const slot = s * TRADE_SLOTS + row;
                        const name = u.items[row];
                        const uses = u.uses[row];
                        if (!tradeSlotOpen(play, a.unit, a.partner, slot)) return <div key={slot} className="trade-empty" />;
                        return (
                          <button
                            key={slot}
                            type="button"
                            role="menuitem"
                            aria-current={a.index === slot}
                            className={a.picked === slot ? 'picked' : undefined}
                            onClick={() => setView((v) => chooseTradeSlot(v.action?.kind === 'trade' ? { ...v, action: { ...v.action, index: slot } } : v, slot))}
                          >
                            <FeText text={name ? (data.items.find((x) => x.entry.name === name)?.entry.gameName ?? name) : '-'} />
                            <span className="item-uses">{uses !== null && uses !== undefined && <FeText text={uses} colour="blue" />}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null,
                )}
              </div>
            );
          })()}
        {a?.kind === 'steal' &&
          (() => {
            const u = play.units.find((x) => x.id === a.unit);
            const target = play.units.find((x) => x.id === a.target);
            if (!u || !target) return null;
            const menuSide = u.at[0] - cam[0] >= viewW / 2 ? 'left' : 'right';
            return (
              <div className={`fe-window action-menu item-list ${menuSide}`} role="menu" aria-label="Steal">
                {target.items.map((name, i) => {
                  const uses = target.uses[i];
                  const can = rules.stealable?.(target, i) ?? false;
                  return (
                    <button
                      key={`${i}:${name}`}
                      type="button"
                      role="menuitem"
                      aria-current={a.index === i}
                      aria-disabled={!can}
                      onClick={() => setView((v) => chooseStealItem(v.action?.kind === 'steal' ? { ...v, action: { ...v.action, index: i } } : v, i, rules))}
                    >
                      <FeText text={data.items.find((x) => x.entry.name === name)?.entry.gameName ?? name} colour={can ? 'white' : 'gray'} />
                      <span className="item-uses">{uses !== null && uses !== undefined && <FeText text={uses} colour={can ? 'blue' : 'gray'} />}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        {(a?.kind === 'items' || a?.kind === 'item') &&
          (() => {
            const u = play.units.find((x) => x.id === a.unit);
            if (!u) return null;
            const menuSide = u.at[0] - cam[0] >= viewW / 2 ? 'left' : 'right';
            const equipped = u.items.findIndex((_, i) => rules.itemUse?.(u, i).equip);
            const chosen = a.kind === 'items' ? a.index : a.item;
            return (
              <>
                <div className={`fe-window action-menu item-list ${menuSide}`} role="menu" aria-label="Items">
                  {u.items.map((name, i) => {
                    const item = data.items.find((x) => x.entry.name === name);
                    const uses = u.uses[i];
                    return (
                      <button
                        key={`${i}:${name}`}
                        type="button"
                        role="menuitem"
                        aria-current={chosen === i}
                        onClick={() => setView((v) => chooseItem(v.action?.kind === 'item' ? { ...v, action: { kind: 'items', unit: a.unit, from: a.from, index: i } } : v, i))}
                      >
                        <FeText text={item?.entry.gameName ?? name} />
                        {i === equipped && <FeText text=" E" colour="gold" />}
                        <span className="item-uses">{uses !== null && uses !== undefined && <FeText text={uses} colour="blue" />}</span>
                      </button>
                    );
                  })}
                </div>
                {a.kind === 'item' && (
                  <div className={`fe-window action-menu item-options ${menuSide}`} role="menu" aria-label="Item options">
                    {itemOptions(view, rules).map((o, i) => (
                      <button key={o} type="button" role="menuitem" aria-current={a.index === i} onClick={() => setView((v) => chooseItemOption(v, o, rules))}>
                        <FeText text={ITEM_OPTION_LABELS[o]} />
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        {battle && hud && battle.heal === undefined && battle.steal === undefined && (
          <BattleHud battle={battle} frame={hud} units={play.units} maxHp={(id: string) => play.units.find((u) => u.id === id)?.stats.hp ?? 1} label={unitLabel} />
        )}
        {battle && hud && <BattlePopup battle={battle} frame={hud} units={play.units} position={position} />}
        {battle?.heal !== undefined &&
          (() => {
            const target = play.units.find((u) => u.id === battle.defender);
            return target ? (
              <div className="popup heal" style={position(target.at)}>
                +{Math.min(battle.heal, target.stats.hp - target.hp)}
              </div>
            ) : null;
          })()}
        {battle?.steal !== undefined &&
          (() => {
            // NewPopup_ItemStealing: "Stole <item>" for the player's thief, "<Item> was stolen." for the computer's.
            const name = play.units.find((u) => u.id === battle.defender)?.items[battle.steal];
            if (!name) return null;
            const item = data.items.find((x) => x.entry.name === name)?.entry.gameName ?? name;
            const byPlayer = play.units.find((u) => u.id === battle.attacker)?.team === 'player';
            return (
              <div className="fe-window broke-window" role="status">
                <span className="fe-line">
                  {byPlayer ? <FeText text="Stole " /> : null}
                  <FeText text={item} colour="blue" />
                  {byPlayer ? null : <FeText text=" was stolen." />}
                </span>
              </div>
            );
          })()}
        {award && expShow?.phase === 'bar' && <ExpWindow exp={expShow.exp} frame={expShow.frame} art={data.expBar} />}
        {broke && (
          <div className="fe-window broke-window" role="status">
            {broke.map((b) => {
              const owner = play.units.find((u) => u.id === b.unit);
              const item = data.items.find((x) => x.entry.name === b.item)?.entry.gameName ?? b.item;
              return (
                <span key={b.unit} className="fe-line">
                  <FeText text={owner ? `${unitLabel(owner)}'s ${item} broke!` : `${item} broke!`} />
                </span>
              );
            })}
          </div>
        )}
        {award?.result.levelUp && expShow?.phase === 'levelUp' && (() => {
          const u = play.units.find((x) => x.id === award.unit);
          if (!u) return null;
          const art = artByName.get(u.class);
          if (data.levelUpBox && art)
            return (
              <LevelUpScreen
                box={imageUrl(data.levelUpBox)}
                unit={u}
                className={art.entry.gameName}
                // UnitHasMagicRank, from the class's ranks: staff, anima, light or dark.
                magic={[4, 5, 6, 7].some((t) => (art.weaponRanks[t] ?? 0) > 0)}
                level={award.level}
                gains={award.result.levelUp}
                frame={expShow.frame}
                at={[u.at[0] - cam[0], u.at[1] - cam[1]]}
                face={characters.get(u.id)?.portrait ? faceUrl(data.rom, characters.get(u.id)!.portrait) : null}
                sprites={data.levelUpSprites ? { rom: data.rom, art: data.levelUpSprites } : null}
              />
            );
          return <LevelUpWindow unit={u} label={unitLabel(u)} level={award.result.level} gains={award.result.levelUp} />;
        })()}
        {view.banner &&
          (data.phaseBanners ? (
            <PhaseIntro key={`${play.turn}:${view.banner}`} banner={data.phaseBanners[view.banner]} label={PHASE_NAMES[view.banner]} viewW={viewW} viewH={viewH} />
          ) : (
            <div className={`phase-banner phase-${view.banner}`} role="status">
              {PHASE_NAMES[view.banner]}
            </div>
          ))}
        {view.outcome && (
          <div className={`result-screen ${view.outcome.result}`} role="alertdialog" aria-label={view.outcome.result === 'victory' ? 'Chapter clear' : 'Defeat'}>
            <strong>{view.outcome.result === 'victory' ? 'Chapter Clear!' : 'Defeat'}</strong>
            <span>
              {view.outcome.result === 'victory'
                ? victoryText(play, unitLabel)
                : view.outcome.fallen
                  ? `${unitLabel(view.outcome.fallen)} has fallen.`
                  : 'All your units have fallen.'}
            </span>
            {play.fallen.some((u) => u.team === 'player') && view.outcome.result === 'victory' && (
              <span className="note">Lost: {play.fallen.filter((u) => u.team === 'player').map(unitLabel).join(', ')}</span>
            )}
            <div className="stepper">
              <button type="button" className="button" onClick={() => setView(start())}>
                Play again
              </button>
              <button type="button" className="button button-secondary" onClick={onExit}>
                {exitLabel}
              </button>
            </div>
          </div>
        )}
      </div>
      <UnitStrip unit={under} weapon={under && weaponsOf(artByName.get(under.class), under.items, data.items)[0]} />
      <GbaControls
        onDirection={(dx, dy) => setView((v) => moveCursor(v, dx, dy, rules))}
        onA={() => onAPress.current()}
        onB={() => setView((v) => pressB(v, rules))}
        extra={[{ label: 'End turn', onPress: () => setView((v) => endPlayerTurn(v, rules)), disabled: phase !== null }]}
      />
      <PlayHint play={play} selected={selectedUnit} canMove={canMove} phase={phase} label={(u) => artByName.get(u.class)?.entry.label ?? u.class} />
      <p className="note">
        You can also tap a square: that moves the cursor there and presses A. On a computer, use the arrow keys, Z for A and X for B.
        {note ? ` ${note}` : ''}
      </p>
    </div>
    </WindowArtContext.Provider>
    </FontContext.Provider>
  );
}

