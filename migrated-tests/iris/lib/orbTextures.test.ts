import { describe, expect, it } from 'vitest';
import { ORB_TEXTURE_PRESETS, normalizeOrbTexture, orbTexturePreset } from '@/platform/orbTextures';

describe('orbTextures', () => {
  it('normalizes known and unknown texture settings', () => {
    expect(normalizeOrbTexture('ice')).toBe('ice');
    expect(normalizeOrbTexture('unknown')).toBe('desert');
    expect(normalizeOrbTexture(null)).toBe('desert');
  });

  it('provides texture-specific glow palettes', () => {
    expect(orbTexturePreset('fire')).toMatchObject({
      label: 'Fire',
      hot: '#FF4D1C',
    });
    expect(ORB_TEXTURE_PRESETS.neon.image).toContain('neon.png');
  });
});
