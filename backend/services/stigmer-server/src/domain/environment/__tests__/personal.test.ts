/**
 * Pins the shared personal-environment lookup (personal.ts) on the seam
 * both its callers stand on: outcomes are VALUES (no personal environment;
 * resolved with the required keys still missing named), a declaration's
 * is_secret rides onto the value, optional keys are skipped silently in
 * every absent arm, only stored keys are read (existence before the
 * secret read; own-key membership), and a failing list is the one thrown
 * fault. The connect lane's refusals over these outcomes are pinned in
 * mcpserver/__tests__/connect.test.ts; the build's warnings in
 * agentexecution/__tests__/create-execution-context-step.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import {
  EnvVarDeclarationSchema,
  EnvironmentValueSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";

import { createLogger } from "../../../boot/logger.js";
import { PERSONAL_LABEL_KEY, PERSONAL_LABEL_VALUE } from "../constants.js";
import type { PersonalEnvironmentReader } from "../personal.js";
import { resolveDeclaredFromPersonalEnvironment } from "../personal.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** A declaration literal as the generated message. */
function decl(init: { isSecret: boolean; optional?: boolean }) {
  return create(EnvVarDeclarationSchema, init);
}

function readerOver(
  stored: Record<string, string>,
  reads: string[],
  failing: ReadonlySet<string> = new Set(),
): PersonalEnvironmentReader {
  return {
    list: async (request) => {
      expect(request.labels).toEqual({ [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE });
      return create(EnvironmentListSchema, {
        totalCount: 1,
        items: [
          create(EnvironmentSchema, {
            metadata: { id: "env_p", org: "acme", slug: "personal" },
            spec: {
              data: Object.fromEntries(
                Object.keys(stored).map((k) => [k, { value: "***", isSecret: true }]),
              ),
            },
          }),
        ],
      });
    },
    getSecretValue: async (input) => {
      const key = input.key ?? "";
      reads.push(key);
      if (failing.has(key)) {
        throw new ConnectError("decrypt failed", Code.Internal);
      }
      return create(EnvironmentValueSchema, { value: stored[key] ?? "", isSecret: true });
    },
  };
}

describe("resolveDeclaredFromPersonalEnvironment", () => {
  it("answers no-personal-environment as a value when the org has none", async () => {
    const reader: PersonalEnvironmentReader = {
      list: async () => create(EnvironmentListSchema, { totalCount: 0, items: [] }),
      getSecretValue: async () => {
        throw new Error("unreached");
      },
    };
    const out = await resolveDeclaredFromPersonalEnvironment(reader, silentLogger, "acme", {
      TOKEN: decl({ isSecret: true }),
    });
    expect(out).toEqual({ kind: "no-personal-environment" });
  });

  it("resolves stored keys with the declaration's is_secret, names missing required keys, skips optional ones", async () => {
    const reads: string[] = [];
    const reader = readerOver({ TOKEN: "t-1", PUBLIC_URL: "https://x", EMPTY: "" }, reads);
    const out = await resolveDeclaredFromPersonalEnvironment(reader, silentLogger, "acme", {
      TOKEN: decl({ isSecret: true }),
      PUBLIC_URL: decl({ isSecret: false }),
      EMPTY: decl({ isSecret: true }),
      ABSENT_REQUIRED: decl({ isSecret: true }),
      ABSENT_OPTIONAL: decl({ isSecret: true, optional: true }),
    });
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") return;
    expect(out.values["TOKEN"]?.value).toBe("t-1");
    expect(out.values["TOKEN"]?.isSecret).toBe(true);
    expect(out.values["PUBLIC_URL"]?.value).toBe("https://x");
    expect(out.values["PUBLIC_URL"]?.isSecret).toBe(false);
    // An empty stored value is absent; required → missing.
    expect(out.values["EMPTY"]).toBeUndefined();
    expect([...out.missing].sort()).toEqual(["ABSENT_REQUIRED", "EMPTY"]);
    // Only stored keys are read: absent declarations cost no secret read.
    expect(reads.sort()).toEqual(["EMPTY", "PUBLIC_URL", "TOKEN"]);
  });

  it("treats a failing secret read as absent: missing when required, skipped when optional", async () => {
    const reads: string[] = [];
    const reader = readerOver({ A: "a", B: "b" }, reads, new Set(["A", "B"]));
    const out = await resolveDeclaredFromPersonalEnvironment(reader, silentLogger, "acme", {
      A: decl({ isSecret: true }),
      B: decl({ isSecret: true, optional: true }),
    });
    expect(out).toEqual({ kind: "resolved", values: {}, missing: ["A"] });
  });

  it("never reads a prototype name as a stored key", async () => {
    const reads: string[] = [];
    const reader = readerOver({}, reads);
    const out = await resolveDeclaredFromPersonalEnvironment(reader, silentLogger, "acme", {
      constructor: decl({ isSecret: true }),
      toString: decl({ isSecret: true, optional: true }),
    });
    expect(out).toEqual({ kind: "resolved", values: {}, missing: ["constructor"] });
    expect(reads).toEqual([]);
  });

  it("throws Internal when the personal environment cannot be listed", async () => {
    const reader: PersonalEnvironmentReader = {
      list: async () => {
        throw new Error("store offline");
      },
      getSecretValue: async () => {
        throw new Error("unreached");
      },
    };
    await expect(
      resolveDeclaredFromPersonalEnvironment(reader, silentLogger, "acme", { A: decl({ isSecret: true }) }),
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
