/**
 * Fixture MCP server for resources/skills integration tests (SEP-2640).
 *
 * Modes (single argv flag):
 *   (default)     skills + valid skill://index.json enumeration
 *   --no-index    same skills, no index resource (fallback discovery)
 *   --bad-index   index resource serves invalid JSON (fallback discovery)
 *   --tools-only  one tool, no resources capability
 *   --paged       low-level server: 5 resources served 2 per page
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const mode = process.argv[2] ?? '--default';

const SKILL_DESCRIPTION =
  "Follow this team's Git conventions for branching and commits";

const SKILL_MD = `---
name: git-workflow
description: ${SKILL_DESCRIPTION}
---

# Git Workflow

Use conventional commits. See [references/GUIDE.md](references/GUIDE.md).
`;

const GUIDE_MD = '# Branching Guide\n\nBranch from dev.\n';

const RELEASE_NOTES_MD = '# Release Notes Skill\n\nSummarize per release.\n';

// base64 of "binarydata"
const LOGO_BLOB = 'YmluYXJ5ZGF0YQ==';

const INDEX_JSON = JSON.stringify({
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: [
    {
      name: 'git-workflow',
      type: 'skill-md',
      description: SKILL_DESCRIPTION,
      url: 'skill://git-workflow/SKILL.md',
    },
    {
      // NOTE(victor): index entries may use a non-skill:// scheme (SEP-2640);
      // loading this skill by name only works via index resolution
      name: 'release-notes',
      type: 'skill-md',
      description: 'Draft release notes for a version',
      url: 'docs://release-notes/SKILL.md',
    },
    {
      type: 'mcp-resource-template',
      description: 'Per-product documentation skill',
      url: 'skill://docs/{product}/SKILL.md',
    },
    {
      // Unrecognized type: clients MUST skip this entry
      name: 'future',
      type: 'zip-archive',
      description: 'Entry with a type this client does not recognize',
      url: 'skill://future/archive.zip',
    },
  ],
});

async function startToolsOnlyServer(): Promise<void> {
  const server = new McpServer({ name: 'tools-only-fixture', version: '0.0.1' });
  server.registerTool('echo', { description: 'Echo a fixed string' }, async () => ({
    content: [{ type: 'text', text: 'ok' }],
  }));
  await server.connect(new StdioServerTransport());
}

async function startPagedServer(): Promise<void> {
  const PAGE_SIZE = 2;
  const items = Array.from({ length: 5 }, (_, i) => ({
    uri: `paged://item-${i}`,
    name: `item-${i}`,
  }));

  const server = new Server(
    { name: 'paged-fixture', version: '0.0.1' },
    { capabilities: { resources: {} } },
  );

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const start = request.params?.cursor
      ? Number.parseInt(request.params.cursor, 10)
      : 0;
    const resources = items.slice(start, start + PAGE_SIZE);
    const nextCursor =
      start + PAGE_SIZE < items.length ? String(start + PAGE_SIZE) : undefined;
    return nextCursor ? { resources, nextCursor } : { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
    contents: [{ uri: request.params.uri, text: 'paged content' }],
  }));

  await server.connect(new StdioServerTransport());
}

async function startSkillsServer(): Promise<void> {
  const server = new McpServer({ name: 'skills-fixture', version: '0.0.1' });

  server.registerResource(
    'git-workflow',
    'skill://git-workflow/SKILL.md',
    { description: SKILL_DESCRIPTION, mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: SKILL_MD, mimeType: 'text/markdown' }],
    }),
  );

  server.registerResource(
    'git-workflow-guide',
    'skill://git-workflow/references/GUIDE.md',
    { mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: GUIDE_MD, mimeType: 'text/markdown' }],
    }),
  );

  server.registerResource(
    'git-workflow-logo',
    'skill://git-workflow/assets/logo.png',
    { mimeType: 'image/png' },
    async (uri) => ({
      contents: [{ uri: uri.href, blob: LOGO_BLOB, mimeType: 'image/png' }],
    }),
  );

  server.registerResource(
    'release-notes',
    'docs://release-notes/SKILL.md',
    { description: 'Draft release notes for a version', mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [
        { uri: uri.href, text: RELEASE_NOTES_MD, mimeType: 'text/markdown' },
      ],
    }),
  );

  if (mode !== '--no-index') {
    const indexText = mode === '--bad-index' ? '{not valid json' : INDEX_JSON;
    server.registerResource(
      'skill-index',
      'skill://index.json',
      { mimeType: 'application/json' },
      async (uri) => ({
        contents: [
          { uri: uri.href, text: indexText, mimeType: 'application/json' },
        ],
      }),
    );
  }

  await server.connect(new StdioServerTransport());
}

if (mode === '--tools-only') {
  await startToolsOnlyServer();
} else if (mode === '--paged') {
  await startPagedServer();
} else {
  await startSkillsServer();
}
