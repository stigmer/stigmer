// `list` dispatch: render a collection of resources for a kind.
//
// Most registry kinds are search-indexed and list through the unified
// SearchService (matching the Go CLI's search-backed list). Organizations and
// API keys are not search-indexed and use their dedicated find RPCs.

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import type { OutputFormat } from "../output/index.js";
import { bool, type JsonObject, obj, renderCollection, str, type TableShape } from "./render.js";

// Kinds the SearchService indexes; mirrors the Go CLI's search-backed list set.
const SEARCH_KINDS = new Set<ApiResourceKind>([
  ApiResourceKind.agent,
  ApiResourceKind.workflow,
  ApiResourceKind.mcp_server,
  ApiResourceKind.project,
  ApiResourceKind.skill,
]);

export async function listResources(
  client: Stigmer,
  kind: ApiResourceKind,
  org: string,
  limit: number,
  format: OutputFormat,
): Promise<string> {
  if (kind === ApiResourceKind.organization) {
    const result = await client.organization.findMyOrganizations();
    return renderCollection(OrganizationSchema, result.entries, format, ORG_TABLE);
  }
  if (kind === ApiResourceKind.api_key) {
    const result = await client.apiKey.findAll();
    return renderCollection(ApiKeySchema, result.entries, format, APIKEY_TABLE);
  }
  if (!SEARCH_KINDS.has(kind)) {
    throw new UsageError("list is not implemented for this resource type");
  }
  const result = await client.search.query({ kinds: [kind], org, page: { num: 1, size: limit } });
  return renderCollection(SearchResultSchema, result.entries, format, SEARCH_TABLE);
}

const SEARCH_TABLE: TableShape = {
  resourceName: "resources",
  headers: ["NAME", "DESCRIPTION", "VISIBILITY", "CREATED"],
  row: (json) => [
    str(json, "qualified_slug"),
    truncate(str(json, "description"), 50),
    str(json, "visibility"),
    date(str(json, "created_at")),
  ],
};

const ORG_TABLE: TableShape = {
  resourceName: "organizations",
  headers: ["NAME", "SLUG", "ID"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    return [str(metadata, "name"), str(metadata, "slug"), str(metadata, "id")];
  },
};

const APIKEY_TABLE: TableShape = {
  resourceName: "API keys",
  headers: ["ID", "NAME", "FINGERPRINT", "EXPIRES"],
  row: (json) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    const fingerprint = str(spec, "fingerprint");
    return [
      str(metadata, "id"),
      str(metadata, "name") || "-",
      fingerprint === "" ? "" : `***${fingerprint}`,
      apiKeyExpiry(spec),
    ];
  },
};

function apiKeyExpiry(spec: JsonObject): string {
  if (bool(spec, "never_expires")) return "Never";
  const expiresAt = str(spec, "expires_at");
  return expiresAt === "" ? "Never" : date(expiresAt);
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function date(timestamp: string): string {
  return timestamp === "" ? "-" : timestamp.slice(0, 10);
}
