/**
 * Pins what every eval activity reads first, over a real store and a real
 * suite read by `readEvalSuite`:
 *
 *   - the loader answers undefined for an eval gone, an eval with no spec,
 *     and an eval whose plugin is gone, so an activity plans nothing rather
 *     than failing; a store fault other than "not found" is thrown, so the
 *     activity is retried rather than treating a transient fault as a gone
 *     eval;
 *   - the suite cache keeps eight digests and drops the oldest: a ninth
 *     digest evicts the first read, which is then read from the archive
 *     again, while the others stay cached;
 *   - `wantedFilesOf` names each file a regex target or an `llm` focus
 *     reads, once, in order, and nothing for graders that read no file;
 *   - `loadRun` answers undefined for an empty id without asking the store.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EvalGrader, EvalGraderCheck } from "@stigmer/plugin-package";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { loadRun, newEvalContextLoader, wantedFilesOf } from "../context.js";
import {
  EVAL_ID,
  ORG,
  PLUGIN_ID,
  catalog,
  seedEval,
  seedPlugin,
  suiteSource,
} from "./support.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

function loader(
  source: ReturnType<typeof suiteSource> = suiteSource(),
  store: Store = temp.store,
) {
  return newEvalContextLoader({ store, suites: source, catalog });
}

/** An eval of the seeded plugin pinned to `digest`. */
async function seedEvalAt(id: string, digest: string): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.plugin_eval,
    id,
    PluginEvalSchema,
    create(PluginEvalSchema, {
      metadata: { id, org: ORG, name: id },
      spec: create(PluginEvalSpecSchema, {
        pluginId: PLUGIN_ID,
        pluginDigest: digest,
        runs: 1,
      }),
    }),
  );
}

/** A store whose every read fails with a fault that is not "not found". */
function faultyReads(store: Store): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "getResource") {
        return () => Promise.reject(new Error("the database is unreachable"));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("the eval context loader", () => {
  it("answers undefined for an eval gone, and reads no suite", async () => {
    const source = suiteSource();
    expect(await loader(source)(EVAL_ID)).toBeUndefined();
    expect(source.reads).toBe(0);
  });

  it("answers undefined for an eval stored with no spec", async () => {
    await seedPlugin(temp.store);
    await temp.store.saveResource(
      ApiResourceKind.plugin_eval,
      EVAL_ID,
      PluginEvalSchema,
      create(PluginEvalSchema, {
        metadata: { id: EVAL_ID, org: ORG, name: EVAL_ID },
      }),
    );
    const source = suiteSource();
    expect(await loader(source)(EVAL_ID)).toBeUndefined();
    expect(source.reads).toBe(0);
  });

  it("answers undefined when the eval's plugin is gone", async () => {
    await seedEval(temp.store);
    const source = suiteSource();
    expect(await loader(source)(EVAL_ID)).toBeUndefined();
    expect(source.reads).toBe(0);
  });

  it("throws a store fault that is not a missing row", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    await expect(
      loader(suiteSource(), faultyReads(temp.store))(EVAL_ID),
    ).rejects.toThrow("the database is unreachable");
  });

  it("keeps eight suites by digest and reads the oldest again once a ninth evicts it", async () => {
    await seedPlugin(temp.store);
    const digests = Array.from({ length: 9 }, (_, index) =>
      String(index + 1).repeat(64),
    );
    for (const [index, digest] of digests.entries()) {
      await seedEvalAt(`pev_${index + 1}`, digest);
    }
    const source = suiteSource();
    const load = loader(source);

    for (let index = 1; index <= 8; index++) {
      expect((await load(`pev_${index}`))?.digest).toBe(digests[index - 1]);
    }
    expect(source.reads).toBe(8);

    await load("pev_9");
    expect(source.reads).toBe(9);
    await load("pev_9");
    await load("pev_2");
    expect(source.reads, "the newest and the second digest stay cached").toBe(
      9,
    );
    await load("pev_1");
    expect(source.reads, "the first digest was evicted").toBe(10);
  });
});

function grader(check: EvalGraderCheck, name: string): EvalGrader {
  return { name, path: `evals/c/graders/${name}.md`, weight: 1, check };
}

describe("wantedFilesOf", () => {
  it("names each file a regex target or an llm focus reads, once and in order", () => {
    const graders: EvalGrader[] = [
      grader(
        {
          type: "regex",
          pattern: "x",
          flags: "",
          match: { kind: "contains" },
          target: { kind: "file", path: "CHANGELOG.md" },
        },
        "changelog",
      ),
      grader({ type: "tool_used", tool: "Read", min: 1 }, "read"),
      grader(
        {
          type: "llm",
          criteria: "PASS if it is tidy",
          focus: { kind: "file", path: "src/a.ts" },
        },
        "tidy",
      ),
      grader(
        {
          type: "llm",
          criteria: "PASS if it is short",
          focus: { kind: "file", path: "CHANGELOG.md" },
        },
        "short",
      ),
      grader(
        {
          type: "regex",
          pattern: "y",
          flags: "",
          match: { kind: "contains" },
          target: { kind: "last_message" },
        },
        "message",
      ),
      grader(
        { type: "baseline", baselineFile: "ref.jsonl", criteria: "as good" },
        "baseline",
      ),
    ];
    expect(wantedFilesOf(graders)).toEqual(["CHANGELOG.md", "src/a.ts"]);
  });

  it("names nothing for graders that read no file", () => {
    expect(
      wantedFilesOf([grader({ type: "tool_used", tool: "Bash", min: 0 }, "b")]),
    ).toEqual([]);
  });
});

describe("loadRun", () => {
  it("answers undefined for an empty id without asking the store", async () => {
    expect(await loadRun(faultyReads(temp.store), "")).toBeUndefined();
  });

  it("answers undefined for a run that is not stored", async () => {
    expect(await loadRun(temp.store, "run_missing")).toBeUndefined();
  });
});
