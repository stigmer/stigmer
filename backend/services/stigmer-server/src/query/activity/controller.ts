/**
 * Activity controller — ports
 * pkg/query/activity/controller/activity_controller.go: the thin adapter
 * between ConnectRPC and the activity handler, following the search
 * controller's pattern.
 *
 * The handler's only failure mode is a storage read error — server
 * internals that must stay off the wire (stigmer/stigmer#478); the full
 * error is logged here at the boundary and the wire carries the sanitized
 * Internal.
 *
 * ActivityQueryController carries no api_resource_kind option and
 * is_skip_authorization (cross-aggregate CQRS read; single-tenant OSS has
 * no authorization set to enumerate — stigmer#461).
 *
 * Proven by activity.conformance.test.ts (CONFORMANCE_TARGET=local-ts)
 * and __tests__/handler.test.ts.
 */
import type { ConnectRouter } from "@connectrpc/connect";

import { ActivityQueryController } from "@stigmer/protos/ai/stigmer/activity/v1/query_pb";

import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import type { ActivityHandler } from "./handler.js";

export interface ActivityControllerDeps {
  readonly handler: ActivityHandler;
  readonly logger: Logger;
}

/** Registers the ActivityQueryController on the router (routes stage). */
export function registerActivityServices(
  router: ConnectRouter,
  deps: ActivityControllerDeps,
): void {
  router.service(ActivityQueryController, {
    listRecentActivity: async (request) => {
      try {
        return await deps.handler.listRecentActivity(request);
      } catch (error) {
        deps.logger.error("ListRecentActivity failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw internalError(error, "failed to list recent activity");
      }
    },
  });
}
