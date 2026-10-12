/**
 * Pins the federated lane's userinfo client:
 *   - the endpoint is dialed exactly as the IdentityProvider row states it
 *     (the full OIDC UserInfo URL, never a base with `/userinfo` appended —
 *     the append this client once made turned every documented endpoint
 *     into `.../userinfo/userinfo`), with the caller's token as Bearer;
 *   - the four profile claims are read as the server library's client reads them,
 *     a missing or non-string claim being the empty string;
 *   - a non-2xx answer throws for the lane to map;
 *   - over the egress-guarded fetch, a private destination is refused
 *     before any request leaves;
 *   - every call carries an abort signal, so an endpoint that never
 *     answers cannot hold a sign-in open (the bound is
 *     AbortSignal.timeout; the test asserts the signal, never a wall-clock
 *     wait).
 */
import {
  EgressError,
  guardedFetch,
  type OutboundFetch,
} from "@stigmer/outbound/egress";
import { strictEgressPolicy } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { newUserInfoClient } from "../userinfo.js";

const ENDPOINT = "https://idp.acme.test/userinfo";

interface Dial {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function answering(response: () => Response): {
  readonly fetchImpl: OutboundFetch;
  readonly dials: Dial[];
} {
  const dials: Dial[] = [];
  return {
    fetchImpl: (url, init) => {
      dials.push({ url: String(url), init });
      return Promise.resolve(response());
    },
    dials,
  };
}

describe("newUserInfoClient", () => {
  it("dials the endpoint as stored, with the caller's token, and reads the profile claims", async () => {
    const underlying = answering(
      () =>
        new Response(
          JSON.stringify({
            email: "ada@acme.test",
            given_name: "Ada",
            family_name: "Lovelace",
            picture: 42,
          }),
        ),
    );
    const profile = await newUserInfoClient(underlying.fetchImpl).fetchUserProfile(
      ENDPOINT,
      "access-token",
    );

    expect(profile).toEqual({
      email: "ada@acme.test",
      firstName: "Ada",
      lastName: "Lovelace",
      pictureUrl: "",
    });
    expect(underlying.dials.map((dial) => dial.url)).toEqual([ENDPOINT]);
    expect(new Headers(underlying.dials[0]?.init?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
    expect(underlying.dials[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a non-2xx answer", async () => {
    const underlying = answering(() => new Response("nope", { status: 401 }));
    await expect(
      newUserInfoClient(underlying.fetchImpl).fetchUserProfile(ENDPOINT, "t"),
    ).rejects.toThrow("userinfo answered 401");
  });

  it("refuses a private destination over the egress-guarded fetch, before any request leaves", async () => {
    const underlying = answering(() => new Response("{}"));
    const client = newUserInfoClient(
      guardedFetch(strictEgressPolicy(), {
        fetchImpl: underlying.fetchImpl,
        lookup: () => Promise.resolve(["10.0.0.5"]),
      }),
    );
    await expect(client.fetchUserProfile(ENDPOINT, "t")).rejects.toBeInstanceOf(
      EgressError,
    );
    expect(underlying.dials).toEqual([]);
  });
});
