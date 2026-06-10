import { closest, distance } from 'fastest-levenshtein';

export enum ErrorCode {
  CLIENT_ERROR = 1,
  SERVER_ERROR = 2,
  NETWORK_ERROR = 3,
  AUTH_ERROR = 4,
}

export interface CliError {
  code: ErrorCode;
  type: string;
  message: string;
  details?: string;
  suggestion?: string;
}

const INLINE_CONFIG_GUIDANCE =
  'A missing registry entry does not mean mcpx cannot use this MCP server. ' +
  'Provide server config inline: mcpx --command <cmd> --arg <arg> server/tool, ' +
  'or mcpx --url <endpoint> server/tool. ' +
  'For full config JSON, use -c.';

function withInlineConfigGuidance(suggestion: string): string {
  return `${suggestion} ${INLINE_CONFIG_GUIDANCE}`;
}

export function formatCliError(error: CliError): string {
  const lines: string[] = [];

  lines.push(`Error [${error.type}]: ${error.message}`);

  if (error.details) {
    lines.push(`  Details: ${error.details}`);
  }

  if (error.suggestion) {
    lines.push(`  Suggestion: ${error.suggestion}`);
  }

  return lines.join('\n');
}

export function configNotFoundError(path: string): CliError {
  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'CONFIG_NOT_FOUND',
    message: `Config file not found: ${path}`,
    suggestion: 'Pass a valid path with -c/--config.',
  };
}

export function configSearchError(): CliError {
  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'CONFIG_NOT_FOUND',
    message: 'No config file selected',
    details: 'mcpx defaults to registry-backed in-memory servers.',
    suggestion: 'Pass -c/--config if you intend to use an explicit override.',
  };
}

export function configInvalidJsonError(
  path: string,
  parseError?: string,
): CliError {
  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'CONFIG_INVALID_JSON',
    message: `Invalid JSON in config input: ${path}`,
    details: parseError,
    suggestion:
      "Check for syntax errors: missing commas, unquoted keys, trailing commas. Run 'mcpx --help' for config examples.",
  };
}

export function configMissingFieldError(path: string): CliError {
  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'CONFIG_MISSING_FIELD',
    message: 'Config input missing required server object',
    details: `Input: ${path}`,
    suggestion: `Config must have structure: { "mcpServers": { "name": { "command": "...", "args": [...] } } } or { "name": { "command": "...", "args": [...] } }. Run 'mcpx --help' for full examples.`,
  };
}

export function serverNotFoundError(
  serverName: string,
  localServers: string[],
  registryServers: string[] = [],
  configSource?: string,
): CliError {
  const allServers = [...new Set([...localServers, ...registryServers])];
  const availableList =
    allServers.length > 0 ? allServers.join(', ') : '(none)';
  const sourceInfo = configSource ? ` (from ${configSource})` : '';

  let suggestion = withInlineConfigGuidance(
    "Run 'mcpx registry list' to see built-in servers.",
  );

  if (allServers.length > 0) {
    const match = closest(serverName, allServers);
    const dist = distance(serverName, match);
    if (dist <= 2) {
      const fromRegistry = registryServers.includes(match)
        ? ' (from registry)'
        : '';
      suggestion = withInlineConfigGuidance(
        `Did you mean '${match}'${fromRegistry}?`,
      );
    }
  }

  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'SERVER_NOT_FOUND',
    message: `Server "${serverName}" not found`,
    details: `Available servers${sourceInfo}: ${availableList}`,
    suggestion,
  };
}

