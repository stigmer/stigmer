/**
 * The activity boundary's ONE entry into the run-credential store.
 *
 * Every activity a worker runs — the server-dispatched turn activities and
 * the server-dispatched GenerateSessionSubject among them — passes through
 * this inbound interceptor. It reads the run credential from the input
 * object's key the server's workflow sets (`shared/run-credential.ts`) and
 * runs the activity inside `withRunCredential`, so that every control-plane
 * request the activity makes — however deep, however detached — is made as
 * the run's human.
 *
 * An activity whose dispatch carried no credential runs with no credential
 * in the store, and the client falls back to the process credential exactly
 * as it did before the store existed — an older server, and the cloud, see
 * no change.
 *
 * Both worker roots (`worker.ts`, `runner-manager.ts`) register this
 * unconditionally; it is inert without a credential. It logs nothing: a
 * credential is never written to a log, and the arguments it inspects may
 * carry anything.
 */

import type { ActivityInterceptorsFactory } from "@temporalio/worker";

import { readRunCredentialFromInput } from "../shared/run-credential.js";
import { withRunCredential } from "../shared/run-credential-store.js";

/** The inbound interceptor factory both worker roots register. */
export const runCredentialActivityInterceptor: ActivityInterceptorsFactory =
  () => ({
    inbound: {
      async execute(input, next) {
        const credential = readRunCredentialFromInput(input.args[0]);
        if (credential === undefined) {
          return next(input);
        }
        return withRunCredential(credential, () => next(input));
      },
    },
  });
