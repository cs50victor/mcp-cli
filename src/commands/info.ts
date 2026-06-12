import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectToServer, listTools, safeClose } from '../client.js';
import {
  type McpServersConfig,
  type ServerConfig,
  findDisabledMatch,
  getServerConfig,
  isToolAllowedByServerConfig,
  loadConfig,
  loadDisabledTools,
} from '../config.js';
import {
  ErrorCode,
  formatCliError,
  serverConnectionError,
  toolDisabledError,
  toolNotFoundError,
} from '../errors.js';
import {
  formatJson,
  formatServerDetails,
  formatToolSchema,
  redactServerConfigEnv,
} from '../output.js';

export interface InfoOptions {
  target: string; // "server" or "server/tool"
  json: boolean;
  withDescriptions: boolean;
  configInput?: string;
}

function parseTarget(target: string): { server: string; tool?: string } {
  const parts = target.split('/');
  if (parts.length === 1) {
    return { server: parts[0] };
  }
  return { server: parts[0], tool: parts.slice(1).join('/') };
}

export async function infoCommand(options: InfoOptions): Promise<void> {
  let config: McpServersConfig;

  try {
    config = await loadConfig(options.configInput, { allowEmpty: true });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  const { server: serverName, tool: toolName } = parseTarget(options.target);

  let serverConfig: ServerConfig;
  try {
    serverConfig = await getServerConfig(config, serverName);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  let client: Client;
  let close: () => Promise<void> = async () => {};
  let instructions: string | undefined;

  try {
    const connection = await connectToServer(serverName, serverConfig);
    client = connection.client;
    close = connection.close;
    instructions = connection.instructions;
  } catch (error) {
    console.error(
      formatCliError(
        serverConnectionError(serverName, (error as Error).message),
      ),
    );
    process.exit(ErrorCode.NETWORK_ERROR);
  }

  try {
    const disabledPatterns = await loadDisabledTools();

    if (toolName) {
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

      const tools = await listTools(client);
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        const availableTools = tools
          .filter(
            (t) =>
              !findDisabledMatch(`${serverName}/${t.name}`, disabledPatterns) &&
              isToolAllowedByServerConfig(t.name, serverConfig),
          )
          .map((t) => t.name);
        console.error(
          formatCliError(
            toolNotFoundError(toolName, serverName, availableTools),
          ),
        );
        process.exit(ErrorCode.CLIENT_ERROR);
      }

      if (options.json) {
        console.log(
          formatJson({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }),
        );
      } else {
        console.log(formatToolSchema(serverName, tool));
      }
    } else {
      const tools = await listTools(client);

      const filteredTools = tools.filter(
        (t) =>
          !findDisabledMatch(`${serverName}/${t.name}`, disabledPatterns) &&
          isToolAllowedByServerConfig(t.name, serverConfig),
      );

      if (options.json) {
        console.log(
          formatJson({
            name: serverName,
            config: redactServerConfigEnv(serverConfig),
            tools: filteredTools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
            instructions,
          }),
        );
      } else {
        console.log(
          formatServerDetails(
            serverName,
            serverConfig,
            filteredTools,
            options.withDescriptions,
            instructions,
          ),
        );
      }
    }
  } finally {
    await safeClose(close);
  }
}
