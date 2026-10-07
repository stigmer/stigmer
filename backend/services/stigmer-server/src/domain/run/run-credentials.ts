/**
 * Whose credentials a run may use, and which surface started it.
 *
 * The run's person is decided ONCE, when the run is created, by the
 * platform's one "is this a person" rule (`isFirstPartyHumanOperator`,
 * extensions/identity.ts): the creating caller when it is a person at the
 * console, the CLI or an SDK speaking for themselves, and nobody
 * otherwise. A schedule fire, a channel message, a shared-link guest, a
 * machine account and a platform client's user are all person-less in
 * every edition, with no rule of their own. The answer is recorded on the
 * run (`status.credentials.person`), and every later read takes the
 * recorded answer: recover never re-derives it from whoever recovers, so a
 * recovered run uses the same person's credentials. Each turn is its own
 * run and records its own sender.
 *
 * A run with no person uses only what the surface that started it
 * assigns. The surface is read from server-stamped facts, never from the
 * request: the minting platform client from the audit stamp the token
 * verifier set, then the run's lineage labels, which only the lanes that
 * start such runs write (the reserved-label guard refuses them from a
 * client): `stigmer.ai/schedule-id` from the schedule clock,
 * `stigmer.ai/share-id` from the shared-link lane, `stigmer.ai/channel-id`
 * from the channel lane. A run with a person reads no surface: its
 * values are its person's.
 */
import { create } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunCredentialsSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

import { isFirstPartyHumanOperator } from "../../extensions/identity.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";

/** The lineage label the schedule clock stamps on every run a fire starts (temporal/schedule/run-starter.ts). */
export const SCHEDULE_ID_LABEL_KEY = "stigmer.ai/schedule-id";

/** The lineage label the shared-link lane stamps on a guest's runs. */
export const SHARE_ID_LABEL_KEY = "stigmer.ai/share-id";

/** The lineage label the channel lane stamps on a channel's runs. */
export const CHANNEL_ID_LABEL_KEY = "stigmer.ai/channel-id";

/** The run's person for a creating caller: their identity, or "" for every caller that is not a person. */
export function personOfCaller(caller: CallerIdentity): string {
  return isFirstPartyHumanOperator(caller) ? caller.identityId : "";
}

/** The recorded person of a run, or undefined for a run with none. */
export function recordedPersonOf(run: Run): string | undefined {
  const person = run.status?.credentials?.person ?? "";
  return person === "" ? undefined : person;
}

/**
 * RecordRunPerson — create only, before the run's values are resolved:
 * writes `status.credentials` from the creating caller, overwriting
 * whatever a request carried (status is the server's).
 */
export function newRecordRunPersonStep(): PipelineStep<typeof RunSchema> {
  return {
    name: "RecordRunPerson",
    execute(ctx): void {
      const status = (ctx.newState.status ??= create(RunStatusSchema));
      status.credentials = create(RunCredentialsSchema, {
        person: personOfCaller(ctx.callerIdentity),
      });
    },
  };
}
