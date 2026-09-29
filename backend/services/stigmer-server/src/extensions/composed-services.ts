/**
 * The composed services — what the composition built that a unit's own
 * lanes must use, handed to the unit rather than rebuilt by it. A unit
 * receives them through `ServerExtension.onComposed` (extensions/
 * registry.ts), called once, in unit order, at the end of `composeServer`,
 * before it returns; and it runs boot work that needs them through
 * `ServerExtension.start`, called in unit order first in the server's
 * `start()`, before any worker, reconciler or listener.
 *
 * Why the composition hands these over instead of the host passing them
 * in: under open source's own authorization the Authorizer, the list read
 * scope and the policy check are built inside `composeServer`, after every
 * unit exists, so no host could pass them; and where a host could (its own
 * Authorizer), handing the unit anything but the instance the Authorize
 * step calls would let the unit's gates ask a different question than the
 * chain around them. Receiving the one instance makes that impossible by
 * construction, in every host.
 *
 * The contract:
 *   - `onComposed` is synchronous and only keeps what it is handed. The
 *     unit's lanes may be called by anyone once `composeServer` returns (a
 *     host's own sweep before `start`, a test that never starts), so the
 *     services must be in place by then; nothing in `composeServer` calls
 *     a unit's lanes before the hand-over.
 *   - `start` runs boot work that must finish before anything serves (a
 *     repair of the unit's own rows). A throw fails `start()`, so a server
 *     whose repair failed never listens.
 *   - Every field is the composition's one instance, whichever posture
 *     built it: a unit's registration, or open source's built-in.
 */
import type { Transport } from "@connectrpc/connect";

import type { AuthorizationQueryEngine } from "./authorization-queries.js";
import type { Authorizer } from "./authorizer.js";
import type { ListReadScope } from "./list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "./resource-authorization.js";

export interface ComposedServices {
  /** The one Authorizer the Authorize step of every chain calls. */
  readonly authorizer: Authorizer;
  /** The one list read scope; undefined where lists are the full scan (open source signed-out). */
  readonly listReadScope: ListReadScope | undefined;
  /**
   * "Is this policy effectively held": the registered engine's `check`, or
   * under open source's own authorization the evaluator's
   * (authorization/policy-check.ts); undefined where neither exists (a
   * unit Authorizer with no engine, or open source signed-out).
   */
  readonly authorizationQueries:
    | Pick<AuthorizationQueryEngine, "check">
    | undefined;
  /**
   * The registered tuple lifecycle; undefined where the tuples are derived
   * from the rows, so a unit's creation event has nothing to write.
   */
  readonly resourceAuthorizationLifecycle:
    | ResourceAuthorizationLifecycle
    | undefined;
  /** The in-process transport: server code calling another domain's RPCs rides it (boot/inprocess.ts). */
  readonly inProcessTransport: Transport;
}
