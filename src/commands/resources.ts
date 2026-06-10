import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ResourceTemplate } from '@modelcontextprotocol/sdk/types.js';
import {
  connectToServer,
  debug,
  listResourceTemplates,
  listResources,
  readResource,
  safeClose,
  serverSupportsResources,
} from '../client.js';
import {
  type McpServersConfig,
  type ServerConfig,
  getServerConfig,
  loadConfig,
} from '../config.js';
import {
  ErrorCode,
  formatCliError,
  resourceListError,
  resourceReadError,
  resourcesNotSupportedError,
  serverConnectionError,
} from '../errors.js';
import {
  formatJson,
  formatResourceContents,
  formatResourceList,
} from '../output.js';

export interface ResourcesOptions {
  server: string;
  uri?: string;
  json: boolean;
  withDescriptions: boolean;
  configInput?: string;
}

export async function resourcesCommand(
  options: ResourcesOptions,
): Promise<void> {
  let config: McpServersConfig;
  try {
    config = await loadConfig(options.configInput, { allowEmpty: true });
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  let serverConfig: ServerConfig;
  try {
    serverConfig = await getServerConfig(config, options.server);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(ErrorCode.CLIENT_ERROR);
  }

  let client: Client;
  let close: () => Promise<void> = async () => {};

  try {
    const connection = await connectToServer(options.server, serverConfig);
    client = connection.client;
    close = connection.close;
  } catch (error) {
    console.error(
      formatCliError(
        serverConnectionError(options.server, (error as Error).message),
      ),
    );
    process.exit(ErrorCode.NETWORK_ERROR);
  }

  try {
    if (!serverSupportsResources(client)) {
      console.error(formatCliError(resourcesNotSupportedError(options.server)));
      process.exit(ErrorCode.SERVER_ERROR);
    }

    if (options.uri) {
      try {
        const result = await readResource(client, options.uri);
        if (options.json) {
          console.log(formatJson(result));
        } else {
          console.log(formatResourceContents(result));
        }
      } catch (error) {
        console.error(
          formatCliError(
            resourceReadError(
              options.uri,
              options.server,
              (error as Error).message,
            ),
          ),
        );
        process.exit(ErrorCode.SERVER_ERROR);
      }
      return;
    }

    try {
      const resources = await listResources(client);

      // NOTE(victor): templates/list is optional - servers with only fixed resources may reject it
      let templates: ResourceTemplate[] = [];
      try {
        templates = await listResourceTemplates(client);
      } catch (error) {
        debug(
          `${options.server}: resource templates unavailable - ${(error as Error).message}`,
        );
      }

      if (options.json) {
        console.log(
          formatJson({
            name: options.server,
            resources,
            resourceTemplates: templates,
          }),
        );
      } else {
        console.log(
          formatResourceList(
            options.server,
            resources,
            templates,
            options.withDescriptions,
          ),
        );
      }
    } catch (error) {
      console.error(
        formatCliError(
          resourceListError(options.server, (error as Error).message),
        ),
      );
      process.exit(ErrorCode.SERVER_ERROR);
    }
  } finally {
    await safeClose(close);
  }
}
