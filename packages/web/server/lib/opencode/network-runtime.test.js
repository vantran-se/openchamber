import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenCodeNetworkRuntime } from './network-runtime.js';

const originalFetch = globalThis.fetch;

const createRuntime = (overrides = {}) => createOpenCodeNetworkRuntime({
  state: {
    openCodePort: 4096,
    openCodeBaseUrl: null,
    openCodeApiPrefix: '',
    openCodeApiPrefixDetected: false,
    openCodeApiDetectionTimer: null,
    ...overrides.state,
  },
  getOpenCodeBaseUrl: overrides.getOpenCodeBaseUrl,
  getOpenCodeAuthHeaders: overrides.getOpenCodeAuthHeaders ?? (() => ({})),
  configuredOpenCodeHostname: overrides.configuredOpenCodeHostname,
});

describe('OpenCode network runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('returns false when readiness fetch rejects', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    });

    const runtime = createRuntime();
    const readyPromise = runtime.waitForReady('http://127.0.0.1:4096', 1);

    await expect(readyPromise).resolves.toBe(false);
  });

  it('builds managed OpenCode URLs against IPv4 loopback by default', () => {
    const runtime = createRuntime();

    expect(runtime.buildOpenCodeUrl('/provider')).toBe('http://127.0.0.1:4096/provider');
  });

  it('keeps external OpenCode base URLs authoritative', () => {
    const runtime = createRuntime({
      state: { openCodeBaseUrl: 'http://remote.example:4096' },
    });

    expect(runtime.buildOpenCodeUrl('/provider')).toBe('http://remote.example:4096/provider');
  });

  it('builds each request from the current shared-service base URL', () => {
    let baseUrl = 'http://127.0.0.1:4096';
    const runtime = createRuntime({
      state: { openCodePort: null },
      getOpenCodeBaseUrl: () => baseUrl,
    });

    expect(runtime.buildOpenCodeUrl('/api/session')).toBe('http://127.0.0.1:4096/api/session');
    baseUrl = 'http://127.0.0.1:5096/';
    expect(runtime.buildOpenCodeUrl('/api/session')).toBe('http://127.0.0.1:5096/api/session');
  });

  it('normalizes current service auth without dropping additional headers', () => {
    let headers = { authorization: 'Basic first', 'x-service-header': 'one' };
    const runtime = createRuntime({ getOpenCodeAuthHeaders: () => headers });

    expect(runtime.getOpenCodeAuthHeaders()).toEqual({
      Authorization: 'Basic first',
      'x-service-header': 'one',
    });
    headers = { authorization: 'Basic replacement', 'x-service-header': 'two' };
    expect(runtime.getOpenCodeAuthHeaders()).toEqual({
      Authorization: 'Basic replacement',
      'x-service-header': 'two',
    });
  });

  it('normalizes wildcard and IPv6 OpenCode bind hosts for local connects', () => {
    expect(createRuntime({ configuredOpenCodeHostname: '0.0.0.0' }).buildOpenCodeUrl('/provider'))
      .toBe('http://127.0.0.1:4096/provider');
    expect(createRuntime({ configuredOpenCodeHostname: '::1' }).buildOpenCodeUrl('/provider'))
      .toBe('http://[::1]:4096/provider');
  });
});
