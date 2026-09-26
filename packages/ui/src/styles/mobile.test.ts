import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const mobileCssPath = fileURLToPath(new URL('./mobile.css', import.meta.url));

describe('standalone PWA home-indicator overlay', () => {
  test('keeps a non-interactive safe-area gradient over the home indicator', () => {
    const css = fs.readFileSync(mobileCssPath, 'utf8');

    expect(css).toContain('@media (display-mode: standalone)');
    expect(css).toContain(':root.device-mobile:not(.desktop-runtime) body::after');
    expect(css).toContain('height: var(--oc-safe-area-bottom-visual, var(--oc-safe-area-bottom, env(safe-area-inset-bottom, 0)))');
    expect(css).toContain('background: linear-gradient(');
    expect(css).toContain('pointer-events: none');
  });
});
