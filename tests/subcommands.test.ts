import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { $ } from 'bun';

const CLI_PATH = join(import.meta.dir, '..', 'src', 'index.ts');
const LOCAL_REGISTRY_PATH = join(
  import.meta.dir,
  '..',
  'registry',
  'registry.json',
);

describe('subcommand sync', () => {
  test('no args defaults to help output', async () => {
    const result =
      await $`MCPX_REGISTRY_URL=${LOCAL_REGISTRY_PATH} bun run ${CLI_PATH}`.nothrow();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Usage:');
    expect(result.stdout.toString()).toContain('mcpx list');
  });

  describe('valid subcommands are recognized', () => {
    test('config', async () => {
      const result = await $`bun run ${CLI_PATH} config`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
    });

    test('daemon', async () => {
      const result = await $`bun run ${CLI_PATH} daemon`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
      expect(result.stderr.toString()).toContain('start|stop|status');
    });

    test('grep', async () => {
      const result = await $`bun run ${CLI_PATH} grep`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
      expect(result.stderr.toString()).toContain('pattern');
    });

    test('registry', async () => {
      const result =
        await $`MCPX_REGISTRY_URL=${LOCAL_REGISTRY_PATH} bun run ${CLI_PATH} registry`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
    });
  });

  describe('typos trigger fuzzy matching', () => {
    test('confg does not leak hidden config command', async () => {
      const result = await $`bun run ${CLI_PATH} confg`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).not.toContain("Did you mean 'config'");
      expect(result.stderr.toString()).toContain('Server "confg" not found');
    });

    test('deamon -> daemon', async () => {
      const result = await $`bun run ${CLI_PATH} deamon status`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Did you mean 'daemon'");
    });

    test('grp -> grep', async () => {
      const result = await $`bun run ${CLI_PATH} grp pattern`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Did you mean 'grep'");
    });

    test('daemn -> daemon', async () => {
      const result = await $`bun run ${CLI_PATH} daemn`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Did you mean 'daemon'");
    });

    test('regsitry -> registry', async () => {
      const result = await $`bun run ${CLI_PATH} regsitry`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Did you mean 'registry'");
    });
  });

  describe('non-typos fall through to server lookup', () => {
    test('xyz (distance > 2)', async () => {
      const result =
        await $`MCPX_REGISTRY_URL=${LOCAL_REGISTRY_PATH} bun run ${CLI_PATH} xyz`.nothrow();
      expect(result.stderr.toString()).not.toContain('Did you mean');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('registry misses', () => {
    test('explain that inline config can still use unregistered MCPs', async () => {
      const result =
        await $`MCPX_REGISTRY_URL=${LOCAL_REGISTRY_PATH} bun run ${CLI_PATH} registry get neon`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(
        'does not mean mcpx cannot use this MCP server',
      );
      expect(result.stderr.toString()).toContain('--command');
    });
  });

  describe('inline server flags', () => {
    test('--command and --url are mutually exclusive', async () => {
      const result =
        await $`bun run ${CLI_PATH} --command echo --url http://x server`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('mutually exclusive');
    });

    test('--command and -c are mutually exclusive', async () => {
      const result =
        await $`bun run ${CLI_PATH} --command echo -c '{}' server`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('mutually exclusive');
    });

    test('--url and -c are mutually exclusive', async () => {
      const result =
        await $`bun run ${CLI_PATH} --url http://x -c '{}' server`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('mutually exclusive');
    });

    test('--arg without --command is an error', async () => {
      const result =
        await $`bun run ${CLI_PATH} --arg foo server`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('--arg requires --command');
    });

    test('--env without --command or --url is an error', async () => {
      const result =
        await $`bun run ${CLI_PATH} --env KEY=VAL server`.nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('--env requires --command or --url');
    });

    test('--command without a value is an error', async () => {
      const result =
        await $`bun run ${CLI_PATH} --command`.nothrow();
      expect(result.exitCode).toBe(1);
    });

    test('valid --command flag synthesizes config', async () => {
      const result =
        await $`bun run ${CLI_PATH} --command echo --arg hello myserver`.nothrow();
      const stderr = result.stderr.toString();
      expect(stderr).not.toContain('Unknown option');
      expect(stderr).not.toContain('mutually exclusive');
    });
  });
});
