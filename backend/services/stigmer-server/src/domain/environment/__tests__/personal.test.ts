/**
 * Pins the shared personal-environment lookup (personal.ts) on the seam
 * its callers stand on: WHOSE row it reads (the asked person's own in the
 * asked organization, never a teammate's, newest first should a race
 * leave two; nobody's for an empty person), and what it returns: outcomes
 * as VALUES (no personal environment; resolved with the required keys
 * still missing named), a declaration's is_secret riding onto the value,
 * optional keys skipped silently in every absent arm, only stored keys
 * read (existence before the secret read; own-key membership), and a
 * failing store scan the one thrown fault. The connect lane's refusals
 * over these outcomes are pinned in mcpserver/__tests__/connect.test.ts;
 * whose row a run reads in
 * agentexecution/__tests__/personal-environment-reach.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toBinary } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import {
  EnvVarDeclarationSchema,
  EnvironmentValueSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { PERSONAL_LABEL_KEY, PERSONAL_LABEL_VALUE } from "../constants.js";
import type { PersonalEnvironmentReader } from "../personal.js";
import {
  personalEnvironmentsOf,
  resolveDeclaredFromPersonalEnvironment,
} from "../personal.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "acme";
const ANA = "acc_ana";
const BEN = "acc_ben";

let dir: string;
let store: Store;

/** A declaration literal as the generated message. */
function decl(init: { isSecret: boolean; optional?: boolean }) {
  return create(EnvVarDeclarationSchema, init);
}

function seconds(at: number): Timestamp {
  return {
    $typeName: "google.protobuf.Timestamp",
    seconds: BigInt(at),
    nanos: 0,
  };
}

