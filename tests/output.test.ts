/**
 * Unit tests for output formatting
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  formatError,
  formatJson,
  formatRegistryList,
  formatRegistryServer,
  formatServerDetails,
  formatServerList,
  formatToolResult,
  formatToolSchema,
  redactServerConfigEnv,
} from '../src/output';

// Disable colors for testing
process.env.NO_COLOR = '1';

describe('output', () => {
  afterEach(() => {
    delete process.env.MCPX_SHOW_ENV_VALUES;
  });

  describe('formatServerList', () => {
    test('formats servers with tools', () => {
      const servers = [
        {
          name: 'github',
          tools: [
            { name: 'search', description: 'Search repos', inputSchema: {} },
            { name: 'clone', description: 'Clone repo', inputSchema: {} },
          ],
        },
        {
          name: 'filesystem',
          tools: [
            { name: 'read_file', description: 'Read file', inputSchema: {} },
          ],
        },
      ];

      const output = formatServerList(servers, false);
      expect(output).toContain('github');
      expect(output).toContain('search');
      expect(output).toContain('clone');
      expect(output).toContain('filesystem');
      expect(output).toContain('read_file');
    });

    test('includes descriptions when requested', () => {
      const servers = [
        {
          name: 'test',
          tools: [
            { name: 'tool1', description: 'A test tool', inputSchema: {} },
          ],
        },
      ];

      const withDesc = formatServerList(servers, true);
      expect(withDesc).toContain('A test tool');

      const withoutDesc = formatServerList(servers, false);
      expect(withoutDesc).not.toContain('A test tool');
    });
  });

  describe('formatServerDetails', () => {
    test('shows a tool-schema tip after server tools', () => {
      const output = formatServerDetails(
        'github',
        { command: 'server-github' },
        [
          {
            name: 'search',
            description: 'Search repositories',
            inputSchema: {},
          },
        ],
      );

      expect(output).toContain(
        "Tip: Run 'mcpx github/<tool>' for a tool's schema and description.",
      );
    });
  });

  describe('formatToolSchema', () => {
    test('formats tool with schema', () => {
      const tool = {
        name: 'search_repos',
        description: 'Search GitHub repositories',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      };

      const output = formatToolSchema('github', tool);
      expect(output).toContain('search_repos');
      expect(output).toContain('github');
      expect(output).toContain('Search GitHub');
      expect(output).toContain('query');
      expect(output).not.toContain('Tip:');
    });
  });

  describe('formatToolResult', () => {
    test('extracts text content from MCP result', () => {
      const result = {
        content: [{ type: 'text', text: 'Hello, world!' }],
      };

      const output = formatToolResult(result);
      expect(output).toBe('Hello, world!');
    });

    test('handles multiple text parts', () => {
      const result = {
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      };

      const output = formatToolResult(result);
      expect(output).toContain('Part 1');
      expect(output).toContain('Part 2');
    });

    test('falls back to JSON for non-text content', () => {
      const result = { data: [1, 2, 3] };
      const output = formatToolResult(result);
      expect(output).toContain('"data"');
      expect(output).toContain('1');
      expect(output).toContain('2');
      expect(output).toContain('3');
    });
  });

  describe('formatJson', () => {
    test('outputs valid JSON', () => {
      const data = { name: 'test', values: [1, 2, 3] };
      const output = formatJson(data);
      expect(JSON.parse(output)).toEqual(data);
    });
  });

  describe('redactServerConfigEnv', () => {
    test('redacts env values by default', () => {
      const output = redactServerConfigEnv({
        name: 'supabase',
        config: {
          command: 'bunx',
          env: { MCPX_REGISTRY_AUTH_TOKEN: 'secret-key' },
        },
      });

      expect(output.config.env.MCPX_REGISTRY_AUTH_TOKEN).toBe('<redacted>');
    });

    test('keeps env values when MCPX_SHOW_ENV_VALUES is enabled', () => {
      process.env.MCPX_SHOW_ENV_VALUES = 'true';

      const output = redactServerConfigEnv({
        config: {
          env: { API_KEY: 'secret-key' },
        },
      });

      expect(output.config.env.API_KEY).toBe('secret-key');
    });
  });

  describe('formatError', () => {
    test('formats error message', () => {
      const output = formatError('Something went wrong');
      expect(output).toContain('Something went wrong');
    });
  });

  describe('formatRegistryList', () => {
    test('formats registry servers as table', () => {
      const servers = [
        {
          name: 'filesystem',
          description: 'Read/write files',
          recommended: { command: 'npx', args: ['-y', 'server'] },
        },
      ];

      const output = formatRegistryList(servers);
      expect(output).toContain('filesystem');
      expect(output).toContain('Read/write files');
      expect(output).not.toContain('tools');
    });
  });

  describe('formatRegistryServer', () => {
    test('formats server details with config', () => {
      const server = {
        name: 'filesystem',
        description: 'Read/write files and directories',
        recommended: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/path'],
        },
        notes: 'Replace /path with your directory',
      };

      const output = formatRegistryServer(server);
      expect(output).toContain('filesystem');
      expect(output).toContain('Read/write files');
      expect(output).toContain('Default in-memory config');
      expect(output).toContain('npx');
      expect(output).toContain('Use:');
      expect(output).toContain('mcpx filesystem');
      expect(output).toContain('Notes');
      expect(output).toContain('Replace /path');
    });

    test('formats server with envVars', () => {
      const server = {
        name: 'brave-search',
        description: 'Web search',
        recommended: { command: 'npx', args: ['-y', 'brave'] },
        envVars: ['BRAVE_API_KEY'],
      };

      const output = formatRegistryServer(server);
      expect(output).toContain('Environment variables');
      expect(output).toContain('BRAVE_API_KEY');
    });

    test('formats server with alternatives', () => {
      const server = {
        name: 'git',
        description: 'Git operations',
        recommended: { command: 'uvx', args: ['mcp-server-git'] },
        alternatives: [
          { name: 'npm', command: 'npx', args: ['-y', '@mcp/server-git'] },
        ],
      };

      const output = formatRegistryServer(server);
      expect(output).toContain('Alternatives');
      expect(output).toContain('npm');
    });
  });
});
