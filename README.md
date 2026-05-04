# vendure-mcp-graphql

MCP (Model Context Protocol) server for interacting with Vendure GraphQL APIs (Admin & Shop).

## Installation

```bash
npm install -g vendure-mcp-graphql
```

## Usage

Configure as an MCP server in your IDE (like Claude Desktop):

```json
{
  "mcpServers": {
    "vendure-mcp-graphql": {
      "command": "vendure-mcp-graphql",
      "args": [],
      "env": {
        "VENDURE_API_KEY": "your-api-key",
        "ADMIN_API_URL": "http://localhost:3000/admin-api",
        "SHOP_API_URL": "http://localhost:3000/shop-api"
      }
    }
  }
}
```

Or with a combined URL and auth:

```json
{
  "mcpServers": {
    "vendure-mcp-graphql": {
      "command": "vendure-mcp-graphql",
      "args": [],
      "env": {
        "VENDURE_URL": "http://localhost:3000/admin-api",
        "VENDURE_AUTH_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Features

- **Admin API access**: Full GraphQL queries and mutations for store management
- **Shop API access**: Customer-facing operations
- **Schema introspection**: Discover available types and operations
- **Operation discovery**: List all queries and mutations with descriptions

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VENDURE_API_KEY` | — | API key for authentication (sent as `vendure-api-key` header) |
| `ADMIN_API_URL` | `http://localhost:3000/admin-api` | Admin GraphQL endpoint |
| `SHOP_API_URL` | `http://localhost:3000/shop-api` | Shop GraphQL endpoint |

## License

MIT
