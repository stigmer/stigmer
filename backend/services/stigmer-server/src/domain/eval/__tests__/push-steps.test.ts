/**
 * Pins the eval push's own pieces apart from a server: the write's two
 * questions (writeTargetsOf), create on the organization when no eval
 * holds the slug and edit on the eval when one does, each with the one
 * copy, and a broken chain throwing; the refusal of a folder with no case
 * that loads, naming each reason; the level a push writes (the request's,
 * else the stored eval's, else the organization); and the status a reading
 * becomes, bounded as a plugin's suite summary is.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { EvalSuite } from "@stigmer/plugin-package";
import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { PushEvalRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_PUSHED_RESOURCE_KEY, PUSHED_RESOURCE_KEY } from "../../../pipeline/steps/archive-push.js";
import { EVAL_MAX_LISTED_MOCK_SERVERS, EVAL_PUSH_DENIED } from "../constants.js";
import { initialEval, noCaseRefusal, requestedEvalVisibility, statusOf, writeTargetsOf } from "../push.js";

const existing = create(EvalSchema, {
  metadata: { id: "evs_01support", org: "org_acme", slug: "support", visibility: ApiResourceVisibility.visibility_private },
});

function ctxFor(
  request: { visibility?: ApiResourceVisibility } = {},
  stored?: typeof existing,
): RequestContext<typeof PushEvalRequestSchema> {
  const ctx = new RequestContext(
    PushEvalRequestSchema,
    create(PushEvalRequestSchema, { org: "org_acme", slug: "support", ...request }),
    testCallerIdentity(),
    ApiResourceKind.eval,
  );
  ctx.set(PUSHED_RESOURCE_KEY, initialEval({ org: "org_acme", slug: "support" }));
  ctx.set(EXISTING_PUSHED_RESOURCE_KEY, stored);
  return ctx;
}

describe("writeTargetsOf", () => {
  it("asks can_create_eval on the organization when no eval holds the slug", () => {
    expect(writeTargetsOf(ctxFor())).toEqual([
      {
        permission: IamPermission.can_create_eval,
        resourceKind: ApiResourceKind.organization,
        resourceId: "org_acme",
        deniedMessage: EVAL_PUSH_DENIED,
      },
    ]);
  });

  it("asks can_edit on the eval the slug names when one does", () => {
    expect(writeTargetsOf(ctxFor({}, existing))).toEqual([
      {
        permission: IamPermission.can_edit,
        resourceKind: ApiResourceKind.eval,
        resourceId: "evs_01support",
        deniedMessage: EVAL_PUSH_DENIED,
      },
    ]);
  });

  it("throws when no head was built: a broken chain, not a question", () => {
    const ctx = ctxFor();
    ctx.set(PUSHED_RESOURCE_KEY, undefined);
    expect(() => writeTargetsOf(ctx)).toThrow("BuildInitialEval must run first");
  });
});

describe("the level a push writes", () => {
  it("is the request's, else the stored eval's, else the organization", () => {
    expect(requestedEvalVisibility(ctxFor({ visibility: ApiResourceVisibility.visibility_org }, existing))).toBe(
      ApiResourceVisibility.visibility_org,
    );
    expect(requestedEvalVisibility(ctxFor({}, existing))).toBe(ApiResourceVisibility.visibility_private);
    expect(requestedEvalVisibility(ctxFor())).toBe(ApiResourceVisibility.visibility_org);
  });
});

describe("initialEval", () => {
  it("names the eval by the request's slug, and by it as the display name when the request gives none", () => {
    expect(initialEval({ org: "o", slug: "s" }).metadata?.name).toBe("s");
    expect(initialEval({ org: "o", slug: "s", name: "" }).metadata?.name).toBe("s");
    expect(initialEval({ org: "o", slug: "s", name: "Support tests" }).metadata?.name).toBe("Support tests");
  });
});

describe("noCaseRefusal", () => {
  it("lists every finding of a folder where no case loads", () => {
    const suite: EvalSuite = {
      dir: "",
      cases: [],
      servers: [],
      findings: [
        { kind: "eval-case-invalid", path: "a", message: "a: the case has no graders" },
        { kind: "eval-case-invalid", path: "b", message: "b: the prompt is required" },
      ],
    };
    expect(noCaseRefusal(suite)).toBe(
      "eval cannot be pushed: no case in the folder loads, 2 problems found:\n  - a: the case has no graders\n  - b: the prompt is required",
    );
  });

  it("says what a case is when the folder holds none", () => {
    expect(noCaseRefusal({ dir: "", cases: [], servers: [], findings: [] })).toContain("the folder holds no case");
  });
});

describe("statusOf", () => {
  it("lists at most the bounded number of mocked servers", () => {
    const servers = Array.from({ length: EVAL_MAX_LISTED_MOCK_SERVERS + 5 }, (_, i) => `s${String(i).padStart(4, "0")}`);
    const status = statusOf({ dir: "", cases: [], findings: [], servers }, "d".repeat(64));
    expect(status.mockServers).toHaveLength(EVAL_MAX_LISTED_MOCK_SERVERS);
    expect(status.digest).toBe("d".repeat(64));
    expect(status.caseCount).toBe(0);
  });
});
