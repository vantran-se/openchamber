import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '/usr/local/bin', stderr: '' })),
}));

const {
  checkForUpdates,
  detectPackageManager,
  executeUpdate,
  getCurrentVersion,
  getUpdateCommand,
} = await import('./package-manager.js');

function createFetchMock() {
  const handlers = new Map();
  const mock = vi.fn((url) => {
    const urlString = String(url);
    for (const [pattern, response] of handlers) {
      if (urlString.includes(pattern)) return Promise.resolve(response);
    }
    return Promise.reject(new Error(`Unexpected fetch call: ${urlString}`));
  });
  mock.when = (pattern, response) => {
    handlers.set(pattern, response);
    return mock;
  };
  return mock;
}

describe('checkForUpdates', () => {
  let fetchMock;
  let originalFetch;

  beforeEach(() => {
    fetchMock = createFetchMock();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses the latest fork release for web updates', async () => {
    fetchMock.when('api.github.com/repos/vantran-se/openchamber/releases/latest', {
      ok: true,
      json: async () => ({
        tag_name: 'v1.22.1',
        body: 'Fork release notes',
      }),
    });

    const result = await checkForUpdates({ currentVersion: '1.22.0' });

    expect(result).toMatchObject({
      available: true,
      version: '1.22.1',
      currentVersion: '1.22.0',
      body: 'Fork release notes',
      releaseUrl: 'https://github.com/vantran-se/openchamber/releases/tag/v1.22.1',
      updateCommand: 'openchamber update',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports no web update when the fork release matches the installed version', async () => {
    fetchMock.when('api.github.com/repos/vantran-se/openchamber/releases/latest', {
      ok: true,
      json: async () => ({ tag_name: 'v1.22.0' }),
    });

    const result = await checkForUpdates({ currentVersion: '1.22.0' });

    expect(result.available).toBe(false);
    expect(result.version).toBe('1.22.0');
  });

  it('does not offer a prerelease over the matching stable version', async () => {
    fetchMock.when('api.github.com/repos/vantran-se/openchamber/releases/latest', {
      ok: true,
      json: async () => ({ tag_name: 'v1.22.0-beta.1' }),
    });

    const result = await checkForUpdates({ currentVersion: '1.22.0' });

    expect(result.available).toBe(false);
  });

  it('fails explicitly when the fork release cannot be resolved', async () => {
    fetchMock.when('api.github.com/repos/vantran-se/openchamber/releases/latest', {
      ok: false,
      status: 404,
    });

    const result = await checkForUpdates({ currentVersion: '1.22.0' });

    expect(result).toMatchObject({
      available: false,
      currentVersion: '1.22.0',
      error: 'Unable to determine versions',
    });
  });

  it('keeps the central update API for desktop runtimes', async () => {
    fetchMock.when('api.openchamber.dev', {
      ok: true,
      json: async () => ({
        latestVersion: '1.22.1',
        updateAvailable: true,
        releaseNotes: 'Desktop release notes',
      }),
    });

    const result = await checkForUpdates({
      appType: 'desktop-electron',
      currentVersion: '1.22.0',
      installId: '4f4dfead-9688-4c4f-97d7-4607fbbfc3ab',
      platform: 'windows',
      arch: 'arm64',
    });

    expect(result.available).toBe(true);
    expect(result.version).toBe('1.22.1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      installId: '4f4dfead-9688-4c4f-97d7-4607fbbfc3ab',
      platform: 'windows',
      arch: 'arm64',
    });
  });

  it('resolves an Android APK asset for mobile updates', async () => {
    fetchMock
      .when('api.openchamber.dev', {
        ok: true,
        json: async () => ({
          latestVersion: '1.22.1',
          updateAvailable: true,
          downloadUrl: 'https://github.com/openchamber/openchamber/releases/download/v1.22.1/OpenChamber-1.22.1-42-android.aab',
        }),
      })
      .when('api.github.com/repos/openchamber/openchamber/releases/tags/v1.22.1', {
        ok: true,
        json: async () => ({
          assets: [
            {
              name: 'OpenChamber-1.22.1-42-android.apk',
              browser_download_url: 'https://downloads.example/OpenChamber-1.22.1-42-android.apk',
            },
          ],
        }),
      });

    const result = await checkForUpdates({
      appType: 'mobile-capacitor',
      platform: 'android',
      currentVersion: '1.22.0',
    });

    expect(result.downloadUrl).toBe('https://downloads.example/OpenChamber-1.22.1-42-android.apk');
  });
});

describe('getUpdateCommand', () => {
  it('installs the public fork package from npm', () => {
    expect(getUpdateCommand('npm')).toBe(
      'npm install -g @vantran-se/openchamber-web@latest --registry=https://registry.npmjs.org',
    );
  });
});

describe('getCurrentVersion', () => {
  it('is exported for the CLI update command', () => {
    expect(typeof getCurrentVersion).toBe('function');
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+|unknown$/);
  });
});

describe('CLI update exports', () => {
  it('exports package-manager helpers used by the update command', () => {
    expect(typeof detectPackageManager).toBe('function');
    expect(typeof executeUpdate).toBe('function');
  });
});
