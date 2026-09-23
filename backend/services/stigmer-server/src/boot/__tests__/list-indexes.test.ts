/**
 * Pins the list-indexed surface (list-indexes.ts). The table below is
 * every declaration's keys against its revision: a store trusts a row's
 * facts only under the revision they were derived with, so a change to a
 * declaration's keys without a new revision would read rows written under
 * the old keys as if they carried the new ones. Changing a declaration
 * therefore fails here until its revision is bumped and this table is
 * updated in the same change.
 */
import { describe, expect, it } from "vitest";

import {
  ListIndexRegistry,
  listIndexFingerprint,
} from "../../store/list-index.js";
import { LIST_INDEXES } from "../list-indexes.js";

const PINNED: Readonly<
  Record<string, { revision: number; fingerprint: string }>
> = {
  agent_execution: {
    revision: 1,
    fingerprint: "agent_execution{session=field:spec.session_id}",
  },
  artifact: {
    revision: 1,
    fingerprint:
      "artifact{agent_execution=field:spec.source.agent_execution_id,workflow_execution=field:spec.source.workflow_execution_id}",
  },
  session: {
    revision: 1,
    fingerprint:
      "session{agent_instance=field:spec.agent_instance_id,channel=label:stigmer.ai/channel-id}",
  },
  workflow_execution: {
    revision: 1,
    fingerprint:
      "workflow_execution{workflow=field:spec.workflow_id,workflow_instance=field:spec.workflow_instance_id}",
  },
};

describe("the list-indexed surface", () => {
  it("opens as one registry: no kind declared twice", () => {
    expect(() => new ListIndexRegistry(LIST_INDEXES)).not.toThrow();
  });

  it("declares exactly the pinned kinds", () => {
    const kinds = LIST_INDEXES.map(
      (d) => listIndexFingerprint(d).split("{")[0],
    );
    expect(kinds.sort()).toEqual(Object.keys(PINNED).sort());
  });

  it.each(LIST_INDEXES.map((d) => [listIndexFingerprint(d), d] as const))(
    "%s carries the revision its keys are pinned to",
    (fingerprint, declaration) => {
      const kind = fingerprint.split("{")[0] ?? "";
      const pinned = PINNED[kind];
      expect(
        { revision: declaration.revision, fingerprint },
        "a declaration's keys changed: bump its revision and update this table together",
      ).toEqual(pinned);
    },
  );
});
