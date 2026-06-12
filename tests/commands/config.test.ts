import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('config command', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await realpath(
      await mkdtemp(join(tmpdir(), 'mcpx-config-test-')),
    );
    configPath = join(tempDir, '.mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          test: { command: 'echo', args: ['hello'] },
        },
      }),
    );
  });

  afterEach(async () => {
    delete process.env.MCPX_USE_LOCAL_CONFIG;
    delete process.env.MCP_CONFIG_PATH;
    delete process.env.MCPX_SHOW_ENV_VALUES;
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(
    args: string[],
    env: Record<string, string> = {},
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cliPath = join(import.meta.dir, '..', '..', 'src', 'index.ts');
    const proc = Bun.spawn(['bun', 'run', cliPath, ...args], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout, stderr, exitCode };
  }

  test('shows registry-backed default mode without local config guidance', async () => {
    const result = await runCli(['config']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'Default: registry-backed in-memory servers',
    );
    expect(result.stdout).toContain('Override: (none)');
    expect(result.stdout).not.toContain('Local config discovery');
    expect(result.stdout).not.toContain('Local config paths');
    expect(result.stdout).not.toContain('.mcp.json');
    expect(result.stdout).not.toContain('MCP_CONFIG_PATH');
    expect(result.stdout).not.toContain('MCPX_USE_LOCAL_CONFIG');
  });

  test('shows selected local override without advertising discovery details', async () => {
    const result = await runCli(
      ['config'],
      { MCPX_USE_LOCAL_CONFIG: '1' },
      tempDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Override: ${configPath}`);
    expect(result.stdout).not.toContain('discovered from local config paths');
  });

  test('shows selected config path', async () => {
    const result = await runCli(['config', '-c', configPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Override: ${configPath}`);
  });

  test('shows inline JSON mode when selected', async () => {
    const result = await runCli(['config', '-c', '{"mcpServers":{}}']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Override: inline JSON');
  });

  test('outputs JSON with --json flag', async () => {
    const result = await runCli(['config', '-c', configPath, '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.mode).toBe('file');
    expect(parsed.active).toBe(configPath);
    expect(parsed.localDiscoveryEnabled).toBe(false);
    expect(Array.isArray(parsed.searchPaths)).toBe(true);
  });

  test('redacts env values from inline MCP_CONFIG_PATH JSON by default', async () => {
    const inlineConfig = JSON.stringify({
      mcpServers: {
        supabase: {
          command: 'bunx',
          env: { MCPX_REGISTRY_AUTH_TOKEN: 'secret-key' },
        },
      },
    });

    const result = await runCli(['config', '--json'], {
      MCP_CONFIG_PATH: inlineConfig,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('secret-key');
    expect(result.stdout).toContain('<redacted>');
  });

  test('shows env values from inline MCP_CONFIG_PATH JSON when enabled', async () => {
    const inlineConfig = JSON.stringify({
      mcpServers: {
        supabase: {
          command: 'bunx',
          env: { MCPX_REGISTRY_AUTH_TOKEN: 'secret-key' },
        },
      },
    });

    const result = await runCli(['config', '--json'], {
      MCP_CONFIG_PATH: inlineConfig,
      MCPX_SHOW_ENV_VALUES: 'true',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('secret-key');
  });

  test('shows MCP_CONFIG_PATH when set', async () => {
    const result = await runCli(['config'], { MCP_CONFIG_PATH: configPath });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Override: ${configPath}`);
    expect(result.stdout).not.toContain('MCP_CONFIG_PATH');
  });
});
