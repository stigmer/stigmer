// Spec-first known-deviation registry.
// Domain: conformance contract.
//
// The suite asserts the INTENDED contract, not whatever a given implementation
// happens to do today. Where a target legitimately deviates from the contract
// because of a known bug, it gets a tracked entry here instead of the test
// silently asserting the wrong behavior. When the target is fixed, the
// assertion in expectCodeOrDeviation flips and the entry should be removed —
// the registry can never hide a regression or bless a bug permanently.
import { Code } from "@connectrpc/connect";
import { expectGrpcCode } from "./errors";

export interface KnownDeviation {
  // Stable identifier used by tests to opt a case into the registry.
  id: string;
  // Target names that currently exhibit the deviation (e.g. "local-go").
  targets: string[];
  // The code the contract requires.
  expected: Code;
  // The code the listed targets currently return.
  actual: Code;
  // Why the deviation exists.
  rationale: string;
  // Where to fix it / track it.
  tracking: string;
}

export const KNOWN_DEVIATIONS: KnownDeviation[] = [
  {
    id: "create.duplicate.code",
    // Same Go server, so both the CRUD and execution-engine targets exhibit it.
    targets: ["local-go", "local-go-execution"],
    expected: Code.AlreadyExists,
    actual: Code.Unknown,
    rationale:
      "CheckDuplicateStep returns a plain fmt.Errorf, so the gRPC status is lost in the pipeline wrapper and the client sees Unknown instead of AlreadyExists.",
    tracking: "backend/libs/go/grpc/request/pipeline/steps/duplicate.go",
  },
  {
    id: "create.missing-name.code",
    targets: ["local-go", "local-go-execution"],
    expected: Code.InvalidArgument,
    actual: Code.Unknown,
    rationale:
      "ResolveSlugStep returns a plain fmt.Errorf when name and slug are both empty, so the client sees Unknown instead of InvalidArgument.",
    tracking: "backend/libs/go/grpc/request/pipeline/steps/slug.go",
  },
  {
    id: "workflow.create.missing-spec.code",
    targets: ["local-go"],
    expected: Code.InvalidArgument,
    actual: Code.Unknown,
    rationale:
      "Workflow.spec is not marked required at the proto level, so a spec-less create passes Layer 1 and reaches validateWorkflowSpecStep, which returns a plain fmt.Errorf for the nil spec — the gRPC status is lost and the client sees Unknown instead of InvalidArgument.",
    tracking: "backend/services/stigmer-server/pkg/domain/workflow/controller/validate_spec_step.go",
  },
  {
    id: "workflow.get-version.malformed-hash.code",
    targets: ["local-go"],
    expected: Code.InvalidArgument,
    actual: Code.NotFound,
    rationale:
      "GetWorkflowVersionInput.version_hash declares pattern ^[a-f0-9]{64}$, but getVersion is a direct handler with no ValidateProtoStep — protovalidate never runs. A malformed hash is treated as a (nonexistent) version and falls through to the audit lookup, so the client sees NotFound instead of InvalidArgument.",
    tracking: "backend/services/stigmer-server/pkg/domain/workflow/controller/get_version.go",
  },
];

// Asserts the contract code, transparently accommodating a registered deviation
// for the active target. The deviation is reported (never silently swallowed),
// and if the target starts returning the contract code the assertion fails,
// signaling the entry is stale and should be deleted.
export async function expectCodeOrDeviation(
  targetName: string,
  deviationId: string,
  op: () => Promise<unknown>,
  context: string,
): Promise<void> {
  const deviation = KNOWN_DEVIATIONS.find((entry) => entry.id === deviationId);
  if (deviation === undefined) {
    throw new Error(`unknown deviation id: ${deviationId}`);
  }

  const applies = deviation.targets.includes(targetName);
  const codeToAssert = applies ? deviation.actual : deviation.expected;
  await expectGrpcCode(op, codeToAssert, context);

  if (applies) {
    console.warn(
      `[conformance] tracked deviation ${deviation.id} on ${targetName}: ` +
        `contract=${Code[deviation.expected]} actual=${Code[deviation.actual]} ` +
        `(${deviation.tracking})`,
    );
  }
}
