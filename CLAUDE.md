# Sumo Logic MCP Server

MCP (Model Context Protocol) server that exposes Sumo Logic Search, Log, and Metrics APIs as tools for AI assistants.

## Build / Dev / Run

```bash
npm run build     # TypeScript compile (tsc) -> dist/
npm run dev       # Run from source via tsx (npx tsx src/index.ts)
npm start         # Run compiled output (node dist/index.js)
```

No test framework is configured. The project uses TypeScript 5.9+ targeting ES2022 with Node16 module resolution.

## Project Structure

```
src/
  index.ts                    # Entry point: creates McpServer, wires layers, connects stdio
  client/
    sumo-client.ts            # HTTP client with rate limiting (4 req/s) and retry logic
  config/
    config-manager.ts         # Reads/writes ~/.sumologic/mcp-config.json
    deployments.ts            # Maps deployment regions (US1, US2, EU, etc.) to API base URLs
  tools/
    config-tools.ts           # Account management tools (add/remove/switch/list)
    search-job-tools.ts       # Search job tools (sumo_search, create/status/messages/records)
    log-search-tools.ts       # Saved log search CRUD tools
    metrics-tools.ts          # Metrics query + saved metrics search tools
  types/
    config.ts                 # DeploymentRegion, AccountConfig, McpConfig
    search.ts                 # Search job types, saved log search types, time range types
    metrics.ts                # Metrics query/response types, saved metrics search types
```

### Architecture (4 layers)

1. **Entry** (`index.ts`) — Creates `McpServer`, initializes `ConfigManager` and `SumoClient`, registers tool groups, connects `StdioServerTransport`.
2. **Config** (`config/`) — Manages multi-account configuration persisted to `~/.sumologic/mcp-config.json`. Supports 10 deployment regions (AU, CA, DE, EU, FED, IN, JP, KR, US1, US2).
3. **Client** (`client/sumo-client.ts`) — Stateless HTTP client using `fetch`. Handles Basic auth, token-bucket rate limiting, exponential backoff retries (max 3), and 429/5xx handling.
4. **Tools** (`tools/`) — Each file exports a `register*Tools(server, client|configManager)` function that calls `server.tool()` to register MCP tools with Zod input schemas.

## Key Patterns

- **Tool registration**: Each tool is registered via `server.tool(name, description, zodSchema, handler)`. The Zod schema defines the tool's input parameters.
- **MCP response format**: Handlers return `{ content: [{ type: "text" as const, text: "..." }] }`. Use `as const` on the `type` field for MCP SDK type narrowing. Error responses add `isError: true`.
- **Logging**: Use `console.error()` for logging — stdout is reserved for the MCP stdio protocol.
- **Search job lifecycle**: `sumo_search` is a high-level tool that creates a job, polls until done (120s timeout with exponential backoff), fetches results, and cleans up. The low-level tools (`sumo_create_search_job`, `sumo_get_search_job_status`, etc.) expose individual steps but are hidden by default (see Environment Variables below).

## Configuration

Account credentials are stored at `~/.sumologic/mcp-config.json`:

```json
{
  "activeAccount": "account-name",
  "accounts": {
    "account-name": {
      "deployment": "US1",
      "accessId": "...",
      "accessKey": "..."
    }
  }
}
```

The first account added is auto-activated. The config directory is auto-created on first write.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SUMO_ENABLE_LOW_LEVEL_TOOLS` | `false` | Set to `true` to expose the 4 low-level search job tools (`sumo_create_search_job`, `sumo_get_search_job_status`, `sumo_get_search_job_messages`, `sumo_get_search_job_records`). By default only the high-level `sumo_search` and `sumo_search_all` tools are registered. |

Example — enable in an MCP client config:

```json
{
  "mcpServers": {
    "sumologic": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "SUMO_ENABLE_LOW_LEVEL_TOOLS": "true"
      }
    }
  }
}
```

Or via the command line:

```bash
SUMO_ENABLE_LOW_LEVEL_TOOLS=true npm start
```

## Code Conventions

- **ES modules**: `"type": "module"` in package.json. All imports use `.js` extensions (e.g., `./config/config-manager.js`), even for `.ts` source files — this is required by Node16 module resolution.
- **Strict TypeScript**: `strict: true` in tsconfig.
- **No external HTTP library**: Uses native `fetch` (Node 18+).
- **Zod for validation**: All tool input schemas use Zod. Complex schemas (time ranges) are extracted into `const` variables.
- **Error handling in tools**: Every tool handler wraps its body in try/catch and returns an MCP error response rather than throwing.

## Sumo Logic API Endpoints Used

- `/v1/search/jobs` — Create, poll, fetch messages/records, delete search jobs
- `/v1/logSearches` — CRUD for saved log searches
- `/v1/metrics/results` — Execute metrics queries
- `/v1/metricsSearches` — CRUD for saved metrics searches
