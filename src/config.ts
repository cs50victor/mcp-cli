import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ErrorCode,
  configInvalidJsonError,
  configNotFoundError,
  formatCliError,
  serverNotFoundError,
} from './errors.js';
import { fetchRegistry, findServer } from './registry.js';

export interface ToolFilterConfig {
  includeTools?: string[];
  allowedTools?: string[];
  disabledTools?: string[];
}

export interface StdioServerConfig extends ToolFilterConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpServerConfig extends ToolFilterConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export type ServerConfig = StdioServerConfig | HttpServerConfig;

export interface McpServersConfig {
  mcpServers: Record<string, ServerConfig>;
  _configSource?: string;
}

export function isHttpServer(config: ServerConfig): config is HttpServerConfig {
  return 'url' in config;
}

export function isStdioServer(
  config: ServerConfig,
): config is StdioServerConfig {
  return 'command' in config;
}

export const DEFAULT_TIMEOUT_SECONDS = 1800;
export const DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_SECONDS * 1000;
export const DEFAULT_CONCURRENCY = 5;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 1000;

export function debug(message: string): void {
  if (process.env.MCP_DEBUG) {
    console.error(`[mcpx] ${message}`);
  }
}

export function getTimeoutMs(): number {
  const envTimeout = process.env.MCP_TIMEOUT;
  if (envTimeout) {
    const seconds = Number.parseInt(envTimeout, 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  return DEFAULT_TIMEOUT_MS;
}

export function getConcurrencyLimit(): number {
  const envConcurrency = process.env.MCP_CONCURRENCY;
  if (envConcurrency) {
    const limit = Number.parseInt(envConcurrency, 10);
    if (!Number.isNaN(limit) && limit > 0) {
      return limit;
    }
  }
  return DEFAULT_CONCURRENCY;
}

export function getMaxRetries(): number {
  const envRetries = process.env.MCP_MAX_RETRIES;
  if (envRetries) {
    const retries = Number.parseInt(envRetries, 10);
    if (!Number.isNaN(retries) && retries >= 0) {
      return retries;
    }
  }
  return DEFAULT_MAX_RETRIES;
}

export function getRetryDelayMs(): number {
  const envDelay = process.env.MCP_RETRY_DELAY;
  if (envDelay) {
    const delay = Number.parseInt(envDelay, 10);
    if (!Number.isNaN(delay) && delay > 0) {
      return delay;
    }
  }
  return DEFAULT_RETRY_DELAY_MS;
}

function isStrictEnvMode(): boolean {
  const value = process.env.MCP_STRICT_ENV?.toLowerCase();
  return value !== 'false' && value !== '0';
}

/**
 * Substitute environment variables in a string
 * Supports ${VAR_NAME} syntax
 *
 * By default (strict mode), throws an error when referenced env var is not set.
 * Set MCP_STRICT_ENV=false to warn instead of error.
 */
function substituteEnvVars(value: string): string {
  const missingVars: string[] = [];

  const result = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      missingVars.push(varName);
      return '';
    }
    return envValue;
  });

  if (missingVars.length > 0) {
    const varList = missingVars.map((v) => `\${${v}}`).join(', ');
    const message = `Missing environment variable${missingVars.length > 1 ? 's' : ''}: ${varList}`;

    if (isStrictEnvMode()) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'MISSING_ENV_VAR',
          message: message,
          details: 'Referenced in config but not set in environment',
          suggestion: `Set the variable(s) before running: export ${missingVars[0]}="value" or set MCP_STRICT_ENV=false to use empty values`,
        }),
      );
    }
    console.error(`[mcpx] Warning: ${message}`);
  }

  return result;
}

function substituteEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVarsInObject) as T;
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVarsInObject(value);
    }
    return result as T;
  }
  return obj;
}

function isWrappedFormat(
  config: unknown,
): config is { mcpServers: Record<string, unknown> } {
  return (
    typeof config === 'object' &&
    config !== null &&
    'mcpServers' in config &&
    typeof (config as { mcpServers: unknown }).mcpServers === 'object' &&
    (config as { mcpServers: unknown }).mcpServers !== null
  );
}

