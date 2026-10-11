/**
 * The fence on what a runner registers. Every export of `workflows/index.ts`
 * is a Temporal workflow type on every worker root, and anyone who can
 * reach Temporal can start any of them on a runner's queue. So the set is
 * pinned exactly: the two tools listing types the server starts (the
 * pinned `stigmer/mcp-server/*` names), each by plugin id and server name.
 * A new export fails here until this list, and the review that comes with
 * changing it, admits it.
 */

import { describe, expect, it } from "vitest";

import * as barrel from "../index.js";

describe("the registered workflow types", () => {
  it("are exactly the types the server starts", () => {
    expect(Object.keys(barrel).sort()).toEqual(
      ["stigmer/mcp-server/connect", "stigmer/mcp-server/discover"].sort(),
    );
  });
});
