/**
 * Pins TokenService's guest arm (../controller.ts) over an in-memory router:
 *
 *   - with no guest-token capability composed, mintGuestToken answers
 *     UNIMPLEMENTED with the edition sentence;
 *   - with one, the request and its headers reach the capability, and its
 *     answer is the RPC's.
 *
 * The user-token arm is the composed suite's (user-token.composed.test.ts).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  MintGuestTokenResponseSchema,
  TokenService,
} from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";
import type { MintGuestTokenRequest } from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";

import type { GuestTokenMinting } from "../../../extensions/guest-token-minting.js";
import { GUEST_MINT_UNIMPLEMENTED_MESSAGE } from "../constants.js";
import { registerTokenService } from "../controller.js";
import type { UserTokenMintDeps } from "../mint.js";

function client(guestTokenMinting: GuestTokenMinting | undefined) {
  return createClient(
    TokenService,
    createRouterTransport((router) =>
      registerTokenService(router, {
        mint: {} as UserTokenMintDeps,
        guestTokenMinting,
      }),
    ),
  );
}

describe("TokenService.mintGuestToken", () => {
  it("answers UNIMPLEMENTED with the edition sentence when no capability is composed", async () => {
    const refused = await client(undefined)
      .mintGuestToken({ channelId: "share-1" })
      .then(
        () => undefined,
        (error: unknown) => ConnectError.from(error),
      );
    expect([refused?.code, refused?.rawMessage]).toEqual([
      Code.Unimplemented,
      GUEST_MINT_UNIMPLEMENTED_MESSAGE,
    ]);
  });

  it("hands the request and its headers to the composed capability, and answers its token", async () => {
    const seen: { request?: MintGuestTokenRequest; origin?: string | null } = {};
    const minting: GuestTokenMinting = {
      mintGuestToken: (request, headers) => {
        seen.request = request;
        seen.origin = headers.get("origin");
        return Promise.resolve(
          create(MintGuestTokenResponseSchema, {
            accessToken: "guest-jwt",
            tokenType: "Bearer",
            expiresIn: 900,
            guestCookieId: "cookie-1",
          }),
        );
      },
    };
    const answered = await client(minting).mintGuestToken(
      { channelId: "share-1", guestCookieId: "cookie-1" },
      { headers: { origin: "https://app.example" } },
    );
    expect(seen.request?.channelId).toBe("share-1");
    expect(seen.origin).toBe("https://app.example");
    expect([answered.accessToken, answered.guestCookieId]).toEqual(["guest-jwt", "cookie-1"]);
  });
});
