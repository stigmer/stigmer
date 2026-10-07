// Pins how a contract rename's table is computed from two buf images: files
// pair across a moved directory, elements pair by number or by name then
// position, each language's generated spelling follows its generator, an
// added field is listed rather than refused, and a deletion, an unpairable
// leftover or one old name renamed two ways stops the table. The images are
// built here in code, in the shape `buf build -o <file>.json` writes. Run via
// `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeRenameTable,
  goCamelCase,
  protoCamelCase,
  RenameTableError,
  tsEnumValueNames,
  withHandNames,
} from "./contract-rename-table.mjs";

const field = (name, number, extra = {}) => ({ name, number, jsonName: protoCamelCase(name), ...extra });

function baseImage() {
  return {
    file: [
      {
        name: "ai/x/agentrun/v1/api.proto",
        package: "ai.x.agentrun.v1",
        messageType: [
          {
            name: "AgentRun",
            field: [field("agent_run_id", 1, { oneofIndex: 0 }), field("note", 2)],
            oneofDecl: [{ name: "target" }],
            nestedType: [{ name: "Inner", field: [field("value", 1)] }],
          },
          { name: "ScheduleRun", field: [field("run_id", 1)] },
        ],
        enumType: [
          {
            name: "AgentRunWindow",
            value: [
              { name: "AGENT_RUN_WINDOW_UNSPECIFIED", number: 0 },
              { name: "AGENT_RUN_WINDOW_DAY", number: 1 },
            ],
          },
        ],
        service: [{ name: "AgentRunQuery", method: [{ name: "get" }, { name: "listRuns" }] }],
      },
      {
        name: "ai/x/kind.proto",
        package: "ai.x",
        messageType: [{ name: "Meta", field: [field("id_prefix", 1)] }],
        enumType: [
          {
            name: "Kind",
            value: [
              { name: "agent_run", number: 41 },
              { name: "session", number: 42 },
            ],
          },
        ],
      },
    ],
  };
}

function headImage() {
  return {
    file: [
      {
        name: "ai/x/kind.proto",
        package: "ai.x",
        messageType: [{ name: "Meta", field: [field("id_prefix", 1), field("retired_id_prefixes", 10)] }],
        enumType: [
          {
            name: "Kind",
            value: [
              { name: "run", number: 41 },
              { name: "session", number: 42 },
            ],
          },
        ],
      },
      {
        name: "ai/x/run/v1/api.proto",
        package: "ai.x.run.v1",
        messageType: [
          {
            name: "Run",
            field: [field("run_id", 1, { oneofIndex: 0 }), field("note", 2)],
            oneofDecl: [{ name: "target" }],
            nestedType: [{ name: "Inner", field: [field("value", 1)] }],
          },
          { name: "ScheduleFire", field: [field("run_id", 1)] },
        ],
        enumType: [
          {
            name: "RunWindow",
            value: [
              { name: "RUN_WINDOW_UNSPECIFIED", number: 0 },
              { name: "RUN_WINDOW_DAY", number: 1 },
            ],
          },
        ],
        service: [{ name: "RunQuery", method: [{ name: "get" }, { name: "listFires" }] }],
      },
    ],
  };
}

test("generated spellings follow the generators: protobuf-es and protoc-gen-go", () => {
  assert.equal(protoCamelCase("agent_run_id"), "agentRunId");
  assert.equal(goCamelCase("agent_run_id"), "AgentRunId");
  assert.equal(goCamelCase("Outer.Inner"), "Outer_Inner");
  assert.equal(goCamelCase("http2_port"), "Http2Port");
  assert.equal(goCamelCase("_x"), "XX", "a leading underscore becomes X");
  assert.deepEqual(tsEnumValueNames("AgentRunWindow", ["AGENT_RUN_WINDOW_UNSPECIFIED", "AGENT_RUN_WINDOW_DAY"]), [
    "UNSPECIFIED",
    "DAY",
  ]);
  assert.deepEqual(
    tsEnumValueNames("Kind", ["agent_run", "session"]),
    ["agent_run", "session"],
    "no shared prefix, nothing stripped",
  );
  assert.deepEqual(
    tsEnumValueNames("Size", ["SIZE_1X", "SIZE_SMALL"]),
    ["SIZE_1X", "SIZE_SMALL"],
    "a stripped name may not start with a digit",
  );
});

test("a package move pairs its files by base name and maps modules, directories and the Go alias", () => {
  const t = computeRenameTable(baseImage(), headImage());
  assert.deepEqual(t.files, [{ from: "ai/x/agentrun/v1/api.proto", to: "ai/x/run/v1/api.proto" }]);
  assert.deepEqual(t.packages, { "ai.x.agentrun.v1": "ai.x.run.v1" });
  assert.deepEqual(t.directories, { "ai/x/agentrun/v1": "ai/x/run/v1" });
  assert.deepEqual(t.ts.modules, {
    "ai/x/agentrun/v1/api_pb": "ai/x/run/v1/api_pb",
    "ai/x/agentrun/v1/api_connect": "ai/x/run/v1/api_connect",
  });
  assert.deepEqual(t.go.packageAliases, { agentrunv1: "runv1" });
  assert.equal(t.ts.identifiers.file_ai_x_agentrun_v1_api, "file_ai_x_run_v1_api", "protobuf-es's file descriptor");
  assert.equal(t.go.identifiers.File_ai_x_agentrun_v1_api_proto, "File_ai_x_run_v1_api_proto", "protoc-gen-go's");
  assert.equal(t.ts.identifiers.file_ai_x_kind, undefined, "a file that did not move keeps its descriptor name");
});

