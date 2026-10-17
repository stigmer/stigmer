/**
 * Pins update-mask.ts: what an update's mask may name, and what the merge
 * makes of the stored row.
 *
 *   - `*` names spec and the four editable metadata fields; a spec path
 *     at any depth through message fields is named as given;
 *   - refused, each with INVALID_ARGUMENT naming the path: an empty mask,
 *     any other metadata path, a path the kind does not have, a path
 *     through a list or a map, and a path the kind refuses (with who
 *     writes it), at it or under it;
 *   - the merge copies a set field and clears an unset one at each named
 *     path, replaces a list or a map whole, leaves every unnamed field as
 *     stored, and puts back a refused field under a broader path;
 *   - clearing a nested field creates no message along its path that the
 *     stored row lacks, so a clear of nothing changes nothing;
 *   - a chain reached without a mask names every path.
 */
import { clone, create } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";

import {
  EVERY_UPDATABLE_PATH,
  UPDATE_MASK_KEY,
  applyUpdateMask,
  checkUpdateMask,
  updateMaskOf,
} from "../update-mask.js";
import type { RefusedUpdatePath } from "../update-mask.js";

const VAULT_ENTRIES: ReadonlyArray<RefusedUpdatePath> = [
  { path: "spec.secrets", writtenBy: "setSecrets and removeSecrets" },
];

function stored(): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "org_1", slug: "reviewer", name: "Reviewer", labels: { team: "core" } },
    spec: {
      description: "reviews pull requests",
      instructions: "Review every pull request.",
      tools: ["Read", "Grep"],
      env: { A: { description: "first" } },
      runConfig: { modelName: "model-a", maxToolRounds: 7 },
    },
    status: { versionHash: "a1b2" },
  });
}