/** A row as the store holds it: the stored keys, its creator, its creation instant. */
function row(opts: {
  readonly id: string;
  readonly creator: string;
  readonly createdAt: number;
  readonly keys: readonly string[];
  readonly org?: string;
  readonly personal?: boolean;
}): Environment {
  return create(EnvironmentSchema, {
    metadata: {
      id: opts.id,
      org: opts.org ?? ORG,
      slug: opts.id,
      labels:
        opts.personal === false
          ? {}
          : { [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE },
    },
    spec: {
      data: Object.fromEntries(
        opts.keys.map((k) => [k, { value: "ciphertext", isSecret: true }]),
      ),
    },
    status: {
      audit: {
        specAudit: {
          createdBy: { id: opts.creator },
          createdAt: seconds(opts.createdAt),
        },
      },
    },
  });
}

const ROWS: readonly Environment[] = [
  // Ana's, saved after Ben's: an organization-wide newest-first list
  // would answer hers to everyone.
  row({ id: "env_ana", creator: ANA, createdAt: 3_000, keys: ["TOKEN"] }),
  row({
    id: "env_ben",
    creator: BEN,
    createdAt: 1_000,
    keys: ["TOKEN", "PUBLIC_URL", "EMPTY", "A", "B"],
  }),
  // A second row of Ben's, newer: a raced duplicate; the newest wins.
  row({ id: "env_ben_newer", creator: BEN, createdAt: 2_000, keys: ["TOKEN"] }),
  // Ben's in another organization, and a plain (non-personal) one of his.
  row({
    id: "env_ben_elsewhere",
    creator: BEN,
    createdAt: 4_000,
    keys: ["TOKEN"],
    org: "other",
  }),
  row({
    id: "env_ben_plain",
    creator: BEN,
    createdAt: 5_000,
    keys: ["TOKEN"],
    personal: false,
  }),
];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "env-personal-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  for (const env of ROWS) {
    await store.saveResource(
      ApiResourceKind.environment,
      env.metadata!.id,
      EnvironmentSchema,
      env,
    );
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Answers secret reads from `values` by (environment id, key), recording each; `failing` keys throw. */
function readerOver(
  values: Record<string, Record<string, string>>,
  reads: string[],
  failing: ReadonlySet<string> = new Set(),
): PersonalEnvironmentReader {
  return {
    getSecretValue: async (input) => {
      const id = input.environmentId ?? "";
      const key = input.key ?? "";
      reads.push(`${id}/${key}`);
      if (failing.has(key)) {
        throw new ConnectError("decrypt failed", Code.Internal);
      }
      return create(EnvironmentValueSchema, {
        value: values[id]?.[key] ?? "",
        isSecret: true,
      });
    },
  };
}

describe("personalEnvironmentsOf", () => {
  it("answers the person's own personal rows in the organization, newest first", async () => {
    const ids = (await personalEnvironmentsOf(store, ORG, BEN)).map(
      (e) => e.metadata?.id,
    );
    expect(ids).toEqual(["env_ben_newer", "env_ben"]);
  });

  it("never answers a teammate's row, whoever saved last", async () => {
    const ids = (await personalEnvironmentsOf(store, ORG, ANA)).map(
      (e) => e.metadata?.id,
    );
    expect(ids).toEqual(["env_ana"]);
  });

  it("skips a row that does not decode, as every scan does", async () => {
    const rows = [
      new Uint8Array([0x0f]),
      toBinary(EnvironmentSchema, ROWS[0]!),
    ];
    const scanning = { listResources: async () => rows } as unknown as Store;
    const ids = (await personalEnvironmentsOf(scanning, ORG, ANA)).map(
      (e) => e.metadata?.id,
    );
    expect(ids).toEqual(["env_ana"]);
  });

  it("answers nothing for a person with no row, and for an empty person", async () => {
    expect(await personalEnvironmentsOf(store, ORG, "acc_guest_lane")).toEqual(
      [],
    );
    expect(await personalEnvironmentsOf(store, ORG, "")).toEqual([]);
  });
});

describe("resolveDeclaredFromPersonalEnvironment", () => {
  it("answers no-personal-environment as a value when the person has none", async () => {
    const reads: string[] = [];
    const out = await resolveDeclaredFromPersonalEnvironment(
      readerOver({}, reads),
      store,
      silentLogger,
      ORG,
      "acc_carol",
      { TOKEN: decl({ isSecret: true }) },
    );
    expect(out).toEqual({ kind: "no-personal-environment" });
    expect(reads).toEqual([]);
  });

  it("reads only the asked person's row: Ben's run never reads Ana's", async () => {
    const reads: string[] = [];
    const out = await resolveDeclaredFromPersonalEnvironment(
      readerOver(
        { env_ana: { TOKEN: "ana" }, env_ben_newer: { TOKEN: "ben" } },
        reads,
      ),
      store,
      silentLogger,
      ORG,
      BEN,
      { TOKEN: decl({ isSecret: true }) },
    );
    expect(out.kind === "resolved" && out.values["TOKEN"]?.value).toBe("ben");
    expect(reads).toEqual(["env_ben_newer/TOKEN"]);
  });

  it("resolves stored keys with the declaration's is_secret, names missing required keys, skips optional ones", async () => {
    // Ana's one row holds TOKEN only; the rest are absent or empty.
    const reads: string[] = [];
    const out = await resolveDeclaredFromPersonalEnvironment(
      readerOver({ env_ana: { TOKEN: "t-1" } }, reads),
      store,
      silentLogger,
      ORG,
      ANA,
      {
        TOKEN: decl({ isSecret: false }),
        ABSENT_REQUIRED: decl({ isSecret: true }),
        ABSENT_OPTIONAL: decl({ isSecret: true, optional: true }),
      },
    );
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") return;
    expect(out.values["TOKEN"]?.value).toBe("t-1");
    expect(out.values["TOKEN"]?.isSecret).toBe(false);
    expect([...out.missing]).toEqual(["ABSENT_REQUIRED"]);
    // Only stored keys are read: absent declarations cost no secret read.
    expect(reads).toEqual(["env_ana/TOKEN"]);
  });

  it("an empty stored value is absent: missing when required", async () => {
    const reads: string[] = [];
    const out = await resolveDeclaredFromPersonalEnvironment(
      readerOver({ env_ana: { TOKEN: "" } }, reads),
      store,
      silentLogger,
      ORG,
      ANA,
      { TOKEN: decl({ isSecret: true }) },
    );
    expect(out).toEqual({ kind: "resolved", values: {}, missing: ["TOKEN"] });
  });

  it("treats a failing secret read as absent: missing when required, skipped when optional", async () => {
    // Ben's newest row holds TOKEN only; read it failing, required and optional.
    const reads: string[] = [];
    const required = await resolveDeclaredFromPersonalEnvironment(
      readerOver({}, reads, new Set(["TOKEN"])),
      store,
      silentLogger,
      ORG,
      BEN,
      { TOKEN: decl({ isSecret: true }) },
    );
    expect(required).toEqual({
      kind: "resolved",
      values: {},
      missing: ["TOKEN"],
    });
    const optional = await resolveDeclaredFromPersonalEnvironment(
      readerOver({}, reads, new Set(["TOKEN"])),
      store,
      silentLogger,
      ORG,
      BEN,
      { TOKEN: decl({ isSecret: true, optional: true }) },
    );
    expect(optional).toEqual({ kind: "resolved", values: {}, missing: [] });
  });

  it("never reads a prototype name as a stored key", async () => {
    const reads: string[] = [];
    const out = await resolveDeclaredFromPersonalEnvironment(
      readerOver({}, reads),
      store,
      silentLogger,
      ORG,
      ANA,
      {
        constructor: decl({ isSecret: true }),
        toString: decl({ isSecret: true, optional: true }),
      },
    );
    expect(out).toEqual({
      kind: "resolved",
      values: {},
      missing: ["constructor"],
    });
    expect(reads).toEqual([]);
  });

  it("throws Internal when the personal environments cannot be scanned", async () => {
    const failing = {
      listResources: async () => {
        throw new Error("store offline");
      },
    } as unknown as Store;
    await expect(
      resolveDeclaredFromPersonalEnvironment(
        readerOver({}, []),
        failing,
        silentLogger,
        ORG,
        ANA,
        { A: decl({ isSecret: true }) },
      ),
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
