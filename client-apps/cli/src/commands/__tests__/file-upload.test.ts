// Contract for `stigmer file upload <path>…`: each path becomes a File in the
// order given and its id is printed beside its name (in the JSON form under
// data.files, for scripts); without --session the Files are the person's own
// in the context organization, and with it they are uploaded into that
// conversation in the conversation's own organization. A folder, a missing
// path or a malformed session id is refused before any byte moves, and a
// failed upload deletes the Files the batch had uploaded. The program, the
// flag parsing and the SDK's upload routing are real; the server is an
// in-memory Connect router behind a real Stigmer client.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import type { UploadFileInput } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { Stigmer } from "@stigmer/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const server = vi.hoisted(() => ({
  uploads: [] as UploadFileInput[],
  deletes: [] as string[],
  refuse: new Set<string>(),
  client: undefined as Stigmer | undefined,
}));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer: server.client }),
}));

let dir: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "file-upload-"));
  server.uploads.length = 0;
  server.deletes.length = 0;
  server.refuse.clear();
  const transport = createRouterTransport(({ service }) => {
    service(FileCommandController, {
      upload: (input) => {
        if (server.refuse.has(input.filename)) throw new ConnectError("too large", Code.InvalidArgument);
        server.uploads.push(input);
        return create(FileSchema, {
          metadata: { id: `file_${input.filename.replace(/\W/g, "")}`, org: input.org },
          spec: { filename: input.filename },
        });
      },
      delete: (id) => {
        server.deletes.push(id.value);
        return create(FileSchema, { metadata: { id: id.value } });
      },
    });
    service(SessionQueryController, {
      get: (id) => {
        if (id.value !== "ses_conv") throw new ConnectError("session not found", Code.NotFound);
        return create(SessionSchema, { metadata: { id: "ses_conv", org: "org_conversation" } });
      },
    });
  });
  server.client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });

  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content = "x"): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

/** Runs `stigmer --org acme file upload ...`, returning stdout and stderr. */
async function upload(...args: string[]): Promise<{ out: string; err: string }> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--org", "acme", "file", "upload", ...args]);
  return { out: stdout.join(""), err: stderr.join("") };
}

describe("stigmer file upload", () => {
  it("uploads each path as the person's own File, in order, and prints each id beside its name", async () => {
    const { err } = await upload(write("q3-ledger.xlsx", "ledger"), write("notes.md", "notes"));
    expect(server.uploads.map((u) => [u.org, u.sessionId, u.filename])).toEqual([
      ["acme", "", "q3-ledger.xlsx"],
      ["acme", "", "notes.md"],
    ]);
    expect(err).toContain("Uploaded 2 files");
    expect(err).toContain("q3-ledger.xlsx");
    expect(err).toContain("file_q3ledgerxlsx");
    expect(err).toContain("stigmer run <agent> --file-id <id>");
  });

  it("answers the ids under data.files in the JSON form, for scripts", async () => {
    const { out } = await upload(write("a.csv", "a,b"), "--json");
    expect(JSON.parse(out).data).toEqual({ files: [{ id: "file_acsv", filename: "a.csv", size_bytes: 3 }] });
  });

  it("uploads into a conversation in the conversation's own organization", async () => {
    await upload(write("shot.png"), "--session", "ses_conv");
    expect(server.uploads.map((u) => [u.org, u.sessionId])).toEqual([["org_conversation", "ses_conv"]]);
  });

  it("refuses a folder before uploading anything, pointing at run --attach", async () => {
    const folder = join(dir, "bundle");
    mkdirSync(folder);
    await expect(upload(write("a.csv"), folder)).rejects.toThrow(
      new UsageError(`"${folder}" is a folder; attach a folder to a conversation with stigmer run --attach`),
    );
    expect(server.uploads).toEqual([]);
  });

  it("refuses a missing path and a malformed session id before uploading anything", async () => {
    await expect(upload(write("a.csv"), join(dir, "nope.csv"))).rejects.toThrow(/file not found: .*nope\.csv/);
    await expect(upload(write("b.csv"), "--session", "conv")).rejects.toThrow(/invalid session ID: conv/);
    expect(server.uploads).toEqual([]);
  });

  it("refuses a path it cannot read, and one that is neither a file nor a folder", async () => {
    const plain = write("plain.csv");
    await expect(upload(join(plain, "inside.csv"))).rejects.toThrow(/cannot read ".*plain\.csv\/inside\.csv": ENOTDIR/);
    await expect(upload("/dev/null")).rejects.toThrow(new UsageError('cannot upload "/dev/null": not a file'));
    expect(server.uploads).toEqual([]);
  });

  it("deletes the Files the batch uploaded when one upload fails, and names the file", async () => {
    server.refuse.add("bad.csv");
    await expect(upload(write("good.csv"), write("bad.csv"))).rejects.toThrow(/failed to upload ".*bad\.csv": .*too large/);
    expect(server.deletes).toEqual(server.uploads.map((u) => `file_${u.filename.replace(/\W/g, "")}`));
  });
});
