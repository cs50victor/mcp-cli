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

let memoryCache: Registry | null = null;

export function getCachePath(): string {
  return join(homedir(), '.cache', 'mcpx', 'registry.json');
}

export function clearRegistryCache(): void {
  memoryCache = null;
}

export function getRegistryUrl(): string {
  return process.env.MCPX_REGISTRY_URL || DEFAULT_REGISTRY_URL;
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

  const response = await fetch(url);
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
