/**
 * Pins a conversation's own values, which are its repositories' tokens
 * (GitRepoSource.token): sealed on every write, shown as the marker on
 * every read, kept when a writer sends the marker back (the runner
 * rewrites the whole session after each turn), refused when the marker
 * has nothing behind it or a value is shaped like server ciphertext; a
 * token refused on any repository that is not an https://github.com URL;
 * a stored token kept only for the same repository (name and URL); only
 * the tokens a write drops destroyed (a replaced token keeps its backing
 * state); and opened in plaintext for the run resolver alone, under the
 * entry's name and URL. A stale write's arms run through the composed
 * session chain in session-values-composed.test.ts.
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

/** A repository entry; `token` empty for a public clone. */
function repo(name: string, url: string, token: string) {
  return { name, source: { source: { case: "gitRepo" as const, value: { url, token } } } };
}

const REPO = repo("app", "https://github.com/acme/app", "repo-token");

/** The token a stored entry holds, by position. */
function tokenOf(next: Session, index = 0): string {
  const source = next.spec!.workspaceEntries[index]!.source!.source;
  return source.case === "gitRepo" ? source.value.token : "";
}

async function written(next: Session, existing?: Session) {
  const { codec, secrets } = fixture();
  const ctx = ctxOf(next, existing);
  await newPreserveSessionValuesStep().execute(ctx);
  await newSealSessionValuesStep(secrets, logger).execute(ctx);
  return { ctx, codec, secrets };
}

describe("writing a repository's token", () => {
  it("seals every token, opened for the resolver under its entry's name and URL", async () => {
    const { ctx, secrets } = await written(session({ workspaceEntries: [REPO] }));
    expect(tokenOf(ctx.newState)).toMatch(/^enc:v9:/);
    const opened = openSessionValues(secrets, ctx.newState);
    expect(
      await opened.repositoryTokens.get(repositoryTokenKey("app", "https://github.com/acme/app"))?.open(),
    ).toBe("repo-token");
  });

  it("opens a repository's token under its name and URL together: a same-named repository elsewhere has its own", async () => {
    const { secrets } = fixture();
    const opened = openSessionValues(
      secrets,
      session({ workspaceEntries: [repo("app", "https://gitlab.example.com/acme/app", "gitlab-pat")] }),
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

  it("keeps the stored token behind a marker a writer sends back", async () => {
    const first = await written(session({ workspaceEntries: [REPO] }));
    const stored = first.ctx.newState;
    const sealed = tokenOf(stored);

    const echoed = session({
      workspaceEntries: [repo("app", "https://github.com/acme/app", REDACTED_MARKER)],
    });
    const second = await written(echoed, stored);
    expect(tokenOf(second.ctx.newState)).toBe(sealed);
  });

  it("refuses a marker with nothing stored behind it, and a ciphertext-shaped value", async () => {
    for (const token of [REDACTED_MARKER, "enc:v9:Zm9yZ2Vk"]) {
      const failure = await written(
        session({ workspaceEntries: [repo("app", "https://github.com/acme/app", token)] }),
      ).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ConnectError);
      expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
      expect((failure as ConnectError).rawMessage).toContain("repository 'app'");
    }
  });

  it("refuses a repository token on any repository that is not an https://github.com URL: nothing else is cloned with it", async () => {
    for (const url of [
      "https://gitlab.example.com/acme/app",
      "http://github.com/acme/app",
      "ssh://git@github.com/acme/app.git",
      "https://github.com:8443/acme/app",
    ]) {
      const failure = await written(session({ workspaceEntries: [repo("app", url, "repo-TOKEN")] })).catch(
        (e: unknown) => e,
      );
      expect(failure, url).toBeInstanceOf(ConnectError);
      expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
      expect((failure as ConnectError).rawMessage).toBe(
        "a repository token is used only for https://github.com repositories (repository 'app')",
      );
    }
    await expect(
      written(session({ workspaceEntries: [repo("app", "https://gitlab.example.com/acme/app", "")] })),
    ).resolves.toBeDefined();
  });

  it("keeps a repository's stored token only for the same repository: a marker with a new URL is refused", async () => {
    const first = await written(session({ workspaceEntries: [REPO] }));
    const moved = repo("app", "https://github.com/attacker/app", REDACTED_MARKER);
    const failure = await written(session({ workspaceEntries: [moved] }), first.ctx.newState).catch(
      (e: unknown) => e,
    );
    expect((failure as ConnectError).code).toBe(Code.InvalidArgument);
    const kept = await written(
      session({ workspaceEntries: [repo("app", "https://github.com/acme/app", REDACTED_MARKER)] }),
      first.ctx.newState,
    );
    expect(tokenOf(kept.ctx.newState)).toMatch(/^enc:v9:/);
  });
});

describe("reading and dropping", () => {
  it("a read shows the marker for every token, a tokenless clone untouched", () => {
    const shown = session({
      workspaceEntries: [REPO, repo("public", "https://github.com/acme/public", "")],
    });
    redactSessionValues(shown);
    expect(tokenOf(shown, 0)).toBe(REDACTED_MARKER);
    expect(tokenOf(shown, 1)).toBe("");
  });

  it("an update destroys only the tokens it drops; a replaced token keeps its backing state", async () => {
    const first = await written(
      session({
        workspaceEntries: [
          repo("dropped", "https://github.com/acme/dropped", "a"),
          repo("replaced", "https://github.com/acme/replaced", "b"),
          repo("kept", "https://github.com/acme/kept", "c"),
        ],
      }),
    );
    const stored = first.ctx.newState;
    const { codec, secrets } = fixture();
    const ctx = ctxOf(
      session({
        workspaceEntries: [
          repo("replaced", "https://github.com/acme/replaced", "b2"),
          repo("kept", "https://github.com/acme/kept", REDACTED_MARKER),
        ],
      }),
      stored,
    );
    await newPreserveSessionValuesStep().execute(ctx);
    await newSealSessionValuesStep(secrets, logger).execute(ctx);
    await newDestroyDroppedSessionValuesStep(secrets, logger).execute(ctx);
    expect(codec.deleted).toEqual([tokenOf(stored, 0)]);
  });

  it("the delete chain's extractor names every sealed token", async () => {
    const { ctx } = await written(
      session({ workspaceEntries: [REPO, repo("docs", "https://github.com/acme/docs", "t")] }),
    );
    expect(sealedValuesOfSession(ctx.newState)).toHaveLength(2);
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
    const ctx = ctxOf(session({ workspaceEntries: [REPO] }));
    await newSealSessionValuesStep(keyless, {
      ...logger,
      warn: (message: string) => warnings.push(message),
    } as typeof logger).execute(ctx);
    expect(tokenOf(ctx.newState)).toBe("repo-token");
    expect(warnings).toEqual(["Encryption disabled: a session's repository tokens will be stored in plaintext"]);
  });

  it("answers INTERNAL when a token cannot be sealed", async () => {
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
    const ctx = ctxOf(session({ workspaceEntries: [REPO] }));
    let failure: unknown;
    try {
      await newSealSessionValuesStep(broken, logger).execute(ctx);
    } catch (error) {
      failure = error;
    }
    expect((failure as ConnectError).code).toBe(Code.Internal);
  });
});
