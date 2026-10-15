// Conformance suite for building an eval case from a run, the refusals
// every edition answers before a run is read.
// Domain: agentic / eval — a run's turn kept as a case: buildCaseFromRun
// answers the case folder zipped, addCaseFromRun adds it to an eval as a new
// version.
//
// What is pinned here, on every edition, with no engine behind the server:
//   - a run that does not exist is NOT_FOUND, from both methods;
//   - a request the contract refuses is INVALID_ARGUMENT before anything is
//     read: a case name that is no directory name, an add that names no
//     eval, and a tag `latest`, which always names the current version.
//
// Out of scope here: every arm that needs a finished conversation (a case
// built from a two-turn conversation, its mock and its history; the case
// added as a new version, a second add of its name refused, an eval of
// another organization refused; an eval run of the new case on the agent).
// A run ends only with an engine behind the server, so those arms are the
// execution class's (suites-execution/eval-case-from-run.conformance.test.ts).
// Who may view a run is the run's own suites'.
import { Code } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";
import type { TenancyContext } from "../targets/target";

let target: TargetProfile;
let clients: ConformanceClients;
let tenancy: TenancyContext;

// A run id no run holds.
const MISSING_RUN = "run_01m4zzzzzzzzzzzzzzzzzzzzzz";

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  tenancy = await target.provisionTenancy();
});

afterAll(async () => {
  if (tenancy !== undefined) {
    await target.cleanupTenancy(tenancy);
  }
  await target?.teardown();
});

describe("an eval case from a run: refusals before a run is read", () => {
  it("[rpc:EvalQueryController.buildCaseFromRun] [rpc:EvalCommandController.addCaseFromRun] answers NOT_FOUND for a run that does not exist", async () => {
    await expectGrpcCode(() => clients.evalQuery.buildCaseFromRun({ runId: MISSING_RUN }), Code.NotFound, "a case built from a missing run");
    await expectGrpcCode(
      () => clients.evalCommand.addCaseFromRun({ runId: MISSING_RUN, eval: { org: tenancy.org, slug: uniqueName("ecr-eval") } }),
      Code.NotFound,
      "a case added from a missing run",
    );
  });

  it("[rpc:EvalQueryController.buildCaseFromRun] [rpc:EvalCommandController.addCaseFromRun] refuses a case name that is no directory name, an add naming no eval, and the tag latest", async () => {
    await expectGrpcCode(
      () => clients.evalQuery.buildCaseFromRun({ runId: MISSING_RUN, caseName: "Not A Name" }),
      Code.InvalidArgument,
      "a case name with spaces and capitals",
    );
    await expectGrpcCode(() => clients.evalCommand.addCaseFromRun({ runId: MISSING_RUN }), Code.InvalidArgument, "an add that names no eval");
    await expectGrpcCode(
      () => clients.evalCommand.addCaseFromRun({ runId: MISSING_RUN, eval: { org: tenancy.org, slug: uniqueName("ecr-eval") }, tag: "latest" }),
      Code.InvalidArgument,
      "the tag latest",
    );
  });
});
