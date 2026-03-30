import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  callTool,
  connectToServer,
  debug,
  getTimeoutMs,
  listTools,
  safeClose,
} from '../client.js';
import {
  type McpServersConfig,
  type ServerConfig,
  findDisabledMatch,
  getServerConfig,
  isToolAllowedByServerConfig,
  loadConfig,
  loadDisabledTools,
} from '../config.js';
import { callViaDaemon, isServerInDaemon } from '../daemon.js';
import {
  ErrorCode,
  formatCliError,
  invalidJsonArgsError,
  invalidTargetError,
  serverConnectionError,
  toolDisabledError,
  toolExecutionError,
  toolNotFoundError,
} from '../errors.js';
import { formatJson, formatToolResult } from '../output.js';

export interface CallOptions {
  target: string; // "server/tool"
  args?: string; // JSON arguments
  json: boolean;
  configInput?: string;
}

function parseTarget(target: string): { server: string; tool: string } {
  const slashIndex = target.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(formatCliError(invalidTargetError(target)));
  }
  return {
    server: target.substring(0, slashIndex),
    tool: target.substring(slashIndex + 1),
  };
}

async function parseArgs(
  argsString?: string,
): Promise<Record<string, unknown>> {
  let jsonString: string;

  if (argsString) {
    jsonString = argsString;
  } else if (!process.stdin.isTTY) {
    // NOTE(victor): timer cleanup prevents memory leak on stdin timeout
    const timeoutMs = getTimeoutMs();
    const chunks: Buffer[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const readPromise = (async () => {
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf-8').trim();
    })();

    const timeoutPromise = new Promise<string>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`stdin read timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    try {
      jsonString = await Promise.race([readPromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } else {
    return {};
  }

  if (!jsonString) {
    return {};
  }

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error(
      formatCliError(invalidJsonArgsError(jsonString, (e as Error).message)),
    );
  }
}

export async function callCommand(options: CallOptions): Promise<void> {
  let config: McpServersConfig;

  try {
    config = await loadConfig(options.configInput, { allowEmpty: true });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  let serverName: string;
  let toolName: string;

  try {
    const parsed = parseTarget(options.target);
    serverName = parsed.server;
    toolName = parsed.tool;
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const disabledPatterns = await loadDisabledTools();
  const disabledMatch = findDisabledMatch(
    `${serverName}/${toolName}`,
    disabledPatterns,
  );
  if (disabledMatch) {
    console.error(
      formatCliError(
        toolDisabledError(
          `${serverName}/${toolName}`,
          disabledMatch.pattern,
          disabledMatch.source,
        ),
      ),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  let args: Record<string, unknown>;
  try {
    args = await parseArgs(options.args);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  if (await isServerInDaemon(serverName)) {
    debug(`routing call through daemon: ${serverName}/${toolName}`);
    let daemonConfig: ServerConfig | undefined;
    let configSource: string | undefined;

    if (config.mcpServers[serverName]) {
      daemonConfig = config.mcpServers[serverName];
      configSource = config._configSource || 'inline';
    } else {
      try {
        daemonConfig = await getServerConfig(config, serverName);
        configSource = 'registry';
      } catch {
        daemonConfig = undefined;
      }
    }

    if (daemonConfig && !isToolAllowedByServerConfig(toolName, daemonConfig)) {
      console.error(
        formatCliError(
          toolDisabledError(
            `${serverName}/${toolName}`,
            'server config filter',
            'includeTools/disabledTools',
          ),
        ),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    try {
      const result = await callViaDaemon(
        serverName,
        daemonConfig,
        configSource,
        toolName,
        args,
      );
      if (options.json) {
        console.log(formatJson(result));
      } else {
        console.log(formatToolResult(result));
      }
      return;
    } catch (error) {
      const errMsg = (error as Error).message;
      if (errMsg.includes('not found') || errMsg.includes('unknown tool')) {
        console.error(
          formatCliError(toolNotFoundError(toolName, serverName, undefined)),
        );
      } else if (errMsg.includes('disabled by server config')) {
        console.error(
          formatCliError(
            toolDisabledError(
              `${serverName}/${toolName}`,
              'server config filter',
              'includeTools/disabledTools',
            ),
          ),
        );
      } else {
        console.error(
          formatCliError(toolExecutionError(toolName, serverName, errMsg)),
        );
      }
      process.exit(ErrorCode.SERVER_ERROR);
    }
  }

  let serverConfig: ServerConfig;
  try {
    serverConfig = await getServerConfig(config, serverName);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  if (!isToolAllowedByServerConfig(toolName, serverConfig)) {
    console.error(
      formatCliError(
        toolDisabledError(
          `${serverName}/${toolName}`,
          'server config filter',
          'includeTools/disabledTools',
        ),
      ),
    );
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  let client: Client;
  // NOTE(victor): initialize to noop to prevent undefined access in finally block
  let close: () => Promise<void> = async () => {};

  try {
    const connection = await connectToServer(serverName, serverConfig);
    client = connection.client;
    close = connection.close;
  } catch (error) {
    console.error(
      formatCliError(
        serverConnectionError(serverName, (error as Error).message),
      ),
    );
    process.exit(ErrorCode.NETWORK_ERROR);
  }

  try {
    const result = await callTool(client, toolName, args);

    if (options.json) {
      console.log(formatJson(result));
    } else {
      console.log(formatToolResult(result));
    }
  } catch (error) {
    let availableTools: string[] | undefined;
    try {
      const tools = await listTools(client);
      availableTools = tools.map((t) => t.name);
    } catch {
      // NOTE(victor): silently continue without tool list if listing fails
    }

    const errMsg = (error as Error).message;
    if (errMsg.includes('not found') || errMsg.includes('unknown tool')) {
      console.error(
        formatCliError(toolNotFoundError(toolName, serverName, availableTools)),
      );
    } else {
      console.error(
        formatCliError(toolExecutionError(toolName, serverName, errMsg)),
      );
    }
    process.exit(ErrorCode.SERVER_ERROR);
  } finally {
    await safeClose(close);
    console.error(
      '[mcpx] Session connection closed (stateful tools like browser automation need daemon mode, see mcpx --help)',
    );
  }
}
