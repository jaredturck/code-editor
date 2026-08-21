/**
 * Keeps the renderer policy free from eval and inline script execution while retaining the
 * loopback connections needed by development and local models. This reads the source HTML
 * directly so a future build change cannot silently reintroduce the removed directives.
 */

import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('renderer content security policy', () => {
  it('does not permit eval or inline scripts', async () => {
    const html = await fs.readFile('index.html', 'utf8');
    const policy = html.match(/Content-Security-Policy[\s\S]*?content="([\s\S]*?)"/i)?.[1] || '';

    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy.match(/script-src[^;]*'unsafe-inline'/)).toBeNull();
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
  });
});
