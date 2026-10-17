/**
 * Pins the Grant domain's constants:
 *
 *   - the grant-id derivation — `grt_` + the top 130 bits of sha256 over
 *     the triple's canonical text as 26 lowercase Crockford-base32
 *     characters. The canonical text IS the tuple notation the contract's
 *     own comment documents (`principal.kind:principal.id#principal.relation
 *     @resource.kind:resource.id#relation`, spec.proto), so the natural key
 *     has one spelling and the primary key is the one home of "one row per
 *     triple". The golden vectors are wire-adjacent constants: a change
 *     re-addresses every grant open source ever wrote. The
 *     prefix moved from `iamp` to `grt` with the kind's rename and the
 *     hash did not, so a stored id moves by its prefix alone;
 *   - `BLUEPRINT_KINDS` — the kinds an admin authors, the legacy-creator
 *     rule's whole scan; sessions and executions are personal
 *     and never appear here;
 *   - the byte-pinned copy moved from the cloud's handlers as-is, plus the
 *     new sentences (the two edition refusals, the unknown permission, the
 *     unknown principal kind, the malformed triple, the four principal
 *     refusals a team grantee brought);
 *   - `USER_GRANT_PRINCIPAL_KINDS` — a person and a team, and no kind the
 *     hierarchy walk would read as a structural parent;
 *   - the canonical text's one weakness and its closure: `ApiResourceRef` fields carry no character pattern, so an
 *     id or relation holding `:`, `#` or `@` could spell another triple's
 *     text. `malformedTripleField` names the offending field and
 *     `grantIdFor` refuses to hash such a spec; the grant path turns the
 *     same check into INVALID_ARGUMENT before any read or write.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { GrantSpec } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { GrantSpecSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";

import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
  BLUEPRINT_KINDS,
  GRANT_API_VERSION,
  GRANT_KIND,
  PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE,
  GRANT_ID_PREFIX,
  TRIPLE_DELIMITERS,
  USER_GRANT_PRINCIPAL_KINDS,
  canonicalTripleText,
  malformedTripleField,
  malformedTripleMessage,
  noGrantableRolesMessage,
  personQualifierMessage,
  grantIdFor,
  grantNotFoundMessage,
  principalNotGrantableMessage,
  roleNotGrantableMessage,
  teamNotGrantableMessage,
  teamQualifierMessage,
  teamRoleNotGrantableMessage,
  unknownPermissionMessage,
  unknownPrincipalKindMessage,
  unknownResourceKindMessage,
} from "../constants.js";
import { derivedId } from "../../../pipeline/steps/defaults.js";

const CROCKFORD_ID = /^grt_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

function spec(
  principal: { kind: string; id: string; relation?: string },
  relation: string,
  resource: { kind: string; id: string },
): GrantSpec {
  return create(GrantSpecSchema, {
    principal: {
      kind: principal.kind,
      id: principal.id,
      relation: principal.relation ?? "",
    },
    relation,
    resource: { kind: resource.kind, id: resource.id },
  });
}

const ALICE = "ida_wtr3jcf281yfk9xx61kj59fsme";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

describe("grantIdFor — the derived grant id", () => {
  it("pins the golden vectors (a change re-addresses every OSS grant)", () => {
    expect(
      grantIdFor(
        spec({ kind: "identity_account", id: ALICE }, "admin", {
          kind: "organization",
          id: "acme",
        }),
      ),
    ).toBe("grt_vkbjb6nvqm77vtwnr2bj0x95f9");
    expect(
      grantIdFor(
        spec({ kind: "identity_account", id: ALICE }, "member", {
          kind: "organization",
          id: "acme",
        }),
      ),
    ).toBe("grt_8excwectzw4xzrphy43zpar661");
    // A structural link (the cloud's scope tuple) derives the same way: the
    // id is the triple's, whatever the relation means.
    expect(
      grantIdFor(
        spec({ kind: "organization", id: "acme" }, "organization", {
          kind: "agent",
          id: AGENT,
        }),
      ),
    ).toBe("grt_e8ak7be793avgz5tk4abmew2fp");
    // The public-viewer wildcard principal is a legal triple.
    expect(
      grantIdFor(
        spec({ kind: "identity_account", id: "*" }, "viewer", {
          kind: "agent",
          id: AGENT,
        }),
      ),
    ).toBe("grt_w5wqxkyrtbspjyp3jd6ce565q2");
  });

  it("kept the hash through the rename: an iamp_ id and its grt_ id share their 26 characters", () => {
    const triple = spec({ kind: "identity_account", id: ALICE }, "admin", {
      kind: "organization",
      id: "acme",
    });
    expect(derivedId("iamp", canonicalTripleText(triple))).toBe("iamp_vkbjb6nvqm77vtwnr2bj0x95f9");
    expect(grantIdFor(triple)).toBe("grt_vkbjb6nvqm77vtwnr2bj0x95f9");
  });

  it("has the shape of every minted id: prefix, underscore, 26 Crockford chars", () => {
    expect(GRANT_ID_PREFIX).toBe("grt");
    expect(
      grantIdFor(
        spec({ kind: "identity_account", id: ALICE }, "viewer", {
          kind: "organization",
          id: "acme",
        }),
      ),
    ).toMatch(CROCKFORD_ID);
  });

  it("changes with every axis of the triple, the principal's relation qualifier included", () => {
    const base = spec({ kind: "identity_account", id: ALICE }, "admin", {
      kind: "organization",
      id: "acme",
    });
    const variants = [
      spec({ kind: "team", id: ALICE }, "admin", {
        kind: "organization",
        id: "acme",
      }),
      spec({ kind: "identity_account", id: "ida_other" }, "admin", {
        kind: "organization",
        id: "acme",
      }),
      spec(
        { kind: "identity_account", id: ALICE, relation: "member" },
        "admin",
        { kind: "organization", id: "acme" },
      ),
      spec({ kind: "identity_account", id: ALICE }, "member", {
        kind: "organization",
        id: "acme",
      }),
      spec({ kind: "identity_account", id: ALICE }, "admin", {
        kind: "vault",
        id: "acme",
      }),
      spec({ kind: "identity_account", id: ALICE }, "admin", {
        kind: "organization",
        id: "globex",
      }),
    ];
    const ids = new Set([grantIdFor(base), ...variants.map(grantIdFor)]);
    expect(ids.size).toBe(variants.length + 1);
  });

  it("refuses a spec missing either reference — a triple is the whole key", () => {
    expect(() =>
      grantIdFor(create(GrantSpecSchema, { relation: "admin" })),
    ).toThrow("grant spec must carry principal and resource");
  });

  it("hashes exactly the proto's tuple notation, the principal's `#` present even when its relation is empty", () => {
    expect(
      canonicalTripleText(
        spec({ kind: "identity_account", id: ALICE }, "admin", {
          kind: "organization",
          id: "acme",
        }),
      ),
    ).toBe(`identity_account:${ALICE}#@organization:acme#admin`);
    expect(
      canonicalTripleText(
        spec({ kind: "team", id: "tm_1", relation: "member" }, "viewer", {
          kind: "agent",
          id: AGENT,
        }),
      ),
    ).toBe(`team:tm_1#member@agent:${AGENT}#viewer`);
  });

  it("refuses a triple whose text would be ambiguous — a delimiter inside any field", () => {
    // `a#b` with an empty qualifier and `a` with qualifier `b#` would spell
    // one text; the refusal is what keeps one text one triple.
    expect(() =>
      grantIdFor(
        spec({ kind: "identity_account", id: "a#b" }, "admin", {
          kind: "organization",
          id: "acme",
        }),
      ),
    ).toThrow(malformedTripleMessage("principal.id"));
  });
});

describe("malformedTripleField — the delimiter check the id and the writer share", () => {
  it("names the delimiters the canonical text is built from", () => {
    expect([...TRIPLE_DELIMITERS]).toEqual([":", "#", "@"]);
  });

  it("names the first field holding a delimiter, in the text's order", () => {
    const base = {
      principal: { kind: "identity_account", id: ALICE, relation: "" },
      relation: "admin",
      resource: { kind: "organization", id: "acme" },
    };
    const cases: ReadonlyArray<[GrantSpec, string]> = [
      [
        spec(
          { ...base.principal, kind: "identity:account" },
          base.relation,
          base.resource,
        ),
        "principal.kind",
      ],
      [
        spec(
          { ...base.principal, id: `${ALICE}@x` },
          base.relation,
          base.resource,
        ),
        "principal.id",
      ],
      [
        spec(
          { ...base.principal, relation: "mem#ber" },
          base.relation,
          base.resource,
        ),
        "principal.relation",
      ],
      [
        spec(base.principal, base.relation, {
          ...base.resource,
          kind: "org:anization",
        }),
        "resource.kind",
      ],
      [
        spec(base.principal, base.relation, {
          ...base.resource,
          id: "acme#admin",
        }),
        "resource.id",
      ],
      [spec(base.principal, "ad@min", base.resource), "relation"],
    ];
    for (const [malformed, field] of cases) {
      expect(malformedTripleField(malformed), field).toBe(field);
    }
  });

  it("is undefined for a well-formed triple, the public wildcard principal included", () => {
    expect(
      malformedTripleField(
        spec({ kind: "identity_account", id: ALICE }, "admin", {
          kind: "organization",
          id: "acme",
        }),
      ),
    ).toBeUndefined();
    expect(
      malformedTripleField(
        spec({ kind: "identity_account", id: "*" }, "viewer", {
          kind: "agent",
          id: AGENT,
        }),
      ),
    ).toBeUndefined();
  });
});

describe("the contract's identity strings", () => {
  it("stamps the proto's apiVersion const, not the Java-era value", () => {
    expect(GRANT_API_VERSION).toBe("iam.stigmer.ai/v1");
    expect(GRANT_KIND).toBe("Grant");
  });
});

describe("BLUEPRINT_KINDS — the legacy-creator rule's scan", () => {
  it("is exactly the three kinds an admin authors, in registry order", () => {
    expect([...BLUEPRINT_KINDS]).toEqual([
      ApiResourceKind.agent,
      ApiResourceKind.skill,
      ApiResourceKind.routine,
    ]);
  });

  it("never names a personal kind — those stay with their creator, no role needed", () => {
    for (const personal of [
      ApiResourceKind.session,
      ApiResourceKind.run,
      ApiResourceKind.api_key,
      ApiResourceKind.memory,
      // A vault never makes its creator an admin: My vault is a person's
      // own, and a shared vault is created by an admin already.
      ApiResourceKind.vault,
    ]) {
      expect(BLUEPRINT_KINDS).not.toContain(personal);
    }
  });
});

describe("USER_GRANT_PRINCIPAL_KINDS — who a person may grant a role to", () => {
  it("is exactly a person and a team of people — the one vocabulary the writer admits and the reader treats as no structural parent", () => {
    expect([...USER_GRANT_PRINCIPAL_KINDS]).toEqual([
      ApiResourceKind.identity_account,
      ApiResourceKind.team,
    ]);
  });

  it("names no kind the hierarchy walk would read as a structural parent", () => {
    // The two sets meet by construction (resource-store.ts derives its
    // non-structural exclusion from this one), so this pins the
    // consequence: an organization, an agent or the platform can never
    // be a person's grantee.
    for (const structural of [
      ApiResourceKind.organization,
      ApiResourceKind.platform,
      ApiResourceKind.agent,
      ApiResourceKind.federation_issuer,
    ]) {
      expect(USER_GRANT_PRINCIPAL_KINDS).not.toContain(structural);
    }
  });
});

describe("byte-pinned copy", () => {
  it("moves the cloud's sentences as-is", () => {
    expect(grantNotFoundMessage("grt_x")).toBe(
      "Grant not found: grt_x",
    );
    expect(noGrantableRolesMessage("run")).toBe(
      "No roles can be granted on resource kind 'run'. Role assignments for this resource kind are system-managed.",
    );
    expect(
      roleNotGrantableMessage("editor", "organization", [
        "owner",
        "admin",
        "member",
        "viewer",
      ]),
    ).toBe(
      "Role 'editor' cannot be granted on resource kind 'organization'. Grantable roles: [owner, admin, member, viewer]",
    );
    expect(AUTHENTICATION_REQUIRED_MESSAGE).toBe(
      "Authentication required to check permissions",
    );
    expect(unknownResourceKindMessage("organisation")).toBe(
      "Unknown resource kind: 'organisation'",
    );
  });

  it("spells the two new writer refusals in the cloud sentence's shape", () => {
    expect(unknownPrincipalKindMessage("team")).toBe(
      "Unknown principal kind: 'team'",
    );
    expect(malformedTripleMessage("resource.id")).toBe(
      "grant resource.id must not contain ':', '#' or '@'",
    );
  });

  it("spells the principal refusal in the role sentence's shape, listing the grantable principal kinds", () => {
    expect(principalNotGrantableMessage("organization")).toBe(
      "Principal kind 'organization' cannot be granted a role. Grantable principal kinds: [identity_account, team]",
    );
  });

  it("spells the four team-era principal refusals, each naming what to fix", () => {
    expect(personQualifierMessage("member")).toBe(
      "Principal kind 'identity_account' takes no relation; got 'member'",
    );
    expect(teamQualifierMessage("admin")).toBe(
      "A team principal must name the relation 'member' (the team's members); got 'admin'",
    );
    expect(teamNotGrantableMessage("session")).toBe(
      "A team cannot be granted access to resource kind 'session'.",
    );
    expect(teamRoleNotGrantableMessage("owner", "agent", ["viewer"])).toBe(
      "Role 'owner' cannot be granted to a team on resource kind 'agent'. Roles a team can hold: [viewer]",
    );
  });

  it("names the edition in the two new refusals, and quotes the unknown permission single-quoted", () => {
    expect(PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE).toBe(
      "per-resource access grants are served by the Enterprise and Cloud editions",
    );
    expect(AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE).toBe(
      "authorization queries are served by the Enterprise and Cloud editions",
    );
    expect(unknownPermissionMessage("can_fly")).toBe(
      "unknown permission 'can_fly'",
    );
  });
});
