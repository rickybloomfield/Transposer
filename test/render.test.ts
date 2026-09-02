import { describe, expect, it } from 'vitest';
import { musicSizeToUnit, musicSpacingToSpacingLinear } from '../src/render/verovio';

describe('Verovio render options', () => {
  it('maps music spacing to bounded horizontal spacing values', () => {
    expect(musicSpacingToSpacingLinear(100)).toBe(0.24);
    expect(musicSpacingToSpacingLinear(70)).toBe(0.168);
    expect(musicSpacingToSpacingLinear(130)).toBe(0.312);
    expect(musicSpacingToSpacingLinear(10)).toBe(0.168);
    expect(musicSpacingToSpacingLinear(200)).toBe(0.312);
  });

  it('maps music size to bounded staff unit values', () => {
    expect(musicSizeToUnit(100)).toBe(9);
    expect(musicSizeToUnit(70)).toBe(6.3);
    expect(musicSizeToUnit(130)).toBe(11.7);
    expect(musicSizeToUnit(10)).toBe(6.3);
    expect(musicSizeToUnit(200)).toBe(11.7);
  });
});
