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
  api_key: {
    revision: 1,
    fingerprint: "api_key{owner=field:status.audit.spec_audit.created_by.id}",
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
  // keys did not, so the rename kept revision 1; revision 2 added the judge
  // label's key, revision 3 the plugin eval label's, revision 4 the working
  // session's, revision 5 the schedule label's, revision 6 split the waiting
  // session out of the working one, revision 7 the recorded agent's.
  run: {
    revision: 7,
    fingerprint:
      "run{agent=field:status.agent_id,grades=label:stigmer.ai/grades-run,plugin_eval=label:stigmer.ai/plugin-eval,schedule=label:stigmer.ai/schedule-id,session=field:spec.session_id,waiting_session=fieldWhen:spec.session_id?status.phase=6,working_session=fieldWhen:spec.session_id?status.phase=1|2}",
  },
  // Revision 2 added the agent's key and the plugin eval label's, which an
  // agent's quality report and flagged list read.
  score: {
    revision: 2,
    fingerprint:
      "score{agent=field:status.agent_id,plugin_eval=label:stigmer.ai/plugin-eval,run=field:spec.run_id,session=field:spec.session_id}",
  },
  evaluator: {
    revision: 1,
    fingerprint: "evaluator{agent=field:spec.agent_id}",
  },
  plugin_eval: {
    revision: 1,
    fingerprint: "plugin_eval{plugin=field:spec.plugin_id}",
  },
  agent_eval: {
    revision: 1,
    fingerprint: "agent_eval{agent=field:spec.agent_id}",
  },
  // Revision 3 added the plugin eval label's key.
  session: {
    revision: 3,
    fingerprint:
      "session{agent=field:status.agent_id,channel=label:stigmer.ai/channel-id,plugin_eval=label:stigmer.ai/plugin-eval}",
  },
  vault: {
    revision: 1,
    fingerprint: "vault{person=field:spec.person}",
  },
  agent: { revision: 1, fingerprint: "agent{}" },
  skill: { revision: 1, fingerprint: "skill{}" },
  plugin: { revision: 1, fingerprint: "plugin{}" },
  schedule: {
    revision: 1,
    fingerprint: "schedule{agent=field:spec.agent.agent_ref.id}",
  },
  agent_channel: {
    revision: 1,
    fingerprint: "agent_channel{agent=field:spec.agent_ref.id}",
  },
  agent_share: {
    revision: 1,
    fingerprint: "agent_share{agent=field:spec.agent_ref.id}",
  },
  oauth_app: { revision: 1, fingerprint: "oauth_app{}" },
  channel_app: { revision: 1, fingerprint: "channel_app{}" },
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
