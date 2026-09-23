/**
 * The routes stage's one refusal: an extension may not register a route
 * the router already serves.
 *
 * Connect's router keeps every registration, and both the serving adapter
 * and the in-process transport build their path table with a plain map
 * set, so a second registration of `/<service>/<method>` silently wins.
 * Extensions register after the whole core set (compose.ts), so a
 * composition that re-registers a service the core has come to serve —
 * the moment a cloud domain moves into open source and the cloud's pin
 * advances without deleting its own handlers — would shadow the core with
 * no error, and serve from whatever store its old handlers read. Refusing
 * at boot turns that into the loudest possible failure; the fix is always
 * the domain's driver point, never a second service.
 *
 * Checked per request path, because `router.service` registers every
 * method of a descriptor (the unimplemented ones answering UNIMPLEMENTED)
 * and `router.rpc` registers one; two extensions colliding with each
 * other are refused the same way.
 */
import type { ConnectRouter } from "@connectrpc/connect";

import type { ResolvedServiceRegistration } from "../extensions/registry.js";

/** Runs each extension registration, refusing any path already routed. */
export function registerExtensionServicesUnshadowed(
  router: ConnectRouter,
  registrations: ReadonlyArray<ResolvedServiceRegistration>,
): void {
  // Request path → who serves it, as the refusal names them.
  const servedBy = new Map<string, string>(
    router.handlers.map((handler) => [handler.requestPath, "the core"]),
  );
  for (const { unit, register } of registrations) {
    const before = router.handlers.length;
    register(router);
    for (const handler of router.handlers.slice(before)) {
      const server = servedBy.get(handler.requestPath);
      if (server !== undefined) {
        throw new Error(
          `extension '${unit}' registers ${handler.requestPath}, which ${server} already serves — a route is never registered twice; an edition changes a core domain's behaviour through its driver points`,
        );
      }
      servedBy.set(handler.requestPath, `extension '${unit}'`);
    }
  }
}
