import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAdHocConfig,
  computeConfigHash,
  findDisabledMatch,
  getServerConfig,
  isDaemonAutoServer,
  isHttpServer,
  isStdioServer,
  isToolAllowedByServerConfig,
  listServerNames,
  loadConfig,
  loadDisabledTools,
} from '../src/config';
import { clearRegistryCache, refreshRegistry } from '../src/registry';

const LOCAL_REGISTRY_PATH = join(
  import.meta.dir,
  '..',
  'registry',
  'registry.json',
);

describe('config', () => {
  const originalRegistryUrl = process.env.MCPX_REGISTRY_URL;
  const originalFetch = globalThis.fetch;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await realpath(
      await mkdtemp(join(tmpdir(), 'mcpx-config-test-')),
    );
    process.env.MCPX_REGISTRY_URL = LOCAL_REGISTRY_PATH;
    clearRegistryCache();
  });

  afterEach(async () => {
    clearRegistryCache();
    await rm(tempDir, { recursive: true, force: true });
    process.env.MCP_CONFIG_PATH = undefined;
    process.env.MCPX_USE_LOCAL_CONFIG = undefined;
    process.env.MCP_STRICT_ENV = undefined;
    process.env.MCP_DISABLED_TOOLS = undefined;
    process.env.MCP_DAEMON_AUTO = undefined;
    process.env.MCPX_REGISTRY_AUTH_TOKEN = undefined;
    process.env.MCPX_REGISTRY_AUTH_HEADER_TYPE = undefined;
    process.env.TEST_MCP_TOKEN = undefined;
    process.env.TEST_CONFIG_ENV_SET = undefined;
    process.env.TEST_CONFIG_ENV_MISSING = undefined;
    process.env.TEST_CONFIG_ENV_OTHER = undefined;
    process.env.ANOTHER_NONEXISTENT_VAR = undefined;
    process.env.NONEXISTENT_VAR = undefined;
    globalThis.fetch = originalFetch;

    if (originalRegistryUrl === undefined) {
      process.env.MCPX_REGISTRY_URL = undefined;
    } else {
      process.env.MCPX_REGISTRY_URL = originalRegistryUrl;
    }
  });

  describe('loadConfig', () => {
    test('returns empty config when no config is provided', async () => {
      const config = await loadConfig(undefined, { allowEmpty: true });
      expect(config.mcpServers).toEqual({});
      expect(config._configSource).toBe('registry');
    });

    test('ignores local config files unless MCPX_USE_LOCAL_CONFIG is set', async () => {
      const configPath = join(tempDir, '.mcp.json');
      const originalCwd = process.cwd();
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: { command: 'echo', args: ['hello'] },
          },
        }),
      );

      process.chdir(tempDir);

      try {
        const config = await loadConfig(undefined, { allowEmpty: true });
        expect(config.mcpServers).toEqual({});
        expect(config._configSource).toBe('registry');
      } finally {
        process.chdir(originalCwd);
      }
    });

    test('discovers local config files when MCPX_USE_LOCAL_CONFIG=1', async () => {
      const configPath = join(tempDir, '.mcp.json');
      const originalCwd = process.cwd();
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: { command: 'echo', args: ['hello'] },
          },
        }),
      );

      process.env.MCPX_USE_LOCAL_CONFIG = '1';
      process.chdir(tempDir);

      try {
        const config = await loadConfig(undefined, { allowEmpty: true });
        expect(config.mcpServers.test).toBeDefined();
        expect(config._configSource).toBe(configPath);
      } finally {
        process.chdir(originalCwd);
      }
    });

    test('loads valid config from explicit file path', async () => {
      const configPath = join(tempDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: { command: 'echo', args: ['hello'] },
          },
        }),
      );

      const config = await loadConfig(configPath);

      expect(config.mcpServers.test).toBeDefined();
      expect((config.mcpServers.test as { command: string }).command).toBe(
        'echo',
      );
      expect(config._configSource).toBe(configPath);
    });

    test('loads config from MCP_CONFIG_PATH', async () => {
      const configPath = join(tempDir, 'project.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            test: { url: 'https://example.com' },
          },
        }),
      );

      process.env.MCP_CONFIG_PATH = configPath;

      const config = await loadConfig();

      expect((config.mcpServers.test as { url: string }).url).toBe(
        'https://example.com',
      );
      expect(config._configSource).toBe(configPath);
    });

    test('throws on missing config file', async () => {
      await expect(loadConfig('/nonexistent/path.json')).rejects.toThrow(
        'Config file not found',
      );
    });

    test('loads valid wrapped inline config', async () => {
      const config = await loadConfig(
        JSON.stringify({
          mcpServers: {
            test: { command: 'echo', args: ['hello'] },
          },
        }),
      );

      expect(config.mcpServers.test).toBeDefined();
      expect((config.mcpServers.test as { command: string }).command).toBe(
        'echo',
      );
      expect(config._configSource).toBe('inline');
    });

    test('loads valid flat inline config', async () => {
      const config = await loadConfig(
        JSON.stringify({
          test: { command: 'echo', args: ['hello'] },
          http: { url: 'https://example.com' },
        }),
      );

      expect(config.mcpServers.test).toBeDefined();
      expect(config.mcpServers.http).toBeDefined();
    });

    test('parses inline JSON with whitespace prefix', async () => {
      const config = await loadConfig(
        '  {"mcpServers":{"test":{"url":"http://localhost"}}}',
      );
      expect((config.mcpServers.test as { url: string }).url).toBe(
        'http://localhost',
      );
    });

    test('throws on invalid inline JSON', async () => {
      await expect(loadConfig('{mcpServers: invalid}')).rejects.toThrow(
        'Invalid JSON',
      );
    });

    test('treats unknown top-level objects as flat-format servers and validates them', async () => {
      await expect(loadConfig('{"servers":{}}')).rejects.toThrow(
        'missing required field',
      );
    });

    test('substitutes environment variables', async () => {
      process.env.TEST_MCP_TOKEN = 'secret123';

      const config = await loadConfig(
        JSON.stringify({
          mcpServers: {
            test: {
              url: 'https://example.com',
              headers: { Authorization: 'Bearer ${TEST_MCP_TOKEN}' },
            },
          },
        }),
      );

      const server = config.mcpServers.test as {
        headers: Record<string, string>;
      };
      expect(server.headers.Authorization).toBe('Bearer secret123');
    });

    test('handles missing env vars gracefully with MCP_STRICT_ENV=false', async () => {
      process.env.MCP_STRICT_ENV = 'false';

      const config = await loadConfig(
        JSON.stringify({
          mcpServers: {
            test: {
              command: 'echo',
              env: { TOKEN: '${NONEXISTENT_VAR}' },
            },
          },
        }),
      );

      const server = config.mcpServers.test as {
        env: Record<string, string>;
      };
      expect(server.env.TOKEN).toBe('');
    });

    test('throws error on missing env vars in strict mode (default)', async () => {
      await expect(
        loadConfig(
          JSON.stringify({
            mcpServers: {
              test: {
                command: 'echo',
                env: { TOKEN: '${ANOTHER_NONEXISTENT_VAR}' },
              },
            },
          }),
        ),
      ).rejects.toThrow('MISSING_ENV_VAR');
    });

    test('throws error on empty server config', async () => {
      await expect(
        loadConfig(
          JSON.stringify({
            mcpServers: {
              badserver: {},
            },
          }),
        ),
      ).rejects.toThrow('missing required field');
    });

    test('throws error on server with both command and url', async () => {
      await expect(
        loadConfig(
          JSON.stringify({
            mcpServers: {
              mixed: {
                command: 'echo',
                url: 'https://example.com',
              },
            },
          }),
        ),
      ).rejects.toThrow('both "command" and "url"');
    });

    test('throws error on null server config', async () => {
      await expect(
        loadConfig(
          JSON.stringify({
            mcpServers: {
              nullserver: null,
            },
          }),
        ),
      ).rejects.toThrow('Invalid server configuration');
    });

    test('warns but does not error on empty inline config', async () => {
      const config = await loadConfig('{}');
      expect(Object.keys(config.mcpServers).length).toBe(0);
    });
  });

  describe('getServerConfig', () => {
    test('returns inline server config by name', async () => {
      const config = await loadConfig(
        JSON.stringify({
          mcpServers: {
            server1: { command: 'cmd1' },
            server2: { command: 'cmd2' },
          },
        }),
      );

      const server = await getServerConfig(config, 'server1');
      expect((server as { command: string }).command).toBe('cmd1');
    });

    test('throws on unknown server not in registry', async () => {
      const config = await loadConfig(
        JSON.stringify({
          mcpServers: { known: { command: 'cmd' } },
        }),
      );

      await expect(
        getServerConfig(config, 'totally-unknown-xyz'),
      ).rejects.toThrow('not found');
    });

    test('uses registry defaults when server is not defined inline', async () => {
      const config = await loadConfig(undefined, { allowEmpty: true });
      const server = await getServerConfig(config, 'filesystem');

      expect((server as { command: string }).command).toBe('bunx');
      expect((server as { args?: string[] }).args).toContain(
        '@modelcontextprotocol/server-filesystem',
      );
    });

    test('registry env notice filters variables already set locally', async () => {
      const registryPath = join(tempDir, 'registry.json');
      await writeFile(
        registryPath,
        JSON.stringify({
          version: 1,
          servers: [
            {
              name: 'env-test',
              description: 'Env test',
              recommended: { command: 'echo', args: ['ok'] },
              envVars: ['TEST_CONFIG_ENV_SET', 'TEST_CONFIG_ENV_MISSING'],
            },
          ],
        }),
      );
      process.env.MCPX_REGISTRY_URL = registryPath;
      process.env.TEST_CONFIG_ENV_SET = 'set';
      process.env.TEST_CONFIG_ENV_MISSING = undefined;
      const messages: string[] = [];
      const originalConsoleError = console.error;
      console.error = (message?: unknown) => {
        messages.push(String(message));
      };
      clearRegistryCache();

      try {
        const config = await loadConfig(undefined, { allowEmpty: true });
        await getServerConfig(config, 'env-test');
      } finally {
        console.error = originalConsoleError;
      }

      expect(messages).toContain('[mcpx] Environment: TEST_CONFIG_ENV_MISSING');
      expect(messages.join('\n')).not.toContain('TEST_CONFIG_ENV_SET');
      expect(messages.join('\n')).not.toContain('Required env vars');
    });

    test('registry env notice is omitted when all variables are set locally', async () => {
      const registryPath = join(tempDir, 'registry.json');
      await writeFile(
        registryPath,
        JSON.stringify({
          version: 1,
          servers: [
            {
              name: 'env-test',
              description: 'Env test',
              recommended: { command: 'echo', args: ['ok'] },
              envVars: ['TEST_CONFIG_ENV_SET', 'TEST_CONFIG_ENV_OTHER'],
            },
          ],
        }),
      );
      process.env.MCPX_REGISTRY_URL = registryPath;
      process.env.TEST_CONFIG_ENV_SET = 'set';
      process.env.TEST_CONFIG_ENV_OTHER = 'other';
      const messages: string[] = [];
      const originalConsoleError = console.error;
      console.error = (message?: unknown) => {
        messages.push(String(message));
      };
      clearRegistryCache();

      try {
        const config = await loadConfig(undefined, { allowEmpty: true });
        await getServerConfig(config, 'env-test');
      } finally {
        console.error = originalConsoleError;
      }

      expect(messages.join('\n')).not.toContain('[mcpx] Environment:');
    });

    test('injects_registry_auth_into_matching_mcp_remote_urls', async () => {
      process.env.MCPX_REGISTRY_URL =
        'https://tools.example.test/registry.json';
      process.env.MCPX_REGISTRY_AUTH_TOKEN = "'secret-key'";
      process.env.MCPX_REGISTRY_AUTH_HEADER_TYPE = 'x-api-key';
      globalThis.fetch = (async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        expect(init?.headers).toEqual({ 'x-api-key': 'secret-key' });
        return new Response(
          JSON.stringify({
            version: 1,
            servers: [
              {
                name: 'github',
                description: 'GitHub MCP',
                recommended: {
                  command: 'bunx',
                  args: [
                    '-y',
                    'mcp-remote',
                    'https://tools.example.test/mcp/default/github/',
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;
      clearRegistryCache();
      await refreshRegistry();

      const config = await loadConfig(undefined, { allowEmpty: true });
      const server = (await getServerConfig(config, 'github')) as {
        command: string;
        args: string[];
        env: Record<string, string>;
      };

      expect(server.command).toBe('bunx');
      expect(server.args).toEqual([
        '-y',
        'mcp-remote',
        '--header',
        'x-api-key: ${MCPX_REGISTRY_AUTH_TOKEN}',
        'https://tools.example.test/mcp/default/github/',
      ]);
      expect(server.args.join(' ')).not.toContain('secret-key');
      expect(server.env).toEqual({ MCPX_REGISTRY_AUTH_TOKEN: 'secret-key' });
    });

    test('does_not_inject_registry_auth_into_external_mcp_remote_urls', async () => {
      process.env.MCPX_REGISTRY_URL =
        'https://tools.example.test/registry.json';
      process.env.MCPX_REGISTRY_AUTH_TOKEN = 'secret-key';
      process.env.MCPX_REGISTRY_AUTH_HEADER_TYPE = 'x-api-key';
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            version: 1,
            servers: [
              {
                name: 'external',
                description: 'External MCP',
                recommended: {
                  command: 'bunx',
                  args: [
                    '-y',
                    'mcp-remote',
                    'https://api.githubcopilot.com/mcp/',
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;
      clearRegistryCache();
      await refreshRegistry();

      const config = await loadConfig(undefined, { allowEmpty: true });
      const server = (await getServerConfig(config, 'external')) as {
        args: string[];
        env?: Record<string, string>;
      };

      expect(server.args).toEqual([
        '-y',
        'mcp-remote',
        'https://api.githubcopilot.com/mcp/',
      ]);
      expect(server.env).toBeUndefined();
    });
  });

  describe('listServerNames', () => {
    test('returns all inline server names', async () => {
      const config = await loadConfig(
        JSON.stringify({
          mcpServers: {
            alpha: { command: 'a' },
            beta: { command: 'b' },
            gamma: { url: 'https://example.com' },
          },
        }),
      );

      const names = listServerNames(config);
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
      expect(names).toContain('gamma');
      expect(names.length).toBe(3);
    });
  });

  describe('type guards', () => {
    test('isHttpServer identifies HTTP config', () => {
      expect(isHttpServer({ url: 'https://example.com' })).toBe(true);
      expect(isHttpServer({ command: 'echo' })).toBe(false);
    });

    test('isStdioServer identifies stdio config', () => {
      expect(isStdioServer({ command: 'echo' })).toBe(true);
      expect(isStdioServer({ url: 'https://example.com' })).toBe(false);
    });
  });

  describe('disabled tools', () => {
    test('findDisabledMatch matches exact patterns', () => {
      const patterns = new Map([['server/tool', 'test']]);
      expect(findDisabledMatch('server/tool', patterns)).toEqual({
        pattern: 'server/tool',
        source: 'test',
      });
      expect(findDisabledMatch('server/other', patterns)).toBeUndefined();
    });

    test('findDisabledMatch supports glob wildcards', () => {
      const patterns = new Map([
        ['server/*', 'test1'],
        ['*/dangerous', 'test2'],
      ]);
      expect(findDisabledMatch('server/anything', patterns)?.pattern).toBe(
        'server/*',
      );
      expect(findDisabledMatch('other/dangerous', patterns)?.pattern).toBe(
        '*/dangerous',
      );
      expect(findDisabledMatch('other/safe', patterns)).toBeUndefined();
    });

    test('loadDisabledTools reads from environment variable', async () => {
      process.env.MCP_DISABLED_TOOLS = 'server/tool1,server/tool2';
      const patterns = await loadDisabledTools();
      expect(patterns.get('server/tool1')).toBe('MCP_DISABLED_TOOLS');
      expect(patterns.get('server/tool2')).toBe('MCP_DISABLED_TOOLS');
    });

    test('loadDisabledTools returns empty map when no config', async () => {
      const patterns = await loadDisabledTools();
      expect(patterns.size).toBe(0);
    });
  });

  describe('isDaemonAutoServer', () => {
    test('returns false when MCP_DAEMON_AUTO is unset', () => {
      expect(isDaemonAutoServer('browser')).toBe(false);
    });

    test('matches a server listed in MCP_DAEMON_AUTO', () => {
      process.env.MCP_DAEMON_AUTO = 'browser, playwright';
      expect(isDaemonAutoServer('browser')).toBe(true);
      expect(isDaemonAutoServer('playwright')).toBe(true);
      expect(isDaemonAutoServer('supabase')).toBe(false);
    });

    test('ignores empty entries and surrounding whitespace', () => {
      process.env.MCP_DAEMON_AUTO = ' , browser ,';
      expect(isDaemonAutoServer('browser')).toBe(true);
      expect(isDaemonAutoServer('')).toBe(false);
    });
  });

  describe('per-server tool filtering', () => {
    test('parses includeTools array', async () => {
      const config = await loadConfig(
        JSON.stringify({
          test: {
            command: 'echo',
            includeTools: ['read_*', 'list_*'],
          },
        }),
      );

      const server = config.mcpServers.test as {
        includeTools: string[];
      };
      expect(server.includeTools).toEqual(['read_*', 'list_*']);
    });

    test('parses allowedTools array (alias for includeTools)', async () => {
      const config = await loadConfig(
        JSON.stringify({
          test: {
            command: 'echo',
            allowedTools: ['read_*'],
          },
        }),
      );

      const server = config.mcpServers.test as {
        allowedTools: string[];
      };
      expect(server.allowedTools).toEqual(['read_*']);
    });

    test('parses disabledTools array', async () => {
      const config = await loadConfig(
        JSON.stringify({
          test: {
            command: 'echo',
            disabledTools: ['delete_*', 'write_*'],
          },
        }),
      );

      const server = config.mcpServers.test as {
        disabledTools: string[];
      };
      expect(server.disabledTools).toEqual(['delete_*', 'write_*']);
    });

    test('throws error when both includeTools and allowedTools are present', async () => {
      await expect(
        loadConfig(
          JSON.stringify({
            test: {
              command: 'echo',
              includeTools: ['read_*'],
              allowedTools: ['write_*'],
            },
          }),
        ),
      ).rejects.toThrow('both "includeTools" and "allowedTools"');
    });

    test('allows includeTools with disabledTools together', async () => {
      const config = await loadConfig(
        JSON.stringify({
          test: {
            command: 'echo',
            includeTools: ['*'],
            disabledTools: ['delete_*'],
          },
        }),
      );

      const server = config.mcpServers.test as {
        includeTools: string[];
        disabledTools: string[];
      };
      expect(server.includeTools).toEqual(['*']);
      expect(server.disabledTools).toEqual(['delete_*']);
    });
  });

  describe('isToolAllowedByServerConfig', () => {
    test('allows all tools when no filters specified', () => {
      const serverConfig = { command: 'echo' };
      expect(isToolAllowedByServerConfig('any_tool', serverConfig)).toBe(true);
    });

    test('filters by includeTools patterns', () => {
      const serverConfig = {
        command: 'echo',
        includeTools: ['read_*', 'list_*'],
      };
      expect(isToolAllowedByServerConfig('read_file', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('list_dir', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('write_file', serverConfig)).toBe(
        false,
      );
      expect(isToolAllowedByServerConfig('delete_file', serverConfig)).toBe(
        false,
      );
    });

    test('filters by allowedTools patterns (alias)', () => {
      const serverConfig = { command: 'echo', allowedTools: ['read_*'] };
      expect(isToolAllowedByServerConfig('read_file', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('write_file', serverConfig)).toBe(
        false,
      );
    });

    test('filters by disabledTools patterns', () => {
      const serverConfig = {
        command: 'echo',
        disabledTools: ['delete_*', 'write_*'],
      };
      expect(isToolAllowedByServerConfig('read_file', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('delete_file', serverConfig)).toBe(
        false,
      );
      expect(isToolAllowedByServerConfig('write_file', serverConfig)).toBe(
        false,
      );
    });

    test('disabledTools takes precedence over includeTools', () => {
      const serverConfig = {
        command: 'echo',
        includeTools: ['*'],
        disabledTools: ['dangerous_*'],
      };
      expect(isToolAllowedByServerConfig('safe_tool', serverConfig)).toBe(true);
      expect(
        isToolAllowedByServerConfig('dangerous_delete', serverConfig),
      ).toBe(false);
    });

    test('wildcard * matches any tool', () => {
      const serverConfig = { command: 'echo', includeTools: ['*'] };
      expect(isToolAllowedByServerConfig('anything', serverConfig)).toBe(true);
      expect(isToolAllowedByServerConfig('read_file', serverConfig)).toBe(true);
    });
  });

  describe('computeConfigHash', () => {
    test('returns consistent hash for same config', () => {
      const config = { command: 'echo', args: ['test'] };
      const hash1 = computeConfigHash(config);
      const hash2 = computeConfigHash(config);
      expect(hash1).toBe(hash2);
    });

    test('returns different hash for different config', () => {
      const config1 = { command: 'echo', args: ['test'] };
      const config2 = { command: 'echo', args: ['other'] };
      const hash1 = computeConfigHash(config1);
      const hash2 = computeConfigHash(config2);
      expect(hash1).not.toBe(hash2);
    });

    test('returns different hash for configs with different key order only after normalization', () => {
      const config1 = {
        command: 'echo',
        env: { B: '2', A: '1' },
      };
      const config2 = {
        env: { A: '1', B: '2' },
        command: 'echo',
      };
      expect(computeConfigHash(config1)).toBe(computeConfigHash(config2));
    });

    test('returns a short hex hash', () => {
      const hash = computeConfigHash({ command: 'echo' });
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('buildAdHocConfig', () => {
    test('builds stdio config from command and args', () => {
      const config = buildAdHocConfig('neon', {
        command: 'uvx',
        args: ['neon-mcp-server'],
      });
      expect(config.mcpServers.neon).toEqual({
        command: 'uvx',
        args: ['neon-mcp-server'],
      });
    });

    test('builds stdio config with command only', () => {
      const config = buildAdHocConfig('server', { command: 'echo' });
      expect(config.mcpServers.server).toEqual({ command: 'echo' });
    });

    test('builds http config from url', () => {
      const config = buildAdHocConfig('remote', {
        url: 'https://example.com/mcp',
      });
      expect(config.mcpServers.remote).toEqual({
        url: 'https://example.com/mcp',
      });
    });

    test('parses env pairs into env object', () => {
      const config = buildAdHocConfig('s', {
        command: 'cmd',
        envPairs: ['API_KEY=abc123', 'SECRET=xyz'],
      });
      expect(config.mcpServers.s).toEqual({
        command: 'cmd',
        env: { API_KEY: 'abc123', SECRET: 'xyz' },
      });
    });

    test('handles equals signs in env values', () => {
      const config = buildAdHocConfig('s', {
        command: 'cmd',
        envPairs: ['TOKEN=abc=def=ghi'],
      });
      expect(config.mcpServers.s).toEqual({
        command: 'cmd',
        env: { TOKEN: 'abc=def=ghi' },
      });
    });

    test('sets _configSource to inline-flags', () => {
      const config = buildAdHocConfig('s', { command: 'echo' });
      expect(config._configSource).toBe('inline-flags');
    });

    test('builds http config with env pairs', () => {
      const config = buildAdHocConfig('remote', {
        url: 'https://example.com/mcp',
        envPairs: ['TOKEN=secret'],
      });
      expect(config.mcpServers.remote).toEqual({
        url: 'https://example.com/mcp',
        env: { TOKEN: 'secret' },
      });
    });
  });
});
