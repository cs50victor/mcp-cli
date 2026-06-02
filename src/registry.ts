import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RegistryServer {
  name: string;
  description: string;
  recommended: {
    command: string;
    args: string[];
  };
  alternatives?: Array<{
    name: string;
    command: string;
    args: string[];
  }>;
  envVars?: string[];
  notes?: string;
}

export interface Registry {
  version: number;
  servers: RegistryServer[];
}

type LegacyRegistryServer = RegistryServer & {
  tools?: unknown;
  toolCount?: unknown;
};

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/cs50victor/mcpx/dev/registry/registry.json';

const STALE_MS = 3600 * 1000; // 1 hour
const REGISTRY_AUTH_TOKEN_ENV = 'MCPX_REGISTRY_AUTH_TOKEN';
const REGISTRY_AUTH_HEADER_TYPE_ENV = 'MCPX_REGISTRY_AUTH_HEADER_TYPE';
const REGISTRY_AUTH_HEADER_ENV = 'MCPX_REGISTRY_AUTH_HEADER';
const REGISTRY_RESOLVED_AUTH_VALUE_ENV =
  'MCPX_REGISTRY_RESOLVED_AUTH_HEADER_VALUE';

let memoryCache: Registry | null = null;

export interface RegistryAuthHeader {
  name: string;
  value: string;
  mcpRemoteValue: string;
  env: Record<string, string>;
}

export function getCachePath(): string {
  return join(homedir(), '.cache', 'mcpx', 'registry.json');
}

export function clearRegistryCache(): void {
  memoryCache = null;
}

export function getRegistryUrl(): string {
  return process.env.MCPX_REGISTRY_URL || DEFAULT_REGISTRY_URL;
}

function readEnv(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(process.env, name)
    ? process.env[name]
    : undefined;
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function requireHeaderName(name: string, source: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(
      `${source} must resolve to a valid HTTP header name, e.g. "x-api-key" or "Authorization".`,
    );
  }
}

function parseFullAuthHeader(rawHeader: string): RegistryAuthHeader {
  const header = stripMatchingQuotes(rawHeader);
  const separator = header.indexOf(':');
  const name = separator === -1 ? '' : header.slice(0, separator).trim();
  const value = separator === -1 ? '' : header.slice(separator + 1).trim();
  if (!name || !value) {
    throw new Error(
      'MCPX_REGISTRY_AUTH_HEADER must be "Name: value", e.g. "x-api-key: <key>" or "Authorization: Bearer <token>".',
    );
  }
  requireHeaderName(name, REGISTRY_AUTH_HEADER_ENV);
  return {
    name,
    value,
    mcpRemoteValue: `\${${REGISTRY_RESOLVED_AUTH_VALUE_ENV}}`,
    env: { [REGISTRY_RESOLVED_AUTH_VALUE_ENV]: value },
  };
}

function authHeaderFromToken(
  headerType: string,
  token: string,
): RegistryAuthHeader {
  const normalizedHeaderType = stripMatchingQuotes(headerType);
  const normalizedToken = stripMatchingQuotes(token);
  if (!normalizedHeaderType || !normalizedToken) {
    throw new Error(
      `${REGISTRY_AUTH_TOKEN_ENV} and ${REGISTRY_AUTH_HEADER_TYPE_ENV} must both be non-empty when either is set.`,
    );
  }

  const lowerHeaderType = normalizedHeaderType.toLowerCase();
  const tokenRef = `\${${REGISTRY_AUTH_TOKEN_ENV}}`;
  if (lowerHeaderType === 'bearer' || lowerHeaderType === 'basic') {
    const scheme = lowerHeaderType === 'bearer' ? 'Bearer' : 'Basic';
    return {
      name: 'Authorization',
      value: `${scheme} ${normalizedToken}`,
      mcpRemoteValue: `${scheme} ${tokenRef}`,
      env: { [REGISTRY_AUTH_TOKEN_ENV]: normalizedToken },
    };
  }

  requireHeaderName(normalizedHeaderType, REGISTRY_AUTH_HEADER_TYPE_ENV);
  return {
    name: normalizedHeaderType,
    value: normalizedToken,
    mcpRemoteValue: tokenRef,
    env: { [REGISTRY_AUTH_TOKEN_ENV]: normalizedToken },
  };
}

// Authenticated registries (e.g. a self-hosted tool server) can use split
// token/header-type env vars so shell or dotenv quoting cannot become part of
// the header. The legacy full-header env remains a fallback for compatibility.
export function registryAuthHeader(): RegistryAuthHeader | undefined {
  const token = readEnv(REGISTRY_AUTH_TOKEN_ENV);
  const headerType = readEnv(REGISTRY_AUTH_HEADER_TYPE_ENV);
  const hasToken = token !== undefined;
  const hasHeaderType = headerType !== undefined;

  if (hasToken || hasHeaderType) {
    if (!hasToken || !hasHeaderType) {
      throw new Error(
        `${REGISTRY_AUTH_TOKEN_ENV} and ${REGISTRY_AUTH_HEADER_TYPE_ENV} must be set together. ${REGISTRY_AUTH_HEADER_ENV} is only used when both are unset.`,
      );
    }
    return authHeaderFromToken(headerType ?? '', token ?? '');
  }

  const legacyHeader = readEnv(REGISTRY_AUTH_HEADER_ENV);
  if (legacyHeader === undefined || !legacyHeader.trim()) {
    return undefined;
  }
  return parseFullAuthHeader(legacyHeader);
}

