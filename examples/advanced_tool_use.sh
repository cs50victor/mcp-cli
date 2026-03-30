#!/usr/bin/env bash
#
# Programmatic Tool Orchestration
#
# Move data processing outside the model's context window.
# One script replaces N tool calls, keeping intermediate results out of context.
#
# Benefits:
# - Fewer inference passes
# - Clean context (large results stay in the script)
# - Parallel execution and error handling

set -euo pipefail

# Example 1: Search and aggregate across servers
search_across_servers() {
    local query="${1:-mcp}"

    echo "Searching for: $query"
    echo "---"

    # Parallel search across available servers
    for server in github gitlab; do
        if mcpx "$server" &>/dev/null; then
            echo "Results from $server:"
            mcpx "$server/search_repositories" "{\"query\": \"$query\", \"per_page\": 3}" 2>/dev/null || echo "  (server unavailable)"
            echo ""
        fi
    done
}

# Example 2: Chain operations with state
analyze_repository() {
    local owner="${1:-anthropics}"
    local repo="${2:-claude-code}"

    echo "Analyzing $owner/$repo"
    echo "---"

    # Get repo info
    local info
    info=$(mcpx github/search_repositories "{\"query\": \"$owner/$repo\"}" --json)

    # Extract fields
    local name stars
    name=$(echo "$info" | jq -r '.content[0].text' | jq -r '.[0].full_name // "unknown"')
    stars=$(echo "$info" | jq -r '.content[0].text' | jq -r '.[0].stargazers_count // 0')

    # Get counts
    local commits issues
    commits=$(mcpx github/list_commits "{\"owner\": \"$owner\", \"repo\": \"$repo\", \"per_page\": 100}" --json | jq '[.content[0].text | fromjson | length] | add')
    issues=$(mcpx github/list_issues "{\"owner\": \"$owner\", \"repo\": \"$repo\", \"state\": \"open\", \"per_page\": 100}" --json | jq '[.content[0].text | fromjson | length] | add')

    echo "Repository: $name"
    echo "Stars: $stars"
    echo "Recent commits: $commits"
    echo "Open issues: $issues"
}

# Example 3: Browser automation with persistent session
scrape_with_browser() {
    local url="${1:-https://example.com}"
    local selector="${2:-h1}"

    echo "Scraping $url (selector: $selector)"
    echo "---"

    # Start Playwright daemon for session persistence
    mcpx daemon start playwright

    # Ensure cleanup on exit
    trap 'mcpx daemon stop playwright' EXIT

    # Navigate, then inspect the next tool schema before choosing the follow-up action
    mcpx playwright/browser_navigate "{\"url\": \"$url\"}"
    mcpx playwright/browser_evaluate
}

# Example 4: Batch file processing
process_files() {
    local pattern="${1:-*.ts}"
    local directory="${2:-.}"

    echo "Processing files matching $pattern in $directory"
    echo "---"

    # Get file list
    local files
    files=$(mcpx filesystem/search_files "{\"path\": \"$directory\", \"pattern\": \"$pattern\"}" --json | jq -r '.content[0].text' | jq -r '.[]')

    # Process files
    local count=0
    while IFS= read -r file; do
        if [[ -n "$file" ]]; then
            echo "Processing: $file"
            # Count lines
            local content
            content=$(mcpx filesystem/read_file "{\"path\": \"$file\"}")
            local lines
            lines=$(echo "$content" | wc -l)
            echo "  Lines: $lines"
            ((count++))
        fi
    done <<< "$files"

    echo "---"
    echo "Processed $count files"
}

# Main
case "${1:-help}" in
    search)
        search_across_servers "${2:-}"
        ;;
    analyze)
        analyze_repository "${2:-}" "${3:-}"
        ;;
    scrape)
        scrape_with_browser "${2:-}" "${3:-}"
        ;;
    files)
        process_files "${2:-}" "${3:-}"
        ;;
    *)
        echo "Usage: $0 <command> [args...]"
        echo ""
        echo "Commands:"
        echo "  search <query>              Search across multiple MCP servers"
        echo "  analyze <owner> <repo>      Analyze a GitHub repository"
        echo "  scrape <url> <selector>     Scrape with browser (uses daemon)"
        echo "  files <pattern> <dir>       Batch process files"
        ;;
esac
