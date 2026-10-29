/**
 * Pins PlatformClient.getServerInfo's edition-to-mode mapping: the client
 * reports the server's edition through the one converter
 * (`deploymentModeOf`), so a third edition on the wire reaches consumers
 * as its own mode and never collapses into "cloud" by accident. The raw
 * edition rides beside it for callers that want the wire value.
 *
 * Also pins the authentication posture across the wire: a server's `true`
 * and `false` reach callers as they were sent, and a server that does not
 * send the field answers `undefined`, never `false` — the difference between
 * "this server trusts every request" and "this server did not say", which
 * a console released apart from its server must not confuse. The
 * single-organization answer crosses the same way: `true` (fill-on, hide
 * organizations), `false`, and `undefined` from a server that does not send
 * it. So does what an Environment does there: each of its three answers as
 * sent, and `undefined` from a server that does not send the field.
 *
 * getModelReadiness sends the organization and the model to judge as asked,
 * returns the server's answer as it came, and wraps a refusal in the
 * client's own error.
 */
import { describe, expect, it } from "vitest";
import { createRouterTransport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";

import { Code, ConnectError } from "@connectrpc/connect";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  GetModelReadinessOutputSchema,
  ProviderAvailability,
  type GetModelReadinessInput,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";

import { StigmerError } from "../gen/errors";
import { PlatformClient } from "../platform";

function clientAnswering(
  edition: ServerEdition,
  authenticationRequired?: boolean,
  singleOrg?: boolean,
  environments?: { applies: boolean; limitedNetworking: boolean; packages: boolean },
): PlatformClient {
  return new PlatformClient(
    createRouterTransport(({ service }) => {
      service(PlatformQueryController, {
        getServerInfo: () =>
          create(GetServerInfoOutputSchema, {
            edition,
            version: "1.2.3",
            ...(authenticationRequired !== undefined
              ? { authenticationRequired }
              : {}),
            ...(singleOrg !== undefined ? { singleOrg } : {}),
            ...(environments !== undefined ? { environments } : {}),
          }),
      });
    }),
  );
}

describe("PlatformClient.getServerInfo", () => {
  it.each([
    [ServerEdition.oss, "local"],
    [ServerEdition.enterprise, "enterprise"],
    [ServerEdition.cloud, "cloud"],
  ] as const)(
    "maps edition %d to deploymentMode %s and keeps the raw edition",
    async (edition, mode) => {
      const info = await clientAnswering(edition).getServerInfo();
      expect(info.deploymentMode).toBe(mode);
      expect(info.edition).toBe(edition);
      expect(info.version).toBe("1.2.3");
    },
  );

  it.each([
    [true, true],
    [false, false],
    [undefined, undefined],
  ] as const)(
    "reports a server's authentication posture of %s as %s",
    async (sent, reported) => {
      const info = await clientAnswering(
        ServerEdition.cloud,
        sent,
      ).getServerInfo();
      expect(info.authenticationRequired).toBe(reported);
    },
  );

  it.each([
    [true, true],
    [false, false],
    [undefined, undefined],
  ] as const)(
    "reports a server's single-organization answer of %s as %s",
    async (sent, reported) => {
      const info = await clientAnswering(
        ServerEdition.oss,
        false,
        sent,
      ).getServerInfo();
      expect(info.singleOrg).toBe(reported);
    },
  );

  it.each([
    { applies: true, limitedNetworking: true, packages: true },
    { applies: true, limitedNetworking: false, packages: true },
    { applies: false, limitedNetworking: false, packages: false },
  ])("reports what an Environment does there as sent: %o", async (sent) => {
    const info = await clientAnswering(ServerEdition.oss, false, true, sent).getServerInfo();
    expect(info.environments).toEqual(sent);
  });

  it("reports environments as undefined from a server that predates the field", async () => {
    const info = await clientAnswering(ServerEdition.cloud, false, false).getServerInfo();
    expect(info.environments).toBeUndefined();
  });
});

describe("PlatformClient.getModelReadiness", () => {
  function readinessClient(answer: (input: GetModelReadinessInput) => Promise<unknown>): PlatformClient {
    return new PlatformClient(
      createRouterTransport(({ service }) => {
        service(PlatformQueryController, {
          getModelReadiness: async (input) => {
            await answer(input);
            return create(GetModelReadinessOutputSchema, {
              providers: [{ provider: "anthropic", availability: ProviderAvailability.served_by_runners }],
              judged:
                input.model === undefined
                  ? undefined
                  : { harness: input.model.harness, model: input.model.model, provider: "openai" },
            });
          },
        });
      }),
    );
  }

  it("sends the organization, and the model to judge only when one is named", async () => {
    const sent: GetModelReadinessInput[] = [];
    const client = readinessClient(async (input) => sent.push(input));
    const plain = await client.getModelReadiness("org_acme");
    const judged = await client.getModelReadiness("org_acme", { harness: Harness.STIGMER, model: "openai:house" });
    expect(sent.map((input) => [input.org, input.model?.model])).toEqual([
      ["org_acme", undefined],
      ["org_acme", "openai:house"],
    ]);
    expect(plain.providers[0]?.availability).toBe(ProviderAvailability.served_by_runners);
    expect(judged.judged?.provider).toBe("openai");
  });

  it("wraps a refusal in the client's own error", async () => {
    const client = readinessClient(() => Promise.reject(new ConnectError("unauthorized", Code.PermissionDenied)));
    await expect(client.getModelReadiness("org_acme")).rejects.toBeInstanceOf(StigmerError);
  });
});
