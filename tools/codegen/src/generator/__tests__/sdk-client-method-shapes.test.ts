/**
 * Pins the Go, TypeScript and Python client methods the generators emit for
 * the method shapes no served service has today, each under its SDK method
 * name: a call that takes and answers nothing, a delete by id that answers
 * nothing, a resource passed through as it is when its kind has no spec
 * input, a read by id beside the kind's get, a stream read by id, a
 * bidirectional stream, and a request from another versioned package.
 *
 * The generators run over a copy of the real schemas into temporary
 * directories; the copy's license service gains these methods and loses
 * its spec schema, so its resource has no generated input type.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MethodSchema, ServiceSchemaFile } from "../gen-common.js";
import { runSDKClientGeneration } from "../sdk-client-go.js";
import { runSDKClientPythonGeneration } from "../sdk-client-python.js";
import { runSDKClientTSGeneration } from "../sdk-client-ts.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");
const PKG = "ai.stigmer.billing.license.v1";

function method(name: string, input: string, output: string, extra: Partial<MethodSchema> = {}): MethodSchema {
  const full = (t: string) => (t === "Empty" ? "google.protobuf.Empty" : `${PKG}.${t}`);
  return { name, inputType: input, inputFullType: full(input), outputType: output, outputFullType: full(output), ...extra };
}

describe("the generated clients' rarer method shapes", () => {
  let root: string;
  let go: string;
  let ts: string;
  let py: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-method-shapes-"));
    const schemas = path.join(root, "schemas");
    fs.cpSync(SCHEMAS, schemas, { recursive: true });
    fs.rmSync(path.join(schemas, "billing", "license", "license.json"));
    const file = path.join(schemas, "services", "license.json");
    const license = JSON.parse(fs.readFileSync(file, "utf8")) as ServiceSchemaFile;
    const command = license.services.find((svc) => svc.role === "command")!;
    const query = license.services.find((svc) => svc.role === "query")!;
    command.methods.push(
      method("Ping", "Empty", "Empty"),
      method("Forget", "LicenseId", "Empty"),
      method("Replace", "License", "License"),
      method("Talk", "LicenseCommand", "LicenseEvent", { clientStreaming: true, serverStreaming: true }),
    );
    query.methods.push(
      method("Watch", "LicenseId", "License", { serverStreaming: true }),
      method("Fetch", "LicenseId", "License"),
      method("Peek", "ListAgentsRequest", "License", {
        inputFullType: "ai.stigmer.agentic.agent.v1.ListAgentsRequest",
      }),
    );
    license.methodTypes = [
      ...(license.methodTypes ?? []),
      {
        name: "ListAgentsRequest",
        description: "",
        protoType: "ai.stigmer.agentic.agent.v1.ListAgentsRequest",
        protoFile: "apis/ai/stigmer/agentic/agent/v1/io.proto",
        fields: [],
      },
    ];
    fs.writeFileSync(file, JSON.stringify(license));

    const goOut = path.join(root, "go", "internal", "gen");
    runSDKClientGeneration(schemas, goOut);
    go = fs.readFileSync(path.join(goOut, "license.go"), "utf8");
    const tsOut = path.join(root, "ts");
    runSDKClientTSGeneration(schemas, tsOut);
    ts = fs.readFileSync(path.join(tsOut, "license.ts"), "utf8");
    const pyOut = path.join(root, "py");
    runSDKClientPythonGeneration(schemas, pyOut);
    py = fs.readFileSync(path.join(pyOut, "_license.py"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("a call that takes and answers nothing", () => {
    expect(go).toContain("func (l *LicenseClient) Ping(ctx context.Context) error {\n");
  });

  it("a call by id that answers nothing", () => {
    expect(go).toContain("func (l *LicenseClient) Forget(ctx context.Context, id string) error {\n");
  });

  it("a resource passed through as it is when its kind has no spec input", () => {
    expect(go).toContain(
      "func (l *LicenseClient) Replace(ctx context.Context, input *licensev1.License) (*licensev1.License, error) {\n",
    );
    expect(ts).toContain("  async replace(input: License): Promise<License> {\n");
  });

  it("a stream read by id", () => {
    expect(go).toContain("func (l *LicenseClient) Watch(ctx context.Context, id string) (*LicenseWatchStream, error) {\n");
    expect(ts).toContain("  async *watch(id: string, signal?: AbortSignal): AsyncGenerator<License> {\n");
    expect(py).toContain("    def watch(self, id: str) -> Iterator[api_pb2.License]:\n");
  });

  it("a bidirectional stream", () => {
    expect(go).toContain(
      "func (l *LicenseClient) Talk(ctx context.Context, opts ...grpc.CallOption) (*LicenseTalkStream, error) {\n",
    );
    expect(ts).toContain("  talk(signal?: AbortSignal): BidiStream<LicenseCommand, LicenseEvent> {\n");
    expect(py).toContain("    def talk(self) -> BidiStream[io_pb2.LicenseCommand, io_pb2.LicenseEvent]:\n");
  });

  it("a read by id beside the kind's get", () => {
    expect(ts).toContain("  async get(id: string): Promise<License> {\n");
    expect(ts).toContain("  async fetch(id: string): Promise<License> {\n");
  });

  it("a request from another versioned package, typed by the module that declares it", () => {
    expect(ts).toContain("  async peek(input: MessageInitShape<typeof ListAgentsRequestSchema>): Promise<License> {\n");
    const agentIo = ts.split("\n").find((l) => l.endsWith(' from "@stigmer/apis/ai/stigmer/agentic/agent/v1/io_pb";'));
    expect(agentIo).toContain("type ListAgentsRequestSchema");
    expect(py).toContain("    def peek(self, input: agent_io_pb2.ListAgentsRequest) -> api_pb2.License:\n");
    expect(py).toContain("from ai.stigmer.agentic.agent.v1 import io_pb2 as agent_io_pb2\n");
  });
});
