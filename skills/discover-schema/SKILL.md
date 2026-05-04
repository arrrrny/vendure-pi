---
description: Discover Vendure GraphQL schema before running operations
---
# Discover Schema

Before running any Vendure GraphQL operations, discover what's available.

## Steps

1. Call `vendure_list_admin_operations` to see all queries and mutations on the Admin API
2. If working with shop data, call `vendure_list_shop_operations` for the Shop API
3. If you need detailed type information (field names, input types, return shapes), call `vendure_get_admin_schema` or `vendure_get_shop_schema`

## Why

- Vendure installations vary — plugins add custom queries and mutations
- The schema tells you exactly what fields are available
- Prevents errors from using wrong field names or missing required inputs
- Schema introspection is the only way to know what custom entities and fields exist

## Pattern

```
1. Discover → 2. Understand input shape → 3. Execute → 4. Interpret results
```