export function registryFetchHeaders(): Record<string, string> | undefined {
  const authHeader = registryAuthHeader();
  if (!authHeader) {
    return undefined;
  }
  return { [authHeader.name]: authHeader.value };
}

function getRegistryUrlPrefix(): string | null {
  const url = getRegistryUrl();
  if (getLocalRegistryPath(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    if (parsed.pathname.endsWith('/registry.json')) {
      parsed.pathname = parsed.pathname.slice(0, -'registry.json'.length);
    } else if (!parsed.pathname.endsWith('/')) {
      parsed.pathname = `${parsed.pathname}/`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function registryMcpAuthHeader(
  mcpUrl: string,
): RegistryAuthHeader | undefined {
  const authHeader = registryAuthHeader();
  if (!authHeader) {
    return undefined;
  }

  const registryPrefix = getRegistryUrlPrefix();
  if (!registryPrefix) {
    return undefined;
  }

  try {
    const parsedMcpUrl = new URL(mcpUrl);
    parsedMcpUrl.search = '';
    parsedMcpUrl.hash = '';
    if (!parsedMcpUrl.toString().startsWith(registryPrefix)) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return authHeader;
}

async function isCacheFresh(): Promise<boolean> {
  try {
    const { mtime } = await stat(getCachePath());
    return Date.now() - mtime.getTime() < STALE_MS;
  } catch {
    return false;
  }
}

async function readDiskCache(): Promise<Registry | null> {
  try {
    const content = await readFile(getCachePath(), 'utf-8');
    return normalizeRegistry(JSON.parse(content) as Registry);
  } catch {
    return null;
  }
}

async function writeDiskCache(registry: Registry): Promise<void> {
  try {
    const cachePath = getCachePath();
    await mkdir(join(homedir(), '.cache', 'mcpx'), { recursive: true });
    await writeFile(cachePath, JSON.stringify(normalizeRegistry(registry)));
  } catch {
    // NOTE(victor): silently ignore cache write failures - cache is optional optimization
  }
}

function normalizeRegistryServer(server: LegacyRegistryServer): RegistryServer {
  const { tools: _tools, toolCount: _toolCount, ...normalized } = server;
  return normalized;
}

function normalizeRegistry(registry: Registry): Registry {
  return {
    ...registry,
    servers: registry.servers.map((server) => normalizeRegistryServer(server)),
  };
}

function getLocalRegistryPath(url: string): string | null {
  if (url.startsWith('file://')) {
    return url.slice(7);
  }
  if (!url.startsWith('http')) {
    return url.startsWith('/') ? url : join(process.cwd(), url);
  }
  return null;
}

async function fetchFreshRegistry(url: string): Promise<Registry> {
  const localPath = getLocalRegistryPath(url);
  if (localPath) {
    const content = await readFile(localPath, 'utf-8');
    const registry = normalizeRegistry(JSON.parse(content) as Registry);
    memoryCache = registry;
    return registry;
  }

  const response = await fetch(url, { headers: registryFetchHeaders() });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch registry: ${response.status} ${response.statusText}`,
    );
  }
  const registry = normalizeRegistry((await response.json()) as Registry);
  await writeDiskCache(registry);
  memoryCache = registry;
  return registry;
}

export async function refreshRegistry(): Promise<Registry> {
  clearRegistryCache();
  return fetchFreshRegistry(getRegistryUrl());
}

export async function fetchRegistry(): Promise<Registry> {
  // 1. Check memory cache
  if (memoryCache) {
    return memoryCache;
  }

  // Validate auth config up front so a malformed MCPX_REGISTRY_AUTH_HEADER fails
  // fast with a clear message instead of being masked as a network error below.
  registryFetchHeaders();

  const url = getRegistryUrl();

  // 2. For local files, skip disk cache (used in tests and local development)
  if (getLocalRegistryPath(url)) {
    return fetchFreshRegistry(url);
  }

  // 3. Check disk cache freshness
  if (await isCacheFresh()) {
    const cached = await readDiskCache();
    if (cached) {
      memoryCache = cached;
      return cached;
    }
  }

  // 4. Fetch from network
  try {
    return await fetchFreshRegistry(url);
  } catch (err) {
    // 5. Fallback to stale cache on network error
    const staleCache = await readDiskCache();
    if (staleCache) {
      console.error(
        '[mcpx] Warning: Using stale registry cache (network error)',
      );
      memoryCache = staleCache;
      return staleCache;
    }
    throw err;
  }
}

export function findServer(
  registry: Registry,
  name: string,
): RegistryServer | undefined {
  return registry.servers.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
}
