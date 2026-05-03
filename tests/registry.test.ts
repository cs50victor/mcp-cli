import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  getRegistryUrl,
  fetchRegistry,
  findServer,
  clearRegistryCache,
  getCachePath,
} from '../src/registry';

const LOCAL_REGISTRY_PATH = join(import.meta.dir, '../registry/registry.json');

describe('registry', () => {
  const originalEnv = process.env.MCPX_REGISTRY_URL;

  beforeEach(() => {
    process.env.MCPX_REGISTRY_URL = LOCAL_REGISTRY_PATH;
    clearRegistryCache();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MCPX_REGISTRY_URL;
    } else {
      process.env.MCPX_REGISTRY_URL = originalEnv;
    }
    clearRegistryCache();
  });

  describe('getRegistryUrl', () => {
    test('should_return_default_url_when_no_env_var', () => {
      delete process.env.MCPX_REGISTRY_URL;
      const url = getRegistryUrl();
      expect(url).toContain('github');
      expect(url).toContain('registry.json');
    });

    test('should_return_env_var_url_when_set', () => {
      process.env.MCPX_REGISTRY_URL = 'http://localhost:8000/custom.json';
      const url = getRegistryUrl();
      expect(url).toBe('http://localhost:8000/custom.json');
    });
  });

  describe('fetchRegistry', () => {
    test('should_return_registry_with_servers', async () => {
      const registry = await fetchRegistry();
      expect(registry.version).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(registry.servers)).toBe(true);
      expect(registry.servers.length).toBeGreaterThan(0);
    });

    test('should_have_valid_server_structure_without_static_tools', async () => {
      const registry = await fetchRegistry();
      const server = registry.servers[0];
      expect(typeof server.name).toBe('string');
      expect(typeof server.description).toBe('string');
      expect(server.recommended).toBeDefined();
      expect('tools' in server).toBe(false);
      expect('toolCount' in server).toBe(false);
    });

    test('should_find_filesystem_server', async () => {
      const registry = await fetchRegistry();
      const fs = registry.servers.find((s) => s.name === 'filesystem');
      expect(fs).toBeDefined();
      expect(fs!.description).toContain('file');
      expect('tools' in fs!).toBe(false);
    });

    test('strips_legacy_static_tool_fields_from_registry_payloads', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'mcpx-registry-'));
      try {
        const registryPath = join(tempDir, 'registry.json');
        await writeFile(
          registryPath,
          JSON.stringify({
            version: 1,
            servers: [
              {
                name: 'legacy',
                description: 'Legacy payload',
                toolCount: 1,
                recommended: { command: 'echo', args: ['ok'] },
                tools: ['stale_tool'],
              },
            ],
          }),
        );

        process.env.MCPX_REGISTRY_URL = registryPath;
        clearRegistryCache();
        const registry = await fetchRegistry();
        expect('tools' in registry.servers[0]).toBe(false);
        expect('toolCount' in registry.servers[0]).toBe(false);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

  });

  describe('RegistryServer type', () => {
    test('should_have_optional_envVars_and_notes', async () => {
      const registry = await fetchRegistry();
      const braveSearch = registry.servers.find(
        (s) => s.name === 'brave-search',
      );
      expect(braveSearch).toBeDefined();
      expect(braveSearch!.envVars).toBeDefined();
      expect(braveSearch!.envVars).toContain('BRAVE_API_KEY');
      expect(braveSearch!.notes).toBeDefined();
    });
  });

  describe('findServer', () => {
    test('should_find_server_by_exact_name', async () => {
      const registry = await fetchRegistry();
      const server = findServer(registry, 'filesystem');
      expect(server).toBeDefined();
      expect(server!.name).toBe('filesystem');
    });

    test('should_find_server_case_insensitively', async () => {
      const registry = await fetchRegistry();
      const server = findServer(registry, 'FILESYSTEM');
      expect(server).toBeDefined();
      expect(server!.name).toBe('filesystem');
    });

    test('should_return_undefined_for_unknown_server', async () => {
      const registry = await fetchRegistry();
      const server = findServer(registry, 'nonexistent');
      expect(server).toBeUndefined();
    });
  });

  describe('caching', () => {
    test('should_return_cached_registry_on_second_call', async () => {
      const registry1 = await fetchRegistry();
      const registry2 = await fetchRegistry();
      expect(registry1).toBe(registry2);
    });

    test('should_clear_memory_cache_when_clearRegistryCache_called', async () => {
      const registry1 = await fetchRegistry();
      clearRegistryCache();
      const registry2 = await fetchRegistry();
      expect(registry1).not.toBe(registry2);
      expect(registry1.servers.length).toBe(registry2.servers.length);
    });

    test('getCachePath_should_return_path_under_home_cache', () => {
      const cachePath = getCachePath();
      expect(cachePath).toContain('.cache');
      expect(cachePath).toContain('mcpx');
      expect(cachePath).toContain('registry.json');
    });
  });
});