function isFlatServerConfig(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return 'command' in value || 'url' in value;
}

function normalizeConfig(rawConfig: unknown): {
  mcpServers: Record<string, ServerConfig>;
} {
  if (isWrappedFormat(rawConfig)) {
    return { mcpServers: rawConfig.mcpServers as Record<string, ServerConfig> };
  }

  if (typeof rawConfig === 'object' && rawConfig !== null) {
    const servers: Record<string, ServerConfig> = {};
    for (const [key, value] of Object.entries(rawConfig)) {
      if (
        isFlatServerConfig(value) ||
        (typeof value === 'object' && value !== null)
      ) {
        servers[key] = value as ServerConfig;
      }
    }
    return { mcpServers: servers };
  }

  return { mcpServers: {} };
}

function getDefaultConfigPaths(): string[] {
  const home = homedir();

  return [
    resolve('./.mcp.json'),
    resolve('./mcp.json'),
    join(home, '.mcp.json'),
    join(home, '.config', 'mcp', 'mcp.json'),
  ];
}

function isInlineJson(value: string): boolean {
  return value.trimStart().startsWith('{');
}

function isLocalConfigDiscoveryEnabled(): boolean {
  const value = process.env.MCPX_USE_LOCAL_CONFIG?.toLowerCase();
  return value === '1' || value === 'true';
}

function findDiscoveredConfigPath(): string | undefined {
  return getDefaultConfigPaths().find((path) => existsSync(path));
}

export interface ConfigSelection {
  mode: 'registry' | 'inline' | 'file';
  input?: string;
  source?: 'cli' | 'env' | 'local';
}

export function getConfigSelection(explicitInput?: string): ConfigSelection {
  const envValue = process.env.MCP_CONFIG_PATH;

  if (explicitInput) {
    if (isInlineJson(explicitInput)) {
      return { mode: 'inline', input: explicitInput, source: 'cli' };
    }

    return { mode: 'file', input: resolve(explicitInput), source: 'cli' };
  }

  if (envValue) {
    if (isInlineJson(envValue)) {
      return { mode: 'inline', input: envValue, source: 'env' };
    }

    return { mode: 'file', input: resolve(envValue), source: 'env' };
  }

  if (isLocalConfigDiscoveryEnabled()) {
    const discoveredPath = findDiscoveredConfigPath();

    if (discoveredPath) {
      return { mode: 'file', input: discoveredPath, source: 'local' };
    }
  }

  return { mode: 'registry' };
}

export interface ConfigPathInfo {
  path: string;
  exists: boolean;
  active: boolean;
  source?: 'cli' | 'env' | 'local' | 'default';
}

export interface ConfigPathsResult {
  mode: 'registry' | 'inline' | 'file';
  active: string | null;
  activeSource: 'cli' | 'env' | 'local' | null;
  localDiscoveryEnabled: boolean;
  searchPaths: ConfigPathInfo[];
  envVar: string | undefined;
}

export function getConfigPaths(explicitInput?: string): ConfigPathsResult {
  const envValue = process.env.MCP_CONFIG_PATH;
  const localDiscoveryEnabled = isLocalConfigDiscoveryEnabled();
  const selection = getConfigSelection(explicitInput);
  const active = selection.mode === 'file' ? (selection.input ?? null) : null;
  const activeSource = selection.source ?? null;

  const searchPaths: ConfigPathInfo[] = getDefaultConfigPaths().map((path) => ({
    path,
    exists: existsSync(path),
    active: active === path,
    source: active === path && activeSource === 'local' ? 'local' : 'default',
  }));

  if (active && !searchPaths.some((info) => info.path === active)) {
    searchPaths.unshift({
      path: active,
      exists: existsSync(active),
      active: true,
      source: activeSource ?? 'default',
    });
  }

  return {
    mode: selection.mode,
    active,
    activeSource,
    localDiscoveryEnabled,
    searchPaths,
    envVar: envValue,
  };
}

export interface LoadConfigOptions {
  allowEmpty?: boolean;
}

