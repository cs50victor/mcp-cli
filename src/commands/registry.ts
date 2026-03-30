import {
  ErrorCode,
  formatCliError,
  registryFetchError,
  registryServerNotFoundError,
} from '../errors.js';
import {
  formatJson,
  formatRegistryList,
  formatRegistryServer,
} from '../output.js';
import {
  type Registry,
  fetchRegistry,
  findServer,
  getRegistryUrl,
} from '../registry.js';

export interface RegistryOptions {
  action: 'help' | 'list' | 'get';
  serverName?: string;
  json: boolean;
}

function printRegistryHelp(): void {
  console.log(`mcpx registry - Discover available MCP servers

Usage:
  mcpx registry list              List all available servers
  mcpx registry list --json       List servers as JSON
  mcpx registry get <name>        Show server details and config
  mcpx registry get <name> --json Get server metadata as JSON
  mcpx registry <name>            Shorthand for 'get <name>'

Environment:
  MCPX_REGISTRY_URL    Custom registry URL (default: GitHub-hosted registry)`);
}

export async function registryCommand(options: RegistryOptions): Promise<void> {
  if (options.action === 'help') {
    printRegistryHelp();
    return;
  }

  let registry: Registry;
  try {
    registry = await fetchRegistry();
  } catch (error) {
    const url = getRegistryUrl();
    console.error(
      formatCliError(registryFetchError(url, (error as Error).message)),
    );
    process.exit(ErrorCode.NETWORK_ERROR);
  }

  if (options.action === 'list') {
    if (options.json) {
      console.log(formatJson(registry.servers));
    } else {
      console.log(formatRegistryList(registry.servers));
    }
    return;
  }

  if (options.action === 'get') {
    if (!options.serverName) {
      console.error('Usage: mcpx registry get <server-name>');
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    const server = findServer(registry, options.serverName);
    if (!server) {
      console.error(
        formatCliError(
          registryServerNotFoundError(
            options.serverName,
            registry.servers.map((s) => s.name),
          ),
        ),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    if (options.json) {
      console.log(formatJson(server));
    } else {
      console.log(formatRegistryServer(server));
    }
  }
}
