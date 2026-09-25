import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import express from 'express';
import path from 'path';

import { createOpenCodeConnectionAdapter } from './lib/opencode/lifecycle.js';
import { createOpenCodeNetworkRuntime } from './lib/opencode/network-runtime.js';
import { createSseBoundaryTracker, registerOpenCodeProxy, writeSseChunkWithBackpressure } from './lib/opencode/proxy.js';

const listen = (app, host = '127.0.0.1') => new Promise((resolve, reject) => {
  const server = app.listen(0, host, () => resolve(server));
  server.once('error', reject);
});

const closeServer = (server) => new Promise((resolve, reject) => {
  if (!server) {
    resolve();
    return;
  }
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  });
});

describe('OpenCode proxy SSE forwarding', () => {
  let upstreamServer;
  let replacementUpstreamServer;
  let proxyServer;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(async () => {
    Object.defineProperty(process, 'platform', originalPlatform);
    await closeServer(proxyServer);
    await closeServer(upstreamServer);
    await closeServer(replacementUpstreamServer);
    proxyServer = undefined;
    upstreamServer = undefined;
    replacementUpstreamServer = undefined;
  });

  it('forwards event streams with nginx-safe headers', async () => {
    let seenAuthorization = null;

    const upstream = express();
    upstream.get('/api/event', (req, res) => {
      seenAuthorization = req.headers.authorization ?? null;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=0');
      res.setHeader('X-Upstream-Test', 'ok');
      res.write('data: {"ok":true}\n\n');
      res.end();
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('x-upstream-test')).toBe('ok');
    expect(await response.text()).toBe('data: {"ok":true}\n\n');
    expect(seenAuthorization).toBe('Bearer test-token');
  });

  it('closes downstream SSE when the OpenCode upstream stalls despite proxy heartbeats', async () => {
    let stallTimeoutReads = 0;
    const upstream = express();
    upstream.get('/api/event', (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      setTimeout(() => res.write(':upstream-alive\n\n'), 40);
      setTimeout(() => res.write('data: still-alive\n\n'), 80);
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      SSE_HEARTBEAT_INTERVAL_MS: 10,
      getSseUpstreamStallTimeoutMs: () => {
        stallTimeoutReads += 1;
        return stallTimeoutReads === 1 ? 50 : 100;
      },
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/global/event`, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(2000),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(':heartbeat\n\n');
    expect(body).toContain(':upstream-alive\n\n');
    expect(body).toContain('data: still-alive\n\n');
    expect(stallTimeoutReads).toBeGreaterThanOrEqual(3);
  });

  it('holds a request through OpenCode warmup and succeeds once ready (no 503/backoff)', async () => {
    const upstream = express();
    upstream.get('/api/config/providers', (_req, res) => {
      res.json({ ok: true });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const runtime = {
      openCodePort: upstreamPort,
      isOpenCodeReady: false,
      openCodeNotReadySince: 0,
      isRestartingOpenCode: false,
    };
    // OpenCode becomes ready shortly after the request arrives.
    setTimeout(() => { runtime.isOpenCodeReady = true; }, 200);

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 5000,
      getRuntime: () => runtime,
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns 503 fast when OpenCode never becomes ready', async () => {
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      // Zero grace → hold window collapses to nothing → fail fast.
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: 0,
        isOpenCodeReady: false,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:1${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ restarting: true });
  });

  it('waits for drain when writing to a slow SSE response', async () => {
    const writes = [];
    const res = new EventEmitter();
    res.writableEnded = false;
    res.destroyed = false;
    res.write = (value) => {
      writes.push(value);
      return false;
    };
    const controller = new AbortController();

    const write = writeSseChunkWithBackpressure(res, Buffer.from('data: {"ok":true}\n\n'), controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toHaveLength(1);

    res.emit('drain');

    await expect(write).resolves.toBe(true);
  });

  it('tracks whether a raw SSE stream is between event blocks', () => {
    const tracker = createSseBoundaryTracker();

    expect(tracker.isAtBoundary()).toBe(true);
    expect(tracker.observe(Buffer.from('id: evt-1\n'))).toBe(false);
    expect(tracker.observe(Buffer.from('data: {"ok"'))).toBe(false);
    expect(tracker.observe(Buffer.from(':true}\n'))).toBe(false);
    expect(tracker.observe(Buffer.from('\n'))).toBe(true);
    expect(tracker.observe(Buffer.from('data: next\r\n\r\n'))).toBe(true);
  });

  it('routes generic API requests through external OpenCode base URL', async () => {
    const upstream = express();
    upstream.get('/api/config/providers', (_req, res) => {
      res.json({ ok: true, source: 'external-host' });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: 3902,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/config/providers`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, source: 'external-host' });
  });

  it('does not forward browser authorization when OpenCode has no auth', async () => {
    let seenAuthorization = 'not-requested';
    const upstream = express();
    upstream.get('/api/config/providers', (req, res) => {
      seenAuthorization = req.headers.authorization;
      res.json({ ok: true });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);

    const response = await fetch(`http://127.0.0.1:${proxyServer.address().port}/api/config/providers`, {
      headers: { Authorization: 'Bearer browser-secret' },
    });

    expect(response.status).toBe(200);
    expect(seenAuthorization).toBeUndefined();
  });

  it('lets mixed-case service headers override browser headers', async () => {
    let seenServiceHeader;
    const upstream = express();
    upstream.get('/api/config/providers', (req, res) => {
      seenServiceHeader = req.headers['x-service-header'];
      res.json({ ok: true });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({ 'X-Service-Header': 'trusted-value' }),
      buildOpenCodeUrl: (requestPath) => `http://127.0.0.1:${upstreamPort}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);

    const response = await fetch(`http://127.0.0.1:${proxyServer.address().port}/api/config/providers`, {
      headers: { 'x-service-header': 'browser-value' },
    });

    expect(response.status).toBe(200);
    expect(seenServiceHeader).toBe('trusted-value');
  });

  it('routes JSON and global events through rotated shared-service URL and auth', async () => {
    const credentials = ['Basic first-secret', 'Basic replacement-secret'];
    const received = [[], []];
    const upstreamServers = await Promise.all(credentials.map(async (credential, index) => {
      const upstream = express();
      upstream.get('/api/config/providers', (req, res) => {
        received[index].push({
          path: req.path,
          authorization: req.headers.authorization,
          serviceHeader: req.headers['x-service-header'],
        });
        res.json({ source: index });
      });
      upstream.get('/api/event', (req, res) => {
        received[index].push({
          path: req.path,
          authorization: req.headers.authorization,
          serviceHeader: req.headers['x-service-header'],
        });
        res.type('text/event-stream').send(`data: {"source":${index}}\n\n`);
      });
      return listen(upstream);
    }));
    [upstreamServer, replacementUpstreamServer] = upstreamServers;
    let active = 0;
    const sharedRuntime = {
      getBaseUrl: () => `http://127.0.0.1:${upstreamServers[active].address().port}`,
      getHeaders: () => ({ authorization: credentials[active], 'x-service-header': `service-${active}` }),
    };
    const connection = createOpenCodeConnectionAdapter({ kind: 'shared-local', sharedRuntime });
    const network = createOpenCodeNetworkRuntime({
      state: {},
      getOpenCodeBaseUrl: connection.getOpenCodeBaseUrl,
      getOpenCodeAuthHeaders: connection.getOpenCodeAuthHeaders,
    });
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamServers[active].address().port,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: network.getOpenCodeAuthHeaders,
      buildOpenCodeUrl: network.buildOpenCodeUrl,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyBase = `http://127.0.0.1:${proxyServer.address().port}`;

    const firstJson = await fetch(`${proxyBase}/api/config/providers`);
    const firstBody = await firstJson.text();
    expect(JSON.parse(firstBody)).toEqual({ source: 0 });
    active = 1;
    const secondJson = await fetch(`${proxyBase}/api/config/providers`);
    const secondBody = await secondJson.text();
    const eventResponse = await fetch(`${proxyBase}/api/global/event`);
    const eventBody = await eventResponse.text();

    expect(JSON.parse(secondBody)).toEqual({ source: 1 });
    expect(eventBody).toBe('data: {"source":1}\n\n');
    expect(received).toEqual([
      [{ path: '/api/config/providers', authorization: credentials[0], serviceHeader: 'service-0' }],
      [
        { path: '/api/config/providers', authorization: credentials[1], serviceHeader: 'service-1' },
        { path: '/api/event', authorization: credentials[1], serviceHeader: 'service-1' },
      ],
    ]);
    expect(firstJson.url).toBe(`${proxyBase}/api/config/providers`);
    expect(secondJson.url).toBe(`${proxyBase}/api/config/providers`);
    expect(eventResponse.url).toBe(`${proxyBase}/api/global/event`);
    for (const browserValue of [firstJson.url, secondJson.url, eventResponse.url, firstBody, secondBody, eventBody]) {
      expect(browserValue).not.toContain('first-secret');
      expect(browserValue).not.toContain('replacement-secret');
    }
  });

  it('replays parsed urlencoded bodies to generic API proxy requests', async () => {
    const upstream = express();
    upstream.post('/api/form', express.urlencoded({ extended: true }), (req, res) => {
      res.json({ body: req.body });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    app.use('/api', express.urlencoded({ extended: true }));
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/form`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ messageID: 'msg_1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: { messageID: 'msg_1' } });
  });

  it('replays parsed JSON bodies to generic API proxy requests', async () => {
    const upstream = express();
    upstream.post('/api/session/abc/prompt', express.json(), (req, res) => {
      res.json({
        body: req.body,
        authorization: req.headers.authorization,
        contentLength: req.headers['content-length'],
      });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    app.use('/api', express.json());
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer replay-token' }),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const payload = { messageID: 'msg_1', parts: [{ type: 'text', text: 'hello' }] };
    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/session/abc/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.body).toEqual(payload);
    expect(data.authorization).toBe('Bearer replay-token');
    expect(Number(data.contentLength)).toBeGreaterThan(0);
  });

  it.each([
    ['win32', ''],
    ['win32', '&directory=%2Flink%2Frepo'],
    ['linux', ''],
    ['linux', '&directory=%2Flink%2Frepo'],
  ])('sanitizes session pages and forwards query params (%s, %s)', async (platform, directoryQuery) => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    let seenQuery = null;
    let seenAuth = null;

    const upstream = express();
    upstream.get('/api/session', (req, res) => {
      seenQuery = req.query;
      seenAuth = req.headers.authorization ?? null;
      res.setHeader('X-Next-Cursor', '123');
      res.json({
        data: [
          {
            id: 'ses_1',
            projectID: 'proj_1',
            location: { directory: '/repo/app', workspaceID: 'ws_1' },
            subpath: 'app',
            parentID: 'ses_parent',
            title: 'Alpha',
            agent: 'build',
            model: { id: 'gpt-5', providerID: 'openai', variant: 'default' },
            time: { created: 1, updated: 2, archived: 3 },
            cost: 7,
            tokens: { input: 10, output: 20 },
            outcome: 'succeeded',
            fork: { sessionID: 'ses_source', boundary: { type: 'through' } },
            metadata: { openchamber: { kind: 'review', originalSessionID: 'ses_original' } },
            permissions: [{ action: 'deny', resources: ['*'] }],
            revert: { messageID: 'msg_1', partID: 'part_1', snapshot: 'abc123', files: ['a.ts'] },
          },
        ],
        cursor: { next: '123' },
      });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {
        promises: {
          realpath: async (value) => value === '/link/repo' ? '/real/repo' : value,
        },
      },
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer session-token' }),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/session?archived=false&limit=500&cursor=99&roots=true${directoryQuery}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-next-cursor')).toBe('123');
    expect(seenAuth).toBe('Bearer session-token');
    const expectedQuery = {
      archived: 'false',
      limit: '500',
      cursor: '99',
      roots: 'true',
    };
    if (directoryQuery) expectedQuery.directory = '/real/repo';
    expect(seenQuery).toEqual(expectedQuery);

    // The heavy parts of a revert and the per-session permission ruleset are
    // dropped; everything the list view reads survives.
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: 'ses_1',
          projectID: 'proj_1',
          location: { directory: '/repo/app', workspaceID: 'ws_1' },
          subpath: 'app',
          parentID: 'ses_parent',
          title: 'Alpha',
          agent: 'build',
          model: { id: 'gpt-5', providerID: 'openai', variant: 'default' },
          time: { created: 1, updated: 2, archived: 3 },
          cost: 7,
          tokens: { input: 10, output: 20 },
          outcome: 'succeeded',
          fork: { sessionID: 'ses_source', boundary: { type: 'through' } },
          metadata: { openchamber: { kind: 'review', originalSessionID: 'ses_original' } },
          revert: { messageID: 'msg_1', partID: 'part_1' },
        },
      ],
      cursor: { next: '123' },
    });
  });

  it.each([
    [200, { data: [], cursor: {} }],
    [503, { error: 'Upstream unavailable' }],
  ])('preserves Windows global list status and empty/error payload (%s)', async (status, payload) => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const upstream = express();
    upstream.get('/api/session', (_req, res) => res.status(status).json(payload));
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const baseUrl = `http://127.0.0.1:${upstreamPort}`;
    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: baseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${baseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const response = await fetch(`http://127.0.0.1:${proxyServer.address().port}/api/session?limit=1`);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(payload);
  });

  it('sanitizes session list responses without sanitizing session detail responses', async () => {
    let seenListQuery = null;

    const upstream = express();
    upstream.get('/api/session', (req, res) => {
      seenListQuery = req.query;
      res.json({
        data: [
          {
            id: 'ses_1',
            location: { directory: '/repo/app' },
            title: 'Alpha',
            time: { created: 1, updated: 2 },
            metadata: { custom: { value: 'kept' } },
            permissions: [{ action: 'deny', resources: ['*'] }],
            revert: { messageID: 'msg_1', partID: 'part_1', snapshot: 'abc123', files: ['a.ts'] },
          },
        ],
        cursor: {},
      });
    });
    upstream.get('/api/session/abc', (_req, res) => {
      res.json({
        id: 'abc',
        location: { directory: '/repo/app' },
        title: 'Detail',
        revert: { messageID: 'msg_1', snapshot: 'abc123', files: ['a.ts'] },
      });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {
        promises: {
          realpath: async (value) => value === '/link/repo' ? '/real/repo' : value,
        },
      },
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const listResponse = await fetch(`http://127.0.0.1:${proxyPort}/api/session?directory=%2Flink%2Frepo`);

    expect(listResponse.status).toBe(200);
    expect(seenListQuery).toMatchObject({ directory: '/real/repo' });
    await expect(listResponse.json()).resolves.toEqual({
      data: [
        {
          id: 'ses_1',
          location: { directory: '/repo/app' },
          title: 'Alpha',
          time: { created: 1, updated: 2 },
          metadata: { custom: { value: 'kept' } },
          revert: { messageID: 'msg_1', partID: 'part_1' },
        },
      ],
      cursor: {},
    });

    const detailResponse = await fetch(`http://127.0.0.1:${proxyPort}/api/session/abc`);

    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toEqual({
      id: 'abc',
      location: { directory: '/repo/app' },
      title: 'Detail',
      revert: { messageID: 'msg_1', snapshot: 'abc123', files: ['a.ts'] },
    });
  });

  it('folds OpenChamber-owned archive state and metadata onto sessions it serves', async () => {
    const upstream = express();
    upstream.get('/api/session', (_req, res) => {
      res.json({
        data: [
          { id: 'ses_1', location: { directory: '/repo/app' }, title: 'Alpha', time: { created: 1, updated: 2 }, metadata: { fromOpenCode: true, shared: 'theirs', removed: 'stale' } },
          { id: 'ses_2', location: { directory: '/repo/app' }, title: 'Beta', time: { created: 1, updated: 3, archived: 999 }, metadata: { openchamber: { reviewSessionID: 'ses_old' } } },
          { id: 'ses_3', metadata: { untouched: true } },
        ],
        cursor: {},
      });
    });
    upstream.get('/api/session/ses_1', (_req, res) => {
      res.json({ id: 'ses_1', location: { directory: '/repo/app' }, title: 'Alpha', metadata: { fromOpenCode: true, shared: 'theirs', removed: 'stale' } });
    });
    upstream.get('/api/session/ses_2', (_req, res) => {
      res.json({ id: 'ses_2', metadata: { openchamber: { reviewSessionID: 'ses_old' } } });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
      getArchivedSessions: async () => ({ ses_1: 4242 }),
      getStoredSessionMetadata: async () => ({
        ses_1: { fromOpenCode: true, openchamber: { goal: { status: 'active' } }, shared: 'ours' },
        ses_2: {},
      }),
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const list = await (await fetch(`http://127.0.0.1:${proxyPort}/api/session`)).json();
    // The seeded metadata includes unchanged upstream fields but excludes
    // deleted keys. Empty metadata is authoritative too.
    expect(list.data[0]).toMatchObject({
      id: 'ses_1',
      time: { created: 1, updated: 2, archived: 4242 },
      metadata: { fromOpenCode: true, shared: 'ours', openchamber: { goal: { status: 'active' } } },
    });
    expect(list.data[0].metadata).not.toHaveProperty('removed');
    expect(list.data[1].metadata).toEqual({});
    expect(list.data[2].metadata).toEqual({ untouched: true });
    // The archive file does not mention ses_2, so the stamp OpenCode carries
    // (a session migrated from v1) stays as it is.
    expect(list.data[1].time).toEqual({ created: 1, updated: 3, archived: 999 });

    const detail = await (await fetch(`http://127.0.0.1:${proxyPort}/api/session/ses_1`)).json();
    expect(detail).toMatchObject({
      id: 'ses_1',
      time: { archived: 4242 },
      metadata: { fromOpenCode: true, shared: 'ours', openchamber: { goal: { status: 'active' } } },
    });
    expect(detail.metadata).not.toHaveProperty('removed');
    const cleared = await (await fetch(`http://127.0.0.1:${proxyPort}/api/session/ses_2`)).json();
    expect(cleared.metadata).toEqual({});
  });

  it('forwards unparsed SDK JSON bodies to generic API proxy requests', async () => {
    const upstream = express();
    upstream.post('/api/session/abc/revert', express.json(), (req, res) => {
      res.json({
        body: req.body,
        contentLength: req.headers['content-length'],
      });
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const payload = { messageID: 'msg_1' };
    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/session/abc/revert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.body).toEqual(payload);
    expect(Number(data.contentLength)).toBeGreaterThan(0);
  });

  it('uses the long proxy timeout budget for slow upstream responses', async () => {
    const upstream = express();
    upstream.get('/api/slow', (_req, _res) => {
      // Leave the response open so the proxy timeout path is exercised.
    });
    upstreamServer = await listen(upstream);
    const upstreamPort = upstreamServer.address().port;
    const externalBaseUrl = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    registerOpenCodeProxy(app, {
      fs: {},
      os: {},
      path,
      OPEN_CODE_READY_GRACE_MS: 0,
      LONG_REQUEST_TIMEOUT_MS: 50,
      getRuntime: () => ({
        openCodePort: upstreamPort,
        openCodeBaseUrl: externalBaseUrl,
        isOpenCodeReady: true,
        openCodeNotReadySince: 0,
        isRestartingOpenCode: false,
      }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (requestPath) => `${externalBaseUrl}${requestPath}`,
      ensureOpenCodeApiPrefix: () => {},
    });
    proxyServer = await listen(app);
    const proxyPort = proxyServer.address().port;

    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/slow`, {
      signal: AbortSignal.timeout(2000),
    });

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ error: 'OpenCode upstream timed out' });
  });

});
