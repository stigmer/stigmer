/**
 * Pins session-values-retired.ts: what one stored session becomes when a
 * conversation's own secrets and connections leave the contract.
 *
 *   - SessionSpec fields 16 and 17 are dropped, every entry of both, and
 *     the result is exactly the bytes the current release writes for the
 *     session: its repository token, vaults and include_my_vault kept;
 *   - a spec field no release defined is kept, after the current fields;
 *   - a row holding neither field is left alone (undefined), a spec-less
 *     row included;
 *   - bytes that do not decode throw, and the step's error names the row.
 */
import { fromBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  migrateSessionValuesRow,
  unreadableSessionValuesError,
} from "../session-values-retired.js";

import { sessionRowWithValues, currentSessionRow } from "./retired-session-rows.js";

const metadata = { id: "ses_1", org: "org_1", slug: "ses-1" };

const current = {
  metadata,
  spec: {
    agentRef: { kind: ApiResourceKind.agent, org: "org_1", slug: "helper" },
    vaults: [{ kind: ApiResourceKind.vault, org: "org_1", slug: "team" }],
    includeMyVault: true,
    workspaceEntries: [
      {
        name: "app",
        source: {
          source: {
            case: "gitRepo" as const,
            value: { url: "https://github.com/acme/app", token: "enc:v1:sealed-repo" },
          },
        },
      },
    ],
  },
  status: { vaultAttachers: { vlt_team: "ida_ana" } },
};

describe("migrateSessionValuesRow", () => {
  it("drops every retired secret and connection and keeps the rest of the session", () => {
    const migrated = migrateSessionValuesRow(
      sessionRowWithValues(current, {
        secrets: { API_KEY: "enc:v1:sealed-a", OTHER: "enc:v1:sealed-b" },
        connections: { "https://mcp.example.com/mcp": "enc:v1:sealed-c" },
      }),
    );
    expect(migrated).toEqual(currentSessionRow(current));
  });

  it("drops a row holding only connections, and only secrets", () => {
    for (const retired of [
      { connections: { "github.com": "enc:v1:sealed" } },
      { secrets: { API_KEY: "enc:v1:sealed" } },
    ]) {
      expect(migrateSessionValuesRow(sessionRowWithValues(current, retired))).toEqual(
        currentSessionRow(current),
      );
    }
  });

  it("keeps a spec field no release defined", () => {
    const migrated = migrateSessionValuesRow(
      sessionRowWithValues(current, {
        secrets: { API_KEY: "enc:v1:sealed" },
        foreign: { no: 900, value: "kept" },
      }),
    );
    expect(migrated).toEqual(sessionRowWithValues(current, { foreign: { no: 900, value: "kept" } }));
    const unknown = fromBinary(SessionSchema, migrated!).spec?.$unknown ?? [];
    expect(unknown.map((field) => field.no)).toEqual([900]);
  });

  it("leaves a row with neither field alone, a spec-less one included", () => {
    expect(migrateSessionValuesRow(currentSessionRow(current))).toBeUndefined();
    expect(
      migrateSessionValuesRow(sessionRowWithValues(current, { foreign: { no: 900, value: "kept" } })),
    ).toBeUndefined();
    expect(migrateSessionValuesRow(currentSessionRow({ metadata }))).toBeUndefined();
  });

  it("throws on bytes that do not decode, and the step's error names the row", () => {
    expect(() => migrateSessionValuesRow(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
    const error = unreadableSessionValuesError("ses_bad", new Error("premature EOF"));
    expect(error.message).toBe(
      "session 'ses_bad' cannot be read to drop its retired secrets and connections: Error: premature EOF",
    );
    expect(error.cause).toBeInstanceOf(Error);
  });
});
