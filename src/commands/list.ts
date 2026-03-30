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
import { formatJson, formatServerList } from '../output.js';
import {
  fetchRegistry,
  getRegistryUrl,
  isAgentDefaultServer,
  sortRegistryServers,
} from '../registry.js';

export interface ListOptions {
  withDescriptions: boolean;
  json: boolean;
  configInput?: string;
}

interface ServerWithTools {
  name: string;
  tools: ToolInfo[];
  error?: string;
  serverConfig?: import('../config.js').ServerConfig;
  instructions?: string;
}

/**
 * Process items with limited concurrency, preserving order
 * Uses a worker pool pattern where each worker grabs the next item from a shared index
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

async function fetchServerTools(
  serverName: string,
  config: McpServersConfig,
): Promise<ServerWithTools> {
  try {
    const serverConfig = await getServerConfig(config, serverName);
    const { client, close, instructions } = await connectToServer(
      serverName,
      serverConfig,
    );

    try {
      const tools = await listTools(client);
      debug(`${serverName}: loaded ${tools.length} tools`);
      return { name: serverName, tools, serverConfig, instructions };
    } finally {
      await safeClose(close);
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    debug(`${serverName}: connection failed - ${errorMsg}`);
    return {
      name: serverName,
      tools: [],
      error: errorMsg,
    };
  }
}

async function listRegistryServers(options: ListOptions): Promise<void> {
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

  const disabledPatterns = await loadDisabledTools();
  const servers = sortRegistryServers(
    registry.servers.map((server) => {
      const tools = server.tools
        .filter(
          (toolName) =>
            !findDisabledMatch(`${server.name}/${toolName}`, disabledPatterns),
        )
        .map((toolName) => ({
          name: toolName,
          description: undefined,
          inputSchema: {},
        }));

      return {
        name: server.name,
        description: server.description,
        toolCount: tools.length,
        tools,
      };
    }),
  );

  if (options.json) {
    console.log(
      formatJson(
        servers.map((server) => ({
          name: server.name,
          description: server.description,
          toolCount: server.toolCount,
          tools: server.tools.map((tool) => tool.name),
          source: 'registry',
        })),
      ),
    );
  } else {
    console.log(
      formatServerList(
        servers.map((server) => ({
          name: server.name,
          tools: server.tools,
          instructions: server.description,
          label: isAgentDefaultServer(server.name)
            ? '[default for agents, highly recommended]'
            : undefined,
        })),
        options.withDescriptions,
      ),
    );
    console.log("\nTip: Run 'mcpx <server>' to inspect a server live.");
  }
}

export async function listCommand(options: ListOptions): Promise<void> {
  if (getConfigSelection(options.configInput).mode === 'registry') {
    await listRegistryServers(options);
    return;
  }

  let config: McpServersConfig;

  try {
    config = await loadConfig(options.configInput, { allowEmpty: true });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const serverNames = listServerNames(config);

  if (serverNames.length === 0) {
    console.error('Warning: Selected config does not define any servers.');
    console.error(`Tip: Run 'mcpx registry list' for built-in servers.`);
    return;
  }

  const concurrencyLimit = getConcurrencyLimit();
  debug(
    `Processing ${serverNames.length} servers with concurrency ${concurrencyLimit}`,
  );

  const servers = await processWithConcurrency(
    serverNames,
    (name) => fetchServerTools(name, config),
    concurrencyLimit,
  );

  servers.sort((a, b) => a.name.localeCompare(b.name));

  const disabledPatterns = await loadDisabledTools();
  for (const server of servers) {
    server.tools = server.tools.filter((t) => {
      if (!findDisabledMatch(`${server.name}/${t.name}`, disabledPatterns)) {
        if (server.serverConfig) {
          return isToolAllowedByServerConfig(t.name, server.serverConfig);
        }
        return true;
      }
      return false;
    });
  }

  const displayServers = servers.map((s) => ({
    name: s.name,
    tools: s.error
      ? [
          {
            name: `<error: ${s.error}>`,
            description: undefined,
            inputSchema: {},
          },
        ]
      : s.tools,
    instructions: s.instructions,
  }));

  if (options.json) {
    const jsonOutput = servers.map((s) => ({
      name: s.name,
      tools: s.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      error: s.error,
      instructions: s.instructions,
    }));
    console.log(formatJson(jsonOutput));
  } else {
    console.log(formatServerList(displayServers, options.withDescriptions));
    console.log("\nTip: Run 'mcpx registry list' for built-in servers.");
  }
}
