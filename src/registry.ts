import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RegistryServer {
  name: string;
  description: string;
  toolCount: number;
  recommended: {
    command: string;
    args: string[];
  };
  alternatives?: Array<{
    name: string;
    command: string;
    args: string[];
  }>;
  tools: string[];
  envVars?: string[];
  notes?: string;
}

export interface Registry {
  version: number;
  servers: RegistryServer[];
}

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
    return JSON.parse(content) as Registry;
  } catch {
    return null;
  }
}

async function writeDiskCache(registry: Registry): Promise<void> {
  try {
    const cachePath = getCachePath();
    await mkdir(join(homedir(), '.cache', 'mcpx'), { recursive: true });
    await writeFile(cachePath, JSON.stringify(registry));
  } catch {
    // NOTE(victor): silently ignore cache write failures - cache is optional optimization
  }
}

export async function fetchRegistry(): Promise<Registry> {
  // 1. Check memory cache
  if (memoryCache) {
    return memoryCache;
  }

  const url = getRegistryUrl();

  // 2. For local files, skip disk cache (used in tests and local development)
  if (url.startsWith('file://') || !url.startsWith('http')) {
    const filePath = url.startsWith('file://')
      ? url.slice(7)
      : url.startsWith('/')
        ? url
        : join(process.cwd(), url);
    const content = await readFile(filePath, 'utf-8');
    const registry = JSON.parse(content) as Registry;
    memoryCache = registry;
    return registry;
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch registry: ${response.status} ${response.statusText}`,
      );
    }
    const registry = (await response.json()) as Registry;

    // 5. Write to disk cache
    await writeDiskCache(registry);
    memoryCache = registry;
    return registry;
  } catch (err) {
    // 6. Fallback to stale cache on network error
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
