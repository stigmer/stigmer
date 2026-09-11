/**
 * Pins PlatformClient.getServerInfo's edition-to-mode mapping: the client
 * reports the server's edition through the one converter
 * (`deploymentModeOf`), so a third edition on the wire reaches consumers
 * as its own mode and never collapses into "cloud" by accident. The raw
 * edition rides beside it for callers that want the wire value.
 */
import { describe, expect, it } from "vitest";
import { createRouterTransport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { PlatformClient } from "../platform";

function clientAnswering(edition: ServerEdition): PlatformClient {
  return new PlatformClient(
    createRouterTransport(({ service }) => {
      service(PlatformQueryController, {
        getServerInfo: () =>
          create(GetServerInfoOutputSchema, { edition, version: "1.2.3" }),
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
});
