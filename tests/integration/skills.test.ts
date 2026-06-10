/**
 * Integration tests for the resources and skills commands (SEP-2640)
 *
 * Spawns the actual CLI against tests/fixtures/skills-server.ts. Each fixture
 * mode isolates one mechanism: index enumeration, fallback discovery,
 * malformed-index recovery, pagination, and the missing-capability error.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dir, '..', '..', 'src', 'index.ts');
const FIXTURE_PATH = join(
  import.meta.dir,
  '..',
  'fixtures',
  'skills-server.ts',
);

const configJson = JSON.stringify({
  mcpServers: {
    skillsrv: { command: 'bun', args: [FIXTURE_PATH] },
    noindex: { command: 'bun', args: [FIXTURE_PATH, '--no-index'] },
    badindex: { command: 'bun', args: [FIXTURE_PATH, '--bad-index'] },
    toolsonly: { command: 'bun', args: [FIXTURE_PATH, '--tools-only'] },
    paged: { command: 'bun', args: [FIXTURE_PATH, '--paged'] },
  },
});

// Must match SKILL_MD in tests/fixtures/skills-server.ts exactly: pins that
// resource content passes through the CLI byte-for-byte
const SKILL_MD = `---
name: git-workflow
description: Follow this team's Git conventions for branching and commits
---

# Git Workflow

Use conventional commits. See [references/GUIDE.md](references/GUIDE.md).
`;

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
  test('lists every resource exactly once as JSON', async () => {
    const result = await runCli(['resources', 'skillsrv', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('skillsrv');
    const uris = parsed.resources.map((r: { uri: string }) => r.uri).sort();
    expect(uris).toEqual([
      'docs://release-notes/SKILL.md',
      'skill://git-workflow/SKILL.md',
      'skill://git-workflow/assets/logo.png',
      'skill://git-workflow/references/GUIDE.md',
      'skill://index.json',
    ]);
  });

  test('renders resource count and URIs in text output', async () => {
    const result = await runCli(['resources', 'skillsrv']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Resources (5):');
    expect(result.stdout).toContain('skill://git-workflow/SKILL.md');
  });

  test('reads a text resource byte-for-byte', async () => {
    const result = await runCli([
      'resources',
      'skillsrv',
      'skill://git-workflow/SKILL.md',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${SKILL_MD}\n`);
  });

  test('reads a blob resource as its exact base64 payload', async () => {
    const result = await runCli([
      'resources',
      'skillsrv',
      'skill://git-workflow/assets/logo.png',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('YmluYXJ5ZGF0YQ==');
  });

  test('returns the full resources/read result as JSON', async () => {
    const result = await runCli([
      'resources',
      'skillsrv',
      'skill://index.json',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.contents).toHaveLength(1);
    expect(parsed.contents[0].uri).toBe('skill://index.json');
    expect(parsed.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(parsed.contents[0].text).skills).toHaveLength(4);
  });

  test('follows nextCursor across all resources/list pages', async () => {
    const result = await runCli(['resources', 'paged', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    const uris = parsed.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toEqual([
      'paged://item-0',
      'paged://item-1',
      'paged://item-2',
      'paged://item-3',
      'paged://item-4',
    ]);
  });

  test('exits 2 with RESOURCE_READ_FAILED on unknown URI', async () => {
    const result = await runCli([
      'resources',
      'skillsrv',
      'skill://missing/SKILL.md',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('RESOURCE_READ_FAILED');
  });

  test('exits 2 with RESOURCES_NOT_SUPPORTED on a tools-only server', async () => {
    const result = await runCli(['resources', 'toolsonly']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('RESOURCES_NOT_SUPPORTED');
  });
});

describe('skills command', () => {
  test('enumerates the index exactly: skills, template, unrecognized type skipped', async () => {
    const result = await runCli(['skills', 'skillsrv', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('skillsrv');
    expect(parsed.skills).toHaveLength(3);

    const gitWorkflow = parsed.skills.find(
      (s: { name?: string }) => s.name === 'git-workflow',
    );
    expect(gitWorkflow.uri).toBe('skill://git-workflow/SKILL.md');

    const releaseNotes = parsed.skills.find(
      (s: { name?: string }) => s.name === 'release-notes',
    );
    expect(releaseNotes.uri).toBe('docs://release-notes/SKILL.md');

    const template = parsed.skills.find(
      (s: { template?: boolean }) => s.template,
    );
    expect(template.uri).toBe('skill://docs/{product}/SKILL.md');

    // zip-archive entry from the index must be skipped, not listed
    expect(result.stdout).not.toContain('archive.zip');
  });

  test('renders skill names, descriptions, and URIs in text output', async () => {
    const result = await runCli(['skills', 'skillsrv']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Skills (3):');
    expect(result.stdout).toContain('git-workflow');
    expect(result.stdout).toContain('Git conventions');
    expect(result.stdout).toContain('skill://docs/{product}/SKILL.md');
  });

  test('discovers only SKILL.md resources when index is absent', async () => {
    const result = await runCli(['skills', 'noindex', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // GUIDE.md, logo.png, and the docs:// resource must not be misclassified
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.skills[0].name).toBe('git-workflow');
    expect(parsed.skills[0].uri).toBe('skill://git-workflow/SKILL.md');
  });

  test('falls back to resource scan when index is malformed JSON', async () => {
    const result = await runCli(['skills', 'badindex', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.skills[0].name).toBe('git-workflow');
  });

  test('loads a skill by name byte-for-byte', async () => {
    const result = await runCli(['skills', 'skillsrv', 'git-workflow']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${SKILL_MD}\n`);
  });

  test('resolves a name through the index to a non-skill:// scheme', async () => {
    // docs://release-notes/SKILL.md only resolves via the index entry;
    // the constructed skill://release-notes/SKILL.md does not exist
    const result = await runCli(['skills', 'skillsrv', 'release-notes']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# Release Notes Skill');
  });

  test('loads a skill by constructed URI when no index exists', async () => {
    const result = await runCli(['skills', 'noindex', 'git-workflow']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${SKILL_MD}\n`);
  });

  test('loads a supporting skill file by full URI', async () => {
    const result = await runCli([
      'skills',
      'skillsrv',
      'skill://git-workflow/references/GUIDE.md',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# Branching Guide');
  });

  test('exits 1 with SKILL_NOT_FOUND listing discovered skills', async () => {
    const result = await runCli(['skills', 'skillsrv', 'nonexistent']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SKILL_NOT_FOUND');
    expect(result.stderr).toContain('git-workflow');
  });

  test('exits 2 with RESOURCES_NOT_SUPPORTED on a tools-only server', async () => {
    const result = await runCli(['skills', 'toolsonly']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('RESOURCES_NOT_SUPPORTED');
  });
});
