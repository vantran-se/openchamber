import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { startupServicePort } from './cli-startup.js';

function withServiceFile(content, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-startup-test-'));
  const servicePath = path.join(dir, 'service');
  fs.writeFileSync(servicePath, content);
  try {
    return run(servicePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('startup service metadata', () => {
  it('reads the configured port from a systemd unit', () => {
    withServiceFile('ExecStart="/node" "/openchamber" "serve" "--foreground" "--port" "3069"\n', (servicePath) => {
      expect(startupServicePort(servicePath)).toBe(3069);
    });
  });

  it('reads the configured port from a launchd plist', () => {
    withServiceFile('<string>--port</string>\n<string>3070</string>\n', (servicePath) => {
      expect(startupServicePort(servicePath)).toBe(3070);
    });
  });

  it('reads the configured port from the Windows startup wrapper', () => {
    withServiceFile("& 'openchamber' 'serve' '--foreground' '--port' '3071'\n", (servicePath) => {
      expect(startupServicePort(servicePath)).toBe(3071);
    });
  });
});
