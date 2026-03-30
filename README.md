# mcpx

On-demand MCP tool discovery for AI agents. Fetch schemas only when needed, not upfront.

## The Problem

Traditional MCP integration loads all tool definitions into the agent's context window upfront. The context window consumes thousands of schema tokens before work begins. More MCP servers means more bloat.

The Anthropic API requires tool definitions in the initial request, which has tradeoffs:

| Approach | Upside | Downside |
|----------|--------|----------|
| API-level tools | Native integration, typed schemas | Token bloat, cache invalidation on changes |
| CLI discovery (mcpx) | Lean context, cache-stable | Extra inference per discovery call |

API-level tool changes invalidate [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching), forcing recomputation and higher costs on subsequent requests. Even deferred loading requires declaring tools at conversation start.

mcpx sidesteps these constraints by operating at the **execution layer** instead of the API layer:

```
API Layer:    tools: [bash]           ← static, always cached
Execution:    bash → mcpx discover    ← dynamic, on-demand
```

Your agent gets one tool (bash) with instructions to use mcpx. Tool discovery happens at runtime through shell commands, not API definitions. The prompt cache stays intact regardless of how many MCP servers you add.

See [Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) for the pattern this implements.

## Install

```bash
brew tap cs50victor/mcpx && brew install mcpx
```

<details>
<summary>Alternative methods</summary>

```bash
# Direct install
curl -fsSL https://raw.githubusercontent.com/cs50victor/mcpx/dev/install.sh | bash

# From source (requires bun)
bun install -g github:cs50victor/mcpx
```

</details>

## Quick Start

mcpx resolves servers from the built-in registry and invokes them in memory by default. For agents, `memory` is the default recommendation and is highly recommended for cross-session memory. Local `.mcp.json` / `mcp.json` discovery is disabled unless `MCPX_USE_LOCAL_CONFIG=1`. Explicit config still works via `-c /path/to/.mcp.json` or `MCP_CONFIG_PATH`.

**1. Discover available servers**

```bash
mcpx
mcpx -d
mcpx grep "*time*"
mcpx registry get memory
mcpx registry get filesystem
```

**2. Inspect and call a server with its registry default**

```bash
mcpx memory
mcpx time
mcpx time/get_current_time
```

**3. Use explicit config only when needed**

Some servers need runtime-specific values such as filesystem paths, repository paths, headers, or tool filters. Pass them explicitly with `-c`, or enable local file discovery only for shells where you want that behavior:

```bash
mcpx -c ~/.mcp.json filesystem/read_file '{"path":"./README.md"}'
mcpx -c '{"filesystem":{"command":"bunx","args":["-y","@modelcontextprotocol/server-filesystem","."]}}' \
  filesystem/read_file '{"path":"./README.md"}'
MCPX_USE_LOCAL_CONFIG=1 mcpx config
```

**4. Use daemon mode for stateful servers**

```bash
mcpx daemon start playwright
mcpx playwright/browser_navigate '{"url":"https://example.com"}'
mcpx daemon stop playwright
```

Your agent now accesses MCP tools without loading schemas upfront, while still allowing config files when you explicitly opt into them.

## Agent Integration

Add mcpx to your agent's system prompt. See [`examples/system_prompt.md`](./examples/system_prompt.md) for a drop-in template, or [`examples/`](./examples/) for programmatic orchestration patterns:

| Example | Description |
|---------|-------------|
| [`system_prompt.md`](./examples/system_prompt.md) | Drop-in system prompt for AI agents |
| [`advanced_tool_use.sh`](./examples/advanced_tool_use.sh) | Programmatic tool orchestration |
| [`skill_integration.md`](./examples/skill_integration.md) | Combining skills + mcpx |

## CLI Reference

```
mcpx                              List available registry servers and tools
mcpx grep <pattern>               Search registry tool names (glob pattern)
mcpx <server>                     Show live server tools and parameters
mcpx <server>/<tool>              Show live tool JSON schema
mcpx <server>/<tool> <json>       Call tool with arguments
mcpx config                       Show default mode and local config discovery status
mcpx daemon <start|stop|status>   Manage persistent connections
mcpx registry list                List built-in registry servers
mcpx registry get <name>          Show registry metadata and default config
```

| Flag | Effect |
|------|--------|
| `-d` | Include descriptions |
| `-j` | JSON output |
| `-c <path\|json>` | Config file path or inline config override |

## Config Overrides

Without `-c`, `MCP_CONFIG_PATH`, or `MCPX_USE_LOCAL_CONFIG=1`, mcpx stays registry-backed and in-memory by default.

`-c` / `--config` and `MCP_CONFIG_PATH` accept either:

- A config file path such as `~/.mcp.json`
- Inline JSON in flat or wrapped format

To opt into local `.mcp.json` / `mcp.json` discovery, set `MCPX_USE_LOCAL_CONFIG=1`.

Supported formats:

```json
{
  "filesystem": {
    "command": "bunx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }
}
```

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "bunx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

Overrides can also set `env`, `cwd`, `headers`, `includeTools`, `allowedTools`, and `disabledTools`.

## Environment

Useful environment variables:

- `MCP_CONFIG_PATH`
- `MCPX_USE_LOCAL_CONFIG`
- `MCP_TIMEOUT`
- `MCP_CONCURRENCY`
- `MCP_MAX_RETRIES`
- `MCP_RETRY_DELAY`
- `MCP_DEBUG`
- `MCP_STRICT_ENV`
- `MCP_DAEMON_SOCKET`
- `MCP_DAEMON_IDLE_MS`
- `MCPX_REGISTRY_URL`

## License

MIT
