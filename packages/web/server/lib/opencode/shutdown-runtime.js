export const createGracefulShutdownRuntime = (dependencies) => {
  const {
    process,
    shutdownTimeoutMs,
    getExitOnShutdown,
    getIsShuttingDown,
    setIsShuttingDown,
    syncToHmrState,
    openCodeWatcherRuntime,
    sessionRuntime,
    sessionAssistRuntime,
    sessionGoalRuntime,
    contextObligatoryRuntime,
    messageQueueRuntime,
    scheduledTasksRuntime,
    globalEventHub,
    getHealthCheckInterval,
    clearHealthCheckInterval,
    getTerminalRuntime,
    setTerminalRuntime,
    getMessageStreamRuntime,
    setMessageStreamRuntime,
    getOpenCodeConnectionKind,
    getOpenCodePort,
    getOpenCodeProcess,
    setOpenCodeProcess,
    killProcessOnPort,
    waitForPortRelease,
    disposeSharedOpenCodeService,
    getServer,
    getUiAuthController,
    setUiAuthController,
    getActiveTunnelController,
    setActiveTunnelController,
    tunnelAuthController,
    beginGuestServiceShutdown,
    stopAllGuestServices,
    getGuestSurfaceRuntime,
    getRealtimeProxyRuntime,
    getDictationRuntime,
    getRelayService,
    getRelayReconcileTimer,
    getSpacesHost = () => null,
  } = dependencies;

  let shutdownPromise = null;
  const serverConnections = new Set();
  let closingHttpServer = false;

  // Track TCP sockets before listen(): HTTP stops tracking them on upgrade,
  // even when no WebSocket handler completes the handshake.
  const trackServerConnections = (server) => {
    const onConnection = (socket) => {
      if (closingHttpServer) {
        socket.destroy();
        return;
      }
      serverConnections.add(socket);
      socket.once('close', () => serverConnections.delete(socket));
    };
    server.on('connection', onConnection);
    server.once('close', () => server.off('connection', onConnection));
  };

  const runShutdown = async (options = {}) => {
    if (getIsShuttingDown()) return;

    setIsShuttingDown(true);
    beginGuestServiceShutdown();
    syncToHmrState();
    console.log('Starting graceful shutdown...');
    const exitProcess = options.exitProcess === true || options.exitProcess === false
      ? options.exitProcess
      : getExitOnShutdown();

    // Both embedded stop() and daemon exits use this sequence. Close admission
    // synchronously above, then stop viewers before draining their services.
    const cleanupOperations = [
      () => clearInterval(getRelayReconcileTimer()),
      () => getGuestSurfaceRuntime()?.stop(),
      () => getRealtimeProxyRuntime()?.stop(),
      // The isolated-spaces host, when the switch is on: its connections into spaces end here.
      () => getSpacesHost()?.close(),
      () => getRelayService()?.stop(),
      () => getDictationRuntime()?.stop(),
      () => openCodeWatcherRuntime.stop(),
      () => globalEventHub.stop(),
      () => sessionRuntime.dispose(),
      () => sessionAssistRuntime?.stop?.(),
      () => sessionGoalRuntime?.stop?.(),
      () => contextObligatoryRuntime?.stop?.(),
      () => messageQueueRuntime?.stop?.(),
      () => scheduledTasksRuntime?.stop?.(),
      stopAllGuestServices,
    ];
    for (const cleanup of cleanupOperations) {
      try {
        await cleanup();
      } catch {
        // One failed runtime must not skip the rest of host teardown.
      }
    }

    const healthCheckInterval = getHealthCheckInterval();
    if (healthCheckInterval) {
      clearHealthCheckInterval(healthCheckInterval);
    }

    const terminalRuntime = getTerminalRuntime();
    if (terminalRuntime) {
      try {
        await terminalRuntime.shutdown();
      } catch {
      } finally {
        setTerminalRuntime(null);
      }
    }

    const messageStreamRuntime = getMessageStreamRuntime();
    if (messageStreamRuntime) {
      try {
        await messageStreamRuntime.close();
      } catch {
      } finally {
        setMessageStreamRuntime(null);
      }
    }

    const connectionKind = getOpenCodeConnectionKind();
    if (connectionKind === 'managed-owned') {
      const portToKill = getOpenCodePort();
      const openCodeProcess = getOpenCodeProcess();

      if (openCodeProcess) {
        console.log('Stopping OpenCode process...');
        try {
          await openCodeProcess.close();
        } catch (error) {
          console.warn('Error closing OpenCode process:', error);
        }
        setOpenCodeProcess(null);
      }

      killProcessOnPort(portToKill);
      if (!(await waitForPortRelease(portToKill, 5000))) {
        console.warn(`Timed out waiting for OpenCode port ${portToKill} to be released during shutdown`);
      }
    } else if (connectionKind === 'shared-local') {
      await disposeSharedOpenCodeService();
    }

    const server = getServer();
    if (server) {
      closingHttpServer = true;
      let closeTimeout = null;
      try {
        await Promise.race([
          new Promise((resolve) => {
            server.close(() => {
              console.log('HTTP server closed');
              resolve();
            });
            // The backend has stopped. Active SSE/HTTP clients must not keep
            // Desktop waiting for the outer shutdown deadline.
            server.closeAllConnections?.();
            // Includes upgraded sockets and reconnects accepted while the
            // services above were draining. No child-process grace is cut short.
            for (const socket of serverConnections) socket.destroy();
          }),
          new Promise((resolve) => {
            closeTimeout = setTimeout(() => {
              console.warn('Server close timeout reached, forcing shutdown');
              resolve();
            }, shutdownTimeoutMs);
          }),
        ]);
      } finally {
        if (closeTimeout) {
          clearTimeout(closeTimeout);
        }
      }
    }

    const uiAuthController = getUiAuthController();
    if (uiAuthController) {
      uiAuthController.dispose();
      setUiAuthController(null);
    }

    const activeTunnelController = getActiveTunnelController();
    if (activeTunnelController) {
      console.log('Stopping active tunnel...');
      activeTunnelController.stop();
      setActiveTunnelController(null);
      tunnelAuthController.clearActiveTunnel();
    }

    console.log('Graceful shutdown complete');
    if (exitProcess) {
      process.exit(0);
    }
  };

  const gracefulShutdown = (options = {}) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = runShutdown(options);
    return shutdownPromise;
  };

  return {
    gracefulShutdown,
    trackServerConnections,
  };
};
