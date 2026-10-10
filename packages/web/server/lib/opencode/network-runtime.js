import { readOpenCodeInfo, isSupportedOpenCodeVersion } from './compatibility.js';
export const createOpenCodeNetworkRuntime = (deps) => {
  const {
    state,
    getOpenCodeBaseUrl,
    getOpenCodeAuthHeaders: readOpenCodeAuthHeaders,
    configuredOpenCodeHostname = '127.0.0.1',
  } = deps;

  const getOpenCodeAuthHeaders = () => Object.fromEntries(
    Object.entries(readOpenCodeAuthHeaders?.() ?? {}).map(([key, value]) => [
      key.toLowerCase() === 'authorization' ? 'Authorization' : key,
      value,
    ]),
  );

  const resolveConnectHostname = () => {
    const raw = typeof configuredOpenCodeHostname === 'string' ? configuredOpenCodeHostname.trim() : '';
    const hostname = raw || '127.0.0.1';
    if (hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]') {
      return '127.0.0.1';
    }
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      return hostname;
    }
    return hostname.includes(':') ? `[${hostname}]` : hostname;
  };

  const normalizeApiPrefix = (prefix) => {
    if (!prefix) {
      return '';
    }

    if (prefix.includes('://')) {
      try {
        const parsed = new URL(prefix);
        return normalizeApiPrefix(parsed.pathname);
      } catch {
        return '';
      }
    }

    const trimmed = prefix.trim();
    if (!trimmed || trimmed === '/') {
      return '';
    }
    const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
  };

  const waitForReady = async (url, timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let timeout = null;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 3000);
        // OpenCode 2.0.8 replaced `/api/health` with `/api/info`: a 200 is the
        // readiness signal, the payload carries no `healthy` field.
        const response = await fetch(`${url.replace(/\/+$/, '')}/api/info`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...getOpenCodeAuthHeaders(),
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        timeout = null;

        const info = await readOpenCodeInfo(response);
        if (info && isSupportedOpenCodeVersion(info.version)) return true;
      } catch {
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };

  const setDetectedOpenCodeApiPrefix = () => {
    state.openCodeApiPrefix = '';
    state.openCodeApiPrefixDetected = true;
    if (state.openCodeApiDetectionTimer) {
      clearTimeout(state.openCodeApiDetectionTimer);
      state.openCodeApiDetectionTimer = null;
    }
  };

  const buildOpenCodeUrl = (path, prefixOverride) => {
    const base = getOpenCodeBaseUrl?.() ?? state.openCodeBaseUrl;
    if (!base && !state.openCodePort) {
      throw new Error('OpenCode endpoint is not available');
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const prefix = normalizeApiPrefix(prefixOverride ?? '');
    const fallback = `http://${resolveConnectHostname()}:${state.openCodePort}`;
    return `${String(base ?? fallback).replace(/\/+$/, '')}${prefix}${normalizedPath}`;
  };

  const detectOpenCodeApiPrefix = () => {
    state.openCodeApiPrefixDetected = true;
    state.openCodeApiPrefix = '';
    return true;
  };

  const ensureOpenCodeApiPrefix = () => detectOpenCodeApiPrefix();

  const scheduleOpenCodeApiDetection = () => {
    return;
  };

  return {
    waitForReady,
    getOpenCodeAuthHeaders,
    normalizeApiPrefix,
    setDetectedOpenCodeApiPrefix,
    buildOpenCodeUrl,
    ensureOpenCodeApiPrefix,
    scheduleOpenCodeApiDetection,
  };
};
