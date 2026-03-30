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
});
