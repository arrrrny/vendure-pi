/**
 * Vendure Pi Extension
 * Connects to the vendure-mcp-graphql MCP server to provide
 * Vendure Admin and Shop API access as pi agent tools.
 *
 * Only registers generic GraphQL execution + schema discovery tools.
 * The agent discovers the API surface dynamically via introspection.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ─── MCP Client ───────────────────────────────────────────

let mcpClient: Client | null = null;

function findMcpServerPath(): string {
  if (process.env.VENDURE_MCP_SERVER_PATH) return process.env.VENDURE_MCP_SERVER_PATH;
  try {
    const which = execSync("which vendure-mcp-graphql 2>/dev/null || echo ''", { encoding: "utf-8" }).trim();
    if (which) return which;
  } catch { /* nop */ }
  if (existsSync("./mcp-graphql/dist/index.js")) return "./mcp-graphql/dist/index.js";
  throw new Error("vendure-mcp-graphql not found. Run: npm install -g vendure-mcp-graphql");
}

async function connectToMcpServer(): Promise<void> {
  if (mcpClient) return;
  const transport = new StdioClientTransport({
    command: process.argv[0] || "node",
    args: [findMcpServerPath()],
    env: {
      ...process.env,
      VENDURE_API_KEY: process.env.VENDURE_API_KEY ?? "",
      ADMIN_API_URL: process.env.ADMIN_API_URL ?? "http://localhost:3000/admin-api",
      SHOP_API_URL: process.env.SHOP_API_URL ?? "http://localhost:3000/shop-api",
    },
  });
  mcpClient = new Client({ name: "vendure-pi", version: "1.0.0" }, { capabilities: {} });
  await mcpClient.connect(transport);
  console.error("[vendure-pi] MCP connected");
}

async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const result = (await mcpClient!.callTool({ name, arguments: args })) as CallToolResult;
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

function text(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// ─── Extension ────────────────────────────────────────────

export default async function vendureExtension(pi: ExtensionAPI): Promise<void> {
  // Strip non-vendure tools on every agent start
  pi.on("agent_start", async () => {
    try { await connectToMcpServer(); } catch { /* nop */ }
    setTimeout(() => {
      const active = pi.getActiveTools().filter((t) => t.startsWith("vendure_"));
      if (active.length) pi.setActiveTools(active);
    }, 50);
  });

  pi.registerTool({
    name: "vendure_admin_query",
    label: "Admin Query",
    description: "Execute any GraphQL query on the Vendure Admin API. Use list operations to discover available queries first.",
    parameters: Query,
    execute: async (_, p) => text(await callMcpTool("admin_query", { query: p.query, variables: p.variables })),
  });

  pi.registerTool({
    name: "vendure_admin_mutation",
    label: "Admin Mutation",
    description: "Execute any GraphQL mutation on the Vendure Admin API. Use list operations to discover available mutations first.",
    parameters: Mutation,
    execute: async (_, p) => text(await callMcpTool("admin_mutation", { mutation: p.mutation, variables: p.variables })),
  });

  pi.registerTool({
    name: "vendure_shop_query",
    label: "Shop Query",
    description: "Execute any GraphQL query on the Vendure Shop API (customer-facing). Use list operations to discover available queries first.",
    parameters: Query,
    execute: async (_, p) => text(await callMcpTool("shop_query", { query: p.query, variables: p.variables })),
  });

  pi.registerTool({
    name: "vendure_shop_mutation",
    label: "Shop Mutation",
    description: "Execute any GraphQL mutation on the Vendure Shop API (customer-facing). Use list operations to discover available mutations first.",
    parameters: Mutation,
    execute: async (_, p) => text(await callMcpTool("shop_mutation", { mutation: p.mutation, variables: p.variables })),
  });

  pi.registerTool({
    name: "vendure_list_admin_operations",
    label: "List Admin Operations",
    description: "Discover all available GraphQL queries and mutations on the Admin API with descriptions.",
    parameters: Empty,
    execute: async () => text(await callMcpTool("list_admin_operations", {})),
  });

  pi.registerTool({
    name: "vendure_get_admin_schema",
    label: "Get Admin Schema",
    description: "Full Admin API GraphQL introspection. Use when you need detailed type information. Prefer list operations for quick discovery.",
    parameters: Empty,
    execute: async () => text(await callMcpTool("get_admin_schema", {})),
  });

  pi.registerTool({
    name: "vendure_list_shop_operations",
    label: "List Shop Operations",
    description: "Discover all available GraphQL queries and mutations on the Shop API with descriptions.",
    parameters: Empty,
    execute: async () => text(await callMcpTool("list_shop_operations", {})),
  });

  pi.registerTool({
    name: "vendure_get_shop_schema",
    label: "Get Shop Schema",
    description: "Full Shop API GraphQL introspection. Prefer list operations for quick discovery.",
    parameters: Empty,
    execute: async () => text(await callMcpTool("get_shop_schema", {})),
  });

  // ─── Custom Tools from JSON ──────────────────────────

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

function loadCustomTools(pi: ExtensionAPI): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const paths = [
    join(__dirname, "..", "tools", "default-tools.json"),
    ".pi/vendure-custom-tools.json",
    `${process.env.HOME ?? "~"}/.pi/vendure-custom-tools.json`,
  ];

  for (const path of paths) {
    if (!existsSync(path)) continue;

    try {
      const raw = readFileSync(path, "utf-8");
      const config: VendureToolsConfig = JSON.parse(raw);

      for (const tool of config.tools ?? []) {
        const mcpTool = tool.adminQuery ? "admin_query" :
                        tool.shopQuery ? "shop_query" :
                        tool.adminMutation ? "admin_mutation" :
                        tool.shopMutation ? "shop_mutation" : null;
        if (!mcpTool) continue;

        const gql = tool.adminQuery ?? tool.shopQuery ?? tool.adminMutation ?? tool.shopMutation ?? "";

        pi.registerTool({
          name: `vendure_${tool.name}`,
          label: tool.label,
          description: tool.description,
          parameters: Empty,
          execute: async () => {
            const result = await callMcpTool(mcpTool, { query: gql });
            return text(result);
          },
        });
      }

      console.error(`[vendure-pi] Loaded ${config.tools?.length ?? 0} custom tools from ${path}`);
    } catch (err) {
      console.error(`[vendure-pi] Failed to load custom tools from ${path}:`, err);
    }
  }
}
