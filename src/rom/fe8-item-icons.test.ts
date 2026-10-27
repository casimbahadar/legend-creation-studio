import { describe, expect, it } from 'vitest';
import { FE8U_ITEM_ICON_PALETTE, FE8U_ITEM_ICONS, readItemIcon } from './fe8-item-icons';
import { readRom } from './gba-rom';

describe('FE8 item icons', () => {
  it('lays an icon out from its four tiles, top left, top right, bottom left, bottom right, in the first palette', () => {
    const bytes = new Uint8Array(FE8U_ITEM_ICON_PALETTE + 0x40);
    // Icon 2: its tiles in colours 1, 2, 3 and 4.
    for (let t = 0; t < 4; t++) bytes.fill((t + 1) * 0x11, FE8U_ITEM_ICONS + 2 * 0x80 + t * 32, FE8U_ITEM_ICONS + 2 * 0x80 + (t + 1) * 32);
    const view = new DataView(bytes.buffer);
    for (let c = 1; c <= 4; c++) view.setUint16(FE8U_ITEM_ICON_PALETTE + c * 2, c, true);
    const img = readItemIcon(readRom(bytes), 2)!;
    const red = (x: number, y: number) => img.rgba[(y * 16 + x) * 4];
    expect([red(0, 0), red(8, 0), red(0, 8), red(8, 8)]).toEqual([8, 16, 24, 32]);
    expect(readItemIcon(readRom(bytes), 224)).toBeNull();
    expect(readItemIcon(readRom(new Uint8Array(0x100)), 0)).toBeNull();
  });
});
