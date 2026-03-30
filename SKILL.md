---
name: mcpx
description: Interface for MCP (Model Context Protocol) servers via CLI. Use when you need to interact with external tools, APIs, or data sources through MCP servers.
---

# mcpx

Access MCP servers through the command line. MCP enables interaction with external systems like GitHub, filesystems, databases, and APIs.

## Commands

| Command | Output |
|---------|--------|
| `mcpx` | List all servers and tool names |
| `mcpx <server>` | Show tools with parameters |
| `mcpx <server>/<tool>` | Get tool JSON schema |
| `mcpx <server>/<tool> '<json>'` | Call tool with arguments |
| `mcpx grep "<glob>"` | Search tools by name |
| `mcpx daemon start\|stop` | Manage persistent connections (for stateful servers) |

**Add `-d` to include descriptions** (e.g., `mcpx filesystem -d`)

## Workflow

1. **Discover**: `mcpx` → see available servers and tools
2. **Explore**: `mcpx <server>` → see tools with parameters
3. **Inspect**: `mcpx <server>/<tool>` → get full JSON input schema
4. **Execute**: `mcpx <server>/<tool> '<json>'` → run with arguments
5. **Override**: `mcpx -c '<json>' ...` when a server needs custom args, env, cwd, headers, or tool filters

## Examples

```bash
# List all servers and tool names
mcpx

# Inspect registry metadata before overriding a server
mcpx registry get filesystem

# See all tools with parameters
mcpx time

# With descriptions (more verbose)
mcpx -d

# Get JSON schema for specific tool
mcpx time/get_current_time

# Override runtime-specific servers inline
mcpx -c '{"filesystem":{"command":"bunx","args":["-y","@modelcontextprotocol/server-filesystem","."]}}' \
  filesystem/read_file '{"path":"./README.md"}'

# Search for tools
mcpx grep "*file*"

# JSON output for parsing
mcpx filesystem/read_file '{"path":"./README.md"}' --json

# Complex JSON with quotes (use '-' for stdin input)
mcpx server/tool - <<EOF
{"content": "Text with 'quotes' inside"}
EOF

# Or pipe from a file/command
cat args.json | mcpx server/tool -

# Complex Command chaining with xargs and jq
mcpx filesystem/search_files '{"path": "src/", "pattern": "*.ts"}' --json | jq -r '.content[0].text' | head -1 | xargs -I {} sh -c 'mcpx filesystem/read_file "{\"path\": \"{}\"}"'
```


## Options

| Flag | Purpose |
|------|---------|
| `-j, --json` | JSON output for scripting |
| `-d` | Include descriptions |
| `-c, --config <json>` | Inline config override |

## Exit Codes

- `0`: Success
- `1`: Client error (bad args, invalid inline config)
- `2`: Server error (tool failed)
- `3`: Network error
