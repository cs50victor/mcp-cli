import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import {
  connectToServer,
  debug,
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
  resourceReadError,
  resourcesNotSupportedError,
  serverConnectionError,
  skillNotFoundError,
} from '../errors.js';
import {
  type SkillListEntry,
  formatJson,
  formatResourceContents,
  formatSkillList,
} from '../output.js';

export interface SkillsOptions {
  server: string;
  /** Skill name, skill path, or full resource URI */
  skill?: string;
  json: boolean;
  configInput?: string;
}

/**
 * Skills over MCP (SEP-2640): each file of a skill directory is an MCP
 * resource, conventionally under skill://<skill-path>/<file-path>. The
 * well-known skill://index.json resource enumerates skills but is optional,
 * so absence of an index never proves a server has no skills.
 */
const SKILL_INDEX_URI = 'skill://index.json';

const SKILL_MD_URI_PATTERN = /^skill:\/\/(.+)\/SKILL\.md$/;

interface SkillIndexEntry {
  type?: string;
  name?: string;
  description?: string;
  url?: string;
}

function firstTextContent(result: ReadResourceResult): string | undefined {
  for (const content of result.contents) {
    if ('text' in content) {
      return content.text;
    }
  }
  return undefined;
}

async function readSkillIndex(
  client: Client,
): Promise<SkillIndexEntry[] | undefined> {
  let text: string | undefined;
  try {
    text = firstTextContent(await readResource(client, SKILL_INDEX_URI));
  } catch (error) {
    debug(`no ${SKILL_INDEX_URI}: ${(error as Error).message}`);
    return undefined;
  }
  if (!text) return undefined;

  try {
    const parsed = JSON.parse(text) as { skills?: SkillIndexEntry[] };
    return Array.isArray(parsed.skills) ? parsed.skills : undefined;
  } catch (error) {
    debug(`invalid ${SKILL_INDEX_URI}: ${(error as Error).message}`);
    return undefined;
  }
}

function indexEntriesToSkills(entries: SkillIndexEntry[]): SkillListEntry[] {
  const skills: SkillListEntry[] = [];
  for (const entry of entries) {
    if (!entry.url) continue;
    if (entry.type === 'skill-md') {
      skills.push({
        name: entry.name,
        description: entry.description,
        uri: entry.url,
      });
    } else if (entry.type === 'mcp-resource-template') {
      skills.push({
        description: entry.description,
        uri: entry.url,
        template: true,
      });
    }
    // NOTE(victor): SEP-2640 - clients skip entries with unrecognized type
  }
  return skills;
}

async function discoverSkills(client: Client): Promise<SkillListEntry[]> {
  const indexEntries = await readSkillIndex(client);
  if (indexEntries) {
    return indexEntriesToSkills(indexEntries);
  }

  // No index: scan resources/list for skill://<skill-path>/SKILL.md URIs
  try {
    const resources = await listResources(client);
    const skills: SkillListEntry[] = [];
    for (const resource of resources) {
      const match = resource.uri.match(SKILL_MD_URI_PATTERN);
      if (!match) continue;
      const segments = match[1].split('/');
      skills.push({
        name: segments[segments.length - 1],
        description: resource.description,
        uri: resource.uri,
      });
    }
    return skills;
  } catch (error) {
    debug(
      `skill discovery via resources/list failed: ${(error as Error).message}`,
    );
    return [];
  }
}

async function resolveSkillUri(client: Client, skill: string): Promise<string> {
  if (skill.includes('://')) {
    return skill;
  }
  // The index is authoritative and may map a name to a non-skill:// scheme
  const indexEntries = await readSkillIndex(client);
  const match = indexEntries?.find(
    (entry) => entry.type === 'skill-md' && entry.name === skill && entry.url,
  );
  if (match?.url) {
    return match.url;
  }
  return `skill://${skill}/SKILL.md`;
}

export async function skillsCommand(options: SkillsOptions): Promise<void> {
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

    if (options.skill) {
      const uri = await resolveSkillUri(client, options.skill);
      try {
        const result = await readResource(client, uri);
        if (options.json) {
          console.log(formatJson(result));
        } else {
          console.log(formatResourceContents(result));
        }
      } catch (error) {
        const errMsg = (error as Error).message;
        if (errMsg.includes('not found') || errMsg.includes('-32002')) {
          const available = (await discoverSkills(client))
            .map((s) => s.name)
            .filter((name): name is string => Boolean(name));
          console.error(
            formatCliError(
              skillNotFoundError(options.skill, options.server, available),
            ),
          );
          process.exit(ErrorCode.CLIENT_ERROR);
        }
        console.error(
          formatCliError(resourceReadError(uri, options.server, errMsg)),
        );
        process.exit(ErrorCode.SERVER_ERROR);
      }
      return;
    }

    const skills = await discoverSkills(client);

    if (options.json) {
      console.log(formatJson({ name: options.server, skills }));
    } else if (skills.length === 0) {
      console.log(`No skills discovered on server "${options.server}".`);
      console.log(
        'Note: servers are not required to enumerate skills. A known skill is still loadable by URI:',
      );
      console.log(`  mcpx skills ${options.server} skill://<name>/SKILL.md`);
    } else {
      console.log(formatSkillList(options.server, skills));
    }
  } finally {
    await safeClose(close);
  }
}
