import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  ExchangeOAuthCodeRequestSchema,
  GetOAuthAuthorizeUrlRequestSchema,
  GitHubService,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";
import { wrapError } from "./gen/errors.js";

/** Parameters for getting the OAuth authorize URL. */
export interface GetOAuthAuthorizeUrlParams {
  readonly redirectUri: string;
}

/** Response containing the OAuth authorize URL and state. */
export interface OAuthAuthorizeUrlResponse {
  readonly authorizeUrl: string;
  readonly state: string;
}

/** Parameters for exchanging an OAuth authorization code. */
export interface ExchangeOAuthCodeParams {
  readonly code: string;
  readonly state: string;
  readonly redirectUri: string;
}

/** Response containing the exchanged access token. */
export interface OAuthTokenResponse {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly scope: string;
}

/**
 * Client for GitHub OAuth integration.
 *
 * Provides methods to initiate the OAuth flow (get authorize URL) and
 * exchange the authorization code for an access token. The access token
 * is returned to the caller — the backend never persists it.
 */
export class GitHubClient {
  private readonly github: Client<typeof GitHubService>;

  constructor(transport: Transport) {
    this.github = createClient(GitHubService, transport);
  }

  /** Get the GitHub OAuth authorize URL to redirect the user to. */
  async getOAuthAuthorizeUrl(
    params: GetOAuthAuthorizeUrlParams,
  ): Promise<OAuthAuthorizeUrlResponse> {
    try {
      const resp = await this.github.getOAuthAuthorizeUrl(
        create(GetOAuthAuthorizeUrlRequestSchema, {
          redirectUri: params.redirectUri,
        }),
      );
      return {
        authorizeUrl: resp.authorizeUrl,
        state: resp.state,
      };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Exchange an OAuth authorization code for an access token. */
  async exchangeOAuthCode(
    params: ExchangeOAuthCodeParams,
  ): Promise<OAuthTokenResponse> {
    try {
      const resp = await this.github.exchangeOAuthCode(
        create(ExchangeOAuthCodeRequestSchema, {
          code: params.code,
          state: params.state,
          redirectUri: params.redirectUri,
        }),
      );
      return {
        accessToken: resp.accessToken,
        tokenType: resp.tokenType,
        scope: resp.scope,
      };
    } catch (e) {
      throw wrapError(e);
    }
  }
}
