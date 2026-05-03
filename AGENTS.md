# mcpx

## Repository Ownership

This repository is maintained independently at `cs50victor/mcpx`. It is not an
upstream contribution branch for `philschmid/mcp-cli`.

For GitHub operations in this checkout, always target `cs50victor/mcpx`
explicitly:

```bash
gh pr create -R cs50victor/mcpx ...
gh pr view -R cs50victor/mcpx ...
gh pr close -R cs50victor/mcpx ...
```

Never let `gh` infer the PR repository from remotes or fork metadata in this
checkout. Do not open PRs against `philschmid/mcp-cli` unless the user explicitly
asks to contribute upstream.

## Registry Update Protocol

`registry/registry.json` is the source of truth for MCP server discovery. Agents depend on accurate data.

### 1. Fetch Official Docs

WebFetch the official documentation URL. Extract:
- Server URL/endpoint
- Command and args
- Required environment variables

### 2. Clone the Repository

WebFetch summaries lose detail. Clone the repo:

```bash
git clone --depth 1 <repo-url> /tmp/<repo-name>
```

### 3. Find Tool Definitions

Do not add static tool lists or tool counts to registry entries. MCP tools are
discovered at runtime by querying the server.

### 4. Read the README

READMEs list documented tools. Source code may include unlisted internal tools. Trust the README.

### 5. Verify Configuration

Check for:
- URL query parameters (`?project_ref=`, `?read_only=`)
- Environment variables (add to `envVars` array)
- Required placeholders (`<project-ref>`, `/path/to/dir`)

### 6. Write the Entry

```json
{
  "name": "server-name",
  "description": "What it does",
  "recommended": {
    "command": "bunx",
    "args": ["-y", "<package>", "<required-args>"]
  },
  "envVars": ["API_KEY"],
  "notes": "Replace <placeholder> with X. Optional: --flag for Y."
}
```

### Standards

1. Use `bunx`, not `npx`
2. Do not include static `tools` or `toolCount` fields
3. Explain placeholders in notes
4. For remote servers, use `mcp-remote`:
   ```json
   "args": ["-y", "mcp-remote", "https://example.com/mcp"]
   ```

### Example: Supabase MCP

1. WebFetch docs - got overview
2. WebSearch - found project scoping requirement
3. Clone repo to `/tmp/supabase-mcp`
4. Read README and config docs
5. Note URL params: `project_ref`, `read_only`, `features`

Result: accurate entry with project scoping in URL and no static tool metadata.
