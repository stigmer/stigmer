/**
 * The OAuth client a sign-in presents to an address's own login server when
 * no login app serves the address, in the MCP Authorization
 * specification's order (2025-11-25):
 *
 *   1. A Client ID Metadata Document, when the login server advertises
 *      `client_id_metadata_document_supported` and this deployment has a
 *      public https origin: the client id is the URL of Stigmer's document
 *      (`clientDocumentUrl`, served on the unified port by
 *      client-document.ts), which the login server fetches. Nothing is
 *      registered.
 *   2. RFC 7591 Dynamic Client Registration, once per login server and
 *      redirect URI: the first sign-in registers a public client and keeps
 *      its id (`OAuthClientRegistrationStore`, shared by every
 *      organization, since a public client holds no secret); every later
 *      sign-in reuses it. Two tools behind one login server share one
 *      client, because registration belongs to the login server. A client
 *      the login server has since forgotten is dropped and registered again
 *      (`forgetClient`, at the start's pre-flight and at the exchange's
 *      `invalid_client`).
 *   3. Neither: refused, naming the address and what helps.
 *
 * Proven by __tests__/start.test.ts (one registration per login server, a
 * forgotten client registered again, the metadata document's URL) and the
 * sign-in conformance suite.
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";

import type { OAuthClientRegistrationStore } from "../../../store/interface.js";
import { registerClient } from "./dcr.js";
import type { AuthServerMetadata } from "./discovery.js";

/** The client a sign-in uses, and the registration it came from. */
export interface SignInClient {
  readonly clientId: string;
  /**
   * The login server a kept registration belongs to (its key in the
   * registration store); "" for a Client ID Metadata Document, which is no
   * registration.
   */
  readonly registration: string;
  /** Whether the client was registered by this call, rather than reused. */
  readonly fresh: boolean;
}

/** What obtaining a client needs. */
export interface ClientDeps {
  readonly registrations: OAuthClientRegistrationStore;
  readonly fetchImpl: OutboundFetch;
  /** Stigmer's Client ID Metadata Document URL; "" when the deployment has no public https origin. */
  readonly clientDocumentUrl: string;
}

/** The name Stigmer registers under, shown on the login server's consent page. */
export const CLIENT_NAME = "Stigmer";

/** Why no client can be had: thrown with the sentence the person reads. */
export class NoSignInClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoSignInClientError";
  }
}

/**
 * The key a login server's registrations are kept under: its issuer, which
 * discovery has checked is the issuer the document was read for, so no
 * document can file a client under another login server's name.
 */
export function loginServerKey(metadata: AuthServerMetadata): string {
  return metadata.issuer;
}

/** Whether a login server can give Stigmer a client at all, asked without registering anything. */
export function canObtainClient(metadata: AuthServerMetadata, clientDocumentUrl: string): boolean {
  return (
    (metadata.clientIdMetadataDocumentSupported && clientDocumentUrl !== "") ||
    metadata.registrationEndpoint !== ""
  );
}

/**
 * The client for a login server and redirect URI: the metadata document's
 * URL, else the one kept, else one registered now and kept.
 */
export async function obtainClient(
  deps: ClientDeps,
  metadata: AuthServerMetadata,
  redirectUri: string,
): Promise<SignInClient> {
  if (metadata.clientIdMetadataDocumentSupported && deps.clientDocumentUrl !== "") {
    return { clientId: deps.clientDocumentUrl, registration: "", fresh: false };
  }
  if (metadata.registrationEndpoint === "") {
    throw new NoSignInClientError(
      `${loginServerHost(metadata)} does not allow automatic client registration`,
    );
  }
  const key = loginServerKey(metadata);
  const kept = await deps.registrations.find(key, redirectUri);
  if (kept !== undefined) {
    return { clientId: kept, registration: key, fresh: false };
  }
  return register(deps, metadata, redirectUri);
}

/**
 * Drops a kept client the login server refused and registers a new one.
 * Only the client named is dropped: another sign-in may already have
 * replaced it.
 */
export async function replaceClient(
  deps: ClientDeps,
  metadata: AuthServerMetadata,
  redirectUri: string,
  forgotten: SignInClient,
): Promise<SignInClient> {
  await forgetClient(deps.registrations, forgotten.registration, redirectUri, forgotten.clientId);
  return register(deps, metadata, redirectUri);
}

/** Drops a kept client the login server no longer knows; a no-op for one that was never kept. */
export async function forgetClient(
  registrations: OAuthClientRegistrationStore,
  registration: string,
  redirectUri: string,
  clientId: string,
): Promise<void> {
  if (registration !== "") {
    await registrations.forget(registration, redirectUri, clientId);
  }
}

async function register(
  deps: ClientDeps,
  metadata: AuthServerMetadata,
  redirectUri: string,
): Promise<SignInClient> {
  const registered = await registerClient(
    metadata.registrationEndpoint,
    redirectUri,
    CLIENT_NAME,
    deps.fetchImpl,
  );
  const key = loginServerKey(metadata);
  const kept = await deps.registrations.save(
    key,
    redirectUri,
    registered.clientId,
    new Date().toISOString(),
  );
  return { clientId: kept, registration: key, fresh: kept === registered.clientId };
}

/** The login server's host, for a sentence: its issuer, else its authorization endpoint. */
export function loginServerHost(metadata: AuthServerMetadata): string {
  for (const candidate of [metadata.issuer, metadata.authorizationEndpoint]) {
    if (URL.canParse(candidate)) {
      const host = new URL(candidate).host;
      if (host !== "") return host;
    }
  }
  return "the login server";
}
