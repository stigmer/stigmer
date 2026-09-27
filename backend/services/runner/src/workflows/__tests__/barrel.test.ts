/**
 * The fence on what a runner registers. Every export of `workflows/index.ts`
 * is a Temporal workflow type on every worker root, and anyone who can
 * reach Temporal can start any of them on a runner's queue. So the set is
 * pinned exactly: the three types the server starts, each by id, none of
 * which takes a model to run. A new export fails here until this list, and
 * the review that comes with changing it, admits it.
 *
 * It also pins the link to the `run.workflow` refusal
 * (`workflow-engine/tasks/run.ts`): every registered type carries
 * `PLATFORM_WORKFLOW_TYPE_PREFIX`, so a workflow can never name one as its
 * child. And it pins the test barrel (`src/__test-utils__/workflows/`) to
 * the production set plus its one inline entry, under the name the tests
 * start it by, since an export alias cannot import that constant.
 */

import { describe, expect, it } from "vitest";

import * as barrel from "../index.js";
import * as testBarrel from "../../__test-utils__/workflows/index.js";
import { INLINE_MODEL_WORKFLOW_TYPE } from "../../__test-utils__/workflows/inline-model.js";
import { EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE } from "../execute-from-execution.js";
import { PLATFORM_WORKFLOW_TYPE_PREFIX } from "../../workflow-engine/tasks/run.js";

describe("the registered workflow types", () => {
  it("are exactly the types the server starts", () => {
    expect(Object.keys(barrel).sort()).toEqual(
      [
        "stigmer/mcp-server/connect",
        "stigmer/mcp-server/discover",
        EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE,
      ].sort(),
    );
  });

  it("include no type that runs a model handed to it", () => {
    expect(Object.keys(barrel)).not.toContain("stigmer/workflow/execute");
  });

  it("all carry the platform prefix the run.workflow refusal checks", () => {
    for (const type of Object.keys(barrel)) {
      expect(type.startsWith(PLATFORM_WORKFLOW_TYPE_PREFIX), type).toBe(true);
    }
  });

  it("are what the test barrel adds its inline entry to, outside the platform prefix", () => {
    expect(Object.keys(testBarrel).sort()).toEqual(
      [...Object.keys(barrel), INLINE_MODEL_WORKFLOW_TYPE].sort(),
    );
    expect(INLINE_MODEL_WORKFLOW_TYPE.startsWith(PLATFORM_WORKFLOW_TYPE_PREFIX)).toBe(false);
  });
});
