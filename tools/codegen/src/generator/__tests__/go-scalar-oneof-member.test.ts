/**
 * Pins how the Go generator carries a scalar member of a real oneof at the
 * spec level: the agent execution spec's `session_id`, which shares the
 * `target` oneof with the message member `session_spec`. The Go struct has
 * no `SessionId` field of its own — the value is held by the oneof's
 * wrapper type — so toProto sets the wrapper only when the input carries a
 * value (a zero value leaves the oneof to the other member), and fromProto
 * reads the member through its getter, which answers the zero value when
 * the oneof holds the other member. On an input that sets both, the
 * first-declared member wins, as in the TypeScript input: `session_id` is
 * assigned after `session_spec`, so a follow-up turn never silently starts
 * a new conversation (firstMemberWinsOrder). The generator runs over the
 * real schemas and the test reads what it wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { firstMemberWinsOrder } from "../gen-common.js";
import type { FieldSchema } from "../schema.js";
import { runSDKClientGeneration } from "../sdk-client-go.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

describe("the Go generator's scalar oneof member", () => {
  let root: string;
  let go: string;

  beforeAll(() => {
    // The generator writes the package's re-export files two levels above
    // its output (sdk/go/internal/gen → sdk/go), so the output nests inside
    // the temporary root and nothing lands outside it.
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-go-oneof-"));
    const output = path.join(root, "internal", "gen");
    runSDKClientGeneration(SCHEMAS, output);
    go = fs.readFileSync(path.join(output, "agentrun.go"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sets the oneof's wrapper only when the input carries a value", () => {
    expect(go).toContain(
      "\tif i.SessionId != \"\" {\n\t\tresource.Spec.Target = &agentrunv1.AgentRunSpec_SessionId{SessionId: i.SessionId}\n\t}\n",
    );
    expect(go).not.toContain("resource.Spec.SessionId =");
  });

  it("assigns the first-declared member last, so it wins when both are set", () => {
    const spec = go.indexOf(
      "resource.Spec.Target = &agentrunv1.AgentRunSpec_SessionSpec{",
    );
    const id = go.indexOf(
      "resource.Spec.Target = &agentrunv1.AgentRunSpec_SessionId{",
    );
    expect(spec).toBeGreaterThan(-1);
    expect(id).toBeGreaterThan(spec);
  });

  it("orders a nested oneof the same way: the first-declared member, git_repo, wins", () => {
    const fn = go.slice(go.indexOf("func (i *WorkspaceSourceInput) toProto()"));
    const local = fn.indexOf("p.Source = &sessionv1.WorkspaceSource_LocalPath{");
    const git = fn.indexOf("p.Source = &sessionv1.WorkspaceSource_GitRepo{");
    expect(local).toBeGreaterThan(-1);
    expect(git).toBeGreaterThan(local);
  });

  it("reads the member back through its getter", () => {
    expect(go).toContain("\t\tinput.SessionId = s.GetSessionId()\n");
  });
});

describe("firstMemberWinsOrder", () => {
  const field = (name: string, oneofGroup = ""): FieldSchema =>
    ({ name, protoField: name, oneofGroup, type: { kind: "string" } }) as FieldSchema;

  it("reverses each real oneof's members in their own positions and keeps every other field", () => {
    const order = firstMemberWinsOrder([
      field("a", "target"),
      field("b", "target"),
      field("message"),
      field("x", "transport"),
      field("limit", "_limit"),
      field("y", "transport"),
      field("z", "transport"),
    ]).map((f) => f.name);
    expect(order).toEqual(["b", "a", "message", "z", "limit", "y", "x"]);
  });
});
