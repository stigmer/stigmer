/**
 * Pins the reserved-label write guard (C2 Stage 3, the Java
 * GuardReservedLabelsStep matrix): echoes and removals pass without any
 * authorization round-trip, introductions and changes reject with the
 * byte-pinned INVALID_ARGUMENT copy when the Authorizer denies, the
 * permissive default allows (OSS byte-identity), the per-kind client
 * contract (stigmer.ai/personal on Environment) passes, and internal
 * callers skip entirely.
 */
import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../request-context.js";
import {
  newGuardReservedLabelsStep,
  reservedLabelMutations,
} from "../guard-reserved-labels.js";
import { EXISTING_RESOURCE_KEY } from "../load-existing.js";
import { newPermissiveSingleTeamAuthorizer } from "../authorize.js";

const USER: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "stigmer",
  rawToken: "tok",
};

function denying(observed?: AuthzCheck[]): Authorizer {
  return {
    authorize: (_caller, check) => {
      observed?.push(check);
      return Promise.resolve({ kind: "deny", reason: "" });
    },
  };
}

function agentCtx(
  labels: Record<string, string>,
  caller: CallerIdentity = USER,
): RequestContext<typeof AgentSchema> {
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, { metadata: { name: "a", labels } }),
    caller,
    ApiResourceKind.agent,
  );
}

describe("reservedLabelMutations", () => {
  it("flags introductions and changes, never echoes or removals", () => {
    const stored = {
      "stigmer.ai/kept": "true",
      "stigmer.ai/removed": "true",
    };
    const requested = {
      "stigmer.ai/kept": "true", // echo
      "stigmer.ai/new": "true", // introduction
      "stigmer.ai/changed": "x", // introduction (absent in stored)
      ordinary: "fine",
    };
    expect(reservedLabelMutations(stored, requested)).toEqual([
      "stigmer.ai/changed",
      "stigmer.ai/new",
    ]);
  });
});

describe("GuardReservedLabels", () => {
  it("rejects an introduction with the byte-pinned copy when denied", async () => {
    const step = newGuardReservedLabelsStep<typeof AgentSchema>(denying());
    const error = await step
      .execute(agentCtx({ "stigmer.ai/default-agent": "true" }))
      ?.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    expect((error as ConnectError).rawMessage).toBe(
      "Labels in the reserved 'stigmer.ai/' namespace are platform-managed " +
        "and cannot be set or changed by this request: " +
        "stigmer.ai/default-agent. Stored reserved labels may be echoed " +
        "back unchanged or removed.",
    );
  });

  it("consults the platform-scoped operator check lazily", async () => {
    const observed: AuthzCheck[] = [];
    const step = newGuardReservedLabelsStep<typeof AgentSchema>(
      denying(observed),
    );
    // No reserved mutation: no check at all.
    await step.execute(agentCtx({ ordinary: "fine" }));
    expect(observed).toEqual([]);
    // A mutation consults exactly the operator capability.
    await step
      .execute(agentCtx({ "stigmer.ai/x": "1" }))
      ?.catch(() => undefined);
    expect(observed).toEqual([
      {
        permission: IamPermission.can_write_reserved_labels,
        resourceKind: ApiResourceKind.platform,
        resourceId: "stigmer",
      },
    ]);
  });

  it("the permissive default allows — OSS behavior byte-identical", async () => {
    const step = newGuardReservedLabelsStep<typeof AgentSchema>(
      newPermissiveSingleTeamAuthorizer(),
    );
    await expect(
      Promise.resolve(step.execute(agentCtx({ "stigmer.ai/x": "1" }))),
    ).resolves.toBeUndefined();
  });

  it("echoes of stored reserved labels pass on updates", async () => {
    const step = newGuardReservedLabelsStep<typeof AgentSchema>(denying());
    const ctx = agentCtx({ "stigmer.ai/default-agent": "true" });
    ctx.set(
      EXISTING_RESOURCE_KEY,
      create(AgentSchema, {
        metadata: { labels: { "stigmer.ai/default-agent": "true" } },
      }),
    );
    await expect(Promise.resolve(step.execute(ctx))).resolves.toBeUndefined();
  });

  it("the Environment personal-label client contract passes", async () => {
    const step = newGuardReservedLabelsStep<typeof EnvironmentSchema>(
      denying(),
    );
    const ctx = new RequestContext(
      EnvironmentSchema,
      create(EnvironmentSchema, {
        metadata: { labels: { "stigmer.ai/personal": "true" } },
      }),
      USER,
      ApiResourceKind.environment,
    );
    await expect(Promise.resolve(step.execute(ctx))).resolves.toBeUndefined();
  });

  it("internal callers skip — server-composed requests stamp by design", async () => {
    const step = newGuardReservedLabelsStep<typeof AgentSchema>(denying());
    const ctx = agentCtx(
      { "stigmer.ai/default-instance": "true" },
      { identityId: "internal", callerClass: "internal", issuer: "", rawToken: "" },
    );
    await expect(Promise.resolve(step.execute(ctx))).resolves.toBeUndefined();
  });
});
