/**
 * Vendure Pi Extension
 * Connects to the vendure-mcp-graphql MCP server to provide
 * Vendure Admin and Shop API access as pi agent tools.
 *
 * Registers generic GraphQL execution + schema discovery tools.
 * The agent discovers the API surface dynamically via introspection.
 * Custom tools can be added via JSON config files.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";

// ─── MCP Client ───────────────────────────────────────────

type ConnectionState = "disconnected" | "connecting" | "connected";

let mcpClient: Client | null = null;
let connectionState: ConnectionState = "disconnected";
let connectionPromise: Promise<void> | null = null;

function findMcpServerPath(): string {
  if (process.env.VENDURE_MCP_SERVER_PATH)
    return process.env.VENDURE_MCP_SERVER_PATH;
  try {
    const which = execSync("which vendure-mcp-graphql 2>/dev/null || echo ''", {
      encoding: "utf-8",
    }).trim();
    if (which) return which;
  } catch {
    /* not on PATH */
  }
  if (existsSync("./mcp-graphql/dist/index.js"))
    return "./mcp-graphql/dist/index.js";
  throw new Error(
    "vendure-mcp-graphql not found. Install with: npm install -g vendure-mcp-graphql",
  );
}

async function ensureConnected(): Promise<void> {
  if (connectionState === "connected" && mcpClient) return;

  if (connectionState === "connecting" && connectionPromise) {
    await connectionPromise;
    return;
  }

  connectionState = "connecting";
  connectionPromise = connectToMcpServer();
  try {
    await connectionPromise;
    connectionState = "connected";
  } catch (err) {
    connectionState = "disconnected";
    mcpClient = null;
    connectionPromise = null;
    throw err;
  }
}

async function connectToMcpServer(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.argv[0] || "node",
    args: [findMcpServerPath()],
    env: {
      ...process.env,
      VENDURE_API_KEY: process.env.VENDURE_API_KEY ?? "",
      ADMIN_API_URL:
        process.env.ADMIN_API_URL ?? "http://localhost:3000/admin-api",
      SHOP_API_URL:
        process.env.SHOP_API_URL ?? "http://localhost:3000/shop-api",
    },
  });
  const client = new Client(
    { name: "vendure-pi", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  mcpClient = client;
  console.error("[vendure-pi] MCP connected");
}

async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!mcpClient) await ensureConnected();
  if (!mcpClient) throw new Error("[vendure-pi] MCP client not connected");

  const result = (await mcpClient.callTool({
    name,
    arguments: args,
  })) as CallToolResult;
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.map((c) => c.text ?? "").join("\n");
  return result.isError ? `Error: ${text}` : text;
}

// ─── Param Schemas ────────────────────────────────────────

