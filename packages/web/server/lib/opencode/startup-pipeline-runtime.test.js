import { describe, expect, it, vi } from 'vitest';

import { createStartupPipelineRuntime } from './startup-pipeline-runtime.js';

describe('startup pipeline runtime', () => {
  it('publishes the listening port before awaiting OpenCode bootstrap', async () => {
    const order = [];
    let releaseBootstrap;
    const bootstrapGate = new Promise((resolve) => { releaseBootstrap = resolve; });
    const runtime = createStartupPipelineRuntime({
      createTerminalRuntime: () => ({}),
      createDictationRuntime: () => ({}),
      createMessageStreamWsRuntime: () => ({}),
      createServerStartupRuntime: () => ({
        resolveBindHost: () => '127.0.0.1',
        startListeningAndMaybeTunnel: async ({ afterListening }) => {
          order.push('listen');
          await afterListening({ activePort: 3901, bindHost: '127.0.0.1' });
          order.push('ready');
          return { activePort: 3901 };
        },
        attachProcessHandlers: vi.fn(),
      }),
    });

    const run = runtime.run({
      app: {},
      setupProxy: vi.fn(),
      staticRoutesRuntime: { registerStaticRoutes: vi.fn() },
      apiOnly: false,
      tunnelRuntimeContext: {
        setActivePort: (port) => order.push(`port:${port}`),
      },
      bootstrapOpenCodeAtStartup: async () => {
        order.push('bootstrap');
        await bootstrapGate;
      },
      process: {},
      crypto: {},
      server: { close: (callback) => callback() },
      attachSignals: false,
    });

    await Promise.resolve();
    expect(order).toEqual(['listen', 'port:3901', 'bootstrap']);
    releaseBootstrap();
    await run;

    expect(order).toEqual(['listen', 'port:3901', 'bootstrap', 'ready']);
  });
});
