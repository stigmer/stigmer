// GitHub broker conformance — the OAuth utility service's error contract
// (Class A).
// Domain: conformance suites.
//
// GitHubService is a platform utility, not a resource domain: it brokers the
// GitHub OAuth dance (authorize-URL construction + code-for-token exchange)
// so the frontend never holds the client credentials. What is asserted here
// is exactly the arm that is TRUE and hermetic on every edition: malformed
// requests answer InvalidArgument from protovalidate at the transport
// boundary, before any config or network concern.
//
// The broker's other arms are deliberately NOT asserted, each for a
// discovered, recorded reason:
//
//   - "Config-missing FailedPrecondition" is STRUCTURALLY UNREACHABLE on the
//     OSS server: it ships with the bundled "Stigmer Local" OAuth App
//     credentials hardcoded as defaults (config.go — the GitHub CLI pattern;
//     a localhost-only app's secret has negligible value), and the env
//     override treats an empty value as unset, so no configuration can blank
//     them. The guard is live only on the cloud edition, whose config
//     defaults to empty. The editions legitimately diverge here — the
//     cross-edition disposition of this arm is an owner decision recorded in
//     the sp.conformance-wave-1 sub-project, not silently encoded by this
//     suite.
//   - The exchange happy path and its Unavailable / GitHub-rejection arms
//     dial github.com FOR REAL on a configured broker — and the OSS broker
//     is always configured (above). A conformance run must never leave the
//     host, so those arms stay pinned in the Go controller unit tests.
//   - The authorize-URL happy path is hermetic (pure URL construction), but
//     asserting it unconditionally would fail on an unconfigured cloud
//     environment; it rides the same owner decision as the config-missing
//     arm.
import { Code } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
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

const VALID_REDIRECT = "https://app.example.com/oauth/callback";

describe("GitHub broker conformance — request validation (Layer 1, before config or network)", () => {
  it("getOAuthAuthorizeUrl rejects an empty redirect_uri with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.github.getOAuthAuthorizeUrl({ redirectUri: "" }),
      Code.InvalidArgument,
      "getOAuthAuthorizeUrl empty redirect_uri",
    ));

  it("exchangeOAuthCode rejects each missing required field with InvalidArgument", async () => {
    await expectGrpcCode(
      () => clients.github.exchangeOAuthCode({ code: "", state: "s", redirectUri: VALID_REDIRECT }),
      Code.InvalidArgument,
      "exchangeOAuthCode empty code",
    );
    await expectGrpcCode(
      () => clients.github.exchangeOAuthCode({ code: "c", state: "", redirectUri: VALID_REDIRECT }),
      Code.InvalidArgument,
      "exchangeOAuthCode empty state",
    );
    await expectGrpcCode(
      () => clients.github.exchangeOAuthCode({ code: "c", state: "s", redirectUri: "" }),
      Code.InvalidArgument,
      "exchangeOAuthCode empty redirect_uri",
    );
  });
});