test("messages, fields, oneofs, enums, values, services and methods pair and map per language", () => {
  const t = computeRenameTable(baseImage(), headImage());
  const ts = t.ts.identifiers;
  assert.equal(ts.AgentRun, "Run");
  assert.equal(ts.AgentRunSchema, "RunSchema");
  assert.equal(ts.AgentRun_Inner, "Run_Inner", "a nested message is joined by _");
  assert.equal(ts.agentRunId, "runId");
  assert.equal(ts.ScheduleRun, "ScheduleFire");
  assert.equal(ts.AgentRunWindow, "RunWindow");
  assert.equal(ts.DAY, undefined, "a value whose stripped name is unchanged is not a rename in TypeScript");
  assert.equal(ts.agent_run, "run");
  assert.equal(ts.AgentRunQuery, "RunQuery");
  assert.equal(ts.listRuns, "listFires");
  assert.equal(ts.note, undefined, "an unchanged field is not in the table");
  assert.equal(ts.target, undefined, "an unchanged oneof is not in the table");

  const go = t.go.identifiers;
  assert.equal(go.AgentRunId, "RunId");
  assert.equal(go.GetAgentRunId, "GetRunId");
  assert.equal(go.AgentRun_AgentRunId, "Run_RunId", "a oneof arm's wrapper type");
  assert.equal(go.AgentRun_Inner, "Run_Inner");
  assert.equal(go.Kind_agent_run, "Kind_run");
  assert.equal(go.AgentRunWindow_AGENT_RUN_WINDOW_DAY, "RunWindow_RUN_WINDOW_DAY");
  assert.equal(go.ListRuns, "ListFires");

  assert.deepEqual(t.json, {
    agentRunId: "runId",
    AGENT_RUN_WINDOW_UNSPECIFIED: "RUN_WINDOW_UNSPECIFIED",
    AGENT_RUN_WINDOW_DAY: "RUN_WINDOW_DAY",
    agent_run: "run",
  });
  assert.deepEqual(t.rpc, {
    "ai.x.agentrun.v1.AgentRunQuery/get": "ai.x.run.v1.RunQuery/get",
    "ai.x.agentrun.v1.AgentRunQuery/listRuns": "ai.x.run.v1.RunQuery/listFires",
  });
  assert.equal(t.typeNames["ai.x.agentrun.v1.AgentRun.Inner"], "ai.x.run.v1.Run.Inner");
});

test("an added field is listed, not refused, and is not a rename", () => {
  const t = computeRenameTable(baseImage(), headImage());
  assert.deepEqual(t.added, [{ kind: "field", name: "ai.x.Meta.retired_id_prefixes" }]);
  assert.equal(t.ts.identifiers.idPrefix, undefined);
  assert.ok(!t.renamed.some((r) => r.from.startsWith("ai.x.Meta")));
});

test("a field gone from the head stops the table: that is a deletion, not a rename", () => {
  const head = headImage();
  head.file[1].messageType[0].field.pop();
  assert.throws(
    () => computeRenameTable(baseImage(), head),
    (err) => err instanceof RenameTableError && /note = 2 is gone/.test(err.message),
  );
});

test("leftovers that cannot pair one to one stop the table", () => {
  const head = headImage();
  head.file[1].messageType.push({ name: "Extra", field: [] });
  head.file[1].messageType[1].name = "Other";
  const base = baseImage();
  base.file[0].messageType.push({ name: "Third", field: [] });
  base.file[0].messageType.push({ name: "Fourth", field: [] });
  assert.throws(
    () => computeRenameTable(base, head),
    (err) => err instanceof RenameTableError && /pair with nothing one to one/.test(err.message),
  );
});

test("a moved directory that matches two head directories stops the table", () => {
  const head = headImage();
  head.file.push({ ...structuredClone(head.file[1]), name: "ai/x/twin/v1/api.proto", package: "ai.x.twin.v1" });
  assert.throws(
    () => computeRenameTable(baseImage(), head),
    (err) => err instanceof RenameTableError && /2 moved directories/.test(err.message),
  );
});

test("one old name renamed two ways is a conflict, because a rewrite sees only the name", () => {
  const head = headImage();
  head.file[1].messageType[1].field[0] = field("fire_run_id", 1);
  const base = baseImage();
  base.file[0].messageType[1].field[0] = field("agent_run_id", 1);
  assert.throws(
    () => computeRenameTable(base, head),
    (err) => err instanceof RenameTableError && /agentRunId is renamed to both runId and fireRunId/.test(err.message),
  );
});

test("a hand list adds the names generators do not derive, and may not contradict them", () => {
  const t = computeRenameTable(baseImage(), headImage());
  const merged = withHandNames(t, { ts: { useCreateAgentRun: "useCreateRun" }, go: { AgentRunClient: "RunClient" } });
  assert.equal(merged.ts.identifiers.useCreateAgentRun, "useCreateRun");
  assert.equal(merged.ts.identifiers.AgentRun, "Run");
  assert.equal(merged.go.identifiers.AgentRunClient, "RunClient");
  assert.throws(
    () => withHandNames(t, { ts: { AgentRun: "AgentRunV2" } }),
    /AgentRun is Run in the contract and AgentRunV2/,
  );
});
