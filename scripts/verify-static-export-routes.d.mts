/**
 * Type surface of verify-static-export-routes.mjs for TypeScript
 * importers. The TS server's console lane implements the same serving
 * contract nginx.conf encodes, and its equivalence test
 * (backend/services/stigmer-server/src/transport/console/__tests__/
 * nginx-equivalence.test.ts) imports this gate's exported model as the
 * oracle — one route contract, one gate, two verified implementations.
 * Keep these signatures in step with the module's exports.
 */

export interface GateRouteSegment {
  readonly name: string;
  readonly dynamic: boolean;
}

export interface GateRoute {
  readonly url: string;
  readonly segments: readonly GateRouteSegment[];
  readonly pageFile: string;
}

export interface GateServerModel {
  readonly indexFile: string;
  readonly errorPage: { readonly code: number; readonly uri: string } | null;
}

/** Enumerate every App Router route; refuses unmodelled constructs. */
export function enumerateRoutes(appDir: string): GateRoute[];

/** The HTML file a route's static export produces (placeholder form). */
export function exportFileOf(route: GateRoute): string;

/** A real-value request URL for a route — what a browser actually asks for. */
export function representativeUrlOf(route: GateRoute): string;

/** Parse nginx config text into directive nodes. */
export function parseNginxConfig(source: string): unknown[];

/** Build the routing model, refusing unmodelled directives. */
export function buildServerModel(nodes: unknown[]): GateServerModel;

/**
 * Resolve a request against the model and a file set: the document the
 * browser ends up with, or null (bare 404 with no error page).
 */
export function resolveRequest(
  model: GateServerModel,
  uri: string,
  files: ReadonlySet<string>,
  depth?: number,
): string | null;
