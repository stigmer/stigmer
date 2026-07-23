// MCP tools for the Datastore *definition* domain — the structure surface
// (collections, fields, constraints, roles, grants). The record tools
// (records/tools.ts) operate on the living data inside these structures;
// before this domain existed, an assistant could insert records into a
// datastore it had no way to create.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { DatastoreInputShape } from "../../gen/datastore.js";
import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { applyDatastore } from "./apply.js";
import { deleteDatastore } from "./delete.js";
import { fetchDatastore } from "./fetch.js";

/** Register every Datastore-domain tool; returns the registered tool names. */
export function registerDatastoreTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_datastore",
    {
      description:
        "Get the full definition of a Stigmer datastore by its org and slug: collections, field " +
        "declarations, constraints, roles, and grants. For the record-facing view of the same " +
        "structure (allowed verbs, readable fields), use describe_datastore; for the data " +
        "itself, use the record tools.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the datastore (e.g. stigmer)."),
        slug: z
          .string()
          .describe("Datastore slug — the unique identifier within the org (e.g. clinic-bookings)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        fetchDatastore(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  server.registerTool(
    "apply_datastore",
    {
      description:
        "Create or update a Stigmer datastore definition (idempotent). The manifest is " +
        "authoritative for structure only — schema changes sync on apply (the server enforces " +
        "its additive-plus change rules), and records are never touched; use the record tools " +
        "to manage data.",
      inputSchema: DatastoreInputShape,
    },
    (args, extra) =>
      textOrError(() =>
        applyDatastore(target.serverAddress, resolveToken(extra, target.apiKey), args),
      ),
  );

  server.registerTool(
    "delete_datastore",
    {
      description:
        "Delete a Stigmer datastore by its org and slug, destroying its collections and all " +
        "records in them. This is irreversible. Returns the deleted datastore definition.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the datastore (e.g. stigmer)."),
        slug: z
          .string()
          .describe("Datastore slug — the unique identifier within the org (e.g. clinic-bookings)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        deleteDatastore(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  return ["get_datastore", "apply_datastore", "delete_datastore"];
}
