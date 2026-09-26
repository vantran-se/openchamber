import { describe, expect, it, vi } from 'vitest';

import { startupCommand } from './commands-startup.js';

const quiet = { quiet: true };

describe('startup command service controls', () => {
  for (const action of ['start', 'stop', 'restart']) {
    it(`${action}s the installed startup service without changing installation`, async () => {
      const controlStartupService = vi.fn(() => ({ supported: true, enabled: true, active: action !== 'stop', platform: 'linux' }));
      await startupCommand(quiet, action, { controlStartupService });
      expect(controlStartupService).toHaveBeenCalledWith(action);
    });
  }
});