function refusalOf(action: () => unknown): ConnectError {
  try {
    action();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("checkUpdateMask", () => {
  it("expands * to spec and the three editable metadata fields, and keeps a spec path at any depth", () => {
    expect(checkUpdateMask(AgentSchema, [EVERY_UPDATABLE_PATH], [])).toEqual([
      "spec",
      "metadata.name",
      "metadata.labels",
      "metadata.tags",
    ]);
    expect(checkUpdateMask(AgentSchema, ["spec.run_config.model_name", "metadata.name"], [])).toEqual([
      "spec.run_config.model_name",
      "metadata.name",
    ]);
  });

  it("refuses an empty mask, another metadata path, an unknown path, and a path through a list or a map", () => {
    const cases: Array<[ReadonlyArray<string>, string]> = [
      [[], 'update_mask names no path: name the fields the update changes, or "*"'],
      [
        ["metadata.slug"],
        "update_mask path 'metadata.slug' cannot be updated: an update changes spec, metadata.name, metadata.labels and metadata.tags",
      ],
      [
        ["metadata.annotations"],
        "update_mask path 'metadata.annotations' cannot be updated: an update changes spec, metadata.name, metadata.labels and metadata.tags",
      ],
      [
        ["status.version_hash"],
        "update_mask path 'status.version_hash' cannot be updated: an update changes spec, metadata.name, metadata.labels and metadata.tags",
      ],
      [["spec.no_such_field"], "update_mask path 'spec.no_such_field' is not a field of Agent"],
      [["spec.env.A"], "update_mask path 'spec.env.A' is not a field of Agent"],
      [["spec.tools.name"], "update_mask path 'spec.tools.name' is not a field of Agent"],
      [["spec.instructions.length"], "update_mask path 'spec.instructions.length' is not a field of Agent"],
    ];
    for (const [paths, message] of cases) {
      const refused = refusalOf(() => checkUpdateMask(AgentSchema, paths, []));
      expect(refused.code, paths.join(",")).toBe(Code.InvalidArgument);
      expect(refused.rawMessage, paths.join(",")).toBe(message);
    }
  });

  it("refuses a path the kind refuses, at it or under it, naming who writes it; a broader path is not refused", () => {
    for (const path of ["spec.secrets"]) {
      const refused = refusalOf(() => checkUpdateMask(VaultSchema, [path], VAULT_ENTRIES));
      expect(refused.code).toBe(Code.InvalidArgument);
      expect(refused.rawMessage).toBe(
        `update_mask path '${path}' is written by setSecrets and removeSecrets, not by update`,
      );
    }
    expect(checkUpdateMask(VaultSchema, ["spec", "spec.description"], VAULT_ENTRIES)).toEqual([
      "spec",
      "spec.description",
    ]);
  });
});

describe("applyUpdateMask", () => {
  it("copies a named field, clears a named unset one, and leaves every other field as stored", () => {
    const row = stored();
    const request = create(AgentSchema, {
      metadata: { id: "agt_1", name: "Renamed" },
      spec: { instructions: "Review only drafts." },
    });
    const merged = clone(AgentSchema, row);
    applyUpdateMask(AgentSchema, merged, request, row, ["spec.instructions", "spec.description", "metadata.name"], []);

    expect(merged.spec?.instructions).toBe("Review only drafts.");
    expect(merged.spec?.description, "named and unset: cleared").toBe("");
    expect(merged.metadata?.name).toBe("Renamed");
    expect(merged.spec?.tools, "not named: as stored").toEqual(["Read", "Grep"]);
    expect(merged.spec?.runConfig?.modelName).toBe("model-a");
    expect(merged.metadata?.labels).toEqual({ team: "core" });
    expect(merged.metadata?.slug).toBe("reviewer");
    expect(merged.status?.versionHash).toBe("a1b2");
  });

  it("replaces a list or a map whole, and reaches a nested field without touching its siblings", () => {
    const row = stored();
    const request = create(AgentSchema, {
      spec: { tools: ["Edit"], env: { B: { isSecret: true } }, runConfig: { modelName: "model-b" } },
    });
    const merged = clone(AgentSchema, row);
    applyUpdateMask(AgentSchema, merged, request, row, ["spec.tools", "spec.env", "spec.run_config.model_name"], []);

    expect(merged.spec?.tools).toEqual(["Edit"]);
    expect(Object.keys(merged.spec?.env ?? {})).toEqual(["B"]);
    expect(merged.spec?.runConfig?.modelName).toBe("model-b");
    expect(merged.spec?.runConfig?.maxToolRounds, "a sibling under the named message").toBe(7);
  });

  it("creates the message a nested path goes through when the stored row has none", () => {
    const row = stored();
    row.spec!.runConfig = undefined;
    const request = create(AgentSchema, { spec: { runConfig: { modelName: "model-b" } } });
    const merged = clone(AgentSchema, row);
    applyUpdateMask(AgentSchema, merged, request, row, ["spec.run_config.model_name"], []);
    expect(merged.spec?.runConfig?.modelName).toBe("model-b");
  });

  it("creates no message a nested path goes through when the named field is cleared and the stored row has none", () => {
    const row = stored();
    row.spec!.runConfig = undefined;
    const merged = clone(AgentSchema, row);
    applyUpdateMask(AgentSchema, merged, create(AgentSchema), row, ["spec.run_config.model_name"], []);
    expect(merged.spec?.runConfig).toBeUndefined();
  });

  it("puts back a refused field under a broader path, so a whole desired state applies", () => {
    const row: Vault = create(VaultSchema, {
      metadata: { id: "vlt_1", org: "org_1", slug: "team", name: "Team" },
      spec: { description: "stored", secrets: { API_KEY: { value: "enc:v1:sealed" } } },
    });
    const request: Vault = create(VaultSchema, {
      metadata: { id: "vlt_1", name: "Team" },
      spec: { description: "applied", secrets: { FORGED: { value: "plain" } } },
    });
    const merged = clone(VaultSchema, row);
    applyUpdateMask(VaultSchema, merged, request, row, ["spec", "metadata.name"], VAULT_ENTRIES);
    expect(merged.spec?.description).toBe("applied");
    expect(Object.keys(merged.spec?.secrets ?? {})).toEqual(["API_KEY"]);
    expect(merged.spec?.secrets.API_KEY?.value).toBe("enc:v1:sealed");
  });
});

describe("updateMaskOf", () => {
  it("reads the paths the handler set, and names every path when none was set", () => {
    const values = new Map<string, unknown>([[UPDATE_MASK_KEY, ["spec.instructions"]]]);
    expect(updateMaskOf((key) => values.get(key))).toEqual(["spec.instructions"]);
    expect(updateMaskOf(() => undefined)).toEqual([EVERY_UPDATABLE_PATH]);
  });
});
