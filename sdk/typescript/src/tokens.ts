/**
 * The token service's client: mint a short-lived user token for a person
 * signed in to your product, from your product's backend.
 *
 * Minting is one call on the ordinary client built with a service
 * account's API key, the way a payments or messaging platform lets a
 * backend act with its server key. The account must be an admin of the
 * organization the token is for, or of its parent organization (a
 * parent's admins are admins in each of its children); a person's key is
 * refused. Pass the returned `accessToken` to the React
 * SDK's `StigmerProvider` through `getAccessToken`.
 *
 * The organization's embedding settings decide whether a first sign-in
 * creates the person's account and with which role, and which web pages
 * may use the token. The token lives until it expires, or until the
 * service account that minted it is deleted.
 */
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  MintUserTokenRequestSchema,
  TokenService,
} from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";
import { StigmerError, wrapError } from "./gen/errors.js";

/** The person a user token is for. */
export interface MintUserTokenInput {
  /**
   * The organization the token is for, by id or slug: the minting service
   * account's organization, or one of its child organizations.
   */
  readonly org: string;
  /** Your product's stable identifier for the person. */
  readonly userId: string;
  /** The person's email address, used when their account is created. */
  readonly userEmail?: string;
  /** The person's display name, used when their account is created. */
  readonly userName?: string;
}

/** A minted user token. */
export interface MintUserTokenResult {
  /** The token a browser sends as its Bearer credential. */
  readonly accessToken: string;
  /** Token type. Always "Bearer". */
  readonly tokenType: string;
  /** Token lifetime in seconds from issuance. */
  readonly expiresIn: number;
  /** Absolute expiration time, computed from `expiresIn` at call time. */
  readonly expiresAt: Date;
}

/**
 * Mints user tokens with the client's service-account key.
 *
 * @example
 * ```typescript
 * import { createNodeClient } from "@stigmer/sdk/node";
 *
 * const stigmer = createNodeClient({
 *   baseUrl: "https://api.stigmer.ai",
 *   apiKey: process.env.STIGMER_API_KEY!,
 * });
 *
 * // In your /api/stigmer-token endpoint handler:
 * const { accessToken, expiresAt } = await stigmer.tokens.mintUserToken({
 *   org: "acme",
 *   userId: req.user.id,
 *   userEmail: req.user.email,
 *   userName: req.user.name,
 * });
 * ```
 */
export class TokenClient {
  private readonly tokens: Client<typeof TokenService>;

  constructor(transport: Transport) {
    this.tokens = createClient(TokenService, transport);
  }

  /**
   * Mint a user token for a person signed in to your product.
   *
   * @throws {StigmerError} `"invalid-argument"` when `org` or `userId` is empty
   * @throws {StigmerError} `"permission-denied"` when the client's key is not
   *   an admin service account's for the organization
   * @throws {StigmerError} `"failed-precondition"` when the person has no
   *   account and the organization's embedding settings do not create one
   */
  async mintUserToken(input: MintUserTokenInput): Promise<MintUserTokenResult> {
    if (!input.org) {
      throw new StigmerError(
        "invalid-argument",
        "mintUserToken: org is required — the organization the token is for, by id or slug",
        3,
      );
    }
    if (!input.userId) {
      throw new StigmerError(
        "invalid-argument",
        "mintUserToken: userId is required — your product's stable identifier for the person",
        3,
      );
    }
    try {
      const response = await this.tokens.mintUserToken(
        create(MintUserTokenRequestSchema, {
          org: input.org,
          userId: input.userId,
          userEmail: input.userEmail ?? "",
          userName: input.userName ?? "",
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
