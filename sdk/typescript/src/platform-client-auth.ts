import { createGrpcWebTransport } from "@connectrpc/connect-node";
import { createClient, type Client } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { MintUserTokenRequestSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { StigmerError, wrapError } from "./gen/errors";
import {
  rpcMetadataInterceptor,
  errorStripInterceptor,
} from "./internal/interceptors";

/**
 * Configuration for a PlatformClient token-minting helper.
 *
 * This is NOT a general-purpose Stigmer client — it mints user-scoped
 * JWTs from a backend service. The returned tokens are passed to the
 * React SDK's `StigmerProvider` via `getAccessToken`.
 *
 * @example
 * ```typescript
 * import { createPlatformClientAuth } from "@stigmer/sdk/node";
 *
 * const auth = createPlatformClientAuth({
 *   baseUrl: "https://api.stigmer.ai",
 *   clientId: process.env.STIGMER_CLIENT_ID!,
 *   clientSecret: process.env.STIGMER_CLIENT_SECRET!,
 * });
 * ```
 */
export interface PlatformClientAuthConfig {
  /** Stigmer API server URL (e.g., "https://api.stigmer.ai"). */
  readonly baseUrl: string;

  /** PlatformClient client_id (stgm_cid_ prefix). */
  readonly clientId: string;

  /** PlatformClient client_secret (stgm_cs_ prefix). Server-only — never expose in browser code. */
  readonly clientSecret: string;
}

/**
 * Input for minting a user-scoped Stigmer JWT.
 *
 * The platform builder's backend calls this with the authenticated
 * user's identity. Stigmer validates the PlatformClient credentials,
 * optionally JIT-provisions the user's identity account, and returns
 * a signed JWT.
 */
export interface MintUserTokenInput {
  /** Platform's stable user identifier. Becomes the JWT sub claim. */
  readonly userId: string;

  /** User's email address. Used for profile enrichment during JIT provisioning. */
  readonly userEmail?: string;

  /** User's display name. Used for profile enrichment during JIT provisioning. */
  readonly userName?: string;

  /**
   * Organization to scope the token to. When empty, defaults to the
   * PlatformClient's owning organization.
   */
  readonly orgId?: string;
}

/**
 * Result of a successful `mintUserToken` call.
 *
 * Pass `accessToken` to the React SDK's `StigmerProvider` via the
 * `getAccessToken` callback to authenticate browser-based API calls.
 */
export interface MintUserTokenResult {
  /** Stigmer-signed JWT for browser-based API authentication. */
  readonly accessToken: string;

  /** Token type. Always "Bearer". */
  readonly tokenType: string;

  /** Token lifetime in seconds from issuance. */
  readonly expiresIn: number;

  /** Absolute expiration time, computed from `expiresIn` at call time. */
  readonly expiresAt: Date;
}

/**
 * PlatformClient token-minting helper.
 *
 * A minimal, purpose-built client for minting Stigmer user JWTs from
 * a backend service. It does NOT replace the main Stigmer client — use
 * `createNodeClient` for resource management with an API key.
 *
 * @example
 * ```typescript
 * const auth = createPlatformClientAuth({
 *   baseUrl: "https://api.stigmer.ai",
 *   clientId: process.env.STIGMER_CLIENT_ID!,
 *   clientSecret: process.env.STIGMER_CLIENT_SECRET!,
 * });
 *
 * // In your /api/stigmer-token endpoint handler:
 * const { accessToken, expiresAt } = await auth.mintUserToken({
 *   userId: req.user.id,
 *   userEmail: req.user.email,
 *   userName: req.user.name,
 * });
 * res.json({ accessToken, expiresAt: expiresAt.toISOString() });
 * ```
 */
export class PlatformClientAuth {
  private readonly tokenClient: Client<typeof PlatformClientTokenController>;
  private readonly clientId: string;
  private readonly clientSecret: string;

  /** @internal Use {@link createPlatformClientAuth} instead. */
  constructor(config: PlatformClientAuthConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    const transport = createGrpcWebTransport({
      baseUrl: config.baseUrl,
      httpVersion: "2",
      interceptors: [rpcMetadataInterceptor, errorStripInterceptor],
    });

    this.tokenClient = createClient(PlatformClientTokenController, transport);
  }

  /**
   * Mint a user-scoped JWT for browser-based access to Stigmer resources.
   *
   * @throws {StigmerError} with code `"unauthenticated"` if credentials are invalid
   * @throws {StigmerError} with code `"not-found"` if the user doesn't exist and JIT provisioning is disabled
   * @throws {StigmerError} with code `"failed-precondition"` if the client secret has expired
   * @throws {StigmerError} with code `"permission-denied"` if the request origin is not in allowed_origins
   */
  async mintUserToken(input: MintUserTokenInput): Promise<MintUserTokenResult> {
    if (!input.userId) {
      throw new StigmerError(
        "invalid-argument",
        "mintUserToken: userId is required — this is the platform's stable identifier for the user",
        3,
      );
    }

    try {
      const response = await this.tokenClient.mintUserToken(
        create(MintUserTokenRequestSchema, {
          clientId: this.clientId,
          clientSecret: this.clientSecret,
          userId: input.userId,
          userEmail: input.userEmail ?? "",
          userName: input.userName ?? "",
          orgId: input.orgId ?? "",
        }),
      );

      return {
        accessToken: response.accessToken,
        tokenType: response.tokenType,
        expiresIn: response.expiresIn,
        expiresAt: new Date(Date.now() + response.expiresIn * 1000),
      };
    } catch (e) {
      throw wrapError(e);
    }
  }
}

/**
 * Create a PlatformClient token-minting helper for Node.js backends.
 *
 * This is the recommended way to mint Stigmer user JWTs from a platform
 * builder's backend. The returned tokens are passed to the React SDK's
 * `StigmerProvider` via `getAccessToken`.
 *
 * @example
 * ```typescript
 * import { createPlatformClientAuth } from "@stigmer/sdk/node";
 *
 * const auth = createPlatformClientAuth({
 *   baseUrl: "https://api.stigmer.ai",
 *   clientId: process.env.STIGMER_CLIENT_ID!,
 *   clientSecret: process.env.STIGMER_CLIENT_SECRET!,
 * });
 *
 * const { accessToken, expiresAt } = await auth.mintUserToken({
 *   userId: "user-123",
 *   userEmail: "jane@acme.com",
 *   userName: "Jane Doe",
 * });
 * ```
 *
 * @throws {Error} if `baseUrl`, `clientId`, or `clientSecret` is missing or empty
 */
export function createPlatformClientAuth(
  config: PlatformClientAuthConfig,
): PlatformClientAuth {
  if (!config.baseUrl) {
    throw new Error(
      "createPlatformClientAuth: baseUrl is required (e.g., \"https://api.stigmer.ai\")",
    );
  }
  if (!config.clientId) {
    throw new Error(
      "createPlatformClientAuth: clientId is required — find it in the Stigmer Console under IAM > Platform Clients",
    );
  }
  if (!config.clientSecret) {
    throw new Error(
      "createPlatformClientAuth: clientSecret is required — the secret is shown once at creation time. " +
        "If lost, rotate the secret via the Console or CLI",
    );
  }

  return new PlatformClientAuth(config);
}
