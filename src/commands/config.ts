import { type ConfigPathsResult, getConfigPaths } from '../config.js';

export interface ConfigOptions {
  json: boolean;
  configInput?: string;
}

function formatTextOutput(result: ConfigPathsResult): string {
  const lines = ['Default: registry-backed in-memory servers'];

  if (result.mode === 'inline') {
    lines.push('Override: inline JSON');
  } else if (result.active) {
    lines.push(`Override: ${result.active}`);
  } else {
    lines.push('Override: (none)');
  }

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
