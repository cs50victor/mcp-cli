/**
 * Fixture MCP server serving Agent Skills as resources per SEP-2640.
 *
 * Serves one concrete skill (git-workflow) plus the well-known
 * skill://index.json enumeration resource. Pass --no-index to omit the
 * index and exercise the resources/list fallback discovery path.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const withIndex = !process.argv.includes('--no-index');

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
      type: 'mcp-resource-template',
      description: 'Per-product documentation skill',
      url: 'skill://docs/{product}/SKILL.md',
    },
  ],
});

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

if (withIndex) {
  server.registerResource(
    'skill-index',
    'skill://index.json',
    { mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        { uri: uri.href, text: INDEX_JSON, mimeType: 'application/json' },
      ],
    }),
  );
}

await server.connect(new StdioServerTransport());
