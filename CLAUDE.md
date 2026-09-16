# Sumo Logic MCP Server

## Installation

Account credentials are stored at `~/.sumologic/access-keys.json` (falls back to the legacy `~/.sumologic/mcp-config.json` if that's the only file present):

```json
{
  "accounts": {
    "longData": {
      "deployment": "US1",
      "accessId": "...",
      "accessKey": "..."
    }
  }
}
```

The config directory is auto-created on first write. If no config file exists at all, a sample `access-keys.json` with 16 placeholder accounts is created automatically on startup — fill in real `accessId`/`accessKey` values before use. Use `configure_sumo_accounts` to open the resolved config file in your system editor.

## Build / Dev / Run

```bash
npm install       # Install dependencies (run once after clone or when package.json changes)
npm run build     # TypeScript compile (tsc) -> dist/
npm run dev       # Run from source via tsx (npx tsx src/index.ts)
npm start         # Run compiled output (node dist/index.js)
```

No test framework is configured. The project uses TypeScript 5.9+ targeting ES2022 with Node16 module resolution.

**Always run `npm run build` after any code changes.**

MCP (Model Context Protocol) server that exposes Sumo Logic Search, Log, and Metrics APIs as tools for AI assistants.

## Project Structure

```
src/
  index.ts                    # Entry point: creates McpServer, wires layers, connects stdio
  client/
    sumo-client.ts            # HTTP client with rate limiting (4 req/s) and retry logic
  config/
    config-manager.ts         # Reads ~/.sumologic/access-keys.json (fallback: mcp-config.json)
    deployments.ts            # Maps deployment regions (US1, US2, EU, etc.) to API base URLs
  tools/
    config-tools.ts           # Account configuration tools (configure, list)
    search-job-tools.ts       # Search job tools (sumo_search, sumo_search_all, create/status/messages/records)
    metrics-tools.ts          # Metrics query tools (sumo_run_metrics_query, sumo_run_metrics_query_all)
    dashboard-tools.ts        # Dashboard tools (sumo_get_dashboard, sumo_list_dashboards)
  charts/
    svg-chart.ts              # Pure SVG chart generation (line charts, bar charts) — zero dependencies
    metrics-chart-adapter.ts  # Transforms MetricsQueryResponse → ChartData for SVG rendering
    search-chart-adapter.ts   # Transforms SearchRecordsResponse → ChartData (timeslice→line, categorical→bar)
  types/
    config.ts                 # DeploymentRegion, AccountConfig, McpConfig
    search.ts                 # Search job types (CreateSearchJobResponse, SearchJobStatus, etc.)
    metrics.ts                # Metrics query/response types
    dashboard.ts              # Dashboard types (Dashboard, PaginatedDashboards)
    chart.ts                  # Chart types (ChartData, ChartSeries, BarChartData, BarChartItem)
```

### Architecture (4 layers)

1. **Entry** (`index.ts`) — Creates `McpServer`, initializes `ConfigManager` and `SumoClient`, registers tool groups, connects `StdioServerTransport`.
2. **Config** (`config/`) — Manages multi-account configuration read from `~/.sumologic/access-keys.json`, falling back to the legacy `~/.sumologic/mcp-config.json` if the primary file doesn't exist. If neither exists, a sample `access-keys.json` (16 placeholder accounts) is created on startup. The config is re-read from disk on every lookup, so manual edits take effect without restarting the server. Accounts with placeholder (`"..."`) credentials raise an error when used directly but are silently skipped by the `_all` fan-out tools. Supports 10 public deployment regions (AU, CA, DE, EU, FED, IN, JP, KR, US1, US2); unrecognized region codes fall back to a derived URL.
3. **Client** (`client/sumo-client.ts`) — Stateless HTTP client using `fetch`. Handles Basic auth, token-bucket rate limiting, exponential backoff retries (max 3), and 429/5xx handling.
4. **Tools** (`tools/`) — Each file exports a `register*Tools(server, client|configManager)` function that calls `server.tool()` to register MCP tools with Zod input schemas.

## Key Patterns

- **Tool registration**: Each tool is registered via `server.tool(name, description, zodSchema, handler)`. The Zod schema defines the tool's input parameters.
- **MCP response format**: Handlers return `{ content: [{ type: "text" as const, text: "..." }] }`. Use `as const` on the `type` field for MCP SDK type narrowing. Error responses add `isError: true`.
- **Logging**: Use `console.error()` for logging — stdout is reserved for the MCP stdio protocol.
- **Search job lifecycle**: `sumo_search` is a high-level tool that creates a job, polls until done (120s timeout with exponential backoff), fetches results, and cleans up. The low-level tools (`sumo_create_search_job`, `sumo_get_search_job_status`, etc.) expose individual steps but are hidden by default (see Environment Variables below).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SUMO_ENABLE_LOW_LEVEL_TOOLS` | `false` | `true` exposes the 4 low-level search job tools alongside `sumo_search`/`sumo_search_all`. |
| `SUMO_TIMEZONE` | `America/Los_Angeles` | Time zone for all search job tools; not a per-call parameter. |

## Code Conventions

- **ES modules**: `"type": "module"` in package.json. All imports use `.js` extensions (e.g., `./config/config-manager.js`), even for `.ts` source files — this is required by Node16 module resolution.
- **Strict TypeScript**: `strict: true` in tsconfig.
- **No external HTTP library**: Uses native `fetch` (Node 18+).
- **Zod for validation**: All tool input schemas use Zod. Complex schemas (time ranges) are extracted into `const` variables.
- **Error handling in tools**: Every tool handler wraps its body in try/catch and returns an MCP error response rather than throwing.

## Sumo Logic API Endpoints Used

- `/v1/search/jobs` — Create, poll, fetch messages/records, delete search jobs
- `/v1/metrics/results` — Execute metrics queries
- `/v2/dashboards` — List and retrieve dashboards
