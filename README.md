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

mcpx resolves servers from the built-in registry and invokes them in memory by default.

**1. Discover available servers**

```bash
mcpx list
mcpx list -d
mcpx registry get time
mcpx registry get filesystem
```

**2. Inspect and call a server with its registry default**

```bash
mcpx time
mcpx time/get_current_time
```

**3. Read resources and load skills**

```bash
mcpx resources myserver                  # List resources and templates
mcpx resources myserver file:///a.txt    # Read any resource by URI
mcpx skills myserver                     # List skills served over MCP
mcpx skills myserver git-workflow        # Load skill://git-workflow/SKILL.md
```

Skills follow [SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640): a skill is a directory of files (minimally a `SKILL.md`) exposed as MCP resources under `skill://<skill-path>/<file-path>`. Discovery reads the well-known `skill://index.json` resource when present and falls back to scanning `resources/list`. Enumeration is optional - a skill URI is always directly readable even when no index lists it.

**4. Use daemon mode for stateful servers**

```bash
mcpx daemon start playwright
mcpx playwright/browser_navigate '{"url":"https://example.com"}'
mcpx daemon stop playwright
```

Your agent now accesses MCP tools without loading schemas upfront.

## Agent Integration

Add mcpx to your agent's system prompt. See [`examples/system_prompt.md`](./examples/system_prompt.md) for a drop-in template, or [`examples/`](./examples/) for programmatic orchestration patterns:

| Example | Description |
|---------|-------------|
| [`system_prompt.md`](./examples/system_prompt.md) | Drop-in system prompt for AI agents |
| [`advanced_tool_use.sh`](./examples/advanced_tool_use.sh) | Programmatic tool orchestration |
| [`skill_integration.md`](./examples/skill_integration.md) | Combining skills + mcpx |

## CLI Reference

```
mcpx                              Show help
mcpx list                         List available registry servers
mcpx <server>                     Show live server tools and parameters
mcpx <server>/<tool>              Show live tool JSON schema
mcpx <server>/<tool> <json>       Call tool with arguments
mcpx resources <server>           List server resources and templates
mcpx resources <server> <uri>     Read a resource by URI
mcpx skills <server>              List skills served by a server (SEP-2640)
mcpx skills <server> <name|uri>   Load a skill's SKILL.md by name or URI
mcpx daemon <start|stop|status>   Manage persistent connections
mcpx registry list                List built-in registry servers
mcpx registry get <name>          Show registry metadata and default config
mcpx registry refresh             Force-refresh the registry cache
```

| Flag | Effect |
|------|--------|
| `-d` | Include descriptions |
| `-j` | JSON output |

## Environment

Useful environment variables:

- `MCP_TIMEOUT`
- `MCP_CONCURRENCY`
- `MCP_MAX_RETRIES`
- `MCP_RETRY_DELAY`
- `MCP_DEBUG`
- `MCP_STRICT_ENV`
- `MCP_DAEMON_SOCKET`
- `MCP_DAEMON_IDLE_MS`
- `MCPX_REGISTRY_URL`
- `MCPX_REGISTRY_AUTH_TOKEN`
- `MCPX_REGISTRY_AUTH_HEADER_TYPE`

## License

MIT
