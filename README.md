# vendure-pi

[![npm version](https://img.shields.io/npm/v/vendure-pi.svg)](https://www.npmjs.com/package/vendure-pi) [![npm downloads](https://img.shields.io/npm/dm/vendure-pi.svg)](https://www.npmjs.com/package/vendure-pi)

Pi agent extension for [Vendure](https://vendure.io) e-commerce management. Connect to your Vendure instance and manage products, orders, customers, and more through natural language.

Requires [vendure-mcp-graphql](https://npmjs.com/package/vendure-mcp-graphql).

## Installation

```bash
npm install -g vendure-mcp-graphql pi

# Then install this extension in your project:
cd /path/to/your/vendure-project
pi install /path/to/vendure-pi -l
```

## Environment

```bash
export VENDURE_API_KEY="your-api-key"
export ADMIN_API_URL="http://localhost:3000/admin-api"   # optional
export SHOP_API_URL="http://localhost:3000/shop-api"     # optional
```

## Usage

```bash
pi --provider quotio --model gemini-3.1-flash-lite
```

Then type commands like:

```
list 5 channel listings
show order summaries
how many products do we have?
list admin users
create a new product called "Test Product"
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| `vendure_admin_query` | Execute any GraphQL query on Admin API |
| `vendure_admin_mutation` | Execute any GraphQL mutation on Admin API |
| `vendure_shop_query` | Execute any GraphQL query on Shop API |
| `vendure_shop_mutation` | Execute any GraphQL mutation on Shop API |
| `vendure_list_admin_operations` | Discover all Admin API queries and mutations |
| `vendure_get_admin_schema` | Full Admin API introspection |
| `vendure_list_shop_operations` | Discover all Shop API queries and mutations |
| `vendure_get_shop_schema` | Full Shop API introspection |

## Custom Tools

Define your own tools by mapping GraphQL queries/mutations to named commands. Tools are loaded from three locations (globals override earlier ones):

1. **`tools/default-tools.json`** — shipped with the package (updates with new versions)
2. **`~/.pi/vendure-custom-tools.json`** — global user tools (shared across projects)
3. **`.pi/vendure-custom-tools.json`** — project tools (shared with your team via git)

### Format

```json
{
  "tools": [
    {
      "name": "last_orders",
      "label": "Last Orders",
      "description": "List the 5 most recent orders",
      "adminQuery": "query { orders(options: { take: 5 sort: { createdAt: DESC } }) { items { id code state total currencyCode customer { firstName lastName } } } }"
    },
    {
      "name": "mark_shipped",
      "label": "Mark Order Shipped",
      "description": "Transition an order to Shipped state",
      "adminMutation": "mutation($id: ID!) { transitionOrderToState(id: $id, state: \"Shipped\") { id state } }"
    }
  ]
}
```

Each tool has:

| Field | Description |
|-------|-------------|
| `name` | Unique tool name (prefix `vendure_` is added automatically) |
| `label` | Display name shown to the agent |
| `description` | What the tool does |
| `adminQuery` | GraphQL query for Admin API read operations |
| `shopQuery` | GraphQL query for Shop API read operations |
| `adminMutation` | GraphQL mutation for Admin API write operations |
| `shopMutation` | GraphQL mutation for Shop API write operations |

Use exactly one of the four API fields per tool.

### Example: Project Tools

Create `.pi/vendure-custom-tools.json` in your Vendure project:

```json
{
  "tools": [
    {
      "name": "daily_revenue",
      "label": "Daily Revenue",
      "description": "Total revenue from orders placed today",
      "adminQuery": "query { orders(options: { filter: { orderPlacedAt: { after: \"2026-01-01T00:00:00Z\" } } }) { items { total totalWithTax currencyCode } } }"
    }
  ]
}
```

New tools appear automatically on next `pi` run — no restart needed.

## License

MIT
