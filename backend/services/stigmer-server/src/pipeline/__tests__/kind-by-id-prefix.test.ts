/**
 * Pins `kindByIdPrefix` (pipeline/apiresource-meta.ts), the inverse of
 * `getIdPrefix` over the ids the server mints (`<prefix>_<ulid>`,
 * pipeline/steps/defaults.ts). The runner-credential lane reads it to
 * learn which execution kind a token's binding names — a run (`run_`,
 * or `aex_` for the runs a store minted before the run kind's rename) —
 * without a second claim on the token or a guess.
 *
 * Three properties are load-bearing:
 *
 *   - NEVER a throw. The id arrives inside a credential; the caller
 *     refuses with its own sentence, so anything that is not a known
 *     prefix followed by an underscore is the unknown kind.
 *   - A RETIRED prefix still names its kind. Ids are identities and are
 *     never rewritten, so a run minted as `aex_…` before the kind's
 *     prefix became `run` is still a run; a pre-upgrade run waiting on an
 *     approval keeps its credential.
 *   - Every prefix in the contract, current and retired together, is
 *     UNIQUE. The lookup is a Map over the `kind_meta` table; a duplicate
 *     prefix would silently win for one kind and lose for the other. The
 *     pin below turns a future duplicate into a reviewed change, so no
 *     kind can take a prefix another kind's stored ids still carry.
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
    ["run_01m2mp45efcjvq2z1e1yn4cyz7", ApiResourceKind.run],
    ["aex_01m2mp45efcjvq2z1e1yn4cyz7", ApiResourceKind.run],
    ["ses_x", ApiResourceKind.session],
    ["ida_carol", ApiResourceKind.identity_account],
  ])("%s is %s", (id, kind) => {
    expect(kindByIdPrefix(id)).toBe(kind);
  });

  it.each([
    ["zzz_unknown_kind", "an unknown prefix"],
    ["run", "a prefix with no underscore"],
    ["aex", "a retired prefix with no underscore"],
    ["_run", "a leading underscore names no prefix"],
    ["", "empty"],
    ["RUN_upper", "prefixes are lowercase in the contract"],
    ["AEX_upper", "retired prefixes too"],
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

  it("every prefix in the contract, current or retired, is unique — the table pin a duplicate must change", () => {
    const seen = new Map<string, string>();
    for (const value of ApiResourceKindSchema.values) {
      if (!hasOption(value, kind_meta)) continue;
      const meta = getOption(value, kind_meta);
      expect(meta.idPrefix, `${value.name} declares no id_prefix`).not.toBe("");
      for (const prefix of [meta.idPrefix, ...meta.retiredIdPrefixes]) {
        const holder = seen.get(prefix);
        expect(
          holder,
          `prefix '${prefix}' is declared by both ${holder} and ${value.name}`,
        ).toBeUndefined();
        seen.set(prefix, value.name);
      }
    }
  });

  it("the run kind mints run_ and still reads the aex_ ids its stores hold", () => {
    expect(getIdPrefix(ApiResourceKind.run)).toBe("run");
    const meta = getOption(
      ApiResourceKindSchema.values.find((v) => v.number === ApiResourceKind.run)!,
      kind_meta,
    );
    expect(meta.retiredIdPrefixes).toEqual(["aex"]);
  });
});
