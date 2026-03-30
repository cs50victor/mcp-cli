import {
  type ToolInfo,
  connectToServer,
  debug,
  getConcurrencyLimit,
  listTools,
  safeClose,
} from '../client.js';
import {
  type McpServersConfig,
  findDisabledMatch,
  getConfigSelection,
  getServerConfig,
  isToolAllowedByServerConfig,
  listServerNames,
  loadConfig,
  loadDisabledTools,
} from '../config.js';
import { ErrorCode, formatCliError, registryFetchError } from '../errors.js';
import { globToRegex } from '../glob.js';
import { formatJson, formatSearchResults } from '../output.js';
import { fetchRegistry, getRegistryUrl } from '../registry.js';

export interface GrepOptions {
  pattern: string;
  withDescriptions: boolean;
  json: boolean;
  configInput?: string;
}

interface SearchResult {
  server: string;
  tool: ToolInfo;
}

interface ServerSearchResult {
  serverName: string;
  results: SearchResult[];
  error?: string;
}

/**
 * Process items with limited concurrency, preserving order
 */
async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  maxConcurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await processor(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}

async function searchServerTools(
  serverName: string,
  config: McpServersConfig,
  pattern: RegExp,
): Promise<ServerSearchResult> {
  try {
    const serverConfig = await getServerConfig(config, serverName);
    const { client, close } = await connectToServer(serverName, serverConfig);

    try {
      const tools = await listTools(client);
      const results: SearchResult[] = [];

      for (const tool of tools) {
        if (!isToolAllowedByServerConfig(tool.name, serverConfig)) {
          continue;
        }

        const fullPath = `${serverName}/${tool.name}`;
        const matchesName = pattern.test(tool.name);
        const matchesPath = pattern.test(fullPath);
        const matchesDescription =
          tool.description && pattern.test(tool.description);

        if (matchesName || matchesPath || matchesDescription) {
          results.push({ server: serverName, tool });
        }
      }

      debug(`${serverName}: found ${results.length} matches`);
      return { serverName, results };
    } finally {
      await safeClose(close);
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    debug(`${serverName}: connection failed - ${errorMsg}`);
    return { serverName, results: [], error: errorMsg };
  }
}

async function grepRegistry(options: GrepOptions): Promise<void> {
  let registry;
  try {
    registry = await fetchRegistry();
  } catch (error) {
    console.error(
      formatCliError(
        registryFetchError(getRegistryUrl(), (error as Error).message),
      ),
    );
    process.exit(ErrorCode.NETWORK_ERROR);
  }

  const pattern = globToRegex(options.pattern);
  const disabledPatterns = await loadDisabledTools();

  const results: SearchResult[] = [];
  for (const server of registry.servers) {
    for (const toolName of server.tools) {
      const fullPath = `${server.name}/${toolName}`;
      if (findDisabledMatch(fullPath, disabledPatterns)) {
        continue;
      }
      if (pattern.test(toolName) || pattern.test(fullPath)) {
        results.push({
          server: server.name,
          tool: {
            name: toolName,
            description: undefined,
            inputSchema: {},
          },
        });
      }
    }
  }

  if (results.length === 0) {
    console.log(`No tools found matching "${options.pattern}"`);
    return;
  }

  if (options.json) {
    console.log(
      formatJson(
        results.map((result) => ({
          server: result.server,
          tool: result.tool.name,
          source: 'registry',
        })),
      ),
    );
  } else {
    console.log(formatSearchResults(results, options.withDescriptions));
  }
}

export async function grepCommand(options: GrepOptions): Promise<void> {
  if (getConfigSelection(options.configInput).mode === 'registry') {
    await grepRegistry(options);
    return;
  }

  let config: McpServersConfig;

  try {
    config = await loadConfig(options.configInput, { allowEmpty: true });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const pattern = globToRegex(options.pattern);
  const serverNames = listServerNames(config);

  if (serverNames.length === 0) {
    console.error('Warning: Selected config does not define any servers.');
    console.error(`Tip: Run 'mcpx registry list' for built-in servers.`);
    return;
  }

  const concurrencyLimit = getConcurrencyLimit();

  debug(
    `Searching ${serverNames.length} servers for pattern "${options.pattern}" (concurrency: ${concurrencyLimit})`,
  );

  const serverResults = await processWithConcurrency(
    serverNames,
    (serverName) => searchServerTools(serverName, config, pattern),
    concurrencyLimit,
  );

  const allResults: SearchResult[] = [];
  const failedServers: string[] = [];

  for (const result of serverResults) {
    allResults.push(...result.results);
    if (result.error) {
      failedServers.push(result.serverName);
    }
  }

  const disabledPatterns = await loadDisabledTools();
  const filteredResults = allResults.filter(
    (r) => !findDisabledMatch(`${r.server}/${r.tool.name}`, disabledPatterns),
  );

  if (failedServers.length > 0) {
    console.error(
      `Warning: ${failedServers.length} server(s) failed to connect: ${failedServers.join(', ')}`,
    );
  }

  if (filteredResults.length === 0) {
    console.log(`No tools found matching "${options.pattern}"`);
    return;
  }

  if (options.json) {
    const jsonOutput = filteredResults.map((r) => ({
      server: r.server,
      tool: r.tool.name,
      description: r.tool.description,
      inputSchema: r.tool.inputSchema,
    }));
    console.log(formatJson(jsonOutput));
  } else {
    console.log(formatSearchResults(filteredResults, options.withDescriptions));
  }
}
