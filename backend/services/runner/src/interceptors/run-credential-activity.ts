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
 * A credential sealed by the server (a turn on a runner shared by many
 * organizations) is opened here first, with the payload codec the worker
 * decodes Temporal's payloads with ({@link configureRunCredentialBoundary}).
 * A seal that does not open, or one that reaches a runner holding no
 * payload key, fails the activity with a sentence and never runs it without
 * its credential: on a shared runner the runner's own key would be refused
 * by every server call, and elsewhere it would act as the wrong person.
 *
 * An activity whose dispatch carried no credential (the cloud's) runs with
 * no credential in the store, and the client uses the process credential —
 * unless the runner's boundary requires one for that activity (a shared
 * runner in the cloud, `runner-serves.ts`), which refuses it instead.
 *
 * Both worker roots (`worker.ts`, `runner-manager.ts`) register this
 * unconditionally; it is inert without a credential. The boundary is
 * configured once per process by the root that owns the payload codec
 * (`runner.ts`, `runner-manager.ts`): the opener and the requirement are the
 * process's facts, like its codec, never a turn's. It logs nothing: a
 * credential is never written to a log, and the arguments it inspects may
 * carry anything.
 */

import { ApplicationFailure } from "@temporalio/common";
import type { ActivityInterceptorsFactory } from "@temporalio/worker";

import { readRunCredentialFromInput, readSealedRunCredentialFromInput } from "../shared/run-credential.js";
import { withRunCredential } from "../shared/run-credential-store.js";

/** The `ApplicationFailure` type of an activity the boundary refuses to run. */
export const RUN_CREDENTIAL_REFUSED_FAILURE_TYPE = "RunCredentialRefused";

/** What the boundary knows of its process (the module header). */
export interface RunCredentialBoundary {
  /** Opens a sealed run credential; absent on a runner that holds no payload key. */
  readonly openSealed?: (sealed: string) => Promise<string>;
  /** The activities whose dispatch must carry a credential, refused without one. */
  readonly requireCredentialFor?: ReadonlySet<string>;
}

let boundary: RunCredentialBoundary = {};

/** Set the process's boundary; called by the composition root that owns the payload codec, before its worker polls. */
export function configureRunCredentialBoundary(next: RunCredentialBoundary): void {
  boundary = next;
}

/** The inbound interceptor factory both worker roots register. */
export const runCredentialActivityInterceptor: ActivityInterceptorsFactory =
  (ctx) => ({
    inbound: {
      async execute(input, next) {
        const credential = await credentialOf(input.args[0], activityTypeOf(ctx));
        if (credential === undefined) {
          return next(input);
        }
        return withRunCredential(credential, () => next(input));
      },
    },
  });

/** The activity's type, read loosely: a test may build the interceptor without a context. */
function activityTypeOf(ctx: unknown): string {
  const info = (ctx as { info?: { activityType?: unknown } } | undefined)?.info;
  return typeof info?.activityType === "string" ? info.activityType : "";
}

/** The run credential the dispatch carries, opened when sealed; throws the refusal the module header names. */
async function credentialOf(arg: unknown, activityType: string): Promise<string | undefined> {
  const clear = readRunCredentialFromInput(arg);
  const sealed = readSealedRunCredentialFromInput(arg);
  if (sealed !== undefined) {
    if (clear !== undefined) {
      throw refused("This turn's dispatch carries its credential both sealed and in the clear, so the runner did not run it.");
    }
    return openSealedCredential(sealed);
  }
  if (clear !== undefined) return clear;
  if (boundary.requireCredentialFor?.has(activityType)) {
    throw refused(
      `This runner serves the conversations of many organizations and runs ${activityType} only with the turn's own credential, and its dispatch carried none.`,
    );
  }
  return undefined;
}

async function openSealedCredential(sealed: string): Promise<string> {
  const open = boundary.openSealed;
  if (open === undefined) {
    throw refused(
      "This turn's credential is sealed, and this runner holds no payload key to open it (STIGMER_PAYLOAD_ENCRYPTION_KEY), so it did not run the turn.",
    );
  }
  try {
    return await open(sealed);
  } catch (err) {
    // The codec's own words say what failed (an unknown key id, tampering); they never carry the value.
    throw refused(`This turn's sealed credential could not be opened (${err instanceof Error ? err.message : String(err)}), so the runner did not run the turn.`);
  }
}

/** A refusal Temporal never retries: the same dispatch fails the same way on any attempt. */
function refused(message: string): ApplicationFailure {
  return ApplicationFailure.create({ message, type: RUN_CREDENTIAL_REFUSED_FAILURE_TYPE, nonRetryable: true });
}
