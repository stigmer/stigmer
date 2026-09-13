/**
 * Pins `kindByEnumName` (pipeline/apiresource-meta.ts), the lookup for the
 * SECOND kind vocabulary the contract carries. A resource's own `kind`
 * field is the `kind_meta.name` ("McpServer"; `getKindEnum`, the #545
 * lesson). An `ApiResourceRef.kind` — the IamPolicy spec's principal and
 * resource, the FGA object type — is the enum MEMBER name ("mcp_server"),
 * which is what every SDK call site sends and what the cloud's
 * `kindFromSpecString` resolved before this entry (20260913.01, Q-OR-2).
 *
 * Two properties are load-bearing and pinned here rather than assumed:
 *
 *   - EXACT match, never canonicalised. The IamPolicy id is derived from
 *     the spec's text (Q-OR-9), so a lenient matcher that admitted
 *     "Organization" beside "organization" would mint two rows for one
 *     grant, or force the domain to rewrite caller input before storing
 *     it. The two spellings `getKindEnum` accepts are refused here on
 *     purpose; the contrast arm keeps the two lookups from being merged.
 *   - NEVER a throw. The Authorize step resolves `resource_kind_path`
 *     through this function at position 1 of every chain, and resolution
 *     never throws by doctrine (authorize.ts header): an unknown name is
 *     the unknown kind, and the Authorizer owns the decision.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { getKindEnum, kindByEnumName } from "../apiresource-meta.js";

describe("kindByEnumName — an ApiResourceRef.kind is the enum member name", () => {
  it.each([
    ["organization", ApiResourceKind.organization],
    ["identity_account", ApiResourceKind.identity_account],
    ["mcp_server", ApiResourceKind.mcp_server],
    ["agent", ApiResourceKind.agent],
    ["iam_policy", ApiResourceKind.iam_policy],
  ])("%s resolves to its kind", (name, kind) => {
    expect(kindByEnumName(name)).toBe(kind);
  });

  it.each([
    ["Organization", "the kind_meta spelling, not a member name"],
    ["McpServer", "the kind_meta spelling, not a member name"],
    ["ORGANIZATION", "case differs"],
    ["organization ", "trailing whitespace"],
    ["", "empty"],
    ["spaceship", "not a kind"],
    ["5", "a number spelled as text is not a name"],
    ["constructor", "a prototype key is not a name"],
  ])("%s is the unknown kind (%s) — never a throw", (value) => {
    expect(kindByEnumName(value)).toBe(
      ApiResourceKind.api_resource_kind_unknown,
    );
  });

  it("the zero value's own name is the unknown kind too", () => {
    expect(kindByEnumName("api_resource_kind_unknown")).toBe(
      ApiResourceKind.api_resource_kind_unknown,
    );
  });

  it("is exact where getKindEnum is lenient — the two vocabularies stay two lookups", () => {
    // A resource's `kind` field: canonical kind_meta.name matching,
    // case-insensitive, underscores ignored, and a throw on unknown.
    expect(getKindEnum("McpServer")).toBe(ApiResourceKind.mcp_server);
    expect(getKindEnum("mcp_server")).toBe(ApiResourceKind.mcp_server);
    expect(() => getKindEnum("spaceship")).toThrow();
    // An ApiResourceRef.kind: the member name and nothing else.
    expect(kindByEnumName("McpServer")).toBe(
      ApiResourceKind.api_resource_kind_unknown,
    );
    expect(kindByEnumName("mcp_server")).toBe(ApiResourceKind.mcp_server);
  });

  it("every member of the enum round-trips through its own name", () => {
    for (const [name, value] of Object.entries(ApiResourceKind)) {
      if (typeof value !== "number") continue;
      expect(kindByEnumName(name), name).toBe(value);
    }
  });
});
