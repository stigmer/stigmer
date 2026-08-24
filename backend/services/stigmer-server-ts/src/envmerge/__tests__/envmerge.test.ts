/**
 * Ports backend/libs/go/envmerge/merge_test.go case-for-case: the merge
 * priority chain, the least-privilege filter, and required-key
 * validation. Go's nil-slice cases map to empty arrays/records; the
 * same-map-reference test carries over because the TS filter has the
 * same no-copy contract for empty declarations.
 */
import { describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type {
  EnvVarDeclaration,
  EnvironmentValue,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import {
  EnvVarDeclarationSchema,
  EnvironmentValueSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";

import {
  filterByDeclaredKeys,
  mergeEnvironmentLayers,
  validateRequiredKeys,
} from "../envmerge.js";

function envVal(value: string, isSecret: boolean): EnvironmentValue {
  return create(EnvironmentValueSchema, { value, isSecret });
}

function execVal(value: string, isSecret: boolean): ExecutionValue {
  return create(ExecutionValueSchema, { value, isSecret });
}

function decl(isSecret: boolean, optional = false): EnvVarDeclaration {
  return create(EnvVarDeclarationSchema, { isSecret, optional });
}

function makeEnv(data: { [key: string]: EnvironmentValue }): Environment {
  return create(EnvironmentSchema, { spec: { data } });
}

describe("mergeEnvironmentLayers", () => {
  const cases: Array<{
    name: string;
    environments: Environment[];
    runtimeEnv: { [key: string]: ExecutionValue };
    wantKeys: { [key: string]: ExecutionValue };
  }> = [
    {
      name: "all empty inputs returns empty map",
      environments: [],
      runtimeEnv: {},
      wantKeys: {},
    },
    {
      name: "single environment",
      environments: [
        makeEnv({
          API_KEY: envVal("key-123", true),
          REGION: envVal("us-east-1", false),
        }),
      ],
      runtimeEnv: {},
      wantKeys: {
        API_KEY: execVal("key-123", true),
        REGION: execVal("us-east-1", false),
      },
    },
    {
      name: "multiple environments merge in order — later wins",
      environments: [
        makeEnv({
          KEY1: envVal("env1-val", false),
          SHARED: envVal("from-env1", false),
        }),
        makeEnv({
          KEY2: envVal("env2-val", false),
          SHARED: envVal("from-env2", false),
        }),
      ],
      runtimeEnv: {},
      wantKeys: {
        KEY1: execVal("env1-val", false),
        KEY2: execVal("env2-val", false),
        SHARED: execVal("from-env2", false),
      },
    },
    {
      name: "environment entries with empty values are skipped",
      environments: [
        makeEnv({
          FILLED: envVal("value", false),
          EMPTY: envVal("", false),
        }),
      ],
      runtimeEnv: {},
      wantKeys: { FILLED: execVal("value", false) },
    },
    {
      name: "runtime_env overrides environments",
      environments: [makeEnv({ SHARED: envVal("env", false) })],
      runtimeEnv: { SHARED: execVal("runtime", true) },
      wantKeys: { SHARED: execVal("runtime", true) },
    },
    {
      name: "full priority chain — env < runtime",
      environments: [
        makeEnv({
          ENV_AND_RUNTIME: envVal("e-val", false),
          ENV_ONLY: envVal("from-env", false),
          BOTH: envVal("e-val", false),
        }),
      ],
      runtimeEnv: {
        BOTH: execVal("r-val", false),
        RUNTIME_ONLY: execVal("from-runtime", false),
      },
      wantKeys: {
        ENV_AND_RUNTIME: execVal("e-val", false),
        BOTH: execVal("r-val", false),
        ENV_ONLY: execVal("from-env", false),
        RUNTIME_ONLY: execVal("from-runtime", false),
      },
    },
  ];

  for (const tt of cases) {
    it(tt.name, () => {
      const got = mergeEnvironmentLayers(tt.environments, tt.runtimeEnv);
      expect(got.size).toBe(Object.keys(tt.wantKeys).length);
      for (const [key, wantVal] of Object.entries(tt.wantKeys)) {
        const gotVal = got.get(key);
        expect(gotVal, `missing key ${key}`).toBeDefined();
        expect(gotVal?.value, `key ${key} value`).toBe(wantVal.value);
        expect(gotVal?.isSecret, `key ${key} isSecret`).toBe(wantVal.isSecret);
      }
    });
  }

  it("explicitly-undefined runtime_env entries are skipped (Go nil entries)", () => {
    const runtimeEnv = { GOOD: execVal("ok", false) } as {
      [key: string]: ExecutionValue;
    };
    (runtimeEnv as Record<string, ExecutionValue | undefined>)["NIL"] =
      undefined;
    const got = mergeEnvironmentLayers([], runtimeEnv);
    expect([...got.keys()]).toEqual(["GOOD"]);
  });
});

describe("filterByDeclaredKeys", () => {
  const cases: Array<{
    name: string;
    merged: Map<string, ExecutionValue>;
    declarations: { [key: string]: EnvVarDeclaration };
    wantFilteredKeys: string[];
    wantExcluded: string[];
  }> = [
    {
      name: "empty declarations passes all through",
      merged: new Map([
        ["A", execVal("a", false)],
        ["B", execVal("b", false)],
      ]),
      declarations: {},
      wantFilteredKeys: ["A", "B"],
      wantExcluded: [],
    },
    {
      name: "only declared vars pass through",
      merged: new Map([
        ["DECLARED", execVal("val", false)],
        ["UNDECLARED", execVal("secret", true)],
      ]),
      declarations: { DECLARED: decl(false) },
      wantFilteredKeys: ["DECLARED"],
      wantExcluded: ["UNDECLARED"],
    },
    {
      name: "secret declarations allow those keys",
      merged: new Map([
        ["GITHUB_TOKEN", execVal("ghp_abc123", true)],
        ["EXTRA", execVal("not-needed", false)],
      ]),
      declarations: { GITHUB_TOKEN: decl(true) },
      wantFilteredKeys: ["GITHUB_TOKEN"],
      wantExcluded: ["EXTRA"],
    },
    {
      name: "all merged keys in declarations — no exclusion",
      merged: new Map([
        ["A", execVal("a", false)],
        ["B", execVal("b", false)],
      ]),
      declarations: { A: decl(false), B: decl(false), C: decl(false) },
      wantFilteredKeys: ["A", "B"],
      wantExcluded: [],
    },
    {
      name: "excluded keys are sorted alphabetically",
      merged: new Map([
        ["ZEBRA", execVal("z", false)],
        ["APPLE", execVal("a", false)],
        ["MANGO", execVal("m", false)],
        ["KEEP", execVal("k", false)],
      ]),
      declarations: { KEEP: decl(false) },
      wantFilteredKeys: ["KEEP"],
      wantExcluded: ["APPLE", "MANGO", "ZEBRA"],
    },
    {
      name: "empty merged map returns empty",
      merged: new Map(),
      declarations: { A: decl(false) },
      wantFilteredKeys: [],
      wantExcluded: [],
    },
    {
      name: "runtime overrides for undeclared vars are excluded",
      merged: new Map([
        ["DECLARED", execVal("from-runtime", false)],
        ["RUNTIME_EXTRA", execVal("injected", true)],
      ]),
      declarations: { DECLARED: decl(false) },
      wantFilteredKeys: ["DECLARED"],
      wantExcluded: ["RUNTIME_EXTRA"],
    },
  ];

  for (const tt of cases) {
    it(tt.name, () => {
      const { filtered, excludedKeys } = filterByDeclaredKeys(
        tt.merged,
        tt.declarations,
      );
      expect([...filtered.keys()].sort()).toEqual(
        [...tt.wantFilteredKeys].sort(),
      );
      expect(excludedKeys).toEqual(tt.wantExcluded);
    });
  }

  it("returns the same map reference when declarations are empty", () => {
    const original = new Map([["KEY", execVal("val", false)]]);
    const { filtered, excludedKeys } = filterByDeclaredKeys(original, {});
    expect(excludedKeys).toEqual([]);
    original.set("NEW_KEY", execVal("new", false));
    expect(filtered.has("NEW_KEY")).toBe(true);
  });
});

describe("validateRequiredKeys", () => {
  const cases: Array<{
    name: string;
    filtered: Map<string, ExecutionValue>;
    declarations: { [key: string]: EnvVarDeclaration };
    wantMissing: string[];
  }> = [
    {
      name: "empty declarations — nothing required",
      filtered: new Map(),
      declarations: {},
      wantMissing: [],
    },
    {
      name: "all required keys present — valid",
      filtered: new Map([["API_KEY", execVal("k", true)]]),
      declarations: { API_KEY: decl(true, false) },
      wantMissing: [],
    },
    {
      name: "required key missing — reported",
      filtered: new Map(),
      declarations: { API_KEY: decl(true, false) },
      wantMissing: ["API_KEY"],
    },
    {
      name: "optional key missing — not reported",
      filtered: new Map(),
      declarations: { LOG_LEVEL: decl(false, true) },
      wantMissing: [],
    },
    {
      name: "mix of required present, required missing, optional missing",
      filtered: new Map([["PRESENT", execVal("v", false)]]),
      declarations: {
        PRESENT: decl(false, false),
        MISSING_REQUIRED: decl(true, false),
        MISSING_OPTIONAL: decl(false, true),
      },
      wantMissing: ["MISSING_REQUIRED"],
    },
    {
      name: "multiple missing required keys — sorted alphabetically",
      filtered: new Map(),
      declarations: {
        ZEBRA_KEY: decl(false, false),
        ALPHA_KEY: decl(true, false),
        MIDDLE: decl(false, false),
      },
      wantMissing: ["ALPHA_KEY", "MIDDLE", "ZEBRA_KEY"],
    },
    {
      name: "all optional — nothing required",
      filtered: new Map(),
      declarations: { OPT_A: decl(false, true), OPT_B: decl(true, true) },
      wantMissing: [],
    },
  ];

  for (const tt of cases) {
    it(tt.name, () => {
      expect(validateRequiredKeys(tt.filtered, tt.declarations)).toEqual(
        tt.wantMissing,
      );
    });
  }
});
