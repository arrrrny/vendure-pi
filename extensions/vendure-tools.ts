/**
 * Vendure Pi Extension
 * Connects to the raptorr-graphql-mcp MCP server to provide
 * Vendure Admin and Shop API access as pi agent tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type } from "typebox";
import { existsSync } from "fs";
import { execSync } from "child_process";

let mcpClient: Client | null = null;
let mcpTools: Map<string, any> = new Map();

function findMcpServerPath(): string {
  if (process.env.VENDURE_MCP_SERVER_PATH) return process.env.VENDURE_MCP_SERVER_PATH;

  try {
    const which = execSync("which vendure-mcp-graphql 2>/dev/null || echo ''", { encoding: "utf-8" }).trim();
    if (which) return which;
  } catch {}

  if (existsSync("./mcp-graphql/dist/index.js")) return "./mcp-graphql/dist/index.js";

  throw new Error(
    "vendure-mcp-graphql not found.\n" +
    "Install: npm install -g vendure-mcp-graphql\n" +
    "Or: export VENDURE_MCP_SERVER_PATH=/path/to/vendure-mcp-graphql",
  );
}

async function connectToMcpServer() {
  if (mcpClient) return;

  const node = process.argv[0] || "node";
  const serverPath = findMcpServerPath();

  console.error(`[vendure-pi] Starting MCP server: ${serverPath}`);

  try {
    const transport = new StdioClientTransport({
      command: node,
      args: [serverPath],
      env: {
        ...process.env,
        VENDURE_API_KEY: process.env.VENDURE_API_KEY || "",
        ADMIN_API_URL: process.env.ADMIN_API_URL || "http://localhost:3000/admin-api",
        SHOP_API_URL: process.env.SHOP_API_URL || "http://localhost:3000/shop-api",
      },
    });

    const client = new Client(
      { name: "vendure-pi", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    const tools = await client.listTools();
    for (const tool of tools.tools) {
      mcpTools.set(tool.name, tool);
    }

    mcpClient = client;
    console.log(`[vendure-pi] Connected to MCP server, ${mcpTools.size} tools available`);
  } catch (err) {
    console.error(`[vendure-pi] Failed to connect to MCP server at ${serverPath}:`, err);
    throw err;
  }
}

async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!mcpClient) {
    await connectToMcpServer();
    if (!mcpClient) {
      return "Error: Vendure MCP server not connected. Set VENDURE_API_KEY and VENDURE_MCP_SERVER_PATH.";
    }
  }

  const result = await mcpClient.callTool({ name, arguments: args });
  if (result.isError) {
    return `Error: ${result.content.map((c: any) => c.text).join("\n")}`;
  }
  return result.content.map((c: any) => c.text).join("\n");
}

export default async function (pi: any) {
  // On agent start: strip ALL default tools and keep only vendure ones
  pi.on("agent_start", async () => {
    try {
      await connectToMcpServer();
    } catch {
      // Extension will still load, tools will show connection errors on use
    }

    // Wait a tick for all tools to register, then strip non-vendure ones
    setTimeout(() => {
      const state = pi.agent?.state;
      if (!state?.tools) return;

      const allTools = state.tools;
      const vendureTools = allTools.filter((t: any) =>
        t.name?.startsWith("vendure_"),
      );

      if (vendureTools.length > 0) {
        pi.agent.state.tools = vendureTools;
        console.error(
          `[vendure-pi] Stripped ${allTools.length - vendureTools.length} default tools, kept ${vendureTools.length} vendure tools`,
        );
      }
    }, 100);
  });

  // ─── Admin Discovery Tools ─────────────────────────────

  pi.registerTool({
    name: "vendure_list_admin_operations",
    label: "List Admin Operations",
    description:
      "List all available GraphQL queries and mutations on the Vendure Admin API with descriptions. Use this to discover what operations are available before using admin_query or admin_mutation.",
    parameters: Type.Object({}),
    execute: async (_toolCallId: string, _params: any) => {
      const text = await callMcpTool("list_admin_operations", {});
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_get_admin_schema",
    label: "Get Admin Schema",
    description:
      "Fetch the full GraphQL Admin API schema introspection. Use this to understand types, fields, and input requirements. Warning: very large output, prefer vendure_list_admin_operations for overview.",
    parameters: Type.Object({}),
    execute: async (_toolCallId: string, _params: any) => {
      const text = await callMcpTool("get_admin_schema", {});
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_list_shop_operations",
    label: "List Shop Operations",
    description:
      "List all available GraphQL queries and mutations on the Vendure Shop API with descriptions. The Shop API is for customer-facing operations like browsing products, placing orders, managing account.",
    parameters: Type.Object({}),
    execute: async (_toolCallId: string, _params: any) => {
      const text = await callMcpTool("list_shop_operations", {});
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_get_shop_schema",
    label: "Get Shop Schema",
    description:
      "Fetch the full GraphQL Shop API schema introspection. Prefer vendure_list_shop_operations for quicker discovery.",
    parameters: Type.Object({}),
    execute: async (_toolCallId: string, _params: any) => {
      const text = await callMcpTool("get_shop_schema", {});
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ─── Admin Data Operations ──────────────────────────────

  pi.registerTool({
    name: "vendure_admin_query",
    label: "Admin Query",
    description:
      "Execute a GraphQL query on the Vendure Admin API. Use this to read data: list products, view orders, check customers, inspect channels, query custom entities. Use vendure_list_admin_operations first to see available queries.",
    parameters: Type.Object({
      query: Type.String({ description: "The GraphQL query string to execute on the Admin API" }),
      variables: Type.Optional(Type.Object({}, { description: "Optional GraphQL variables as key-value pairs" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const text = await callMcpTool("admin_query", {
        query: params.query,
        variables: params.variables,
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_admin_mutation",
    label: "Admin Mutation",
    description:
      "Execute a GraphQL mutation on the Vendure Admin API. Use this to modify data: create products, update orders, add customers, configure settings. Use vendure_list_admin_operations first to see available mutations.",
    parameters: Type.Object({
      mutation: Type.String({ description: "The GraphQL mutation string to execute on the Admin API" }),
      variables: Type.Optional(Type.Object({}, { description: "Optional GraphQL variables as key-value pairs" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const text = await callMcpTool("admin_mutation", {
        mutation: params.mutation,
        variables: params.variables,
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ─── Shop Data Operations ───────────────────────────────

  pi.registerTool({
    name: "vendure_shop_query",
    label: "Shop Query",
    description:
      "Execute a GraphQL query on the Vendure Shop API. Use this for customer-facing data: browse product catalog, search products, view active order, check customer profile. Use vendure_list_shop_operations first to see available queries.",
    parameters: Type.Object({
      query: Type.String({ description: "The GraphQL query string to execute on the Shop API" }),
      variables: Type.Optional(Type.Object({}, { description: "Optional GraphQL variables as key-value pairs" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const text = await callMcpTool("shop_query", {
        query: params.query,
        variables: params.variables,
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_shop_mutation",
    label: "Shop Mutation",
    description:
      "Execute a GraphQL mutation on the Vendure Shop API. Use this for customer actions: add items to order, apply coupon, set shipping address, create customer account. Use vendure_list_shop_operations first to see available mutations.",
    parameters: Type.Object({
      mutation: Type.String({ description: "The GraphQL mutation string to execute on the Shop API" }),
      variables: Type.Optional(Type.Object({}, { description: "Optional GraphQL variables as key-value pairs" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const text = await callMcpTool("shop_mutation", {
        mutation: params.mutation,
        variables: params.variables,
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  // ─── Helpers ────────────────────────────────────────────

  pi.registerTool({
    name: "vendure_get_product",
    label: "Get Product by ID",
    description:
      "Fetch a single product from the Vendure Admin API by its ID. Returns product details including name, description, variants, assets, and custom fields.",
    parameters: Type.Object({
      productId: Type.String({ description: "The product ID (e.g. '1' or UUID)" }),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const text = await callMcpTool("admin_query", {
        query: `
          query GetProduct($id: ID!) {
            product(id: $id) {
              id name slug description
              enabled
              featuredAsset { id name preview source }
              assets { id name preview source }
              facetValues { id name facet { id name } }
              optionGroups { id name code options { id name code } }
              variants {
                id name sku price priceWithTax stockLevel currencyCode
                featuredAsset { preview }
                options { id name code groupId }
              }
              customFields
            }
          }
        `,
        variables: { id: params.productId },
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_list_products",
    label: "List Products",
    description:
      "List products from Vendure with pagination and optional search filter. Returns product ID, name, slug, description, enabled status, and featured asset.",
    parameters: Type.Object({
      take: Type.Optional(Type.Number({ default: 10, description: "Number of products to return (default: 10, max: 100)" })),
      skip: Type.Optional(Type.Number({ default: 0, description: "Number of products to skip for pagination" })),
      search: Type.Optional(Type.String({ description: "Optional search term to filter products by name or description" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const text = await callMcpTool("admin_query", {
        query: `
          query ListProducts($options: ProductListOptions) {
            products(options: $options) {
              totalItems
              items {
                id name slug description enabled
                featuredAsset { id name preview source }
                variants { id name sku price priceWithTax stockLevel currencyCode }
              }
            }
          }
        `,
        variables: {
          options: {
            take: params.take || 10,
            skip: params.skip || 0,
            ...(params.search ? { filter: { name: { contains: params.search } } } : {}),
          },
        },
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_list_orders",
    label: "List Orders",
    description:
      "List orders from Vendure with optional state filter. Returns order ID, code, state, total, customer info, and timestamps.",
    parameters: Type.Object({
      take: Type.Optional(Type.Number({ default: 10, description: "Number of orders to return (default: 10)" })),
      skip: Type.Optional(Type.Number({ default: 0, description: "Number of orders to skip" })),
      state: Type.Optional(Type.String({ description: "Optional order state filter (e.g. 'PaymentAuthorized', 'Shipped')" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const filter: Record<string, any> = {};
      if (params.state) {
        filter.state = { eq: params.state };
      }
      const text = await callMcpTool("admin_query", {
        query: `
          query ListOrders($options: OrderListOptions) {
            orders(options: $options) {
              totalItems
              items {
                id code state total totalWithTax currencyCode
                customer { id firstName lastName emailAddress }
                orderPlacedAt createdAt updatedAt
              }
            }
          }
        `,
        variables: {
          options: {
            take: params.take || 10,
            skip: params.skip || 0,
            ...(Object.keys(filter).length ? { filter } : {}),
          },
        },
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_list_customers",
    label: "List Customers",
    description:
      "List customers from Vendure. Returns customer ID, name, email, and creation date.",
    parameters: Type.Object({
      take: Type.Optional(Type.Number({ default: 10, description: "Number of customers (default: 10)" })),
      skip: Type.Optional(Type.Number({ default: 0, description: "Number to skip" })),
      search: Type.Optional(Type.String({ description: "Search by name or email" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const text = await callMcpTool("admin_query", {
        query: `
          query ListCustomers($options: CustomerListOptions) {
            customers(options: $options) {
              totalItems
              items {
                id firstName lastName emailAddress phoneNumber
                createdAt updatedAt
              }
            }
          }
        `,
        variables: {
          options: {
            take: params.take || 10,
            skip: params.skip || 0,
            ...(params.search ? { filter: { emailAddress: { contains: params.search } } } : {}),
          },
        },
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_get_channel_listings",
    label: "Get Channel Listings",
    description:
      "List all configured channel listings (if available via the channel-listing plugin). Shows which products are listed on which external channels.",
    parameters: Type.Object({
      take: Type.Optional(Type.Number({ default: 10, description: "Number of listings" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const text = await callMcpTool("admin_query", {
        query: `
          query ListChannelListings($options: ChannelListingListOptions) {
            channelListings(options: $options) {
              totalItems
              items { id title channel websiteId url domain category }
            }
          }
        `,
        variables: {
          options: { take: params.take || 10 },
        },
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "vendure_get_mcp_servers",
    label: "Get MCP Servers",
    description:
      "List all registered MCP servers and their status (if the MCP Discovery plugin is active). Shows server name, transport type, connection status, and available tools.",
    parameters: Type.Object({}),
    execute: async (_toolCallId: string, _params: any) => {
      const text = await callMcpTool("admin_query", {
        query: `
          query {
            mcpServers {
              id name description transportType status
              lastConnectedAt lastError
              toolCount
              tools { id name description }
            }
          }
        `,
      });
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
