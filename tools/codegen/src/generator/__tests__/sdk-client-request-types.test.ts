/**
 * Pins how the TypeScript and Python client generators type a method that
 * forwards its request as it is (a list, a rename, a stream's filters):
 *
 * - TypeScript takes the request's init shape, so a caller passes the plain
 *   object the reference pages show, and Connect builds the message. A
 *   request from the commons package brings its Schema into scope for
 *   `typeof`.
 * - Python annotates every method type with the module that declares it,
 *   read from the schema, under the alias the client imports it by: a
 *   commons type is `apiresource_io_pb2.RenameInput`, never the kind's own
 *   `io_pb2`. A cross-package method type the schema does not list fails
 *   the generator, naming it, instead of guessing a module.
 *
 * The generators run over the real schemas (and, for the failure, a copy
 * with one entry removed) into temporary directories.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ServiceSchemaFile } from "../gen-common.js";
import { runSDKClientPythonGeneration } from "../sdk-client-python.js";
import { runSDKClientTSGeneration } from "../sdk-client-ts.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

function importLineFrom(source: string, module: string): string {
  const line = source.split("\n").find((l) => l.endsWith(` from "${module}";`));
  if (line === undefined) throw new Error(`no import from ${module}`);
  return line;
}

describe("the generated clients' request and response types", () => {
  let root: string;
  const ts = new Map<string, string>();
  const py = new Map<string, string>();

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-request-types-"));
    const tsOut = path.join(root, "ts");
    runSDKClientTSGeneration(SCHEMAS, tsOut);
    for (const kind of ["agent", "session"]) {
      ts.set(kind, fs.readFileSync(path.join(tsOut, `${kind}.ts`), "utf8"));
    }
    const pyOut = path.join(root, "py");
    runSDKClientPythonGeneration(SCHEMAS, pyOut);
    for (const kind of ["agent", "identityaccount"]) {
      py.set(kind, fs.readFileSync(path.join(pyOut, `_${kind}.py`), "utf8"));
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("TypeScript", () => {
    it("a list takes its request's init shape", () => {
      expect(ts.get("agent")).toContain(
        "  async list(input: MessageInitShape<typeof ListAgentsRequestSchema>): Promise<AgentList> {\n",
      );
    });

    it("a commons request takes its init shape and imports its Schema for typeof", () => {
      const agent = ts.get("agent")!;
      expect(agent).toContain("  async rename(input: MessageInitShape<typeof RenameInputSchema>): Promise<Agent> {\n");
      expect(agent).toContain(
        "  async updateVisibility(input: MessageInitShape<typeof UpdateVisibilityInputSchema>): Promise<Agent> {\n",
      );
      const commonsIo = importLineFrom(agent, "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb");
      expect(commonsIo).toContain("type RenameInputSchema");
      expect(commonsIo).toContain("type UpdateVisibilityInputSchema");
    });

    it("a stream takes its request's init shape", () => {
      expect(ts.get("session")).toContain(
        "  async *streamEvents(input: MessageInitShape<typeof StreamSessionEventsRequestSchema>, signal?: AbortSignal): AsyncGenerator<StreamSessionEventsResponse> {\n",
      );
    });
  });

  describe("Python", () => {
    it("a commons request is annotated with the commons module", () => {
      const agent = py.get("agent")!;
      expect(agent).toContain("    def rename(self, input: apiresource_io_pb2.RenameInput) -> api_pb2.Agent:\n");
      expect(agent).toContain(
        "    def update_visibility(self, input: apiresource_io_pb2.UpdateVisibilityInput) -> api_pb2.Agent:\n",
      );
      expect(agent).not.toMatch(/[^_]io_pb2\.(RenameInput|UpdateVisibilityInput)/);
    });

    it("imports the commons io module once, under one name", () => {
      const lines = py.get("agent")!.split("\n").filter((l) => l.includes("commons.apiresource import io_pb2"));
      expect(lines).toEqual(["from ai.stigmer.commons.apiresource import io_pb2 as apiresource_io_pb2"]);
    });

    it("a commons response is annotated with the module that declares it, which is imported", () => {
      const account = py.get("identityaccount")!;
      expect(account).toContain("    def get_actor_info(self, id: str) -> apiresource_status_pb2.ApiResourceAuditActor:\n");
      expect(account).toContain("from ai.stigmer.commons.apiresource import status_pb2 as apiresource_status_pb2\n");
    });

    it("a cross-package method type the schema does not list fails the generator, naming it", () => {
      const schemas = path.join(root, "schemas-unlisted");
      fs.cpSync(SCHEMAS, schemas, { recursive: true });
      const file = path.join(schemas, "services", "agent.json");
      const agent = JSON.parse(fs.readFileSync(file, "utf8")) as ServiceSchemaFile;
      agent.methodTypes = (agent.methodTypes ?? []).filter((mt) => mt.name !== "RenameInput");
      fs.writeFileSync(file, JSON.stringify(agent));
      expect(() => runSDKClientPythonGeneration(schemas, path.join(root, "py-unlisted"))).toThrow(
        /ai\.stigmer\.commons\.apiresource\.RenameInput/,
      );
    });
  });
});
