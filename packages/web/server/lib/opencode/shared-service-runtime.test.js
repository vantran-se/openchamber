import { describe, expect, it, vi } from 'vitest';

import { createSharedOpenCodeServiceRuntime } from './shared-service-runtime.js';

const endpointA = {
  url: 'http://127.0.0.1:4096',
  auth: { type: 'basic', username: 'opencode', password: 'original' },
};
const endpointB = {
  url: 'http://127.0.0.1:5096',
  auth: { type: 'basic', username: 'opencode', password: 'replacement' },
};

const createRuntime = ({
  discover = vi.fn().mockResolvedValue(endpointA),
  ensure = vi.fn(),
  stop = vi.fn(),
  headers = vi.fn((endpoint) => endpoint.auth
    ? { authorization: `Basic ${endpoint.auth.password}` }
    : undefined),
  fetchImpl = vi.fn().mockResolvedValue(Response.json({ version: '2.0.15' })),
  infoVersion,
  readInfo = async (response) => infoVersion === undefined
    ? response.json()
    : { version: infoVersion },
  isSupportedVersion = (version) => version === '2.0.15',
  ensureOptions = { command: ['opencode', 'serve', '--service'] },
  hasRegistration = vi.fn().mockResolvedValue(false),
} = {}) => createSharedOpenCodeServiceRuntime({
  service: { discover, ensure, stop, headers },
  fetchImpl,
  ensureOptions,
  readInfo,
  isSupportedVersion,
  hasRegistration,
});

describe('shared OpenCode service runtime', () => {
  it('uses a compatible discovered service without ensuring another one', async () => {
    const discover = vi.fn().mockResolvedValue(endpointA);
    const ensure = vi.fn();
    const runtime = createRuntime({ discover, ensure, infoVersion: '2.0.15' });

    await expect(runtime.connect()).resolves.toMatchObject({
      kind: 'shared-local',
      endpoint: endpointA,
      version: '2.0.15',
    });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('rejects an incompatible discovered service without replacing it', async () => {
    const discover = vi.fn().mockResolvedValue(endpointA);
    const ensure = vi.fn();
    const runtime = createRuntime({ discover, ensure, infoVersion: '1.99.0' });

    await expect(runtime.connect()).rejects.toMatchObject({
      code: 'OPENCODE_INCOMPATIBLE',
      foundVersion: '1.99.0',
    });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('refuses to ensure when discovery hides an existing incompatible or unhealthy registration', async () => {
    const discover = vi.fn().mockResolvedValue(undefined);
    const ensure = vi.fn();
    const runtime = createRuntime({
      discover,
      ensure,
      hasRegistration: vi.fn().mockResolvedValue(true),
    });

    await expect(runtime.connect()).rejects.toMatchObject({
      code: 'OPENCODE_SERVICE_UNAVAILABLE',
    });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('ensures a service only when discovery returns no endpoint', async () => {
    const discover = vi.fn().mockResolvedValue(undefined);
    const ensure = vi.fn().mockResolvedValue(endpointA);
    const runtime = createRuntime({ discover, ensure, infoVersion: '2.0.15' });

    await expect(runtime.connect()).resolves.toMatchObject({ endpoint: endpointA });
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('refreshes URL and auth when recovery discovers a replacement endpoint', async () => {
    const discover = vi.fn()
      .mockResolvedValueOnce(endpointA)
      .mockResolvedValueOnce(endpointB);
    const runtime = createRuntime({ discover, infoVersion: '2.0.15' });

    await runtime.connect();
    await runtime.recover();

    expect(runtime.getBaseUrl()).toBe(endpointB.url);
    expect(runtime.getHeaders()).toEqual({ authorization: 'Basic replacement' });
  });

  it('keeps the active connection when a replacement is incompatible', async () => {
    const discover = vi.fn()
      .mockResolvedValueOnce(endpointA)
      .mockResolvedValueOnce(endpointB);
    const readInfo = vi.fn()
      .mockResolvedValueOnce({ version: '2.0.15' })
      .mockResolvedValueOnce({ version: '1.99.0' });
    const runtime = createRuntime({ discover, readInfo });

    await runtime.connect();
    await expect(runtime.recover()).rejects.toMatchObject({ code: 'OPENCODE_INCOMPATIBLE' });

    expect(runtime.getBaseUrl()).toBe(endpointA.url);
    expect(runtime.getHeaders()).toEqual({ authorization: 'Basic original' });
  });

  it('dispose does not stop the shared service', async () => {
    const stop = vi.fn();
    const runtime = createRuntime({ stop, infoVersion: '2.0.15' });
    await runtime.connect();
    await runtime.dispose();
    expect(stop).not.toHaveBeenCalled();
    expect(runtime.getConnection()).toBeNull();
  });

  it.each([
    [undefined],
    [{}],
    [{ url: '' }],
    [{ url: 'file:///tmp/opencode.sock' }],
    [{ url: 'not a url' }],
  ])('rejects a malformed endpoint (%j)', async (endpoint) => {
    const runtime = createRuntime({ discover: vi.fn().mockResolvedValue(endpoint) });

    await expect(runtime.connect()).rejects.toMatchObject({ code: 'OPENCODE_SERVICE_UNAVAILABLE' });
  });

  it('reports an authenticated service as unavailable when /api/info returns 401', async () => {
    const runtime = createRuntime({
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      readInfo: async () => null,
    });

    await expect(runtime.connect()).rejects.toMatchObject({ code: 'OPENCODE_SERVICE_UNAVAILABLE' });
  });

  it('reports discovery failures as unavailable without ensuring a replacement', async () => {
    const ensure = vi.fn();
    const runtime = createRuntime({
      discover: vi.fn().mockRejectedValue(new Error('registration unavailable')),
      ensure,
    });

    await expect(runtime.connect()).rejects.toMatchObject({ code: 'OPENCODE_SERVICE_UNAVAILABLE' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('reports an unreachable discovered endpoint as unavailable without ensuring a replacement', async () => {
    const ensure = vi.fn();
    const runtime = createRuntime({
      ensure,
      fetchImpl: vi.fn().mockRejectedValue(new Error('connection refused')),
    });

    await expect(runtime.connect()).rejects.toMatchObject({ code: 'OPENCODE_SERVICE_UNAVAILABLE' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('uses empty headers when Service.headers returns undefined', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ version: '2.0.15' }));
    const runtime = createRuntime({ headers: vi.fn().mockReturnValue(undefined), fetchImpl });

    await runtime.connect();

    expect(runtime.getHeaders()).toEqual({});
    expect(fetchImpl).toHaveBeenCalledWith(new URL(`${endpointA.url}/api/info`), {
      headers: { Accept: 'application/json' },
    });
  });
});
