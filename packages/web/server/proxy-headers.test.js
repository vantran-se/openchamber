import { describe, expect, it } from 'vitest';

import {
  applyForwardProxyResponseHeaders,
  collectForwardProxyHeaders,
  shouldForwardProxyResponseHeader,
} from './proxy-headers.js';

describe('OpenCode proxy header handling', () => {
  it('drops accept-encoding from forwarded request headers', () => {
    const headers = collectForwardProxyHeaders({
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate, br',
      connection: 'keep-alive',
    });

    expect(headers.accept).toBe('application/json');
    expect(headers['accept-encoding']).toBeUndefined();
  });

  it('replaces client authorization with managed OpenCode auth', () => {
    const headers = collectForwardProxyHeaders(
      { authorization: 'Bearer oc_client_stale-ui-token' },
      { Authorization: 'Bearer managed-opencode-token' },
    );

    expect(headers.Authorization).toBe('Bearer managed-opencode-token');
    expect(headers['authorization']).toBeUndefined();
  });

  it('normalizes lowercase service authorization and preserves service headers', () => {
    const headers = collectForwardProxyHeaders(
      { authorization: 'Bearer oc_client_stale-ui-token' },
      { authorization: 'Basic shared-service-token', 'x-service-header': 'service-value' },
    );

    expect(headers.Authorization).toBe('Basic shared-service-token');
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-service-header']).toBe('service-value');
  });

  it('drops client authorization when upstream has no managed auth', () => {
    const headers = collectForwardProxyHeaders({
      accept: 'application/json',
      authorization: 'Bearer oc_client_stale-ui-token',
    });

    expect(headers['authorization']).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
    expect(headers.accept).toBe('application/json');
  });

  it('lets trusted service headers replace browser headers case-insensitively', () => {
    const headers = collectForwardProxyHeaders(
      { 'x-service-header': 'browser-value' },
      { 'X-Service-Header': 'trusted-value' },
    );

    expect(headers).toEqual({ 'X-Service-Header': 'trusted-value' });
  });

  it('drops content-encoding from forwarded response headers', () => {
    expect(shouldForwardProxyResponseHeader('content-encoding')).toBe(false);
    expect(shouldForwardProxyResponseHeader('Content-Encoding')).toBe(false);
  });

  it('drops transfer-encoding from forwarded response headers', () => {
    expect(shouldForwardProxyResponseHeader('transfer-encoding')).toBe(false);
    expect(shouldForwardProxyResponseHeader('Transfer-Encoding')).toBe(false);
  });

  it('still keeps ordinary response headers', () => {
    expect(shouldForwardProxyResponseHeader('content-type')).toBe(true);
    expect(shouldForwardProxyResponseHeader('etag')).toBe(true);
  });

  it('applies upstream response headers to express response without content-encoding', () => {
    const applied = [];
    const response = {
      setHeader(key, value) {
        applied.push([key, value]);
      },
    };

    applyForwardProxyResponseHeaders(
      new Headers({
        'content-type': 'application/json',
        etag: 'W/"abc"',
        'content-encoding': 'gzip',
      }),
      response,
    );

    expect(applied).toEqual([
      ['content-type', 'application/json'],
      ['etag', 'W/"abc"'],
    ]);
  });
});
