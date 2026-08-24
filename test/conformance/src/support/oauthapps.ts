// Canonical valid OAuthApp fixtures for the conformance suite.
// Domain: conformance support.
//
// OAuthApp is the outbound-auth registration with an external vendor (the
// mirror image of IdentityProvider's inbound trust): client credentials plus
// the vendor's OAuth endpoints. Its spec carries a real secret
// (client_secret), which the contract encrypts at rest and REDACTS on every
// read — the suites assert the redaction marker, never a stored value.
//
// Negative cases (missing client_id/client_secret, malformed endpoint URLs,
// ciphertext-shaped secrets) are written inline in the suite, matching the
// support/agents.ts convention: this module is validity by construction.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type {
  TokenEndpointAuthMethod,
  VendorApprovalStatus,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";

export const OAUTHAPP_API_VERSION = "iam.stigmer.ai/v1";
export const OAUTHAPP_KIND = "OAuthApp";

// The redaction sentinel every read surface substitutes for the stored
// client_secret. A CROSS-EDITION CONTRACT STRING: the Go steps package and
// the Java handler each pin it in their own unit tests; the suite asserts it
// over the wire on both. Re-submitting it on apply/update means "keep the
// stored secret" (the Environment redaction-marker convention).
export const OAUTHAPP_REDACTED_MARKER = "***REDACTED***";

export interface OAuthAppOptions {
  // Vendor display name; defaults to a stable placeholder.
  provider?: string;
  // OAuth client credentials; default to obviously-fake fixture values.
  clientId?: string;
  clientSecret?: string;
  // Vendor endpoint URLs; default to a well-formed fixture vendor.
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  // Vendor marketplace approval state; PENDING/REJECTED gate the McpServer
  // OAuth initiate flow with byte-pinned refusal copy.
  vendorApprovalStatus?: VendorApprovalStatus;
  // Non-standard scope query parameter name (e.g. Slack's user_scope).
  scopeParameterName?: string;
  // How the client secret is presented at the token endpoint; unset means
  // HTTP Basic (the backwards-compatible baseline).
  tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
}

// A complete, valid OAuthApp resource ready to hand to create/apply/update.
export function makeOAuthApp(
  org: string,
  name: string,
  options: OAuthAppOptions = {},
): MessageInitShape<typeof OAuthAppSchema> {
  return {
    apiVersion: OAUTHAPP_API_VERSION,
    kind: OAUTHAPP_KIND,
    metadata: { name, org },
    spec: {
      provider: options.provider ?? "ConformanceVendor",
      clientId: options.clientId ?? "conformance-client-id",
      clientSecret: options.clientSecret ?? "conformance-client-secret",
      authorizationUrl: options.authorizationUrl ?? "https://vendor.example.com/oauth/authorize",
      tokenUrl: options.tokenUrl ?? "https://vendor.example.com/oauth/token",
      scopes: options.scopes ?? ["read", "write"],
      ...(options.vendorApprovalStatus !== undefined
        ? { vendorApprovalStatus: options.vendorApprovalStatus }
        : {}),
      ...(options.scopeParameterName !== undefined
        ? { scopeParameterName: options.scopeParameterName }
        : {}),
      ...(options.tokenEndpointAuthMethod !== undefined
        ? { tokenEndpointAuthMethod: options.tokenEndpointAuthMethod }
        : {}),
    },
  };
}
