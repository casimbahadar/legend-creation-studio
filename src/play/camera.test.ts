import { describe, expect, it } from 'vitest';
import { followCamera } from './camera';

describe('the game camera', () => {
  it('stays put while the cursor is well inside the view', () => {
    expect(followCamera([0, 0], [7, 5], 30, 20)).toEqual([0, 0]);
  });

  it('scrolls just enough to keep two squares to the edge', () => {
    expect(followCamera([0, 0], [13, 5], 30, 20)).toEqual([1, 0]);
    expect(followCamera([10, 5], [11, 6], 30, 20)).toEqual([9, 4]);
  });

  it('never shows past the map, and keeps small maps still', () => {
    expect(followCamera([0, 0], [29, 19], 30, 20)).toEqual([15, 10]);
    expect(followCamera([5, 5], [0, 0], 30, 20)).toEqual([0, 0]);
    expect(followCamera([0, 0], [14, 9], 15, 10)).toEqual([0, 0]);
  });
});
