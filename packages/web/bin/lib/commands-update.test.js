import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

import { createUpdateCommand, partitionUpdateInstances } from './commands-update.js';

async function withTempOpenChamberDataDir(fn) {
  const previous = process.env.OPENCHAMBER_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-update-test-'));
  process.env.OPENCHAMBER_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
    else process.env.OPENCHAMBER_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('update command', () => {
  it('separates CLI daemons from the installed startup service', () => {
    const daemon = { port: 3000, instanceFilePath: '/daemon.json' };
    const startup = { port: 3069, instanceFilePath: '/startup.json', startupService: true };
    const manualForeground = { port: 3070, instanceFilePath: '/manual.json' };
    const readOptions = vi.fn((filePath) => ({
      launchMode: filePath === daemon.instanceFilePath ? 'daemon' : 'foreground',
    }));

    expect(partitionUpdateInstances(
      [daemon, startup, manualForeground],
      readOptions,
      { enabled: true, active: true, port: 3069 },
    )).toEqual({
      managed: [daemon],
      startup: [startup],
      foreground: [manualForeground],
    });
  });

  it('restarts the installed startup service after updating', async () => {
    await withTempOpenChamberDataDir(async (dir) => {
      const originalWrite = process.stdout.write;
      process.stdout.write = vi.fn(() => true);
      const instanceFilePath = path.join(dir, 'run', 'openchamber-3069.json');
      fs.mkdirSync(path.dirname(instanceFilePath), { recursive: true });
      fs.writeFileSync(instanceFilePath, JSON.stringify({ port: 3069, launchMode: 'foreground' }));
      const restartStartupService = vi.fn();
      const updateCommand = createUpdateCommand({
        packageManagerPath: '/fake/package-manager.js',
        serveCommand: vi.fn(),
        discoverRunningInstances: vi.fn(async () => [{ port: 3069, instanceFilePath, startupService: true }]),
        getStartupStatus: vi.fn(() => ({ supported: true, enabled: true, active: true, port: 3069 })),
        restartStartupService,
        importFromFilePath: vi.fn(async () => ({
          checkForUpdates: vi.fn(async () => ({ available: true, version: '9.9.9' })),
          detectPackageManager: vi.fn(() => 'npm'),
          executeUpdate: vi.fn(() => ({ success: true, exitCode: 0 })),
          getCurrentVersion: vi.fn(() => '1.0.0'),
        })),
      });

      try {
        await updateCommand({ json: true });
        expect(restartStartupService).toHaveBeenCalledTimes(1);
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });

  it('uses the package-manager helpers on the update-available path', async () => {
    await withTempOpenChamberDataDir(async () => {
      const originalWrite = process.stdout.write;
      process.stdout.write = vi.fn(() => true);
      const executeUpdate = vi.fn(() => ({ success: true, exitCode: 0 }));
      const updateCommand = createUpdateCommand({
        packageManagerPath: '/fake/package-manager.js',
        serveCommand: vi.fn(),
        importFromFilePath: vi.fn(async () => ({
          checkForUpdates: vi.fn(async () => ({ available: true, version: '9.9.9' })),
          detectPackageManager: vi.fn(() => 'npm'),
          executeUpdate,
          getCurrentVersion: vi.fn(() => '1.0.0'),
        })),
      });

      try {
        await updateCommand({ json: true });

        expect(executeUpdate).toHaveBeenCalledWith('npm', { silent: true });
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });
});
