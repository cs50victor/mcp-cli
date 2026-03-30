/**
 * Unit tests for output formatting
 */

import { describe, test, expect } from 'bun:test';
import {
  formatServerList,
  formatSearchResults,
  formatToolSchema,
  formatToolResult,
  formatJson,
  formatError,
  formatRegistryList,
  formatRegistryServer,
} from '../src/output';

// Disable colors for testing
process.env.NO_COLOR = '1';

describe('output', () => {
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

    test('renders optional server labels', () => {
      const output = formatServerList(
        [
          {
            name: 'memory',
            label: '[default for agents, highly recommended]',
            tools: [{ name: 'read_graph', description: '', inputSchema: {} }],
          },
        ],
        false,
      );

      expect(output).toContain('memory');
      expect(output).toContain('default for agents');
    });
  });

  describe('formatSearchResults', () => {
    test('formats search results', () => {
      const results = [
        {
          server: 'github',
          tool: { name: 'search', description: 'Search', inputSchema: {} },
        },
        {
          server: 'fs',
          tool: { name: 'find', description: 'Find files', inputSchema: {} },
        },
      ];

      const output = formatSearchResults(results, false);
      expect(output).toContain('github');
      expect(output).toContain('search');
      expect(output).toContain('fs');
      expect(output).toContain('find');
    });

    test('includes descriptions when requested', () => {
      const results = [
        {
          server: 'test',
          tool: {
            name: 'tool',
            description: 'Tool description',
            inputSchema: {},
          },
        },
      ];

      const withDesc = formatSearchResults(results, true);
      expect(withDesc).toContain('Tool description');

      const withoutDesc = formatSearchResults(results, false);
      expect(withoutDesc).not.toContain('Tool description');
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
          name: 'memory',
          description: 'Persistent memory',
          toolCount: 7,
          recommended: { command: 'npx', args: ['-y', 'server-memory'] },
          tools: ['read_graph'],
        },
        {
          name: 'filesystem',
          description: 'Read/write files',
          toolCount: 6,
          recommended: { command: 'npx', args: ['-y', 'server'] },
          tools: ['read', 'write'],
        },
      ];

      const output = formatRegistryList(servers);
      expect(output).toContain('default for agents');
      expect(output).toContain('highly recommended');
      expect(output).toContain('memory');
      expect(output).toContain('filesystem');
      expect(output).toContain('Read/write files');
      expect(output).toContain('6 tools');
      expect(output).toContain('7 tools');
    });
  });

  describe('formatRegistryServer', () => {
    test('formats server details with config', () => {
      const server = {
        name: 'filesystem',
        description: 'Read/write files and directories',
        toolCount: 6,
        recommended: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/path'],
        },
        tools: ['read_file', 'write_file', 'list_directory'],
        notes: 'Replace /path with your directory',
      };

      const output = formatRegistryServer(server);
      expect(output).toContain('filesystem');
      expect(output).toContain('Read/write files');
      expect(output).toContain('Default in-memory config');
      expect(output).toContain('npx');
      expect(output).toContain('Tools (6)');
      expect(output).toContain('read_file');
      expect(output).toContain('Notes');
      expect(output).toContain('Replace /path');
    });

    test('highlights memory as the default agent recommendation', () => {
      const output = formatRegistryServer({
        name: 'memory',
        description: 'Persistent memory',
        toolCount: 7,
        recommended: {
          command: 'bunx',
          args: ['-y', '@modelcontextprotocol/server-memory'],
        },
        tools: ['read_graph'],
      });

      expect(output).toContain('default for agents');
      expect(output).toContain('highly recommended');
      expect(output).toContain('Recommendation');
    });

    test('formats server with envVars', () => {
      const server = {
        name: 'brave-search',
        description: 'Web search',
        toolCount: 2,
        recommended: { command: 'npx', args: ['-y', 'brave'] },
        tools: ['search'],
        envVars: ['BRAVE_API_KEY'],
      };

      const output = formatRegistryServer(server);
      expect(output).toContain('Required environment variables');
      expect(output).toContain('BRAVE_API_KEY');
    });

    test('formats server with alternatives', () => {
      const server = {
        name: 'git',
        description: 'Git operations',
        toolCount: 12,
        recommended: { command: 'uvx', args: ['mcp-server-git'] },
        tools: ['git_status'],
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
