// FE8's Game Over screen from the player's ROM (decision 35), drawn frame by frame (fe8-gameover.ts) on
// the game screen. A (`leave`), a tap or FE8's wait of 1500 frames starts its fade out; then `onDone`.

import { useEffect, useRef } from 'react';
import { drawGameOver, GAME_OVER_IDLE_FRAMES, gameOverFade, type GameOverArt } from '../rom/fe8-gameover';
import { gbaPx } from './FeWindow';

const FRAME_MS = 1000 / 60;
/** Frames of fade out before the screen ends (GameOverScreen_LoopFadeOut: from -1 up to 32). */
const FADE_OUT_FRAMES = 33;
/** When the wait begins: after the fade in's 22 ticks, 8 frames apart. */
const IDLE_FROM = 22 * 8;

export function GameOver({ art, viewW, viewH, leave, onDone }: { art: GameOverArt; viewW: number; viewH: number; leave: boolean; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  /** Set by A or a tap: the next frame starts the fade out. */
  const asked = useRef(false);
  if (leave) asked.current = true;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (!g) return;
    const start = performance.now();
    let leftAt: number | null = null;
    let raf = 0;
    const tick = (now: number) => {
      const frame = Math.floor((now - start) / FRAME_MS);
      if (leftAt === null && (asked.current || frame > IDLE_FROM + GAME_OVER_IDLE_FRAMES)) leftAt = frame;
      const out = leftAt === null ? null : frame - leftAt;
      if (out !== null && out >= FADE_OUT_FRAMES) {
        done.current();
        return;
      }
      const image = drawGameOver(art, frame, gameOverFade(frame, out));
      g.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [art]);
  const x0 = (viewW * 16 - 240) / 2;
  const y0 = (viewH * 16 - 160) / 2;
  return (
    <div className="game-over" role="alertdialog" aria-label="Game Over" onClick={() => (asked.current = true)}>
      <canvas ref={canvas} width={240} height={160} style={{ left: gbaPx(x0), top: gbaPx(y0), width: gbaPx(240), height: gbaPx(160) }} />
    </div>
  );
}
