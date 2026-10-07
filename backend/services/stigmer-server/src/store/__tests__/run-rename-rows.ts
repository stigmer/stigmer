/**
 * Run rows as each release wrote them, for the driver-neutral test of
 * ../run-rename.ts and both drivers' migration arms: under the kind string
 * of agent executions (before SQLite v18, Postgres v13), of agent runs
 * (before SQLite v21, Postgres v16) and of runs (now). A row built with a
 * step's old name is what the step reads; the same builder with its new
 * name is what it must leave behind.
 */
import { create, toBinary } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

export const RUN_RENAME_ORG = "org_01jz0000000000000000000000";

/** The name a row spells a run by. */
export interface RunNames {
  /** A run's kind string. */
  readonly kindString: string;
}

/** As the releases before SQLite v18 and Postgres v13 wrote a run. */
export const EXECUTION_NAMES: RunNames = { kindString: "AgentExecution" };

/** As the releases from SQLite v18 to v19 and Postgres v13 to v14 wrote a run. */
export const AGENT_RUN_NAMES: RunNames = { kindString: "AgentRun" };

/** As this release writes a run. */
export const RUN_NAMES: RunNames = { kindString: "Run" };

/** A run of a session, as a turn's row stores it. */
export function runBytes(id: string, sessionId: string, names: RunNames): Uint8Array {
  return toBinary(
    RunSchema,
    create(RunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: names.kindString,
      metadata: { id, name: id, org: RUN_RENAME_ORG },
      spec: { target: { case: "sessionId", value: sessionId }, message: "hi" },
    }),
  );
}
