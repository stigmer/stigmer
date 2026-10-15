// Command-level contract for an eval's two file verbs, `stigmer push eval
// <folder> --name <slug>` and `stigmer download eval <ref>[@<version>]`,
// against a real Connect backend over h2c that records every push and
// serves one stored archive.
//
// Push: the folder's archive (run output left out) reaches the server under
// the slug --name gives, into the context organization; --tag is sent only
// when given, never the flag's `latest` default; --dry-run prints the
// reading and sends nothing; a missing --name, a `latest` tag, a
// child-organization level, a skill-only flag and a plugin folder are
// refused before any call. Download: the version the reference names is
// resolved, its archive checked against its digest and unzipped into a new
// directory; a non-empty directory and an archive that does not match its
// digest are refused, and an archive entry that would climb out of the
// directory is refused before anything is written.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { zipSync } from "fflate";
import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/command_pb";
import { EvalArchiveSchema, type PushEvalRequest } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { EvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/query_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../errors/index.js";
import { extractArchive } from "../../resources/eval.js";
import { runCli, type TestHome, useTestHome } from "../__test-utils__/plugin-backend.js";

const JUDGE = "---\ntype: llm\n---\n\nPASS if the reply follows the refund policy.\n";
const CASES: Record<string, string> = {
  "refund/prompt.md": "Can I return shoes I bought last week?",
  "refund/graders/judge.md": JUDGE,
  "mocks/billing/refund.md": "Refunded.",
};

const encoder = new TextEncoder();
const STORED = zipSync(Object.fromEntries(Object.entries(CASES).map(([path, text]) => [path, encoder.encode(text)])));
const STORED_DIGEST = createHash("sha256").update(STORED).digest("hex");

interface Backend {
  readonly port: number;
  readonly pushes: PushEvalRequest[];
  readonly references: ApiResourceReference[];
  /** What the inline download answers with. */
  archive: Uint8Array<ArrayBufferLike>;
  close(): Promise<void>;
}

async function startEvalBackend(): Promise<Backend> {
  const sessions = new Set<ServerHttp2Session>();
  const state = {
    pushes: [] as PushEvalRequest[],
    references: [] as ApiResourceReference[],
    archive: STORED as Uint8Array<ArrayBufferLike>,
  };
  const stored = () =>
    create(EvalSchema, {
      metadata: { id: "evs_1", org: "acme", slug: "support" },
      spec: { tag: "stable" },
      status: { digest: STORED_DIGEST, caseCount: 1 },
    });
  const routes = (router: ConnectRouter) => {
    router.service(EvalCommandController, {
      push: (req) => {
        state.pushes.push(req);
        return create(EvalSchema, {
          metadata: { id: "evs_1", org: "acme", slug: req.slug, visibility: ApiResourceVisibility.visibility_org },
          spec: { tag: req.tag },
          status: { digest: "b".repeat(64), caseCount: 1 },
        });
      },
    });
    router.service(EvalQueryController, {
      getByReference: (ref) => {
        state.references.push(ref);
        return stored();
      },
      // No transfer lane on this server: the CLI reads the archive inline.
      getDownloadUrl: () => {
        throw new ConnectError("eval artifact transfer lane is not configured on this server", Code.FailedPrecondition);
      },
      download: () => create(EvalArchiveSchema, { artifact: state.archive, digest: STORED_DIGEST }),
    });
  };
  const server: Http2Server = createHttp2Server(connectNodeAdapter({ routes }));
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    pushes: state.pushes,
    references: state.references,
    get archive() {
      return state.archive;
    },
    set archive(next: Uint8Array<ArrayBufferLike>) {
      state.archive = next;
    },
    close: async () => {
      for (const session of sessions) session.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let backend: Backend;
let home: TestHome;
let work: string;

beforeAll(async () => {
  backend = await startEvalBackend();
});

afterAll(async () => {
  await backend.close();
});

beforeEach(() => {
  backend.pushes.length = 0;
  backend.references.length = 0;
  backend.archive = STORED;
  home = useTestHome(backend.port);
  work = mkdtempSync(join(tmpdir(), "stigmer-eval-command-"));
});

afterEach(() => {
  home.restore();
  rmSync(work, { recursive: true, force: true });
});

/** An evals/ folder holding the cases, plus a run's output under results/. */
function evalsFolder(): string {
  const dir = join(work, "evals");
  for (const [path, text] of Object.entries({ ...CASES, "results/run-1/aggregate-result.json": "{}" })) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("stigmer push eval", () => {
  it("pushes the folder under --name into the context organization, sending no tag it was not given", async () => {
    const outcome = await runCli(["push", "eval", evalsFolder(), "--name", "support", "-m", "9c2e4b7", "--json"]);
    expect(outcome.message).toBe("");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    const pushed = backend.pushes[0]!;
    expect([pushed.org, pushed.slug, pushed.tag, pushed.message]).toEqual(["acme", "support", "", "9c2e4b7"]);
    expect(pushed.visibility).toBe(ApiResourceVisibility.api_resource_visibility_unspecified);
    expect(JSON.parse(outcome.stdout).message).toBe("Pushed eval 'support' (1 case)");
  });

  it("sends --tag and --visibility when given", async () => {
    const outcome = await runCli(["push", "eval", evalsFolder(), "--name", "support", "--tag", "stable", "--visibility", "private", "--json"]);
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(backend.pushes[0]?.tag).toBe("stable");
    expect(backend.pushes[0]?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });

  it("prints the reading on --dry-run and sends nothing; results/ is not part of it", async () => {
    const outcome = await runCli(["push", "eval", evalsFolder(), "--name", "support", "--dry-run", "--json"]);
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(backend.pushes).toEqual([]);
    const payload = JSON.parse(outcome.stdout);
    expect(payload.message).toBe("Dry run: eval 'support' would hold 1 case");
    expect(payload.data.cases).toEqual([{ name: "refund", path: "refund", tags: [] }]);
    expect(payload.data.mockServers).toEqual(["billing"]);
    expect(payload.data.findings).toEqual([]);
  });

  it.each([
    [["--json"], "push eval needs --name <slug>"],
    [["--name", "support", "--tag", "latest"], "an eval's tag cannot be 'latest'"],
    [["--name", "support", "--visibility", "child-orgs"], "invalid --visibility 'child-orgs' for an eval"],
    [["--name", "support", "--git-url", "https://example.com/r.git"], "cannot be combined with: --git-url"],
    [["--name", "Support"], "invalid --name 'Support'"],
  ])("refuses %j before any call", async (flags, message) => {
    const outcome = await runCli(["push", "eval", evalsFolder(), ...flags]);
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toContain(message);
    expect(backend.pushes).toEqual([]);
  });

  it("refuses a plugin folder, naming its evals/ folder", async () => {
    const plugin = join(work, "plugin");
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "p" }));
    const outcome = await runCli(["push", "eval", plugin, "--name", "support"]);
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toContain(`push ${join(plugin, "evals")} instead`);
  });

  it("refuses --name on another kind", async () => {
    const outcome = await runCli(["push", "skill", work, "--name", "x"]);
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toContain("--name names an eval");
  });
});

describe("stigmer download eval", () => {
  it("resolves the version named, checks the archive against its digest and unzips it into a new directory", async () => {
    const out = join(work, "copy");
    const outcome = await runCli(["download", "eval", "support@stable", "-o", out, "--json"]);
    expect(outcome.message).toBe("");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(backend.references[0]?.slug).toBe("support");
    expect(backend.references[0]?.org).toBe("acme");
    expect(backend.references[0]?.version).toBe("stable");
    for (const [path, text] of Object.entries(CASES)) {
      expect(readFileSync(join(out, path), "utf8")).toBe(text);
    }
    expect(JSON.parse(outcome.stdout).data).toMatchObject({ slug: "support", digest: STORED_DIGEST, files: 3 });
  });

  it("refuses a directory that is not empty", async () => {
    const out = join(work, "busy");
    mkdirSync(out);
    writeFileSync(join(out, "mine.txt"), "keep me");
    const outcome = await runCli(["download", "eval", "support", "-o", out]);
    expect(outcome.exitCode).toBe(ExitCode.Usage);
    expect(outcome.message).toContain("is not empty");
    expect(readFileSync(join(out, "mine.txt"), "utf8")).toBe("keep me");
  });

  it("refuses an archive that does not match its digest, writing nothing", async () => {
    backend.archive = zipSync({ "refund/prompt.md": encoder.encode("Changed in flight.") });
    const out = join(work, "tampered");
    const outcome = await runCli(["download", "eval", "support", "-o", out]);
    expect(outcome.exitCode).not.toBe(ExitCode.Success);
    expect(outcome.message).toContain("does not match its digest");
    expect(existsSync(join(out, "refund"))).toBe(false);
  });
});

describe("extractArchive", () => {
  it.each([["../outside.md"], ["a/../../outside.md"], ["/etc/evil.md"]])(
    "refuses an entry %j that would land outside the directory, before writing anything",
    (name) => {
      const out = join(work, "target");
      mkdirSync(out);
      const archive = zipSync({ "ok.md": encoder.encode("fine"), [name]: encoder.encode("escaped") });
      expect(() => extractArchive(archive, out)).toThrow(/nothing was written/);
      expect(existsSync(join(out, "ok.md"))).toBe(false);
      expect(existsSync(join(work, "outside.md"))).toBe(false);
    },
  );
});
