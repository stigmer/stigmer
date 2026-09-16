/**
 * Pins `kindByIdPrefix` (pipeline/apiresource-meta.ts), the inverse of
 * `getIdPrefix` over the ids the server mints (`<prefix>_<ulid>`,
 * pipeline/steps/defaults.ts). The runner-credential lane reads it to
 * learn which execution kind a token's binding names — an agent
 * execution (`aex_`) or a workflow execution (`wex_`) — without a second
 * claim on the token or a guess.
 *
 * Two properties are load-bearing:
 *
 *   - NEVER a throw. The id arrives inside a credential; the caller
 *     refuses with its own sentence, so anything that is not a known
 *     prefix followed by an underscore is the unknown kind.
 *   - Every `id_prefix` in the contract is UNIQUE. The lookup is a Map
 *     over the `kind_meta` table; a duplicate prefix would silently win
 *     for one kind and lose for the other. The pin below turns a future
 *     duplicate into a reviewed change.
 */
import { describe, expect, it } from "vitest";

import {
  ApiResourceKind,
  ApiResourceKindSchema,
  kind_meta,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { getOption, hasOption } from "@bufbuild/protobuf";

import { getIdPrefix, kindByIdPrefix } from "../apiresource-meta.js";

describe("kindByIdPrefix — a minted id names its kind by prefix", () => {
  it.each([
    ["aex_01m2mp45efcjvq2z1e1yn4cyz7", ApiResourceKind.agent_execution],
    ["wex_01m2mp45efcjvq2z1e1yn4cyz7", ApiResourceKind.workflow_execution],
    ["ses_x", ApiResourceKind.session],
    ["ida_carol", ApiResourceKind.identity_account],
  ])("%s is %s", (id, kind) => {
    expect(kindByIdPrefix(id)).toBe(kind);
  });

  it.each([
    ["zzz_unknown_kind", "an unknown prefix"],
    ["aex", "a prefix with no underscore"],
    ["_aex", "a leading underscore names no prefix"],
    ["", "empty"],
    ["AEX_upper", "prefixes are lowercase in the contract"],
    ["stk_notajwt", "an API key's prefix is not a kind"],
  ])("%s is the unknown kind (%s) — never a throw", (id) => {
    expect(kindByIdPrefix(id)).toBe(ApiResourceKind.api_resource_kind_unknown);
  });

  it("round-trips with getIdPrefix over every kind the contract declares", () => {
    for (const value of ApiResourceKindSchema.values) {
      if (!hasOption(value, kind_meta)) continue;
      const kind = value.number as ApiResourceKind;
      expect(kindByIdPrefix(`${getIdPrefix(kind)}_01anyulid`), value.name).toBe(
        kind,
      );
    }
  });

  it("every id_prefix in the contract is unique — the table pin a duplicate must change", () => {
    const seen = new Map<string, string>();
    for (const value of ApiResourceKindSchema.values) {
      if (!hasOption(value, kind_meta)) continue;
      const prefix = getOption(value, kind_meta).idPrefix;
      expect(prefix, `${value.name} declares no id_prefix`).not.toBe("");
      const holder = seen.get(prefix);
      expect(
        holder,
        `id_prefix '${prefix}' is declared by both ${holder} and ${value.name}`,
      ).toBeUndefined();
      seen.set(prefix, value.name);
    }
  });
});
