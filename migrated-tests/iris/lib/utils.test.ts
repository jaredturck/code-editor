/**
 * Exercises the observable utils contract, with regression cases for “joins conditional
 * class names” and “merges conflicting Tailwind utility classes”. The suite documents
 * caller-visible behavior so implementation refactors cannot silently weaken those
 * guarantees.
 */

import { describe, expect, it } from 'vitest';
import { cn, isIframe } from '@/platform/utils';

describe('utils', () => {
  it('joins conditional class names', () => {
    expect(cn('base', false && 'hidden', { active: true })).toBe('base active');
  });

  it('merges conflicting Tailwind utility classes', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('detects the default test window as not framed', () => {
    expect(isIframe).toBe(false);
  });
});
