/**
 * The never-runner-classifier driver point: which callers are NEVER
 * RUNNERS, whatever they are permitted on. Single instance, registered as
 * `drivers.neverRunnerClassifier`.
 *
 * A door that exists only for runners (today the runner artifact lane,
 * artifactstorage/runner-lane/authorize.ts) admits an identity the
 * composed authorizer allows on the run, because an edition's runners may
 * present identity tokens. Permission on a run does not make a caller its
 * runner. Open source has no caller that holds the one without being
 * able to be the other: a judge run acts as its scoring rule's creator
 * and an eval run as its eval's creator, both people
 * (extensions/grading-caller.ts, extensions/eval-run-caller.ts). An
 * edition that mints credentials of its own for work the server starts (a
 * system account for a judge run, say) holds such callers, and says here
 * which they are. OSS never learns their names; it asks this point.
 * Absent means no caller is ruled out, which is true of open source.
 *
 * It is a different question from the visitor classifier's
 * (visitor-classifier.ts). A visitor is an outsider, and its runs never
 * carry the organization's standing context; a never-runner may be the
 * organization's own work, whose runs do. A visitor is never a runner
 * either, so a runner's door asks both and refuses on either; an edition
 * may answer this point for its visitors as well, but need not.
 *
 * The contract:
 *   - Synchronous and cheap: it runs on a runner's request path. The
 *     classification keys on the verified identity alone (its class, its
 *     raw token), never on a store read.
 *   - It can only refuse. A "no" admits nobody: the caller still meets
 *     the authorizer.
 *   - A throw counts as a never-runner at every consumer, which logs it:
 *     a runner refused a URL retries or fails its turn, and a URL handed
 *     to a caller that is no runner cannot be taken back.
 */
import type { CallerIdentity } from "./identity.js";

/** The never-runner-classifier contract (single-instance point, ExtensionDrivers.neverRunnerClassifier). */
export interface NeverRunnerClassifier {
  /** Whether `caller` is never a runner: refused at a runner's door before the authorizer is asked. */
  isNeverRunner(caller: CallerIdentity): boolean;
}
