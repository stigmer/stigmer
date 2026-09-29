/**
 * The visitor-classifier driver point: which callers are VISITORS, people
 * the organization lets reach its agents without belonging to it.
 * Single instance, registered as `drivers.visitorClassifier`.
 *
 * Open source has no visitor lanes: every caller it authenticates is the
 * organization's own (a person, a runner, a machine account, the server
 * itself). An edition that admits outsiders mints their credentials (the
 * cloud's shared-agent guests and channel senders, each a caller class of
 * its own) and says here which callers those are. OSS never learns the
 * lane names (the guard-memory-capture.ts doctrine); it asks this point.
 * Absent means nobody is a visitor, which is true of open source.
 *
 * A core step reads it wherever an outsider must be treated differently
 * from a member. Today that is ComposeDeclaredPreferences: the
 * organization's standing context, written by its admins for its own
 * work, is never composed onto a visitor's run (stigmer/stigmer#1401).
 * The error boundary's VisitorErrorPolicy stays its own seam: its
 * eligibility is method-aware and must answer before an identity exists
 * (pipeline/interceptors/error-boundary.ts).
 *
 * The contract:
 *   - Synchronous and cheap: it runs on every execution create. The
 *     classification keys on the verified identity alone (its class,
 *     its raw token), never on a store read.
 *   - It classifies the caller whatever the transport: in-process
 *     propagation keeps the forwarded identity's class
 *     (pipeline/interceptors/auth.ts), so a visitor's request the server
 *     composes further stays a visitor's.
 *   - A throw counts as a visitor at every consumer, which logs it:
 *     withholding the organization's context from a member is
 *     recoverable, handing it to an outsider is not (the error boundary's
 *     posture).
 */
import type { CallerIdentity } from "./identity.js";

/** The visitor-classifier contract (single-instance point, ExtensionDrivers.visitorClassifier). */
export interface VisitorClassifier {
  /** Whether `caller` is a visitor: admitted to the organization's agents without belonging to it. */
  isVisitor(caller: CallerIdentity): boolean;
}
