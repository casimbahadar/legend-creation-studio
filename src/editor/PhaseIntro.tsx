// FE8's phase intro from the player's ROM (decision 35): the band and the phase's name, frame by frame
// as the game draws them (fe8-phase.ts), placed in GBA pixels on the game screen. The game's screen is
// 240 x 160; a smaller view keeps the banner centred on it.

import { useEffect, useMemo, useState } from 'react';
import { BAND_HEIGHT, BAND_WIDTH, BAND_Y, NAME_HEIGHT, NAME_WIDTH, NAME_Y, phaseIntroAt, type PhaseBanner } from '../rom/fe8-phase';
import { gbaPx, scaledUrl } from './FeWindow';

const FRAME_MS = 1000 / 60;

export function PhaseIntro({ banner, label, viewW, viewH }: { banner: PhaseBanner; label: string; viewW: number; viewH: number }) {
  const band = useMemo(() => scaledUrl(banner.band), [banner]);
  const name = useMemo(() => scaledUrl(banner.name), [banner]);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setFrame((now - start) / FRAME_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const f = phaseIntroAt(frame);
  const x0 = (viewW * 16 - 240) / 2;
  const y0 = (viewH * 16 - 160) / 2;
  return (
    <div className="phase-intro" role="status" aria-label={label}>
      {f && (
        <>
          <img src={band} alt="" style={{ left: gbaPx(x0), top: gbaPx(y0 + BAND_Y), width: gbaPx(BAND_WIDTH), height: gbaPx(BAND_HEIGHT), transform: `scaleY(${f.bandScale})` }} />
          {f.nameX !== null && (
            <img src={name} alt="" style={{ left: gbaPx(x0 + f.nameX), top: gbaPx(y0 + NAME_Y), width: gbaPx(NAME_WIDTH), height: gbaPx(NAME_HEIGHT), opacity: f.nameOpacity }} />
          )}
        </>
      )}
    </div>
  );
}