export async function loadConfig(
  explicitInput?: string,
  _options?: LoadConfigOptions,
): Promise<McpServersConfig> {
  const selection = getConfigSelection(explicitInput);

  if (selection.mode === 'registry') {
    return { mcpServers: {}, _configSource: 'registry' };
  }

  let rawConfig: unknown;
  let configSource: string;

  if (selection.mode === 'inline') {
    configSource = 'inline';
    try {
      rawConfig = JSON.parse(selection.input ?? '');
    } catch (e) {
      throw new Error(
        formatCliError(
          configInvalidJsonError('<inline>', (e as Error).message),
        ),
      );
    }
  } else {
    const configPath = selection.input ?? '';
    configSource = configPath;

    if (!existsSync(configPath)) {
      throw new Error(formatCliError(configNotFoundError(configPath)));
    }

    const content = await Bun.file(configPath).text();

    try {
      rawConfig = JSON.parse(content);
    } catch (e) {
      throw new Error(
        formatCliError(
          configInvalidJsonError(configPath, (e as Error).message),
        ),
      );
    }
  }

  const normalized = normalizeConfig(rawConfig);

  if (Object.keys(normalized.mcpServers).length === 0) {
    console.error(
      '[mcpx] Warning: Selected config is empty. Registry defaults remain available.',
    );
  }

  for (const [serverName, serverConfig] of Object.entries(
    normalized.mcpServers,
  )) {
    if (!serverConfig || typeof serverConfig !== 'object') {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'CONFIG_INVALID_SERVER',
          message: `Invalid server configuration for "${serverName}"`,
          details: 'Server config must be an object',
          suggestion: `Use { "command": "..." } for stdio or { "url": "..." } for HTTP`,
        }),
      );
    }

    const hasCommand = 'command' in serverConfig;
    const hasUrl = 'url' in serverConfig;

    if (!hasCommand && !hasUrl) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'CONFIG_INVALID_SERVER',
          message: `Server "${serverName}" missing required field`,
          details: `Must have either "command" (for stdio) or "url" (for HTTP)`,
          suggestion: `Add "command": "npx ..." for local servers or "url": "https://..." for remote servers`,
        }),
      );
    }

    if (hasCommand && hasUrl) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'CONFIG_INVALID_SERVER',
          message: `Server "${serverName}" has both "command" and "url"`,
          details:
            'A server must be either stdio (command) or HTTP (url), not both',
          suggestion: `Remove one of "command" or "url"`,
        }),
      );
    }

    const hasIncludeTools = 'includeTools' in serverConfig;
    const hasAllowedTools = 'allowedTools' in serverConfig;

    if (hasIncludeTools && hasAllowedTools) {
      throw new Error(
        formatCliError({
          code: ErrorCode.CLIENT_ERROR,
          type: 'CONFIG_INVALID_SERVER',
          message: `Server "${serverName}" has both "includeTools" and "allowedTools"`,
          details: 'These fields are aliases - use one or the other, not both',
          suggestion: `Remove one field. Both accept glob patterns:\n  "includeTools": ["read_*", "write_*"]   # Amp Code convention\n  "allowedTools": ["read_*", "write_*"]   # Alternative naming`,
        }),
      );
    }
  }

  const config: McpServersConfig = substituteEnvVarsInObject(normalized);
  config._configSource = configSource;

  return config;
}

export async function getServerConfig(
  config: McpServersConfig,
  serverName: string,
): Promise<ServerConfig> {
  const server = config.mcpServers[serverName];
  if (server) {
    return server;
  }

  // Fallback to registry
  const registry = await fetchRegistry();
  const registryServer = findServer(registry, serverName);

  if (registryServer) {
    const serverConfig = {
      command: registryServer.recommended.command,
      args: registryServer.recommended.args,
    };

    if (config._configSource && config._configSource !== 'registry') {
      console.error(
        `[mcpx] Server '${serverName}' not found in selected config (${config._configSource}). Falling back to registry in memory.`,
      );
    } else {
      console.error(
        `[mcpx] Using registry config in memory for '${serverName}'.`,
      );
    }
    if (registryServer.envVars?.length) {
      console.error(
        `[mcpx] Required env vars: ${registryServer.envVars.join(', ')}`,
      );
    }
    if (registryServer.notes) {
      console.error(`[mcpx] Note: ${registryServer.notes}`);
    }
    return serverConfig;
  }

  // Neither found - use smart suggestions
  const localServers = Object.keys(config.mcpServers);
  const registryServers = registry.servers.map((s) => s.name);
  throw new Error(
    formatCliError(
      serverNotFoundError(
        serverName,
        localServers,
        registryServers,
        config._configSource,
      ),
    ),
  );
}

