/**
 * Pins what every eval run activity reads first, over a real store and a
 * real suite read by `readEvalSuite`:
 *
 *   - an eval run about a plugin runs the built-in assistant (no agent)
 *     with that plugin listed in both arms, compared, so the without arm
 *     leaves it out;
 *   - the loader answers undefined for an eval run gone, one with no spec,
 *     and one whose plugin is gone, so an activity plans nothing rather
 *     than failing; a store fault other than "not found" is thrown, so the
 *     activity is retried rather than treating a transient fault as a gone
 *     eval run;
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
import { EvalRunSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { attachmentOf, loadRun, newEvalContextLoader, wantedFilesOf } from "../context.js";
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

/** An eval run of the seeded plugin pinned to `digest`, an archived version of the plugin held at it. */
async function seedEvalAt(id: string, digest: string): Promise<void> {
  const plugin = await temp.store.getResource(ApiResourceKind.plugin, PLUGIN_ID, PluginSchema);
  plugin.status!.digest = digest;
  await temp.store.saveAudit(ApiResourceKind.plugin, PLUGIN_ID, PluginSchema, plugin, digest, `1.0.${id}`);
  await temp.store.saveResource(
    ApiResourceKind.eval_run,
    id,
    EvalRunSchema,
    create(EvalRunSchema, {
      metadata: { id, org: ORG, name: id },
      spec: create(EvalRunSpecSchema, {
        subject: { case: "pluginId", value: PLUGIN_ID },
        pluginDigest: digest,
        runs: 1,
      }),
      status: { plugins: [{ pluginId: PLUGIN_ID, pluginSlug: "thermos", pluginDigest: digest, compared: true }] },
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

describe("the eval run context loader", () => {
  it("runs an eval run about a plugin on the built-in assistant, the plugin listed in both arms and left out of one", async () => {
    await seedPlugin(temp.store);
    await seedEval(temp.store);
    const context = await loader()(EVAL_ID);
    if (context === undefined) throw new Error("no context");
    expect([context.agent, context.comparedPluginId, context.twoArms]).toEqual([undefined, PLUGIN_ID, true]);
    expect(context.ownServers).toEqual([]);
    const without = attachmentOf(context, "without");
    expect(without.agentRef).toBeUndefined();
    expect(without.plugins.map((ref) => ref.id)).toEqual([PLUGIN_ID]);
    expect(without.excludedPluginIds).toEqual([PLUGIN_ID]);
    expect(attachmentOf(context, "with").excludedPluginIds).toEqual([]);
  });

  it("answers undefined for an eval gone, and reads no suite", async () => {
    const source = suiteSource();
    expect(await loader(source)(EVAL_ID)).toBeUndefined();
    expect(source.reads).toBe(0);
  });

  it("answers undefined for an eval stored with no spec", async () => {
    await seedPlugin(temp.store);
    await temp.store.saveResource(
      ApiResourceKind.eval_run,
      EVAL_ID,
      EvalRunSchema,
      create(EvalRunSchema, {
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
      await seedEvalAt(`evr_${index + 1}`, digest);
    }
    const source = suiteSource();
    const load = loader(source);

    for (let index = 1; index <= 8; index++) {
      const context = await load(`evr_${index}`);
      expect(context?.sources[0]?.digest).toBe(digests[index - 1]);
    }
    expect(source.reads).toBe(8);

    await load("evr_9");
    expect(source.reads).toBe(9);
    await load("evr_9");
    await load("evr_2");
    expect(source.reads, "the newest and the second digest stay cached").toBe(
      9,
    );
    await load("evr_1");
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
