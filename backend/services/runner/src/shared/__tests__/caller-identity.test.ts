/**
 * Unit tests for the caller identity: the reserved env keys, the
 * precedence chain, the authoritative injection, and the discovery
 * sentinel that keeps identity-templating servers discoverable.
 */

import { describe, it, expect } from "vitest";
import {
  ANONYMOUS_KIND,
  CALLER_IDENTITY_KIND_ENV_KEY,
  CALLER_IDENTITY_VALUE_ENV_KEY,
  SESSION_ID_ENV_KEY,
  STIGMER_USER_KIND,
  SYSTEM_CREATOR_SENTINEL,
  anonymousCallerIdentity,
  injectAnonymousCallerIdentityForDiscovery,
  injectCallerIdentityEnv,
  resolveCallerIdentity,
} from "../caller-identity.js";
import {
  SENDER_IDENTITY_METADATA_KEY,
  SENDER_KIND_METADATA_KEY,
} from "../sender-identity.js";
import { resolveHeaders } from "../placeholder-resolver.js";

describe("reserved env keys", () => {
  it("are pinned verbatim — MCP server specs template these names (contract guard)", () => {
    // These names appear in user-authored McpServer YAML (spec.env
    // declarations and ${...} header templates). Renaming them breaks
    // every deployed server that consumes caller identity.
    expect(CALLER_IDENTITY_KIND_ENV_KEY).toBe("STIGMER_CALLER_IDENTITY_KIND");
    expect(CALLER_IDENTITY_VALUE_ENV_KEY).toBe("STIGMER_CALLER_IDENTITY_VALUE");
    expect(SESSION_ID_ENV_KEY).toBe("STIGMER_SESSION_ID");
  });
});

describe("resolveCallerIdentity precedence", () => {
  const channelMetadata = {
    [SENDER_IDENTITY_METADATA_KEY]: "919800000001",
    [SENDER_KIND_METADATA_KEY]: "whatsapp_phone",
  };

  it("channel sender wins, kind passed through VERBATIM from the broker", () => {
    expect(
      resolveCallerIdentity(channelMetadata, { id: "idacc_1", email: "owner@example.com" }),
    ).toEqual({ kind: "whatsapp_phone", value: "919800000001" });
  });

  it("falls to the session creator (stigmer_user) when no channel sender exists", () => {
    expect(
      resolveCallerIdentity({}, { id: "idacc_1", email: "owner@example.com" }),
    ).toEqual({ kind: STIGMER_USER_KIND, value: "owner@example.com" });
  });

  it("prefers the creator's email over the historically-mixed id field", () => {
    // The audit actor's `id` is sometimes an identity-account id and
    // sometimes an email (per the proto's own @internal note) — email is
    // what humans bind against, so it wins when present.
    expect(resolveCallerIdentity(undefined, { id: "idacc_1", email: "a@b.c" }).value).toBe("a@b.c");
    expect(resolveCallerIdentity(undefined, { id: "idacc_1" }).value).toBe("idacc_1");
  });

  it("falls to anonymous when neither source exists (OSS sparse audit, no metadata)", () => {
    expect(resolveCallerIdentity(undefined, undefined)).toEqual({
      kind: ANONYMOUS_KIND,
      value: "",
    });
    expect(resolveCallerIdentity({}, { id: "  ", email: "" })).toEqual({
      kind: ANONYMOUS_KIND,
      value: "",
    });
  });

  it('the "system" audit placeholder is never a caller — falls to anonymous (contract guard)', () => {
    // The OSS server stamps created_by.id = "system" on every create (no
    // local auth) and the cloud's AuditActorBuilder falls back to the
    // same literal — one string shared by ALL such traffic. Presenting it
    // would let a single MCP binding for "system" grant every one of
    // those sessions, so it must resolve to the anonymous sentinel.
    expect(resolveCallerIdentity(undefined, { id: SYSTEM_CREATOR_SENTINEL })).toEqual({
      kind: ANONYMOUS_KIND,
      value: "",
    });
    expect(resolveCallerIdentity({}, { id: " system ", email: "" })).toEqual({
      kind: ANONYMOUS_KIND,
      value: "",
    });
  });

  it('a real email always wins — an account is never demoted for its id alone', () => {
    // Email-first ordering: the sentinel check only ever sees creators
    // that have no email, so a resolvable principal cannot be demoted.
    expect(
      resolveCallerIdentity(undefined, { id: SYSTEM_CREATOR_SENTINEL, email: "ops@example.com" }),
    ).toEqual({ kind: STIGMER_USER_KIND, value: "ops@example.com" });
  });

  it("a half-present channel identity (value without kind) is NOT a channel sender", () => {
    // readSenderIdentity requires value AND kind; a half-stamped session
    // falls through to the creator rather than fabricating a kind.
    expect(
      resolveCallerIdentity(
        { [SENDER_IDENTITY_METADATA_KEY]: "919800000001" },
        { email: "owner@example.com" },
      ),
    ).toEqual({ kind: STIGMER_USER_KIND, value: "owner@example.com" });
  });
});

