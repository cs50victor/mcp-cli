/**
 * Integration tests for the resources and skills commands (SEP-2640)
 *
 * These tests spawn the actual CLI against a local fixture MCP server
 * (tests/fixtures/skills-server.ts) that serves skills as resources.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dir, '..', '..', 'src', 'index.ts');
const FIXTURE_PATH = join(import.meta.dir, '..', 'fixtures', 'skills-server.ts');

const configJson = JSON.stringify({
  mcpServers: {
    skillsrv: { command: 'bun', args: [FIXTURE_PATH] },
    noindex: { command: 'bun', args: [FIXTURE_PATH, '--no-index'] },
  },
});

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', CLI_PATH, '-c', configJson, ...args], {
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  return { stdout, stderr, exitCode };
}

describe('resources command', () => {
  test('lists resources', async () => {
    const result = await runCli(['resources', 'skillsrv']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('skill://git-workflow/SKILL.md');
    expect(result.stdout).toContain('skill://git-workflow/references/GUIDE.md');
    expect(result.stdout).toContain('skill://index.json');
  });

  test('outputs resource list as JSON', async () => {
    const result = await runCli(['resources', 'skillsrv', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('skillsrv');
    const uris = parsed.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('skill://git-workflow/SKILL.md');
  });

  test('reads a resource by URI', async () => {
    const result = await runCli([
      'resources',
      'skillsrv',
      'skill://git-workflow/SKILL.md',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('name: git-workflow');
    expect(result.stdout).toContain('# Git Workflow');
  });

  test('reads a resource as JSON', async () => {
    const result = await runCli([
      'resources',
      'skillsrv',
      'skill://index.json',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.contents[0].uri).toBe('skill://index.json');
    expect(parsed.contents[0].mimeType).toBe('application/json');
  });

  test('errors on unknown resource URI', async () => {
    const result = await runCli([
      'resources',
      'skillsrv',
      'skill://missing/SKILL.md',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('RESOURCE_READ_FAILED');
  });
});

describe('skills command', () => {
  test('lists skills from skill://index.json', async () => {
    const result = await runCli(['skills', 'skillsrv']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('git-workflow');
    expect(result.stdout).toContain("Git conventions");
    expect(result.stdout).toContain('skill://docs/{product}/SKILL.md');
  });

  test('lists skills as JSON', async () => {
    const result = await runCli(['skills', 'skillsrv', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('skillsrv');
    expect(parsed.skills[0].name).toBe('git-workflow');
    expect(parsed.skills[0].uri).toBe('skill://git-workflow/SKILL.md');
    expect(parsed.skills[1].template).toBe(true);
  });

  test('falls back to resources/list when index is absent', async () => {
    const result = await runCli(['skills', 'noindex']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('git-workflow');
    expect(result.stdout).toContain('skill://git-workflow/SKILL.md');
  });

  test('loads a skill by name', async () => {
    const result = await runCli(['skills', 'skillsrv', 'git-workflow']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# Git Workflow');
    expect(result.stdout).toContain('conventional commits');
  });

  test('loads a skill by name without an index', async () => {
    const result = await runCli(['skills', 'noindex', 'git-workflow']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# Git Workflow');
  });

  test('loads a skill file by full URI', async () => {
    const result = await runCli([
      'skills',
      'skillsrv',
      'skill://git-workflow/references/GUIDE.md',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# Branching Guide');
  });

  test('errors with discovered skills on unknown skill name', async () => {
    const result = await runCli(['skills', 'skillsrv', 'nonexistent']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SKILL_NOT_FOUND');
    expect(result.stderr).toContain('git-workflow');
  });
});
