import type { ToolInfo } from './client.js';
import type { ServerConfig } from './config.js';
import { isHttpServer } from './config.js';
import type { RegistryServer } from './registry.js';

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
  const maxNameLen = Math.max(...servers.map((s) => s.name.length));

  for (const server of servers) {
    const name = color(
      server.name.padEnd(maxNameLen),
      colors.bold + colors.cyan,
    );
    const desc = color(server.description, colors.dim);
    const tools = `${server.toolCount} tool${server.toolCount !== 1 ? 's' : ''}`;
    lines.push(`${name}  ${desc.padEnd(50)}  ${tools}`);
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

  lines.push(`${color(`Tools (${server.toolCount}):`, colors.bold)}`);
  lines.push(`  ${server.tools.join(', ')}`);

  if (server.envVars && server.envVars.length > 0) {
    lines.push('');
    lines.push(`${color('Required environment variables:', colors.bold)}`);
    lines.push(`  ${server.envVars.join(', ')}`);
  }

  if (server.notes) {
    lines.push('');
    lines.push(`${color('Notes:', colors.bold)}`);
    lines.push(`  ${server.notes}`);
  }

  return lines.join('\n');
}
