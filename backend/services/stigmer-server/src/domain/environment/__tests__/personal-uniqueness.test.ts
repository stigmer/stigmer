/**
 * EnforcePersonalEnvUniqueness (steps.ts) is per PERSON in an
 * organization: a member saving their own personal environment is never
 * refused because a teammate saved one first, and the same person's second
 * is refused with the pinned copy. Driven at the step over a real store,
 * because the composed environment suite (environment.test.ts) runs as one
 * trusted-local caller and cannot be two people.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { PERSONAL_LABEL_KEY, PERSONAL_LABEL_VALUE } from "../constants.js";
import { newEnforcePersonalUniquenessStep } from "../steps.js";

const ORG = "acme";

let dir: string;
let store: Store;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "env-personal-unique-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  // Ana's personal environment, already saved.
  await store.saveResource(
    ApiResourceKind.environment,
    "env_ana",
    EnvironmentSchema,
    create(EnvironmentSchema, {
      metadata: {
        id: "env_ana",
        org: ORG,
        slug: "env-ana",
        labels: { [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE },
      },
      status: { audit: { specAudit: { createdBy: { id: "acc_ana" } } } },
    }),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the step for a personal environment `creator` is creating in ORG. */
async function createAs(creator: string): Promise<void> {
  const ctx = new RequestContext(
    EnvironmentSchema,
    create(EnvironmentSchema, {
      metadata: {
        name: "Personal Environment",
        org: ORG,
        labels: { [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE },
      },
    }),
    testCallerIdentity({ identityId: creator }),
    ApiResourceKind.environment,
  );
  await newEnforcePersonalUniquenessStep(store).execute(ctx);
}

describe("personal-environment uniqueness is per person", () => {
  it("a second member saves their own personal environment beside a teammate's", async () => {
    await expect(createAs("acc_ben")).resolves.toBeUndefined();
  });

  it("the same person's second personal environment is refused with the pinned copy", async () => {
    const error = await createAs("acc_ana").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.AlreadyExists);
    expect((error as ConnectError).rawMessage).toBe(
      "a personal environment already exists for this organization: env_ana",
    );
  });
});
