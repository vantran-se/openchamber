import { describe, expect, test, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createServerStartupRuntime } from './server-startup-runtime.js';

/**
 * The desktop app embeds this server and nothing restarts it, so shutting down
 * on a single uncaught exception turned every stray socket error into "the
 * instance is unreachable until restarted". Only a sustained storm shuts down.
 */
describe('server startup readiness', () => {
  test('reports daemon ready only after listener-dependent startup finishes', async () => {
    const order = [];
    const fakeProcess = {
      connected: true,
      send: mock((message, callback) => {
        order.push(message.type);
        callback();
      }),
    };
    const server = new EventEmitter();
    server.address = () => ({ port: 3901 });
    server.listen = (_port, _host, callback) => callback();
    const runtime = createServerStartupRuntime({
      process: fakeProcess,
      crypto: {},
      server,
      readSettingsFromDiskMigrated: async () => ({}),
      tunnelAuthController: {},
    });

    await runtime.startListeningAndMaybeTunnel({
      port: 0,
      bindHost: '127.0.0.1',
      afterListening: async () => order.push('prepared'),
    });

    expect(order).toEqual(['prepared', 'openchamber:ready']);
  });

  test('closes the listener and reports startup failure when listener-dependent startup fails', async () => {
    const sent = [];
    const fakeProcess = {
      connected: true,
      send: mock((message, callback) => {
        sent.push(message);
        callback();
      }),
    };
    const server = new EventEmitter();
    server.address = () => ({ port: 3901 });
    server.listen = (_port, _host, callback) => callback();
    server.close = mock((callback) => callback());
    server.closeAllConnections = mock(() => {});
    const runtime = createServerStartupRuntime({ process: fakeProcess, crypto: {}, server });
    const startupError = Object.assign(new Error('shared service rejected'), {
      code: 'OPENCODE_INCOMPATIBLE',
    });

    await expect(runtime.startListeningAndMaybeTunnel({
      port: 0,
      bindHost: '127.0.0.1',
      afterListening: async () => { throw startupError; },
    })).rejects.toBe(startupError);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([expect.objectContaining({
      type: 'openchamber:error',
      code: 'OPENCODE_INCOMPATIBLE',
    })]);
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'openchamber:ready' }));
  });

});

describe('uncaught exception policy', () => {
  const setup = () => {
    const fakeProcess = new EventEmitter();
    let shutdowns = 0;
    const runtime = createServerStartupRuntime({
      process: fakeProcess,
      gracefulShutdown: () => { shutdowns += 1; },
      getSignalsAttached: () => true,
      setSignalsAttached: () => {},
      syncToHmrState: () => {},
    });
    runtime.attachProcessHandlers({ attachSignals: false });
    return { fakeProcess, shutdowns: () => shutdowns };
  };

  test('a single uncaught exception keeps the server running', () => {
    const { fakeProcess, shutdowns } = setup();
    fakeProcess.emit('uncaughtException', new Error('setTypeOfService EINVAL'));
    expect(shutdowns()).toBe(0);
  });

  test('a storm of uncaught exceptions still shuts down', () => {
    const { fakeProcess, shutdowns } = setup();
    for (let i = 0; i < 11; i += 1) {
      fakeProcess.emit('uncaughtException', new Error(`stray ${i}`));
    }
    expect(shutdowns()).toBeGreaterThan(0);
  });

  test('an unhandled rejection is logged without shutting down', () => {
    const { fakeProcess, shutdowns } = setup();
    fakeProcess.emit('unhandledRejection', new Error('late failure'), Promise.resolve());
    expect(shutdowns()).toBe(0);
  });
});
