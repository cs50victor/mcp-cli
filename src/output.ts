import type {
  ReadResourceResult,
  Resource,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolInfo } from './client.js';
import type { ServerConfig } from './config.js';
import { isHttpServer } from './config.js';
import type { RegistryServer } from './registry.js';

const REDACTED_ENV_VALUE = '<redacted>';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function shouldColorize(): boolean {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}

function color(text: string, colorCode: string): string {
  if (!shouldColorize()) return text;
  return `${colorCode}${text}${colors.reset}`;
}

export function shouldShowEnvValues(): boolean {
  const value = process.env.MCPX_SHOW_ENV_VALUES?.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function redactEnvRecord(
  env: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(env).map((key) => [key, REDACTED_ENV_VALUE]),
  );
}

export function redactServerConfigEnv<T>(data: T): T {
  if (shouldShowEnvValues()) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactServerConfigEnv(item)) as T;
  }

  if (!data || typeof data !== 'object') {
    return data;
  }

  const input = data as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === 'env' && value && typeof value === 'object') {
      output[key] = redactEnvRecord(value as Record<string, unknown>);
    } else {
      output[key] = redactServerConfigEnv(value);
    }
  }

  return output as T;
}

export function formatServerList(
  servers: Array<{ name: string; tools: ToolInfo[]; instructions?: string }>,
  withDescriptions: boolean,
): string {
  const lines: string[] = [];

  for (const server of servers) {
    if (withDescriptions && server.instructions) {
      const firstLine = server.instructions.split('\n')[0].trim();
      const truncated =
        firstLine.length > 80 ? `${firstLine.substring(0, 77)}...` : firstLine;
      lines.push(
        `${color(server.name, colors.bold + colors.cyan)} - ${color(truncated, colors.dim)}`,
      );
    } else {
      lines.push(color(server.name, colors.bold + colors.cyan));
    }

    for (const tool of server.tools) {
      if (withDescriptions && tool.description) {
        lines.push(`  • ${tool.name} - ${color(tool.description, colors.dim)}`);
      } else {
        lines.push(`  • ${tool.name}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function formatServerDetails(
  serverName: string,
  config: ServerConfig,
  tools: ToolInfo[],
  withDescriptions = false,
  instructions?: string,
): string {
  const lines: string[] = [];

  lines.push(
    `${color('Server:', colors.bold)} ${color(serverName, colors.cyan)}`,
  );

  if (isHttpServer(config)) {
    lines.push(`${color('Transport:', colors.bold)} HTTP`);
    lines.push(`${color('URL:', colors.bold)} ${config.url}`);
  } else {
    lines.push(`${color('Transport:', colors.bold)} stdio`);
    lines.push(
      `${color('Command:', colors.bold)} ${config.command} ${(config.args || []).join(' ')}`,
    );
  }

  if (instructions) {
    lines.push('');
    lines.push(`${color('Instructions:', colors.bold)}`);
    lines.push(`  ${instructions.split('\n').join('\n  ')}`);
  }

  lines.push('');
  lines.push(`${color(`Tools (${tools.length}):`, colors.bold)}`);

  for (const tool of tools) {
    lines.push(`  ${color(tool.name, colors.green)}`);
    if (withDescriptions && tool.description) {
      lines.push(`    ${color(tool.description, colors.dim)}`);
    }

    const schema = tool.inputSchema as {
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    if (schema.properties) {
      lines.push(`    ${color('Parameters:', colors.yellow)}`);
      for (const [name, prop] of Object.entries(schema.properties)) {
        const required = schema.required?.includes(name)
          ? 'required'
          : 'optional';
        const type = prop.type || 'any';
        const desc =
          withDescriptions && prop.description ? ` - ${prop.description}` : '';
        lines.push(`      • ${name} (${type}, ${required})${desc}`);
      }
    }
    lines.push('');
  }

  lines.push(
    `${color('Tip:', colors.dim)} Run 'mcpx ${serverName}/<tool>' for a tool's schema and description.`,
  );

  return lines.join('\n').trimEnd();
}

export function formatToolSchema(serverName: string, tool: ToolInfo): string {
  const lines: string[] = [];

  lines.push(
    `${color('Tool:', colors.bold)} ${color(tool.name, colors.green)}`,
  );
  lines.push(
    `${color('Server:', colors.bold)} ${color(serverName, colors.cyan)}`,
  );
  lines.push('');

  if (tool.description) {
    lines.push(`${color('Description:', colors.bold)}`);
    lines.push(`  ${tool.description}`);
    lines.push('');
  }

  lines.push(`${color('Input Schema:', colors.bold)}`);
  lines.push(JSON.stringify(tool.inputSchema, null, 2));

  return lines.join('\n');
}

export function formatResourceList(
  serverName: string,
  resources: Resource[],
  templates: ResourceTemplate[],
  withDescriptions: boolean,
): string {
  const lines: string[] = [];

  lines.push(
    `${color('Server:', colors.bold)} ${color(serverName, colors.cyan)}`,
  );
  lines.push('');
  lines.push(`${color(`Resources (${resources.length}):`, colors.bold)}`);

  for (const resource of resources) {
    const name =
      resource.name && resource.name !== resource.uri
        ? ` - ${resource.name}`
        : '';
    lines.push(`  ${color(resource.uri, colors.green)}${name}`);
    if (withDescriptions && resource.description) {
      lines.push(`    ${color(resource.description, colors.dim)}`);
    }
    if (withDescriptions && resource.mimeType) {
      lines.push(`    ${color(resource.mimeType, colors.dim)}`);
    }
  }

  if (templates.length > 0) {
    lines.push('');
    lines.push(
      `${color(`Resource Templates (${templates.length}):`, colors.bold)}`,
    );
    for (const template of templates) {
      lines.push(
        `  ${color(template.uriTemplate, colors.green)} - ${template.name}`,
      );
      if (withDescriptions && template.description) {
        lines.push(`    ${color(template.description, colors.dim)}`);
      }
    }
  }

  lines.push('');
  lines.push(
    `${color('Tip:', colors.dim)} Run 'mcpx resources ${serverName} <uri>' to read a resource.`,
  );

  return lines.join('\n');
}

export function formatResourceContents(result: ReadResourceResult): string {
  return result.contents
    .map((content) => ('text' in content ? content.text : content.blob))
    .join('\n');
}

export interface SkillListEntry {
  name?: string;
  description?: string;
  uri: string;
  template?: boolean;
}

export function formatSkillList(
  serverName: string,
  skills: SkillListEntry[],
): string {
  const lines: string[] = [];

  lines.push(
    `${color('Server:', colors.bold)} ${color(serverName, colors.cyan)}`,
  );
  lines.push('');
  lines.push(`${color(`Skills (${skills.length}):`, colors.bold)}`);

  for (const skill of skills) {
    if (skill.template) {
      lines.push(`  ${color(skill.uri, colors.green)} (template)`);
    } else {
      lines.push(`  ${color(skill.name ?? skill.uri, colors.green)}`);
    }
    if (skill.description) {
      lines.push(`    ${color(skill.description, colors.dim)}`);
    }
    if (!skill.template && skill.name) {
      lines.push(`    ${color(skill.uri, colors.dim)}`);
    }
  }

  lines.push('');
  lines.push(
    `${color('Tip:', colors.dim)} Run 'mcpx skills ${serverName} <name|uri>' to load a skill.`,
  );

  return lines.join('\n');
}

export function formatToolResult(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const r = result as { content?: Array<{ type: string; text?: string }> };

    if (r.content && Array.isArray(r.content)) {
      const textParts = r.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text);

      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }
  }

  return JSON.stringify(result, null, 2);
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatError(message: string): string {
  return color(`Error: ${message}`, '\x1b[31m'); // Red
}

export function formatRegistryList(servers: RegistryServer[]): string {
  const lines: string[] = [];
  if (servers.length === 0) {
    return '';
  }
  const maxNameLen = Math.max(...servers.map((s) => s.name.length));

  for (const server of servers) {
    const name = color(
      server.name.padEnd(maxNameLen),
      colors.bold + colors.cyan,
    );
    const desc = color(server.description, colors.dim);
    lines.push(`${name}  ${desc}`);
  }

  return lines.join('\n');
}

export function formatRegistryServer(server: RegistryServer): string {
  const lines: string[] = [];

  lines.push(
    `${color(server.name, colors.bold + colors.cyan)} - ${server.description}`,
  );
  lines.push('');

  lines.push(`${color('Default in-memory config:', colors.bold)}`);
  const configJson = JSON.stringify(
    { [server.name]: server.recommended },
    null,
    2,
  );
  lines.push(`  ${configJson.split('\n').join('\n  ')}`);
  lines.push('');
  lines.push(
    `${color('Tip:', colors.dim)} mcpx uses this config in memory by default.`,
  );
  lines.push('');

  if (server.alternatives && server.alternatives.length > 0) {
    lines.push(`${color('Alternatives:', colors.bold)}`);
    for (const alt of server.alternatives) {
      lines.push(
        `  ${color(alt.name, colors.yellow)}: ${alt.command} ${alt.args.join(' ')}`,
      );
    }
    lines.push('');
  }

  lines.push(`${color('Use:', colors.bold)}`);
  lines.push(`  mcpx ${server.name}`);

  if (server.envVars && server.envVars.length > 0) {
    lines.push('');
    lines.push(`${color('Environment variables:', colors.bold)}`);
    lines.push(`  ${server.envVars.join(', ')}`);
  }

  if (server.notes) {
    lines.push('');
    lines.push(`${color('Notes:', colors.bold)}`);
    lines.push(`  ${server.notes}`);
  }

  return lines.join('\n');
}
