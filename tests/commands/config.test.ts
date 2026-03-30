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

  test('shows registry-backed default mode and local discovery disabled by default', async () => {
    const result = await runCli(['config']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'Default: registry-backed in-memory servers',
    );
    expect(result.stdout).toContain(
      'Local config discovery: disabled by default',
    );
    expect(result.stdout).toContain('Local config paths');
    expect(result.stdout).toContain('.mcp.json');
  });

  test('shows discovered local config when MCPX_USE_LOCAL_CONFIG=1', async () => {
    const result = await runCli(
      ['config'],
      { MCPX_USE_LOCAL_CONFIG: '1' },
      tempDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Local config discovery: enabled');
    expect(result.stdout).toContain(`Selected config: ${configPath}`);
    expect(result.stdout).toContain('discovered from local config paths');
  });

  test('shows selected config path and marks it active', async () => {
    const result = await runCli(['config', '-c', configPath]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Selected config: ${configPath}`);
    expect(result.stdout).toContain(`> ${configPath}`);
  });

  test('shows inline JSON mode when selected', async () => {
    const result = await runCli(['config', '-c', '{"mcpServers":{}}']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Selected config: inline JSON');
    expect(result.stdout).toContain('-c/--config');
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

  test('shows MCP_CONFIG_PATH when set', async () => {
    const result = await runCli(['config'], { MCP_CONFIG_PATH: configPath });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(configPath);
    expect(result.stdout).toContain('MCP_CONFIG_PATH');
  });
});
