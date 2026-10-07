/**
 * Rows as the release before the rename of executions to runs wrote them,
 * and their twins as this release writes them, for the driver-neutral test
 * of ../run-rename.ts and both drivers' migration arms. A row built with
 * the old name is what the step reads; the same builder with the new name
 * is what it must leave behind.
 */
import { create, toBinary } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

export const RUN_RENAME_ORG = "org_01jz0000000000000000000000";

/** The name a row spells a run by, before the rename and after. */
export interface RunNames {
  /** An agent run's kind string. */
  readonly agentRunKind: string;
}

export const OLD_RUN_NAMES: RunNames = { agentRunKind: "AgentExecution" };

export const NEW_RUN_NAMES: RunNames = { agentRunKind: "AgentRun" };

/** An agent run of a session, as a turn's row stores it. */
export function agentRunBytes(id: string, sessionId: string, names: RunNames): Uint8Array {
  return toBinary(
    RunSchema,
    create(RunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: names.agentRunKind,
      metadata: { id, name: id, org: RUN_RENAME_ORG },
      spec: { target: { case: "sessionId", value: sessionId }, message: "hi" },
    }),
  );
}
