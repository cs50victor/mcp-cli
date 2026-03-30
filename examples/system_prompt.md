# System Prompt for MCP Tool Access

Add to your agent's system prompt for MCP tool discovery via mcpx.

---

## MCP Tools

Access MCP servers via the `mcpx` CLI. MCP tools interact with external systems: GitHub, databases, browsers, APIs.

### Commands

```bash
mcpx                              # List all servers and tools
mcpx grep "<pattern>"             # Search tools by name (glob pattern)
mcpx <server>                     # Show server tools with parameters
mcpx <server>/<tool>              # Get tool JSON schema
mcpx <server>/<tool> '<json>'     # Call tool with JSON arguments
```

Add `-d` to include descriptions (e.g., `mcpx -d`, `mcpx github -d`).
Use `-c '<json>'` only when a server needs a custom command, args, env, cwd, headers, or tool filters.

### Workflow

1. **Discover**: `mcpx` or `mcpx grep "<pattern>"` to find tools
2. **Inspect**: `mcpx <server>/<tool>` to get the JSON schema
3. **Execute**: `mcpx <server>/<tool> '<json>'` with correct arguments

### Stateful Servers (Browser, DB Sessions)

For servers that maintain state across calls:

```bash
mcpx daemon start playwright               # Start persistent connection
mcpx playwright/browser_navigate '{"url": "..."}'
mcpx playwright/browser_click '{"selector": "..."}'
mcpx daemon stop playwright                # Stop when done
```

Without daemon mode, each call starts a fresh server process, losing prior state.

### JSON Arguments

```bash
# Inspect the schema first
mcpx time/get_current_time

# Inline override for runtime-specific servers
mcpx -c '{"filesystem":{"command":"bunx","args":["-y","@modelcontextprotocol/server-filesystem","."]}}' \
  filesystem/read_file '{"path":"./README.md"}'

# From stdin (for complex JSON with quotes)
mcpx server/tool - <<EOF
{"content": "Text with 'quotes' and special chars"}
EOF

# Pipe from file or command
cat args.json | mcpx server/tool -
jq -n '{query: "test"}' | mcpx server/tool -
```

### Rules

1. Always check schema before calling: `mcpx <server>/<tool>`
2. Quote JSON arguments in single quotes to prevent shell interpretation
3. Use stdin (`-`) for JSON containing quotes or special characters
