/**
 * The OAuth client document lane: the unified port's plain-HTTP endpoint
 * serving Stigmer's Client ID Metadata Document
 * (domain/vault/sign-in/client-document.ts), which a login server fetches
 * when a sign-in presents the document's URL as its client id.
 *
 * Behavior: GET (and HEAD) → 200, application/json, cacheable for an hour
 * (a login server may cache it; it changes only with the deployment's
 * redirect settings); any other method → 405. No CORS: the reader is a
 * login server, not a page.
 */
import type { LaneHandler } from "../lanes.js";

/** The document changes only when the deployment's redirect settings do. */
const CLIENT_DOCUMENT_CACHE_CONTROL = "public, max-age=3600";

export function createOAuthClientDocumentLane(document: string): LaneHandler {
  return (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", CLIENT_DOCUMENT_CACHE_CONTROL);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    response.end(document);
  };
}
