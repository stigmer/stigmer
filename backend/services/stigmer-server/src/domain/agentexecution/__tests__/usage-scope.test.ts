/**
 * The usage reports' own scope checks. Over the wire, protovalidate refuses
 * an empty `org` before any handler runs (`min_len: 1` on both inputs), so
 * these checks answer only a caller that invokes the exported report
 * functions directly, below the transport. They still hold there: an empty
 * organization never reaches the load step, whose org filter would otherwise
 * match executions that name no organization.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  GetAgentUsageReportInputSchema,
  GetOrgUsageReportInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type { Store } from "../../../store/interface.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { getAgentUsageReport, getOrgUsageReport, type UsageReportDeps } from "../usage.js";

const allow: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

/** A store no call may reach: the scope checks refuse first. */
const unreachableStore = new Proxy({} as Store, {
  get: () => {
    throw new Error("the store was read before the scope check refused");
  },
});

const deps: UsageReportDeps = {
  store: unreachableStore,
  logger: createLogger({ level: "error", pretty: false, write: () => {} }),
  authorizer: allow,
  listReadScope: undefined,
};

async function refusal(call: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("the call succeeded");
}

describe("the usage reports refuse an empty org below the transport", () => {
  it("getAgentUsageReport: org is required", async () => {
    const error = await refusal(() => getAgentUsageReport(deps, create(GetAgentUsageReportInputSchema, { agentId: "agt_1", org: "" }), testCallerIdentity()));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("org is required");
  });

  it("getOrgUsageReport: org is required", async () => {
    const error = await refusal(() =>
      getOrgUsageReport(
        deps,
        create(GetOrgUsageReportInputSchema, { org: "", fromDate: "2026-09-01", toDate: "2026-09-30" }),
        testCallerIdentity(),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("org is required");
  });
});