const Empty = Type.Object({});
const Query = Type.Object({
  query: Type.String(),
  variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
const Mutation = Type.Object({
  mutation: Type.String(),
  variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

function makeResult(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: {} };
}

// ─── Extension ────────────────────────────────────────────

export default async function vendureExtension(
  pi: ExtensionAPI,
): Promise<void> {
  pi.on("agent_start", async () => {
    try {
      await ensureConnected();
    } catch (err) {
      console.error(
        "[vendure-pi] MCP connection failed:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  pi.registerTool({
    name: "vendure_admin_query",
    label: "Admin Query",
    description:
      "Execute a GraphQL query on the Vendure Admin API. Use vendure_list_admin_operations to discover available queries first.",
    parameters: Query,
    execute: async (_, p) => {
      await ensureConnected();
      return makeResult(
        await callMcpTool("admin_query", {
          query: p.query,
          variables: p.variables,
        }),
      );
    },
  });

  pi.registerTool({
    name: "vendure_admin_mutation",
    label: "Admin Mutation",
    description:
      "Execute a GraphQL mutation on the Vendure Admin API. Use vendure_list_admin_operations to discover available mutations first.",
    parameters: Mutation,
    execute: async (_, p) => {
      await ensureConnected();
      return makeResult(
        await callMcpTool("admin_mutation", {
          mutation: p.mutation,
          variables: p.variables,
        }),
      );
    },
  });

  pi.registerTool({
    name: "vendure_shop_query",
    label: "Shop Query",
    description:
      "Execute a GraphQL query on the Vendure Shop API (customer-facing). Use vendure_list_shop_operations to discover available queries first.",
    parameters: Query,
    execute: async (_, p) => {
      await ensureConnected();
      return makeResult(
        await callMcpTool("shop_query", {
          query: p.query,
          variables: p.variables,
        }),
      );
    },
  });

  pi.registerTool({
    name: "vendure_shop_mutation",
    label: "Shop Mutation",
    description:
      "Execute a GraphQL mutation on the Vendure Shop API (customer-facing). Use vendure_list_shop_operations to discover available mutations first.",
    parameters: Mutation,
    execute: async (_, p) => {
      await ensureConnected();
      return makeResult(
        await callMcpTool("shop_mutation", {
          mutation: p.mutation,
          variables: p.variables,
        }),
      );
    },
  });

  pi.registerTool({
    name: "vendure_list_admin_operations",
    label: "List Admin Operations",
    description:
      "Discover all available GraphQL queries and mutations on the Admin API with descriptions.",
    parameters: Empty,
    execute: async () => {
      await ensureConnected();
      return makeResult(await callMcpTool("list_admin_operations", {}));
    },
  });

  pi.registerTool({
    name: "vendure_get_admin_schema",
    label: "Get Admin Schema",
    description:
      "Full Admin API GraphQL introspection. Use when you need detailed type information. Prefer vendure_list_admin_operations for quick discovery.",
    parameters: Empty,
    execute: async () => {
      await ensureConnected();
      return makeResult(await callMcpTool("get_admin_schema", {}));
    },
  });

  pi.registerTool({
    name: "vendure_list_shop_operations",
    label: "List Shop Operations",
    description:
      "Discover all available GraphQL queries and mutations on the Shop API with descriptions.",
    parameters: Empty,
    execute: async () => {
      await ensureConnected();
      return makeResult(await callMcpTool("list_shop_operations", {}));
    },
  });

  pi.registerTool({
    name: "vendure_get_shop_schema",
    label: "Get Shop Schema",
    description:
      "Full Shop API GraphQL introspection. Prefer vendure_list_shop_operations for quick discovery.",
    parameters: Empty,
    execute: async () => {
      await ensureConnected();
      return makeResult(await callMcpTool("get_shop_schema", {}));
    },
  });

  loadCustomTools(pi);
}

// ─── Custom Tool Discovery ────────────────────────────────

interface CustomToolConfig {
  name: string;
  label: string;
  description: string;
  adminQuery?: string;
  shopQuery?: string;
  adminMutation?: string;
  shopMutation?: string;
}

interface VendureToolsConfig {
  tools: CustomToolConfig[];
}

function resolveToolType(
  tool: CustomToolConfig,
): { mcpTool: string; argKey: string; gql: string } | null {
  if (tool.adminQuery)
    return { mcpTool: "admin_query", argKey: "query", gql: tool.adminQuery };
  if (tool.shopQuery)
    return { mcpTool: "shop_query", argKey: "query", gql: tool.shopQuery };
  if (tool.adminMutation)
    return {
      mcpTool: "admin_mutation",
      argKey: "mutation",
      gql: tool.adminMutation,
    };
  if (tool.shopMutation)
    return {
      mcpTool: "shop_mutation",
      argKey: "mutation",
      gql: tool.shopMutation,
    };
  return null;
}

function loadCustomTools(pi: ExtensionAPI): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const paths = [
    join(__dirname, "..", "tools", "default-tools.json"),
    join(homedir(), ".pi", "vendure-custom-tools.json"),
    ".pi/vendure-custom-tools.json",
  ];

  for (const path of paths) {
    if (!existsSync(path)) continue;

    try {
      const raw = readFileSync(path, "utf-8");
      const config: VendureToolsConfig = JSON.parse(raw);
      let loaded = 0;

      for (const tool of config.tools ?? []) {
        const resolved = resolveToolType(tool);
        if (!resolved) continue;

        const { mcpTool, argKey, gql } = resolved;

        pi.registerTool({
          name: `vendure_${tool.name}`,
          label: tool.label,
          description: tool.description,
          parameters: Empty,
          execute: async () => {
            await ensureConnected();
            return makeResult(await callMcpTool(mcpTool, { [argKey]: gql }));
          },
        });
        loaded++;
      }

      console.error(`[vendure-pi] Loaded ${loaded} custom tools from ${path}`);
    } catch (err) {
      console.error(
        `[vendure-pi] Failed to load custom tools from ${path}:`,
        err,
      );
    }
  }
}
