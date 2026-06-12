import { type ConfigPathsResult, getConfigPaths } from '../config.js';
import { redactServerConfigEnv, shouldShowEnvValues } from '../output.js';

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

function redactInlineConfigEnv(value: string | undefined): string | undefined {
  if (!value || shouldShowEnvValues()) {
    return value;
  }

  try {
    return JSON.stringify(redactServerConfigEnv(JSON.parse(value)));
  } catch {
    return value;
  }
}

function formatJsonOutput(result: ConfigPathsResult): string {
  const output = {
    ...result,
    envVar: redactInlineConfigEnv(result.envVar),
  };

  return JSON.stringify(output, null, 2);
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  const result = getConfigPaths(options.configInput);

  if (options.json) {
    console.log(formatJsonOutput(result));
  } else {
    console.log(formatTextOutput(result));
  }
}
