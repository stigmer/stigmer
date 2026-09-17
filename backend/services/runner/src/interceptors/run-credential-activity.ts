/**
 * The activity boundary's ONE entry into the run-credential store.
 *
 * Every activity a worker runs — the server-dispatched turn activities, the
 * server-dispatched GenerateSessionSubject, and every local or remote
 * activity the runner's own serverless-workflow engine schedules — passes
 * through this inbound interceptor. It reads the run credential from
 * whichever channel the dispatch used (`shared/run-credential.ts`: the
 * Temporal header the runner's workflow stamps, else the input object's
 * key the server's workflow sets) and runs the activity inside
 * `withRunCredential`, so that every control-plane request the activity
 * makes — however deep, however detached — is made as the run's human.
 *
 * Header before input: a runner-dispatched activity's header is the nearer
 * authority; in practice a dispatch carries exactly one of the two. An
 * activity whose dispatch carried neither runs with no credential in the
 * store, and the client falls back to the process credential exactly as it
 * did before the store existed — an older server, and the cloud, see no
 * change.
 *
 * Both worker roots (`worker.ts`, `runner-manager.ts`) register this
 * unconditionally; it is inert without a credential. It logs nothing: a
 * credential is never written to a log, and the arguments it inspects may
 * carry anything.
 */

import type { ActivityInterceptorsFactory } from "@temporalio/worker";
import { defaultPayloadConverter } from "@temporalio/common";

import {
  RUN_CREDENTIAL_HEADER,
  readRunCredentialFromInput,
} from "../shared/run-credential.js";
import { withRunCredential } from "../shared/run-credential-store.js";

/** The inbound interceptor factory both worker roots register. */
export const runCredentialActivityInterceptor: ActivityInterceptorsFactory =
  () => ({
    inbound: {
      async execute(input, next) {
        const credential =
          readRunCredentialFromHeader(input.headers[RUN_CREDENTIAL_HEADER]) ??
          readRunCredentialFromInput(input.args[0]);
        if (credential === undefined) {
          return next(input);
        }
        return withRunCredential(credential, () => next(input));
      },
    },
  });

/**
 * The credential a header payload carries, or `undefined` when there is no
 * such header or it does not decode to a non-empty string. Decoding uses the
 * default converter, never the worker's data converter: headers bypass the
 * payload codecs by SDK design, and the stamping side encodes with the same
 * default converter.
 */
function readRunCredentialFromHeader(payload: unknown): string | undefined {
  if (payload === undefined) {
    return undefined;
  }
  const value: unknown = defaultPayloadConverter.fromPayload(
    payload as Parameters<typeof defaultPayloadConverter.fromPayload>[0],
  );
  return typeof value === "string" && value !== "" ? value : undefined;
}