export function serverConnectionError(
  serverName: string,
  cause: string,
): CliError {
  // Detect common error patterns
  let suggestion =
    'Check server configuration and ensure the server process can start. Verify config with: mcpx list --json';

  if (cause.includes('ENOENT') || cause.includes('not found')) {
    suggestion = `Command not found. The server binary/script doesn't exist. For official MCP servers: npx -y @modelcontextprotocol/server-<name>. Check 'command' path in your config.`;
  } else if (cause.includes('ECONNREFUSED')) {
    suggestion =
      'Server refused connection. For SSE servers, verify the URL is correct and server is running. Check "url" in config.';
  } else if (cause.includes('ETIMEDOUT') || cause.includes('timeout')) {
    suggestion =
      'Connection timed out. Check network connectivity. For SSE servers, verify firewall/proxy settings.';
  } else if (cause.includes('401') || cause.includes('Unauthorized')) {
    suggestion =
      'Authentication required. Add authorization headers or env variables to config';
  } else if (cause.includes('403') || cause.includes('Forbidden')) {
    suggestion =
      'Access forbidden. Check API key/token permissions. Verify credentials in config headers.';
  } else if (cause.includes('EACCES') || cause.includes('permission')) {
    suggestion =
      'Permission denied. Check file permissions on the server command/script. Try: chmod +x <script>';
  } else if (
    cause.includes('/path/to/') ||
    /<[^>]+>/.test(cause) ||
    cause.includes('allowed directory')
  ) {
    suggestion =
      "The registry default likely needs runtime-specific values. Inspect the notes with 'mcpx registry get <server>' and retry with the required values.";
  }

  return {
    code: ErrorCode.NETWORK_ERROR,
    type: 'SERVER_CONNECTION_FAILED',
    message: `Failed to connect to server "${serverName}"`,
    details: cause,
    suggestion,
  };
}

export function toolNotFoundError(
  toolName: string,
  serverName: string,
  availableTools?: string[],
): CliError {
  const toolList = availableTools?.slice(0, 5).join(', ') || '';
  const moreCount =
    availableTools && availableTools.length > 5
      ? ` (+${availableTools.length - 5} more)`
      : '';

  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'TOOL_NOT_FOUND',
    message: `Tool "${toolName}" not found in server "${serverName}"`,
    details: availableTools
      ? `Available tools: ${toolList}${moreCount}`
      : undefined,
    suggestion: `Run 'mcpx ${serverName}' to list all tools. Use 'mcpx list' to see available registry servers.`,
  };
}

export function toolExecutionError(
  toolName: string,
  serverName: string,
  cause: string,
): CliError {
  let suggestion = `Check tool arguments match the expected schema. Run 'mcpx ${serverName}/${toolName}' to see the schema.`;

  // Detect common MCP error patterns
  if (cause.includes('validation') || cause.includes('invalid_type')) {
    suggestion = `Wrong argument type. Run 'mcpx ${serverName}/${toolName}' to see the input schema with types. Common issues: string vs number, missing quotes.`;
  } else if (cause.includes('required')) {
    suggestion = `Missing required argument. Run 'mcpx ${serverName}/${toolName}' to see required fields (marked in schema).`;
  } else if (cause.includes('permission') || cause.includes('denied')) {
    suggestion =
      'Permission denied on target resource. Check file/directory permissions or API access rights.';
  } else if (cause.includes('not found') || cause.includes('ENOENT')) {
    suggestion =
      'Resource not found. Verify the path/identifier exists. Use absolute paths for files.';
  } else if (
    cause.includes('rate') ||
    cause.includes('limit') ||
    cause.includes('429')
  ) {
    suggestion =
      'Rate limited. Wait before retrying. Consider adding delays between calls.';
  } else if (cause.includes('timeout')) {
    suggestion =
      'Operation timed out. The tool may need more time. Check MCP_TIMEOUT env var (default 1800s).';
  }

  return {
    code: ErrorCode.SERVER_ERROR,
    type: 'TOOL_EXECUTION_FAILED',
    message: `Tool "${toolName}" execution failed`,
    details: cause,
    suggestion,
  };
}

export function invalidTargetError(target: string): CliError {
  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'INVALID_TARGET',
    message: `Invalid target format: "${target}"`,
    details:
      'Expected format: server/tool for calling tools, or just server to list tools',
    suggestion: `Use 'mcpx <server>' to list tools, 'mcpx <server>/<tool>' for tool info, 'mcpx <server>/<tool> <json>' to call. Run 'mcpx --help' for examples.`,
  };
}

export function invalidJsonArgsError(
  input: string,
  parseError?: string,
): CliError {
  // Truncate long input
  const truncated =
    input.length > 100 ? `${input.substring(0, 100)}...` : input;

  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'INVALID_JSON_ARGUMENTS',
    message: 'Invalid JSON in tool arguments',
    details: parseError ? `Parse error: ${parseError}` : `Input: ${truncated}`,
    suggestion: `Arguments must be valid JSON object. Use single quotes around JSON: 'mcpx server/tool \'{"key": "value"}\''. You can also pipe JSON: 'echo \'{"key":"value"}\' | mcpx server/tool'`,
  };
}

