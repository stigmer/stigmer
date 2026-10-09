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
  iam_policy: {
    revision: 1,
    fingerprint: "iam_policy{principal=field:spec.principal.id}",
  },
  memory: {
    revision: 1,
    fingerprint: "memory{subject=field:spec.subject_identity_account_id}",
  },
  organization: {
    revision: 1,
    fingerprint: "organization{parent_org=field:spec.parent_org}",
  },
  // The run kind's stored name changed (SQLite v21, Postgres v16) and its
  // keys did not; the step renames the rows' kind column, so the facts
  // already derived stay trusted under the same revision.
  run: {
    revision: 1,
    fingerprint: "run{session=field:spec.session_id}",
  },
  score: {
    revision: 1,
    fingerprint: "score{run=field:spec.run_id,session=field:spec.session_id}",
  },
  evaluator: {
    revision: 1,
    fingerprint: "evaluator{agent=field:spec.agent_id}",
  },
  session: {
    revision: 2,
    fingerprint:
      "session{agent=field:status.agent_id,channel=label:stigmer.ai/channel-id}",
  },
  vault: {
    revision: 1,
    fingerprint: "vault{person=field:spec.person}",
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
