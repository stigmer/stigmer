/**
 * Pins the one rule every generated SDK input follows for a real oneof
 * whose caller sets several members: the first-declared member set wins,
 * as in the TypeScript input (firstMemberWinsOrder). For the agent
 * execution's `target` oneof, `session_id` wins over `session_spec`, so a
 * follow-up turn never silently starts a new conversation; and an empty
 * `session_id` is unset, never a member that claims the oneof. A nested
 * oneof (a conversation's resource) follows the same rule: `file` wins over
 * `git_repository`, which wins over `local_path`, wherever the generator
 * writes the shared resource types. Checked on what the Java and
 * Python generators write over the real schemas (the Go generator's output
 * is pinned by go-scalar-oneof-member.test.ts).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSDKClientJavaGeneration } from "../sdk-client-java.js";
import { runSDKClientPythonGeneration } from "../sdk-client-python.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

/**
 * The text of the generated file in `dir` that holds `marker`. A type
 * several kinds share is written once, into the first kind's file that
 * names it, so a case about such a type finds its file rather than naming it.
 */
function holding(dir: string, marker: string): string {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
    const text = fs.readFileSync(path.join(dir, entry.name), "utf8");
    if (text.includes(marker)) {
      return text;
    }
  }
  throw new Error(`no generated file in ${dir} holds ${marker}`);
}

let root: string;
let java: string;
let python: string;
let javaResource: string;
let pythonResource: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-oneof-"));
  const javaOut = path.join(root, "java");
  const pythonOut = path.join(root, "python");
  runSDKClientJavaGeneration(SCHEMAS, javaOut);
  runSDKClientPythonGeneration(SCHEMAS, pythonOut);
  java = fs.readFileSync(path.join(javaOut, "RunInput.java"), "utf8");
  python = fs.readFileSync(path.join(pythonOut, "_run.py"), "utf8");
  javaResource = holding(javaOut, "class SessionResourceInput");
  pythonResource = holding(pythonOut, "class SessionResourceInput");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("the Java input's target oneof", () => {
  it("sets session_id only when it is non-empty, after session_spec, so it wins", () => {
    const guard = "if (this.sessionId != null && !this.sessionId.isEmpty()) {";
    const spec = java.indexOf("spec.setSessionSpec(");
    const id = java.indexOf(guard);
    expect(spec).toBeGreaterThan(-1);
    expect(id).toBeGreaterThan(spec);
  });
});

describe("a nested oneof", () => {
  it("assigns file last in Java and Python, after git_repository and local_path, so it wins", () => {
    const javaSource = javaResource.slice(javaResource.indexOf("class SessionResourceInput"));
    const javaLocal = javaSource.indexOf("builder.setLocalPath(");
    const javaGit = javaSource.indexOf("builder.setGitRepository(");
    expect(javaLocal).toBeGreaterThan(-1);
    expect(javaGit).toBeGreaterThan(javaLocal);
    expect(javaSource.indexOf("builder.setFile(")).toBeGreaterThan(javaGit);
    const pySource = pythonResource.slice(pythonResource.indexOf("class SessionResourceInput"));
    const pyLocal = pySource.indexOf("msg.local_path.CopyFrom(");
    const pyGit = pySource.indexOf("msg.git_repository.CopyFrom(");
    expect(pyLocal).toBeGreaterThan(-1);
    expect(pyGit).toBeGreaterThan(pyLocal);
    expect(pySource.indexOf("msg.file.CopyFrom(")).toBeGreaterThan(pyGit);
  });
});

describe("the Python input's target oneof", () => {
  it("never passes session_id to the constructor, and sets it when non-empty after session_spec", () => {
    const toProto = python.slice(python.indexOf("class RunInput"));
    const constructor = toProto.slice(
      toProto.indexOf("spec = spec_pb2.RunSpec("),
      toProto.indexOf(")\n", toProto.indexOf("spec = spec_pb2.RunSpec(")),
    );
    expect(constructor).not.toContain("session_id=");
    const spec = toProto.indexOf("spec.session_spec.CopyFrom(");
    const id = toProto.indexOf("        if self.session_id:\n");
    expect(spec).toBeGreaterThan(-1);
    expect(id).toBeGreaterThan(spec);
  });
});
