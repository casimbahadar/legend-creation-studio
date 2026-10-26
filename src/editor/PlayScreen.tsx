// Playing a chapter on an FE8-style game screen (decision 35): 15 x 10 squares of the map that scroll
// with the cursor, with units, ranges and walking, battles, the computer's phases and FE's windows
// over it, and the GBA controls below. Shared by the editor's test play and the web game's
// Play page (decision 33). Play's rules, drawing and the ROM catalog live in src/play.

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { battleFrame, expBarEnd, expFrame, LEVEL_UP_MS, type BattleFrame } from '../core/battle-anim';
import { startingExp } from '../core/experience';
import { hpCapFor, randomNumbers, withBonus, withinCaps } from '../core/combat';
import { attackRange } from '../core/movement';
import { startPlay, unitAt } from '../core/play';
import {
  canMove as unitCanMove,
  chooseOption,
  endPlayerTurn,
  finishBattle,
  finishWalk,
  menuOptions,
  moveCursor,
  pressA,
  pressB,
  selectedUnit as selectedOf,
  startView,
  stepAI,
  tapAt,
  visibleRoute,
  walkPosition,
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
import { frameStyle, WindowArtContext } from './FeWindow';
import { PhaseIntro } from './PhaseIntro';
import { Chibi } from './Portrait';
import { shortClassLabel } from './labels';
import { unitCharacters, type EditorRom } from './project-io';
import { BattleHud, BattlePopup, ExpWindow, ForecastWindow, GoalWindow, LevelUpWindow, PlayHint, UnitStrip, UnitWindow, type Corner, type PlayPhase } from './TestPlayPanels';

/** How long a phase banner shows (as long as FE8's phase intro), and the pause between computer units' actions. */
const BANNER_MS = Math.ceil((PHASE_INTRO_FRAMES * 1000) / 60);
const PHASE_NAMES = { player: 'Player Phase', enemy: 'Enemy Phase', ally: 'Ally Phase' } as const;
const AI_PAUSE_MS = 700;

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
  // After a fight that gave experience, its display plays before the fight is applied (expFrame).
  const expShown = useRef(false);
  const [expStart, setExpStart] = useState<number | null>(null);
  const expOffset = useRef(0);
  const [expNow, setExpNow] = useState(0);
  useEffect(() => {
    expShown.current = false;
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
  const expShow = award && expStart !== null ? expFrame(award.exp, award.result.gain, !!award.result.levelUp, expNow) : null;
  useEffect(() => {
    if (expStart === null || expShow) return;
    setExpStart(null);
    setView((v) => finishBattle(v));
  }, [expStart, expShow]);

  /** A: skips ahead through the experience display while it shows, otherwise as in the game. */
  const onAPress = useRef(() => {});
  onAPress.current = () => {
    if (award && expShow) {
      expOffset.current += expShow.phase === 'bar' ? Math.max(0, expBarEnd(award.result.gain) - expNow) : LEVEL_UP_MS;
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
          if (!battle!.exp) setView((v) => finishBattle(v));
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

  const phase: PlayPhase = view.outcome ? 'over' : view.phase !== 'player' ? view.phase : view.battle ? 'battle' : view.walking ? 'walk' : (view.action?.kind ?? null);
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
        {!battle && !view.banner && !view.outcome && a?.kind !== 'target' && a?.kind !== 'menu' && (
          <>
            {under && (
              <UnitWindow
                unit={under}
                label={unitLabel(under)}
                corner={unitCorner}
                portrait={characters.get(under.id)?.portrait ? <Chibi rom={data.rom} id={characters.get(under.id)!.portrait} /> : undefined}
              />
            )}
            {!view.walking && <GoalWindow play={play} corner={goalCorner} />}
          </>
        )}
        {a?.kind === 'target' &&
          (() => {
            const atk = play.units.find((u) => u.id === a.unit);
            const def = play.units.find((u) => u.id === a.targets[a.index]);
            if (!atk || !def) return null;
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
                  <button key={o} type="button" role="menuitem" aria-current={a.index === i} onClick={() => setView((v) => chooseOption(v, o, rules))}>
                    <FeText text={o === 'attack' ? 'Attack' : 'Wait'} />
                  </button>
                ))}
              </div>
            );
          })()}
        {battle && hud && <BattleHud battle={battle} frame={hud} units={play.units} maxHp={(id: string) => play.units.find((u) => u.id === id)?.stats.hp ?? 1} label={unitLabel} />}
        {battle && hud && <BattlePopup battle={battle} frame={hud} units={play.units} position={position} />}
        {award && expShow?.phase === 'bar' && <ExpWindow exp={expShow.exp} />}
        {award?.result.levelUp && expShow?.phase === 'levelUp' && (() => {
          const u = play.units.find((x) => x.id === award.unit);
          return u ? <LevelUpWindow unit={u} label={unitLabel(u)} level={award.result.level} gains={award.result.levelUp} /> : null;
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
                ? `Every enemy defeated on turn ${play.turn}.`
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
        extra={[{ label: 'End turn', onPress: () => setView((v) => endPlayerTurn(v)), disabled: phase !== null }]}
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

