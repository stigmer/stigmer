/**
 * Pins the driver-neutral half of a kind's renames (../kind-rename.ts)
 * over rows built the way each release before a rename wrote them
 * (run-rename-rows.ts for runs), for every step the module serves:
 *   - a run's kind string reads as the contract's name at the step's end
 *     after the rewrite, and a run already past the step is left alone;
 *   - at the last step, the fetched run passes the contract's own
 *     validation, so it can be sent back through `update`;
 *   - a grant naming the step's old kind as resource or principal is
 *     re-keyed to the id its renamed triple derives under the prefix of
 *     the step's time (`iamp_`, frozen: a live prefix would re-key to an
 *     id no store of that time held), keeping the run's id, and a grant on
 *     another kind is not;
 *   - bytes that do not decode throw (the step must not pass over them);
 *   - each step's names are frozen literals, so a later rename cannot
 *     change what an earlier step did;
 *   - at v30, an identity provider's row and the grants naming one become
 *     the federation issuer's, keeping its idp_ id, and the fetched row
 *     passes the contract's validation;
 *   - at v34, a grant's kind string becomes `Grant`, and a grant row or a
 *     history entry's copy of it moves from its `iamp_` id to the `grt_`
 *     id with the same hash; one already moved is left alone, and one whose
 *     id is not its triple's, or that holds no triple, throws;
 *   - at v36, an evaluator's kind string becomes `ScoringRule`, keeping
 *     its evl_ id, settings and spend, and the fetched row passes the
 *     contract's validation.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoringRuleSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";

import { canonicalTripleText } from "../../domain/grant/constants.js";
import { derivedId } from "../../pipeline/steps/defaults.js";
import {
  FEDERATION_ISSUER_RENAME_V30,
  GRANT_RENAME_V34,
  RUN_RENAME_V18,
  RUN_RENAME_V21,
  SCORING_RULE_RENAME_V36,
  movedGrant,
  rekeyedGrant,
  renamedKindRow,
  unreadableKindRenameRowError,
} from "../kind-rename.js";
import { grantIdAfterV34, grantIdBeforeV34, grantRow, grantRowAfterV34 } from "./retired-instance-rows.js";
import {
  AGENT_RUN_NAMES,
  EXECUTION_NAMES,
  RUN_NAMES,
  runBytes,
} from "./run-rename-rows.js";

describe("each step's names are frozen literals", () => {
  it("v18 renamed agent executions to agent runs, v21 agent runs to runs", () => {
    expect(RUN_RENAME_V18.kind).toEqual(["agent_execution", "agent_run"]);
    expect(RUN_RENAME_V18.kindString).toEqual(["AgentExecution", "AgentRun"]);
    expect(RUN_RENAME_V21.kind).toEqual(["agent_run", "run"]);
    expect(RUN_RENAME_V21.kindString).toEqual(["AgentRun", "Run"]);
  });

  it("v30 renamed the identity provider to a federation issuer", () => {
    expect(FEDERATION_ISSUER_RENAME_V30.kind).toEqual(["identity_provider", "federation_issuer"]);
    expect(FEDERATION_ISSUER_RENAME_V30.kindString).toEqual(["IdentityProvider", "FederationIssuer"]);
  });

  it("v36 renamed the evaluator to a scoring rule", () => {
    expect(SCORING_RULE_RENAME_V36.kind).toEqual(["evaluator", "scoring_rule"]);
    expect(SCORING_RULE_RENAME_V36.kindString).toEqual(["Evaluator", "ScoringRule"]);
  });
});

describe("v36: the evaluator is a scoring rule", () => {
  const ruleBytes = (kind: string) =>
    toBinary(
      ScoringRuleSchema,
      create(ScoringRuleSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind,
        metadata: { id: "evl_1", org: "acme", name: "evl_1" },
        spec: { agentId: "agt_1", enabled: true, sampleRate: 0.5, monthlyLimitUsd: 10 },
        status: { period: "2026-10", spentUsd: 2.5, graded: 3 },
      }),
    );

  it("rewrites an evaluator's kind string and keeps its evl_ id, settings and spend", () => {
    const migrated = renamedKindRow(SCORING_RULE_RENAME_V36, ruleBytes("Evaluator"));
    expect(migrated).toEqual(ruleBytes("ScoringRule"));
    const rule = fromBinary(ScoringRuleSchema, migrated!);
    expect([rule.metadata?.id, rule.spec?.sampleRate, rule.status?.spentUsd]).toEqual(["evl_1", 0.5, 2.5]);
    expect(renamedKindRow(SCORING_RULE_RENAME_V36, ruleBytes("ScoringRule"))).toBeUndefined();
  });

  it("a fetched scoring rule passes the contract's own validation, so it can be sent back through update", () => {
    const rule = fromBinary(ScoringRuleSchema, renamedKindRow(SCORING_RULE_RENAME_V36, ruleBytes("Evaluator"))!);
    const kindViolations = createValidator()
      .validate(ScoringRuleSchema, rule)
      .violations?.filter((v) => v.toString().startsWith("kind:"));
    expect(kindViolations ?? []).toEqual([]);
  });
});

describe.each([
  { step: "v18", rename: RUN_RENAME_V18, before: EXECUTION_NAMES, after: AGENT_RUN_NAMES },
  { step: "v21", rename: RUN_RENAME_V21, before: AGENT_RUN_NAMES, after: RUN_NAMES },
])("$step", ({ rename, before, after }) => {
  const [fromKind, toKind] = rename.kind;

  describe("renamedKindRow", () => {
    it("rewrites the kind string and keeps the run's id", () => {
      const migrated = renamedKindRow(rename, runBytes("aex_1", "ses_1", before));
      expect(migrated).toEqual(runBytes("aex_1", "ses_1", after));
      expect(fromBinary(RunSchema, migrated!).metadata?.id).toBe("aex_1");
    });

    it("leaves a run already past the step alone", () => {
      expect(renamedKindRow(rename, runBytes("aex_1", "ses_1", after))).toBeUndefined();
    });

    it("throws on bytes that do not decode", () => {
      expect(() => renamedKindRow(rename, new Uint8Array([0x22, 0xff]))).toThrow();
    });
  });

  describe("rekeyedGrant", () => {
    it("re-keys a grant on a run to the id its renamed triple derives", () => {
      const rekeyed = rekeyedGrant(
        rename,
        grantRow({
          id: "iamp_old",
          principal: "identity_account:ida_1",
          relation: "viewer",
          resource: `${fromKind}:aex_1`,
        }),
      );
      expect(rekeyed).toBeDefined();
      const migrated = fromBinary(GrantSchema, rekeyed!.data);
      expect(migrated.spec?.resource).toMatchObject({ kind: toKind, id: "aex_1" });
      expect(rekeyed!.id).toBe(derivedId("iamp", canonicalTripleText(migrated.spec!)));
      expect(migrated.metadata?.id).toBe(rekeyed!.id);
      expect(rekeyed!.id).not.toBe("iamp_old");
    });

    it("re-keys a grant whose principal is a run", () => {
      const rekeyed = rekeyedGrant(
        rename,
        grantRow({
          id: "iamp_old",
          principal: `${fromKind}:aex_1`,
          relation: "viewer",
          resource: "session:ses_1",
        }),
      );
      expect(fromBinary(GrantSchema, rekeyed!.data).spec?.principal?.kind).toBe(toKind);
    });

    it("leaves a grant with no spec alone", () => {
      expect(
        rekeyedGrant(
          rename,
          toBinary(GrantSchema, create(GrantSchema, { metadata: { id: "iamp_bare" } })),
        ),
      ).toBeUndefined();
    });

    it("leaves a grant on another kind, or on the kind already renamed, alone", () => {
      for (const resource of ["agent:agt_1", `${toKind}:aex_1`]) {
        expect(
          rekeyedGrant(
            rename,
            grantRow({ id: "iamp_other", principal: "identity_account:ida_1", relation: "viewer", resource }),
          ),
        ).toBeUndefined();
      }
    });
  });

  it("names the rename and the row in an unreadable row's failure", () => {
    const error = unreadableKindRenameRowError(rename, fromKind, "aex_bad", new Error("bad wire"));
    expect(error.message).toBe(`the ${fromKind} row aex_bad cannot be read for ${rename.label}: bad wire`);
  });
});

describe("after the last step", () => {
  it("a fetched run passes the contract's own validation, so it can be sent back through update", () => {
    const run = fromBinary(RunSchema, renamedKindRow(RUN_RENAME_V21, runBytes("aex_1", "ses_1", AGENT_RUN_NAMES))!);
    const kindViolations = createValidator()
      .validate(RunSchema, run)
      .violations?.filter((v) => v.toString().startsWith("kind:"));
    expect(kindViolations ?? []).toEqual([]);
  });
});

describe("v30", () => {
  const issuerBytes = (kindString: string): Uint8Array =>
    toBinary(
      FederationIssuerSchema,
      create(FederationIssuerSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: kindString,
        metadata: { id: "idp_1", name: "Acme Okta", slug: "acme-okta", org: "org_1" },
        spec: { expectedAudience: "https://api.acme.example", allowedIssuers: ["https://acme.okta.example"] },
      }),
    );

  it("rewrites an identity provider's kind string and keeps its idp_ id", () => {
    const migrated = renamedKindRow(FEDERATION_ISSUER_RENAME_V30, issuerBytes("IdentityProvider"));
    expect(migrated).toEqual(issuerBytes("FederationIssuer"));
    expect(fromBinary(FederationIssuerSchema, migrated!).metadata?.id).toBe("idp_1");
    expect(renamedKindRow(FEDERATION_ISSUER_RENAME_V30, issuerBytes("FederationIssuer"))).toBeUndefined();
  });

  it("a fetched issuer passes the contract's own validation, so it can be sent back through update", () => {
    const issuer = fromBinary(FederationIssuerSchema, renamedKindRow(FEDERATION_ISSUER_RENAME_V30, issuerBytes("IdentityProvider"))!);
    const kindViolations = createValidator()
      .validate(FederationIssuerSchema, issuer)
      .violations?.filter((v) => v.toString().startsWith("kind:"));
    expect(kindViolations ?? []).toEqual([]);
  });

  it("re-keys a grant on an identity provider to the federation issuer's triple, keeping its id", () => {
    const rekeyed = rekeyedGrant(
      FEDERATION_ISSUER_RENAME_V30,
      grantRow({ id: "iamp_old", principal: "identity_account:ida_1", relation: "viewer", resource: "identity_provider:idp_1" }),
    );
    const migrated = fromBinary(GrantSchema, rekeyed!.data);
    expect(migrated.spec?.resource).toMatchObject({ kind: "federation_issuer", id: "idp_1" });
    expect(rekeyed!.id).toBe(derivedId("iamp", canonicalTripleText(migrated.spec!)));
  });
});

describe("v34: the IAM policy is a grant", () => {
  const triple = { principal: "identity_account:ida_1", relation: "viewer", resource: "agent:agt_1" };

  it("renames the kind and its kind string, frozen", () => {
    expect(GRANT_RENAME_V34.kind).toEqual(["iam_policy", "grant"]);
    expect(GRANT_RENAME_V34.kindString).toEqual(["IamPolicy", "Grant"]);
    const renamed = renamedKindRow(GRANT_RENAME_V34, grantRow({ id: grantIdBeforeV34(triple), ...triple }));
    expect(fromBinary(GrantSchema, renamed!).kind).toBe("Grant");
  });

  it("moves a grant from its iamp_ id to the grt_ id with the same hash, its kind string with it", () => {
    const before = grantIdBeforeV34(triple);
    const moved = movedGrant(before, grantRow({ id: before, ...triple }));
    expect(moved!.id).toBe(grantIdAfterV34(triple));
    expect(moved!.id.slice("grt_".length)).toBe(before.slice("iamp_".length));
    expect(moved!.data).toEqual(grantRowAfterV34(triple));
  });

  it("moves a row the kind rename already rewrote, and leaves one already at its grt_ id", () => {
    const before = grantIdBeforeV34(triple);
    const renamed = renamedKindRow(GRANT_RENAME_V34, grantRow({ id: before, ...triple }))!;
    expect(movedGrant(before, renamed)!.data).toEqual(grantRowAfterV34(triple));
    expect(movedGrant(grantIdAfterV34(triple), grantRowAfterV34(triple))).toBeUndefined();
  });

  it("refuses a row whose id is not the one its triple derives, and one with no triple", () => {
    expect(() => movedGrant("iamp_random", grantRow({ id: "iamp_random", ...triple }))).toThrow(
      `its id is not the one its triple derives (${grantIdBeforeV34(triple)})`,
    );
    const empty = toBinary(GrantSchema, create(GrantSchema, { kind: "IamPolicy", metadata: { id: "iamp_x" } }));
    expect(() => movedGrant("iamp_x", empty)).toThrow("it holds no triple");
    expect(() => movedGrant("iamp_x", new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
  });

  it("refuses a row whose triple no grant could hold, naming the field", () => {
    const row = toBinary(
      GrantSchema,
      create(GrantSchema, {
        kind: "IamPolicy",
        metadata: { id: "iamp_x" },
        spec: { principal: { kind: "identity_account", id: "ida:1" }, resource: { kind: "agent", id: "agt_1" }, relation: "viewer" },
      }),
    );
    expect(() => movedGrant("iamp_x", row)).toThrow("grant principal.id must not contain ':', '#' or '@'");
  });
});