describe("injectCallerIdentityEnv", () => {
  const identity = { kind: "whatsapp_phone", value: "919800000001" };

  it("returns a NEW map with the reserved keys set — input never mutated", () => {
    const input = { GRIST_API_KEY: "secret" };
    const result = injectCallerIdentityEnv(input, identity, "sess_1");

    expect(result).toEqual({
      GRIST_API_KEY: "secret",
      [CALLER_IDENTITY_KIND_ENV_KEY]: "whatsapp_phone",
      [CALLER_IDENTITY_VALUE_ENV_KEY]: "919800000001",
      [SESSION_ID_ENV_KEY]: "sess_1",
    });
    expect(input).toEqual({ GRIST_API_KEY: "secret" });
  });

  it("platform values are authoritative — a user env var cannot impersonate a caller", () => {
    const result = injectCallerIdentityEnv(
      { [CALLER_IDENTITY_VALUE_ENV_KEY]: "999999999999" },
      identity,
      "sess_1",
    );
    expect(result[CALLER_IDENTITY_VALUE_ENV_KEY]).toBe("919800000001");
  });

  it("the reserved keys can never hit the unresolved-placeholder silent-skip path", () => {
    // At runtime PlaceholderResolutionError is caught and the server
    // silently dropped from the execution — always-present injection makes
    // that unreachable for these keys, whatever the identity resolved to.
    const env = injectCallerIdentityEnv({}, anonymousCallerIdentity(), "");
    const headers = resolveHeaders(
      {
        "X-Stigmer-Caller-Kind": `\${${CALLER_IDENTITY_KIND_ENV_KEY}}`,
        "X-Stigmer-Caller-Value": `\${${CALLER_IDENTITY_VALUE_ENV_KEY}}`,
      },
      env,
    );
    expect(headers).toEqual({
      "X-Stigmer-Caller-Kind": ANONYMOUS_KIND,
      "X-Stigmer-Caller-Value": "",
    });
  });
});

describe("injectAnonymousCallerIdentityForDiscovery", () => {
  it("resolves declared identity placeholders with the anonymous sentinel", () => {
    // Discovery has no session: without the sentinel, a server templating
    // ${STIGMER_CALLER_IDENTITY_VALUE} would throw
    // PlaceholderResolutionError and never get its tools classified.
    const declared = new Set([
      "GRIST_API_KEY",
      CALLER_IDENTITY_KIND_ENV_KEY,
      CALLER_IDENTITY_VALUE_ENV_KEY,
    ]);
    const env = injectAnonymousCallerIdentityForDiscovery(declared, {
      GRIST_API_KEY: "secret",
    });

    expect(
      resolveHeaders(
        { "X-Stigmer-Caller-Kind": `\${${CALLER_IDENTITY_KIND_ENV_KEY}}` },
        env,
      ),
    ).toEqual({ "X-Stigmer-Caller-Kind": ANONYMOUS_KIND });
    expect(env[CALLER_IDENTITY_VALUE_ENV_KEY]).toBe("");
    expect(env.GRIST_API_KEY).toBe("secret");
  });

  it("is declaration-gated: servers that never declared the keys get an untouched map", () => {
    const input = { OTHER: "x" };
    const result = injectAnonymousCallerIdentityForDiscovery(new Set(["OTHER"]), input);
    expect(result).toBe(input);
    expect(result).not.toHaveProperty(CALLER_IDENTITY_KIND_ENV_KEY);
  });
});
