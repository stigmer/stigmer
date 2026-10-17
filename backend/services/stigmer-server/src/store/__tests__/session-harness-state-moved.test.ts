/**
 * Pins session-harness-state-moved.ts: what one stored session becomes
 * when its harness state moves from its spec to its status.
 *
 *   - SessionSpec fields 3 and 13 leave the spec and land in
 *     SessionStatus fields 5 and 6, and the result is exactly the bytes the
 *     current release writes for the session, every other field kept;
 *   - a status that already holds a value keeps it;
 *   - a spec field no release defined is kept;
 *   - a row holding neither field is left alone (undefined), a spec-less
 *     row included;
 *   - bytes that do not decode throw, and the step's error names the row.
 */
import { fromBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  migrateSessionHarnessRow,
  unreadableSessionHarnessError,
} from "../session-harness-state-moved.js";

import { currentSessionRow, sessionRowWithValues } from "./retired-session-rows.js";

const metadata = { id: "ses_1", org: "org_1", slug: "ses-1" };

const conversation = {
  metadata,
  spec: {
    agentRef: { kind: ApiResourceKind.agent, org: "org_1", slug: "helper" },
    subject: "Fix the build",
  },
  status: { vaultAttachers: { vlt_team: "ida_ana" } },
};

describe("migrateSessionHarnessRow", () => {
  it("moves the harness id and its history to the status and keeps the rest of the session", () => {
    const migrated = migrateSessionHarnessRow(
      sessionRowWithValues(conversation, {
        harnessStateId: "agent-cursor-3",
        harnessStateIdHistory: ["agent-cursor-1", "agent-cursor-2"],
      }),
    );
    expect(migrated).toEqual(
      currentSessionRow({
        ...conversation,
        status: {
          ...conversation.status,
          harnessStateId: "agent-cursor-3",
          harnessStateIdHistory: ["agent-cursor-1", "agent-cursor-2"],
        },
      }),
    );
  });

  it("moves an id with no history, and gives a session with no status one", () => {
    const migrated = migrateSessionHarnessRow(
      sessionRowWithValues({ metadata, spec: conversation.spec }, { harnessStateId: "thread-1" }),
    );
    expect(migrated).toEqual(
      currentSessionRow({ metadata, spec: conversation.spec, status: { harnessStateId: "thread-1" } }),
    );
  });

  it("keeps a status that already holds the harness state", () => {
    const held = {
      ...conversation,
      status: { ...conversation.status, harnessStateId: "bound-by-the-door", harnessStateIdHistory: ["first"] },
    };
    const migrated = migrateSessionHarnessRow(
      sessionRowWithValues(held, { harnessStateId: "stale", harnessStateIdHistory: ["older"] }),
    );
    expect(migrated).toEqual(currentSessionRow(held));
  });

  it("keeps a spec field no release defined", () => {
    const migrated = migrateSessionHarnessRow(
      sessionRowWithValues(conversation, {
        harnessStateId: "thread-1",
        foreign: { no: 900, value: "kept" },
      }),
    );
    const session = fromBinary(SessionSchema, migrated!);
    expect(session.status?.harnessStateId).toBe("thread-1");
    expect((session.spec?.$unknown ?? []).map((field) => field.no)).toEqual([900]);
  });

  it("leaves a row with neither field alone, a spec-less one included", () => {
    expect(migrateSessionHarnessRow(currentSessionRow(conversation))).toBeUndefined();
    expect(
      migrateSessionHarnessRow(sessionRowWithValues(conversation, { foreign: { no: 900, value: "kept" } })),
    ).toBeUndefined();
    expect(migrateSessionHarnessRow(currentSessionRow({ metadata }))).toBeUndefined();
  });

  it("throws on bytes that do not decode, and the step's error names the row", () => {
    expect(() => migrateSessionHarnessRow(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
    const error = unreadableSessionHarnessError("ses_bad", new Error("premature EOF"));
    expect(error.message).toBe(
      "session 'ses_bad' cannot be read to move its harness state to its status: Error: premature EOF",
    );
    expect(error.cause).toBeInstanceOf(Error);
  });
});
