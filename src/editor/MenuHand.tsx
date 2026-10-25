// FE8's menu hand from the player's ROM (decision 35), beside the chosen line of a menu: 14 GBA pixels
// left of the line's text and 2 down, bobbing as the game's does (fe8-cursor.ts).

import { useEffect, useMemo, useState } from 'react';
import { handOffset } from '../rom/fe8-cursor';
import type { Image } from '../rom/gba-graphics';
import { gbaPx, scaledUrl } from './FeWindow';

export function MenuHand({ hand }: { hand: Image }) {
  const url = useMemo(() => scaledUrl(hand), [hand]);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      setNow(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const at = handOffset(now);
  // The line's 16-pixel text is centred in the button, so its top is 8 GBA pixels above the middle.
  return <img className="menu-hand" src={url} alt="" style={{ left: gbaPx(at.x), top: `calc(50% + ${gbaPx(at.y - 8)})` }} />;
}
