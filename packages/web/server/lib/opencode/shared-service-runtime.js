import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Service } from '@opencode/client/service';
import { z } from 'zod';

import { isSupportedOpenCodeVersion, readOpenCodeInfo } from './compatibility.js';

const endpointSchema = z.object({
  url: z.string(),
  auth: z.object({
    type: z.literal('basic'),
    username: z.string(),
    password: z.string(),
  }).optional(),
});

const createConnectionError = (code, message, details = {}, cause) => {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  Object.assign(error, details);
  return error;
};

const unavailableError = (message, cause) => createConnectionError(
  'OPENCODE_SERVICE_UNAVAILABLE',
  message,
  {},
  cause,
);

const normalizeEndpoint = (endpoint) => {
  const parsed = endpointSchema.safeParse(endpoint);
  if (!parsed.success) {
    throw unavailableError('OpenCode shared service did not return an endpoint');
  }

  let url;
  try {
    url = new URL(parsed.data.url);
  } catch (cause) {
    throw unavailableError('OpenCode shared service returned an invalid URL', cause);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    throw unavailableError('OpenCode shared service returned an unsupported URL');
  }

  return { ...parsed.data, url: url.origin };
};

const defaultRegistrationFile = () => join(
  process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
  'opencode',
  'service.json',
);

const registrationExists = async (options = {}) => {
  try {
    await access(options.file ?? defaultRegistrationFile());
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

export const createSharedOpenCodeServiceRuntime = ({
  service = Service,
  fetchImpl = fetch,
  ensureOptions,
  readInfo = readOpenCodeInfo,
  isSupportedVersion = isSupportedOpenCodeVersion,
  hasRegistration = registrationExists,
}) => {
  let activeConnection = null;

  const resolveEndpoint = async () => {
    let discovered;
    try {
      discovered = await service.discover(ensureOptions);
    } catch (cause) {
      throw unavailableError('Could not discover the OpenCode shared service', cause);
    }
    if (discovered) return normalizeEndpoint(discovered);

    try {
      if (await hasRegistration(ensureOptions)) {
        throw unavailableError(
          'An incompatible or unhealthy OpenCode shared service is already registered',
        );
      }
    } catch (cause) {
      if (cause?.code === 'OPENCODE_SERVICE_UNAVAILABLE') throw cause;
      throw unavailableError('Could not inspect the OpenCode shared service registration', cause);
    }
    try {
      return normalizeEndpoint(await service.ensure(ensureOptions));
    } catch (cause) {
      if (cause?.code === 'OPENCODE_SERVICE_UNAVAILABLE') throw cause;
      throw unavailableError('Could not start the OpenCode shared service', cause);
    }
  };

  const probe = async (endpoint) => {
    let headers;
    try {
      headers = { ...(service.headers(endpoint) ?? {}) };
    } catch (cause) {
      throw unavailableError('Could not authenticate with the OpenCode shared service', cause);
    }
    let info;
    try {
      const response = await fetchImpl(new URL('/api/info', endpoint.url), {
        headers: { Accept: 'application/json', ...headers },
      });
      info = await readInfo(response);
    } catch (cause) {
      throw unavailableError('Could not reach the OpenCode shared service', cause);
    }
    if (!info) {
      throw unavailableError('OpenCode shared service did not return valid service information');
    }
    if (!isSupportedVersion(info.version)) {
      throw createConnectionError(
        'OPENCODE_INCOMPATIBLE',
        `OpenCode shared service version ${info.version} is incompatible`,
        { foundVersion: info.version },
      );
    }

    return {
      kind: 'shared-local',
      endpoint,
      version: info.version,
    };
  };

  const establishConnection = async () => {
    const replacement = await probe(await resolveEndpoint());
    activeConnection = replacement;
    return replacement;
  };

  return {
    connect: establishConnection,
    recover: establishConnection,
    getConnection: () => activeConnection,
    getBaseUrl: () => activeConnection?.endpoint.url ?? null,
    getHeaders: () => activeConnection ? { ...(service.headers(activeConnection.endpoint) ?? {}) } : {},
    dispose: async () => {
      activeConnection = null;
    },
  };
};
