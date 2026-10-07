/**
 * Pins the one rule every generated SDK input follows for a real oneof
 * whose caller sets several members: the first-declared member set wins,
 * as in the TypeScript input (firstMemberWinsOrder). For the agent
 * execution's `target` oneof, `session_id` wins over `session_spec`, so a
 * follow-up turn never silently starts a new conversation; and an empty
 * `session_id` is unset, never a member that claims the oneof. A nested
 * oneof (the workspace source inside a session spec) follows the same
 * rule: `git_repo` wins over `local_path`. Checked on what the Java and
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

let root: string;
let java: string;
let python: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-oneof-"));
  const javaOut = path.join(root, "java");
  const pythonOut = path.join(root, "python");
  runSDKClientJavaGeneration(SCHEMAS, javaOut);
  runSDKClientPythonGeneration(SCHEMAS, pythonOut);
  java = fs.readFileSync(path.join(javaOut, "RunInput.java"), "utf8");
  python = fs.readFileSync(path.join(pythonOut, "_agentrun.py"), "utf8");
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
  it("assigns git_repo after local_path in Java and Python, so it wins", () => {
    const javaSource = java.slice(java.indexOf("class WorkspaceSourceInput"));
    const javaLocal = javaSource.indexOf("builder.setLocalPath(");
    expect(javaLocal).toBeGreaterThan(-1);
    expect(javaSource.indexOf("builder.setGitRepo(")).toBeGreaterThan(javaLocal);
    const pySource = python.slice(python.indexOf("class WorkspaceSourceInput"));
    const pyLocal = pySource.indexOf("msg.local_path.CopyFrom(");
    expect(pyLocal).toBeGreaterThan(-1);
    expect(pySource.indexOf("msg.git_repo.CopyFrom(")).toBeGreaterThan(pyLocal);
  });
});

describe("the Python input's target oneof", () => {
  it("never passes session_id to the constructor, and sets it when non-empty after session_spec", () => {
    const toProto = python.slice(python.indexOf("class RunInput"));
    const constructor = toProto.slice(
      toProto.indexOf("spec = spec_pb2.AgentRunSpec("),
      toProto.indexOf(")\n", toProto.indexOf("spec = spec_pb2.AgentRunSpec(")),
    );
    expect(constructor).not.toContain("session_id=");
    const spec = toProto.indexOf("spec.session_spec.CopyFrom(");
    const id = toProto.indexOf("        if self.session_id:\n");
    expect(spec).toBeGreaterThan(-1);
    expect(id).toBeGreaterThan(spec);
  });
});
