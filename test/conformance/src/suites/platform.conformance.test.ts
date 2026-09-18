// Platform conformance — server identity and runner bootstrap (Class A).
// Domain: conformance suites.
//
// PlatformQueryController is not a resource domain: it is the server's
// self-description surface. getServerInfo is what clients call on startup to
// learn the edition and version instead of guessing from the URL, and
// getRunnerBootstrapConfig is the one authenticated door an embedded runner
// self-bootstraps through. The contract asserted here is the response SHAPE
// both editions must honor:
//
//   - getServerInfo names a real edition (never unspecified) and a non-empty
//     version.
//   - getRunnerBootstrapConfig always carries reachable Temporal coordinates,
//     and its token/key fields follow the PRESENCE-BASED contract: an empty
//     token means "not minted" (OSS has no Cursor proxy; a cloud server may
//     lack a signing key), and the companion fields (token_type,
//     expires_in_seconds, key ids) are present exactly when their principal
//     is — never half-populated. Clients branch on presence, so a
//     half-populated response is a broken contract even when every field is
//     individually well-formed.
//   - getLicenseStatus answers on every edition and follows the same
//     presence contract: the state names what the server holds, claims are
//     present exactly when a ticket verified, key_id exactly when a ticket
//     was presented, checked_at always. Every target here answers `absent`
//     (open source and the cloud hold no key); an Enterprise target with a
//     configured ticket would answer from it, and that assertion arrives
//     with the edition that serves it.
//
// getRunnerScopedToken is deliberately NOT covered here: its arms are gated
// on runner-class credentials (embedded_runner / pool_sandbox / sandbox
// token types) that only exist mid-execution, so it belongs to the
// execution-lifecycle slice.
import { LicenseState } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterAll(async () => {
  await target?.teardown();
});

describe("Platform conformance — getServerInfo", () => {
  it("names exactly the edition the target's composition declares, and a non-empty version", async () => {
    const info = await clients.platformQuery.getServerInfo({});

    expect(
      info.edition,
      "edition is the deployment-mode signal clients branch on — unspecified is a broken server",
    ).not.toBe(ServerEdition.server_edition_unspecified);
    // Equality, not membership: a composition that lost its edition
    // declaration falls back to oss, which a set check would still admit.
    expect(
      info.edition,
      `the ${target.name} target serves ${ServerEdition[target.edition]}`,
    ).toBe(target.edition);
    expect(info.version, "version must identify the build").not.toBe("");
  });

  it("is stable across calls — server identity does not drift within a run", async () => {
    const first = await clients.platformQuery.getServerInfo({});
    const second = await clients.platformQuery.getServerInfo({});

    expect(second.edition).toBe(first.edition);
    expect(second.version).toBe(first.version);
  });
});

describe("Platform conformance — getLicenseStatus", () => {
  it("answers absent with no claims, no key and a checked_at — the presence contract of a keyless server", async () => {
    const status = await clients.platformQuery.getLicenseStatus({});

    expect(
      status.state,
      "unspecified is a broken server; a target that holds no key answers absent",
    ).toBe(LicenseState.absent);
    // Presence follows the state: absent means nothing was presented, so
    // there is no key to name and no claims to report.
    expect(status.claims, "absent carries no claims").toBeUndefined();
    expect(status.keyId, "absent names no key").toBe("");
    expect(status.checkedAt, "checked_at is always set").toBeDefined();
  });
});

describe("Platform conformance — getRunnerBootstrapConfig", () => {
  it("carries Temporal coordinates and presence-consistent token fields", async () => {
    const config = await clients.platformQuery.getRunnerBootstrapConfig({});

    expect(config.temporalAddress, "a runner cannot bootstrap without an address").not.toBe("");
    expect(config.temporalAddress, "address is host:port").toMatch(/^.+:\d+$/);
    expect(config.temporalNamespace, "a runner cannot bootstrap without a namespace").not.toBe("");

    // The presence-based token contract: all-or-nothing, never half-populated.
    if (config.runnerAccessToken === "") {
      expect(config.tokenType, "no token means no token_type").toBe("");
      expect(
        config.runnerAccessTokenExpiresInSeconds,
        "no token means no expiry countdown",
      ).toBe(0);
    } else {
      expect(config.tokenType, "a minted token is a Bearer token").toBe("Bearer");
      expect(
        config.runnerAccessTokenExpiresInSeconds,
        "a minted token carries its lifetime",
      ).toBeGreaterThan(0);
    }

    // The payload-encryption key pairs follow the same presence coupling.
    expect(
      config.payloadEncryptionKeyId === "",
      "key id is present exactly when the key is",
    ).toBe(config.payloadEncryptionKey === "");
    expect(
      config.payloadEncryptionSecondaryKeyId === "",
      "secondary key id is present exactly when the secondary key is",
    ).toBe(config.payloadEncryptionSecondaryKey === "");
  });
});
