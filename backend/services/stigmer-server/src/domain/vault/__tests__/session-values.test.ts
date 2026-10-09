/**
 * Pins a conversation's own values (SessionSpec.secrets, .connections and a
 * repository's token): sealed on every write, shown as the marker on every
 * read, kept when a writer sends the marker back (the runner rewrites the
 * whole session after each turn), refused when the marker has nothing
 * behind it or a value is shaped like server ciphertext; connection
 * addresses normalized, two that are one address refused; a repository
 * token refused on any repository that is not an https://github.com URL;
 * only the values a write drops destroyed (a replaced
 * value keeps its backing state); and opened in plaintext for the run
 * resolver alone. A stale write's arms run through the composed session
 * chain in session-values-composed.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { SecretCodec } from "../../../encryption/codec.js";
import { REDACTED_MARKER, SecretService } from "../../../encryption/encryption.js";
import type { EncryptionScope } from "../../../encryption/encryption.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  newDestroyDroppedSessionValuesStep,
  newPreserveSessionValuesStep,
  newSealSessionValuesStep,
  openSessionValues,
  redactSessionValues,
  repositoryTokenKey,
  sealedValuesOfSession,
} from "../session-values.js";

const logger = createLogger({ level: "error", pretty: false, write: () => {} });

/** A codec whose sealed values are recognisable and whose destroys are recorded. */
class RecordingCodec implements SecretCodec {
  readonly version = "v9";
  readonly deleted: string[] = [];
  async encrypt(plaintext: string, _scope: EncryptionScope): Promise<string> {
    return `enc:v9:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }
  async decrypt(encrypted: string): Promise<string> {
    return Buffer.from(encrypted.slice("enc:v9:".length), "base64").toString("utf8");
  }
  async delete(storedValue: string): Promise<void> {
    this.deleted.push(storedValue);
  }
}

function fixture() {
  const codec = new RecordingCodec();
  const secrets = SecretService.withCodecs({
    codecs: new Map<string, SecretCodec>([["v9", codec]]),
    writeVersion: "v9",
  });
  return { codec, secrets };
}

function session(spec: Record<string, unknown>): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_values", org: "acme" },
    spec,
  });
}

function ctxOf(next: Session, existing?: Session) {
  const ctx = new RequestContext(
    SessionSchema,
    next,
    testCallerIdentity(),
    ApiResourceKind.session,
  );
  if (existing !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, existing);
  }
  return ctx;
}

const REPO = {
  name: "app",
  source: {
    source: {
      case: "gitRepo" as const,
      value: { url: "https://github.com/acme/app", token: "repo-token" },
    },
  },
};

async function written(next: Session, existing?: Session) {
  const { codec, secrets } = fixture();
  const ctx = ctxOf(next, existing);
  await newPreserveSessionValuesStep().execute(ctx);
  await newSealSessionValuesStep(secrets, logger).execute(ctx);
  return { ctx, codec, secrets };
}

describe("writing a session's own values", () => {
  it("seals every value, repository tokens included, and normalizes connection addresses", async () => {
    const { ctx, secrets } = await written(
      session({
        secrets: { API_KEY: "sk-1" },
        connections: { "https://MCP.Example.com/mcp/": "tok" },
        workspaceEntries: [REPO],
      }),
    );
    const spec = ctx.newState.spec!;
    expect(spec.secrets["API_KEY"]).toMatch(/^enc:v9:/);
    expect(Object.keys(spec.connections)).toEqual(["https://mcp.example.com/mcp"]);
    expect(spec.connections["https://mcp.example.com/mcp"]).toMatch(/^enc:v9:/);
    const repo = spec.workspaceEntries[0]!.source!.source;
    expect(repo.case === "gitRepo" ? repo.value.token : "").toMatch(/^enc:v9:/);
    const opened = await openSessionValues(secrets, ctx.newState);
    expect(opened.secrets.get("API_KEY")).toBe("sk-1");
    expect(await opened.connections.get("https://mcp.example.com/mcp")?.open()).toBe("tok");
    expect(
      await opened.repositoryTokens.get(repositoryTokenKey("app", "https://github.com/acme/app"))?.open(),
    ).toBe("repo-token");
  });

  it("opens a repository's token under its name and URL together: a same-named repository elsewhere has its own", async () => {
    const elsewhere = {
      name: "app",
      source: {
        source: {
          case: "gitRepo" as const,
          value: { url: "https://gitlab.example.com/acme/app", token: "gitlab-pat" },
        },
      },
    };
    const { secrets } = fixture();
    const opened = await openSessionValues(
      secrets,
      session({ workspaceEntries: [elsewhere] }),
    );
    expect(opened.repositoryTokens.get(repositoryTokenKey("app", "https://github.com/acme/app"))).toBeUndefined();
    expect(
      await opened.repositoryTokens.get(repositoryTokenKey("app", "https://gitlab.example.com/acme/app"))?.open(),
    ).toBe("gitlab-pat");
  });

  it("refuses workspace entries that repeat a name, naming it", async () => {
    const folder = { name: "app", source: { source: { case: "localPath" as const, value: { path: "/w" } } } };
    const failure = await written(session({ workspaceEntries: [REPO, folder] })).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    expect((failure as ConnectError).rawMessage).toContain("'app'");
  });

  it("keeps the stored value behind a marker a writer sends back", async () => {
    const first = await written(session({ secrets: { API_KEY: "sk-1" } }));
    const stored = first.ctx.newState;
    const sealed = stored.spec!.secrets["API_KEY"]!;

    const echoed = session({ secrets: { API_KEY: REDACTED_MARKER } });
    const second = await written(echoed, stored);
    expect(second.ctx.newState.spec!.secrets["API_KEY"]).toBe(sealed);
  });

  it("refuses a marker with nothing stored behind it, and a ciphertext-shaped value", async () => {
    for (const next of [
      session({ secrets: { API_KEY: REDACTED_MARKER } }),
      session({ secrets: { API_KEY: "enc:v9:Zm9yZ2Vk" } }),
    ]) {
      const failure = await written(next).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ConnectError);
      expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });

  it("refuses a connection whose address breaks the address rule", async () => {
    const failure = await written(
      session({ connections: { "ftp://files.example.com": "tok" } }),
    ).catch((e: unknown) => e);
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
  });

  it("refuses two connections whose addresses are one address, naming neither token", async () => {
    const failure = await written(
      session({
        connections: {
          "https://MCP.Example.com/mcp": "first-TOKEN",
          "https://mcp.example.com/mcp/": "second-TOKEN",
        },
      }),
    ).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    expect((failure as ConnectError).rawMessage).toContain("the same address");
    expect((failure as ConnectError).rawMessage).not.toContain("TOKEN");
  });

  it("refuses a repository token on any repository that is not an https://github.com URL: nothing else is cloned with it", async () => {
    for (const url of [
      "https://gitlab.example.com/acme/app",
      "http://github.com/acme/app",
      "ssh://git@github.com/acme/app.git",
      "https://github.com:8443/acme/app",
    ]) {
      const elsewhere = {
        name: "app",
        source: { source: { case: "gitRepo" as const, value: { url, token: "repo-TOKEN" } } },
      };
      const failure = await written(session({ workspaceEntries: [elsewhere] })).catch(
        (e: unknown) => e,
      );
      expect(failure, url).toBeInstanceOf(ConnectError);
      expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
      expect((failure as ConnectError).rawMessage).toBe(
        "a repository token is used only for https://github.com repositories (repository 'app')",
      );
    }
    const tokenless = {
      name: "app",
      source: {
        source: {
          case: "gitRepo" as const,
          value: { url: "https://gitlab.example.com/acme/app", token: "" },
        },
      },
    };
    await expect(written(session({ workspaceEntries: [tokenless] }))).resolves.toBeDefined();
  });

  it("never repeats a refused address, which may be a pasted credential", async () => {
    for (const address of ["https://user:S3CRET-TOKEN@mcp.example.com/x", "ghp_S3CRET-TOKEN"]) {
      const failure = await written(session({ connections: { [address]: "tok" } })).catch(
        (e: unknown) => e,
      );
      expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
      expect((failure as ConnectError).rawMessage).not.toContain("S3CRET-TOKEN");
      expect((failure as ConnectError).rawMessage).toContain("connection");
    }
  });

  it("keeps a marker to the stored value of its own kind: a connection never takes a secret's", async () => {
    const first = await written(session({ secrets: { "github.com": "a-secret" } }));
    const failure = await written(
      session({ secrets: { "github.com": REDACTED_MARKER }, connections: { "github.com": REDACTED_MARKER } }),
      first.ctx.newState,
    ).catch((e: unknown) => e);
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    expect((failure as ConnectError).rawMessage).toContain("connection 'github.com'");
  });

  it("keeps a repository's stored token only for the same repository: a marker with a new URL is refused", async () => {
    const first = await written(session({ workspaceEntries: [REPO] }));
    const moved = {
      name: "app",
      source: {
        source: {
          case: "gitRepo" as const,
          value: { url: "https://github.com/attacker/app", token: REDACTED_MARKER },
        },
      },
    };
    const failure = await written(session({ workspaceEntries: [moved] }), first.ctx.newState).catch(
      (e: unknown) => e,
    );
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    const kept = await written(
      session({
        workspaceEntries: [
          { ...REPO, source: { source: { ...REPO.source.source, value: { ...REPO.source.source.value, token: REDACTED_MARKER } } } },
        ],
      }),
      first.ctx.newState,
    );
    const repo = kept.ctx.newState.spec!.workspaceEntries[0]!.source!.source;
    expect(repo.case === "gitRepo" ? repo.value.token : "").toMatch(/^enc:v9:/);
  });

  // `__proto__` cannot reach the step: the request context's copy of the
  // message drops it. The vault service's own test pins it.
  it.each(["constructor", "prototype"])(
    "refuses a secret named %j",
    async (name) => {
      const next = session({});
      // An own entry of that name, as a decoder that kept it would leave it.
      Object.defineProperty(next.spec!.secrets, name, {
        value: "x",
        enumerable: true,
        configurable: true,
        writable: true,
      });
      const failure = await written(next).catch((e: unknown) => e);
      expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
      expect((failure as ConnectError).rawMessage).toContain(name);
    },
  );
});

describe("reading and dropping", () => {
  it("a read shows the marker for every value, an empty one untouched", () => {
    const shown = session({
      secrets: { API_KEY: "enc:v9:x", EMPTY: "" },
      connections: { "github.com": "enc:v9:y" },
      workspaceEntries: [REPO],
    });
    redactSessionValues(shown);
    expect(shown.spec!.secrets).toEqual({ API_KEY: REDACTED_MARKER, EMPTY: "" });
    expect(shown.spec!.connections["github.com"]).toBe(REDACTED_MARKER);
    const repo = shown.spec!.workspaceEntries[0]!.source!.source;
    expect(repo.case === "gitRepo" ? repo.value.token : "").toBe(REDACTED_MARKER);
  });

  it("an update destroys only the values it drops; a replaced value keeps its backing state", async () => {
    const first = await written(
      session({ secrets: { DROPPED: "a", REPLACED: "b", KEPT: "c" } }),
    );
    const stored = first.ctx.newState;
    const { codec, secrets } = fixture();
    const ctx = ctxOf(
      session({ secrets: { REPLACED: "b2", KEPT: REDACTED_MARKER } }),
      stored,
    );
    await newPreserveSessionValuesStep().execute(ctx);
    await newSealSessionValuesStep(secrets, logger).execute(ctx);
    await newDestroyDroppedSessionValuesStep(secrets, logger).execute(ctx);
    expect(codec.deleted).toEqual([stored.spec!.secrets["DROPPED"]]);
  });

  it("the delete chain's extractor names every sealed value", async () => {
    const { ctx } = await written(
      session({
        secrets: { ONE: "1" },
        connections: { "github.com": "t" },
        workspaceEntries: [REPO],
      }),
    );
    expect(sealedValuesOfSession(ctx.newState)).toHaveLength(3);
  });
});

describe("edges", () => {
  it("leaves a session with no spec alone", () => {
    const ctx = ctxOf(create(SessionSchema, { metadata: { id: "ses_bare", org: "acme" } }));
    newPreserveSessionValuesStep().execute(ctx);
    expect(ctx.newState.spec).toBeUndefined();
  });

  it("only a git repository with its own token is a value; a local folder and a tokenless clone are not", () => {
    const values = sealedValuesOfSession(
      session({
        workspaceEntries: [
          { name: "folder", source: { source: { case: "localPath", value: { path: "/w" } } } },
          { name: "public", source: { source: { case: "gitRepo", value: { url: "https://github.com/a/b" } } } },
        ],
      }),
    );
    expect(values).toEqual([]);
  });

  it("keeps plaintext, with a warning, where no key can seal", async () => {
    const warnings: string[] = [];
    const keyless = SecretService.withCodecs({
      codecs: new Map<string, SecretCodec>([
        ["v9", Object.assign(new RecordingCodec(), { isEnabled: () => false })],
      ]),
      writeVersion: "v9",
    });
    const ctx = ctxOf(session({ secrets: { API_KEY: "plain" } }));
    await newSealSessionValuesStep(keyless, {
      ...logger,
      warn: (message: string) => warnings.push(message),
    } as typeof logger).execute(ctx);
    expect(ctx.newState.spec?.secrets["API_KEY"]).toBe("plain");
    expect(warnings).toEqual(["Encryption disabled: a session's own secrets will be stored in plaintext"]);
  });

  it("answers INTERNAL when a value cannot be sealed", async () => {
    const broken = SecretService.withCodecs({
      codecs: new Map<string, SecretCodec>([
        [
          "v9",
          Object.assign(new RecordingCodec(), {
            encrypt: async () => {
              throw new Error("kms down");
            },
          }),
        ],
      ]),
      writeVersion: "v9",
    });
    const ctx = ctxOf(session({ secrets: { API_KEY: "plain" } }));
    let failure: unknown;
    try {
      await newSealSessionValuesStep(broken, logger).execute(ctx);
    } catch (error) {
      failure = error;
    }
    expect((failure as ConnectError).code).toBe(Code.Internal);
  });
});
