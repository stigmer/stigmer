/**
 * Pins the code examples on the SDK resource pages to what each SDK takes.
 * Java reaches a resource through the client's field (`client.agent`), not
 * a method. A method input that is a protobuf message is built in the
 * package the SDK's own client names it from (Go `agentv1`, Python
 * `version_pb2`, Java's `newBuilder()`), while the SDK's own inputs keep
 * `stigmer.` and `builder()`, and a resource reference passes by value in
 * Go. Every value is a literal of its field's type: an enum's first named
 * value as each language spells it, `0n` for a TypeScript int64, empty
 * bytes, a Go list or map of pointers. "Client Access" shows each
 * language's imports block (a `prelude` fence) holding what the page's
 * examples import, and no example names an id or an input it never
 * declares.
 *
 * The generator runs over the real schemas and API tree into a temporary
 * directory, and these cases read what it wrote; `DocImports` and
 * `protoCapCamel` are checked on their own.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DocImports, protoCapCamel } from "../sdk-docs-examples.js";
import { runSDKDocsGeneration } from "../sdk-docs.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");
const APIS = path.resolve(__dirname, "../../../../../apis");

/** Every fence of a page: its info line and its body. */
function fences(page: string): { info: string; body: string }[] {
  return [...page.matchAll(/^```([^\n]*)\n([\s\S]*?)^```$/gm)].map((m) => ({ info: m[1], body: m[2] }));
}

describe("the SDK resource pages' examples", () => {
  let root: string;
  const read = (slug: string) => fs.readFileSync(path.join(root, `${slug}.mdx`), "utf8");

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-docs-examples-"));
    runSDKDocsGeneration(SCHEMAS, root, APIS);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reaches a resource in Java through the client's field, as GeneratedClient declares it", () => {
    const agent = read("agent");
    expect(agent).toContain('Agent agent = client.agent.get("agt_01j5q3k7m8r2s4tnz2hfp0q0c3");');
    expect(read("channel-app")).toContain("client.channelapp.get(");
    for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".mdx"))) {
      const java = fences(fs.readFileSync(path.join(root, file), "utf8")).filter((f) => f.info.startsWith("java"));
      for (const fence of java) expect(fence.body, file).not.toMatch(/client\.\w+\(\)\./);
    }
  });

  it("builds a protobuf input in the package the SDK's own client names it from", () => {
    const agent = read("agent");
    expect(agent).toContain("agentVersionEntry, err := client.Agent.GetVersion(ctx, &agentv1.GetAgentVersionInput{");
    expect(agent).toContain("agent_version_entry = client.agents.get_version(version_pb2.GetAgentVersionInput(");
    expect(agent).toContain("AgentVersionEntry agentVersionEntry = client.agent.getVersion(GetAgentVersionInput.newBuilder()");
    expect(agent).toContain("const agentVersionEntry = await stigmer.agent.getVersion({");
    expect(agent).toContain("client.Agent.Rename(ctx, &apiresource.RenameInput{");
    expect(agent).toContain("client.agents.rename(apiresource_io_pb2.RenameInput(");
  });

  it("keeps the SDK's own inputs under stigmer and builder(), and passes a Go resource reference by value", () => {
    const agent = read("agent");
    expect(agent).toContain("agent, err := client.Agent.Apply(ctx, &stigmer.AgentInput{");
    expect(agent).toContain("Agent agent = client.agent.apply(AgentInput.builder()");
    expect(agent).toContain("agent = client.agents.apply(AgentInput(");
    expect(agent).toContain('agent, err := client.Agent.GetByReference(ctx, stigmer.ResourceRef{Org: "acme", Slug: "my-agent"})');
    expect(agent).toContain('Agent agent = client.agent.getByReference(ResourceRef.of("acme", "my-agent"));');
    expect(agent).toContain("    .runConfig(AgentInput.RunConfigInput.builder().build())");
  });

  it("writes each value as a literal of its field's type", () => {
    const agent = read("agent");
    expect(agent).toContain("  harness: Harness.STIGMER,");
    expect(agent).toContain("  Harness:         sessionv1.Harness_HARNESS_STIGMER,");
    expect(agent).toContain("    harness=session_enum_pb2.HARNESS_STIGMER,");
    expect(agent).toContain("    .harness(Harness.HARNESS_STIGMER)");
    expect(agent).toContain("  Hooks:           []*stigmer.HookSourceInput{},");
    expect(agent).toContain("  Env:             map[string]*stigmer.EnvVarDeclarationInput{},");
    expect(read("eval")).toContain("  sizeBytes: 0n,");
    expect(read("eval")).toContain("    .setArtifact(ByteString.EMPTY)");
    expect(read("grant")).toContain("  AfterSequence: proto.Int64(0),");
  });

  it("sets one member of a oneof, and builds the message itself where the TypeScript client takes it", () => {
    const file = read("file");
    expect(file).toContain("const file = await stigmer.file.upload(create(UploadFileInputSchema, {");
    expect(file).toContain('  source: { case: "data", value: new Uint8Array() },');
    expect(file).toContain("  Source:    &filev1.UploadFileInput_Data{Data: []byte{}},");
    const upload = fences(file).find((f) => f.body.includes("stigmer.file.upload("));
    expect(upload?.body).not.toContain("uploadRef");
  });

  it("shows each language's imports once, in Client Access, as a prelude fence", () => {
    const agent = read("agent");
    const access = agent.slice(agent.indexOf("## Client Access"), agent.indexOf("## Methods"));
    expect(access).toContain('```typescript prelude\nimport { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";');
    expect(access).toContain('```go prelude\nimport (\n\tstigmer "go.stigmer.ai/sdk"\n\tagentv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/agent/v1"');
    expect(access).toContain("```python prelude\nfrom stigmer import AgentInput, ResourceRef, RunConfigInput\n");
    expect(access).toContain("from ai.stigmer.agentic.agent.v1 import io_pb2, version_pb2\n");
    expect(access).toContain("```java prelude\nimport ai.stigmer.agentic.agent.v1.Agent;\n");
    expect(access).toContain("import ai.stigmer.sdk.gen.AgentInput;\n");
    const preludes = fences(agent).filter((f) => f.info.endsWith(" prelude"));
    expect(preludes.map((f) => f.info)).toEqual(["typescript prelude", "go prelude", "python prelude", "java prelude"]);
  });

  it("names no id or input an example does not declare", () => {
    for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".mdx"))) {
      for (const fence of fences(fs.readFileSync(path.join(root, file), "utf8"))) {
        expect(fence.body, `${file}: ${fence.body}`).not.toMatch(/[(,=]\s*(id|input)\)/);
      }
    }
  });
});