export function listServerNames(config: McpServersConfig): string[] {
  return Object.keys(config.mcpServers);
}

export interface DisabledToolsMatch {
  pattern: string;
  source: string;
}

function globMatch(pattern: string, str: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return regex.test(str);
}

function getDisabledToolsPaths(): string[] {
  const home = homedir();
  return [
    join(home, '.config', 'mcp', 'disabled_tools'),
    join(home, '.mcp_disabled_tools'),
    resolve('./mcp_disabled_tools'),
  ];
}

function parseDisabledToolsFile(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export async function loadDisabledTools(): Promise<Map<string, string>> {
  const patterns = new Map<string, string>();

  for (const path of getDisabledToolsPaths()) {
    if (existsSync(path)) {
      const content = await Bun.file(path).text();
      for (const pattern of parseDisabledToolsFile(content)) {
        patterns.set(pattern, path);
      }
      debug(`Loaded ${patterns.size} disabled tool patterns from ${path}`);
    }
  }

  const envPatterns = process.env.MCP_DISABLED_TOOLS;
  if (envPatterns) {
    for (const pattern of envPatterns
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)) {
      patterns.set(pattern, 'MCP_DISABLED_TOOLS');
    }
  }

  return patterns;
}

export function findDisabledMatch(
  toolPath: string,
  patterns: Map<string, string>,
): DisabledToolsMatch | undefined {
  for (const [pattern, source] of patterns) {
    if (globMatch(pattern, toolPath)) {
      return { pattern, source };
    }
  }
  return undefined;
}

export function getIncludePatterns(
  serverConfig: ServerConfig,
): string[] | undefined {
  if ('includeTools' in serverConfig && serverConfig.includeTools) {
    return serverConfig.includeTools;
  }
  if ('allowedTools' in serverConfig && serverConfig.allowedTools) {
    return serverConfig.allowedTools;
  }
  return undefined;
}

export function getDisabledPatterns(
  serverConfig: ServerConfig,
): string[] | undefined {
  if ('disabledTools' in serverConfig && serverConfig.disabledTools) {
    return serverConfig.disabledTools;
  }
  return undefined;
}

export function isToolAllowedByServerConfig(
  toolName: string,
  serverConfig: ServerConfig,
): boolean {
  const includePatterns = getIncludePatterns(serverConfig);
  const disabledPatterns = getDisabledPatterns(serverConfig);

  if (includePatterns) {
    const isIncluded = includePatterns.some((pattern) =>
      globMatch(pattern, toolName),
    );
    if (!isIncluded) {
      return false;
    }
  }

  if (disabledPatterns) {
    const isDisabled = disabledPatterns.some((pattern) =>
      globMatch(pattern, toolName),
    );
    if (isDisabled) {
      return false;
    }
  }

  return true;
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function buildAdHocConfig(
  serverName: string,
  options: {
    command?: string;
    args?: string[];
    envPairs?: string[];
    url?: string;
  },
): McpServersConfig {
  const serverConfig: Partial<StdioServerConfig & HttpServerConfig> = {};

  if (options.command) {
    serverConfig.command = options.command;
    if (options.args?.length) {
      serverConfig.args = options.args;
    }
  } else if (options.url) {
    serverConfig.url = options.url;
  }

  if (options.envPairs?.length) {
    const env: Record<string, string> = {};
    for (const pair of options.envPairs) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex > 0) {
        env[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
      }
    }
    serverConfig.env = env;
  }

  return {
    mcpServers: { [serverName]: serverConfig as unknown as ServerConfig },
    _configSource: 'inline-flags',
  };
}

export function computeConfigHash(config: ServerConfig): string {
  const normalized = sortObjectKeys(config);
  const json = JSON.stringify(normalized);
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(json);
  return hasher.digest('hex').substring(0, 16);
}