export function unknownOptionError(option: string): CliError {
  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'UNKNOWN_OPTION',
    message: `Unknown option: ${option}`,
    suggestion: "Run 'mcpx --help' to see available options",
  };
}

export function missingArgumentError(
  command: string,
  argument: string,
): CliError {
  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'MISSING_ARGUMENT',
    message: `Missing required argument for ${command}: ${argument}`,
    suggestion: `Run 'mcpx --help' for usage examples`,
  };
}

export function toolDisabledError(
  toolPath: string,
  pattern: string,
  source: string,
): CliError {
  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'TOOL_DISABLED',
    message: `Tool "${toolPath}" is disabled`,
    details: `Matched pattern "${pattern}" from ${source}`,
    suggestion: `Use 'mcpx list' to see available registry servers.`,
  };
}

export function resourcesNotSupportedError(serverName: string): CliError {
  return {
    code: ErrorCode.SERVER_ERROR,
    type: 'RESOURCES_NOT_SUPPORTED',
    message: `Server "${serverName}" does not declare the resources capability`,
    suggestion: `Run 'mcpx ${serverName}' to see what the server supports.`,
  };
}

export function resourceListError(serverName: string, cause: string): CliError {
  return {
    code: ErrorCode.SERVER_ERROR,
    type: 'RESOURCE_LIST_FAILED',
    message: `Failed to list resources on server "${serverName}"`,
    details: cause,
    suggestion: `The server declares the resources capability but rejected resources/list. Check server logs or run 'mcpx ${serverName}' to inspect the server.`,
  };
}

export function resourceReadError(
  uri: string,
  serverName: string,
  cause: string,
): CliError {
  let suggestion = `Run 'mcpx resources ${serverName}' to list readable resources.`;

  if (cause.includes('not found') || cause.includes('-32002')) {
    suggestion = `Resource not found on the server. Run 'mcpx resources ${serverName}' to list available resources and templates.`;
  }

  return {
    code: ErrorCode.SERVER_ERROR,
    type: 'RESOURCE_READ_FAILED',
    message: `Failed to read resource "${uri}" from server "${serverName}"`,
    details: cause,
    suggestion,
  };
}

export function skillNotFoundError(
  skill: string,
  serverName: string,
  availableSkills?: string[],
): CliError {
  const skillList = availableSkills?.slice(0, 5).join(', ') || '';
  const moreCount =
    availableSkills && availableSkills.length > 5
      ? ` (+${availableSkills.length - 5} more)`
      : '';

  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'SKILL_NOT_FOUND',
    message: `Skill "${skill}" not found on server "${serverName}"`,
    details: availableSkills?.length
      ? `Discovered skills: ${skillList}${moreCount}`
      : undefined,
    suggestion: `Run 'mcpx skills ${serverName}' to list discoverable skills. Skills absent from the index can still be loaded by full URI, e.g. skill://<name>/SKILL.md`,
  };
}

export function registryFetchError(url: string, cause: string): CliError {
  return {
    code: ErrorCode.NETWORK_ERROR,
    type: 'REGISTRY_FETCH_FAILED',
    message: `Failed to fetch registry from ${url}`,
    details: cause,
    suggestion:
      'Check network connectivity. Use MCPX_REGISTRY_URL to point at a different registry, or set MCPX_REGISTRY_AUTH_TOKEN with MCPX_REGISTRY_AUTH_HEADER_TYPE (e.g. x-api-key or bearer) if it needs auth.',
  };
}

export function registryServerNotFoundError(
  serverName: string,
  available: string[],
): CliError {
  const availableList =
    available.length > 0
      ? available.slice(0, 10).join(', ') +
        (available.length > 10 ? ` (+${available.length - 10} more)` : '')
      : '(none)';

  let suggestion = withInlineConfigGuidance(
    "Run 'mcpx registry list' to see all available servers.",
  );

  if (available.length > 0) {
    const match = closest(serverName, available);
    const dist = distance(serverName, match);
    if (dist <= 2) {
      suggestion = withInlineConfigGuidance(`Did you mean '${match}'?`);
    }
  }

  return {
    code: ErrorCode.CLIENT_ERROR,
    type: 'REGISTRY_SERVER_NOT_FOUND',
    message: `Server "${serverName}" not found in registry`,
    details: `Available: ${availableList}`,
    suggestion,
  };
}
