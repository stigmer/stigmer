/**
 * Pins RequireApprovalAuthority (../approval-authority.ts): a turn into an
 * existing conversation that waives its approvals (auto_approve_all) asks
 * session#can_edit, so a participant, who may send, is refused, and an
 * owner passes; a turn without the flag and a turn that starts a new
 * conversation ask nothing; the server's own internal caller is exempt as
 * at every resolved-resource check.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  autoApproveDeniedMessage,
  newRequireApprovalAuthorityStep,
} from "../approval-authority.js";

const SESSION = "ses_01shared";

function fakeAuthorizer(decision: AuthzDecision): { authorizer: Authorizer; checks: AuthzCheck[] } {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorizer: {
      authorize(_caller, check) {
        checks.push(check);
        return Promise.resolve(decision);
      },
    },
  };
}

function turn(options: { autoApproveAll: boolean; sessionId?: string; callerClass?: "user" | "internal" }) {
  const run = create(RunSchema, {
    spec: {
      autoApproveAll: options.autoApproveAll,
      ...(options.sessionId !== undefined
        ? { target: { case: "sessionId", value: options.sessionId } }
        : {}),
    },
  });
  return new RequestContext(
    RunSchema,
    run,
    testCallerIdentity({ identityId: "acc_paul", callerClass: options.callerClass ?? "user" }),
    ApiResourceKind.run,
  );
}

async function refusal(run: () => void | Promise<void>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("RequireApprovalAuthority", () => {
  it("refuses a participant's auto-approving turn with the session's copy", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "deny", reason: "" });
    const error = await refusal(() =>
      newRequireApprovalAuthorityStep(authorizer).execute(turn({ autoApproveAll: true, sessionId: SESSION })),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(autoApproveDeniedMessage(SESSION));
    expect(checks).toEqual([
      { permission: IamPermission.can_edit, resourceKind: ApiResourceKind.session, resourceId: SESSION },
    ]);
  });

  it("admits an owner's auto-approving turn", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "allow" });
    await newRequireApprovalAuthorityStep(authorizer).execute(turn({ autoApproveAll: true, sessionId: SESSION }));
    expect(checks).toHaveLength(1);
  });

  it("asks nothing of a turn that keeps its approvals, or that starts a new conversation", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "deny", reason: "" });
    const step = newRequireApprovalAuthorityStep(authorizer);
    await step.execute(turn({ autoApproveAll: false, sessionId: SESSION }));
    await step.execute(turn({ autoApproveAll: true }));
    expect(checks).toEqual([]);
  });

  it("leaves the server's own internal caller to the chain, as every resolved check does", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "deny", reason: "" });
    await newRequireApprovalAuthorityStep(authorizer).execute(
      turn({ autoApproveAll: true, sessionId: SESSION, callerClass: "internal" }),
    );
    expect(checks).toEqual([]);
  });
});