describe("DocImports", () => {
  it("writes a Java class by its qualified name when another holds its simple name", () => {
    const imports = new DocImports();
    expect(imports.javaType("ai.stigmer.agentic.plugin.v1.GetArtifactRequest")).toBe("GetArtifactRequest");
    expect(imports.javaType("ai.stigmer.agentic.skill.v1.GetArtifactRequest")).toBe("ai.stigmer.agentic.skill.v1.GetArtifactRequest");
    expect(imports.render("java")).toBe("import ai.stigmer.agentic.plugin.v1.GetArtifactRequest;");
  });

  it("refuses one Go alias for two packages", () => {
    const imports = new DocImports();
    imports.goPackage("agentv1", "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/agent/v1");
    expect(() => imports.goPackage("agentv1", "go.stigmer.ai/sdk/proto/other/agent/v1")).toThrow(/names both/);
  });

  it("puts the Python SDK's imports before the protobuf modules, and binds an aliased module by its alias", () => {
    const imports = new DocImports();
    expect(imports.pyName("ai.stigmer.commons.apiresource", "io_pb2 as apiresource_io_pb2")).toBe("apiresource_io_pb2");
    imports.pyName("stigmer._gen", "TeamInput");
    imports.pyName("stigmer", "ResourceRef");
    expect(imports.render("python")).toBe(
      "from stigmer import ResourceRef\nfrom stigmer._gen import TeamInput\nfrom ai.stigmer.commons.apiresource import io_pb2 as apiresource_io_pb2",
    );
  });

  it("renders nothing for a language whose examples import nothing", () => {
    expect(new DocImports().render("typescript")).toBeNull();
  });
});

describe("protoCapCamel", () => {
  it("spells a field as protoc does for Go and Java", () => {
    expect(protoCapCamel("version_hash")).toBe("VersionHash");
    expect(protoCapCamel("ipv4_address")).toBe("Ipv4Address");
    expect(protoCapCamel("v2_api")).toBe("V2Api");
  });
});
