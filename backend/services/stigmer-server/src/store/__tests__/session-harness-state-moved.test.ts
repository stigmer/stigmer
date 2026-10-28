/**
 * Pins session-harness-state-moved.ts: what one stored session becomes
 * when its spec still holds the retired harness state.
 *
 *   - SessionSpec fields 3 and 13 are dropped, and the result is exactly
 *     the bytes the current release writes for the session, every other
 *     field kept;
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
  it("drops the harness id and its history and keeps the rest of the session", () => {
    const migrated = migrateSessionHarnessRow(
      sessionRowWithValues(conversation, {
        harnessStateId: "agent-3",
        harnessStateIdHistory: ["agent-1", "agent-2"],
      }),
    );
    expect(migrated).toEqual(currentSessionRow(conversation));
  });

  it("drops an id with no history from a session with no status", () => {
    const migrated = migrateSessionHarnessRow(
      sessionRowWithValues({ metadata, spec: conversation.spec }, { harnessStateId: "thread-1" }),
    );
    expect(migrated).toEqual(currentSessionRow({ metadata, spec: conversation.spec }));
  });

  it("keeps a spec field no release defined", () => {
    const migrated = migrateSessionHarnessRow(
      sessionRowWithValues(conversation, {
        harnessStateId: "thread-1",
        foreign: { no: 900, value: "kept" },
      }),
    );
    const session = fromBinary(SessionSchema, migrated!);
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
      "session 'ses_bad' cannot be read to drop its retired harness state: Error: premature EOF",
    );
    expect(error.cause).toBeInstanceOf(Error);
  });
});
