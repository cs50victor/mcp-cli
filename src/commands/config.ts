import { type ConfigPathsResult, getConfigPaths } from '../config.js';

export interface ConfigOptions {
  json: boolean;
  configInput?: string;
}

function formatTextOutput(result: ConfigPathsResult): string {
  const lines: string[] = [];

  lines.push('Default: registry-backed in-memory servers');
  lines.push(
    result.localDiscoveryEnabled
      ? 'Local config discovery: enabled via MCPX_USE_LOCAL_CONFIG'
      : 'Local config discovery: disabled by default (set MCPX_USE_LOCAL_CONFIG=1 to enable)',
  );

  if (result.mode === 'inline') {
    const source =
      result.activeSource === 'env' ? 'MCP_CONFIG_PATH' : '-c/--config';
    lines.push(`Selected config: inline JSON (from ${source})`);
  } else if (result.active) {
    lines.push(`Selected config: ${result.active}`);
    if (result.activeSource === 'cli') {
      lines.push('                 (from -c/--config flag)');
    } else if (result.activeSource === 'env') {
      lines.push('                 (from MCP_CONFIG_PATH)');
    } else if (result.activeSource === 'local') {
      lines.push('                 (discovered from local config paths)');
    }
  } else {
    lines.push('Selected config: (none)');
  }

  lines.push('');
  lines.push('Local config paths:');

  for (const info of result.searchPaths) {
    const marker = info.active ? '>' : info.exists ? 'o' : 'x';
    lines.push(`  ${marker} ${info.path}`);
  }

  if (result.envVar) {
    lines.push('');
    lines.push(`MCP_CONFIG_PATH=${result.envVar}`);
  }

  lines.push('');
  lines.push(
    "Tip: Registry/in-memory stays the default. Use -c '<path-or-json>' or MCP_CONFIG_PATH for explicit config, or set MCPX_USE_LOCAL_CONFIG=1 to enable local .mcp.json / mcp.json discovery.",
  );

  return lines.join('\n');
}

function formatJsonOutput(result: ConfigPathsResult): string {
  return JSON.stringify(result, null, 2);
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  const result = getConfigPaths(options.configInput);

  if (options.json) {
    console.log(formatJsonOutput(result));
  } else {
    console.log(formatTextOutput(result));
  }
}
