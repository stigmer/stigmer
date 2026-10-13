/**
 * Pins internal/maskedEdit.ts: how an inline edit becomes an update.
 *
 *   - the resource is the patch built through the kind's builder, addressed
 *     by the loaded resource's id and carrying the etag it was read at;
 *   - each patch key names its path: `name` and `labels` their metadata
 *     paths, any other key its spec field by proto name; the address keys
 *     and the save's arguments name none;
 *   - a key set to `undefined` is still named, so the update clears it;
 *   - a failed save reads as a reload notice for ETAG_MISMATCH, a nudge to
 *     try again for WRITE_CONFLICT, and the server's message otherwise.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { buildAgentProto } from "@stigmer/sdk";

import { ETAG_MISMATCH, WRITE_CONFLICT, maskedEdit, saveErrorMessage } from "../maskedEdit";

const LOADED = create(AgentSchema, {
  metadata: { id: "agt_1", etag: "etag-at-load", name: "Reviewer", org: "org_acme", slug: "reviewer" },
  spec: { instructions: "Review every pull request.", description: "stored words" },
});

function refusal(reason: string): ConnectError {
  return new ConnectError("refused", Code.Aborted, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason, metadata: {} } },
  ]);
}

describe("maskedEdit", () => {
  it("addresses the loaded resource by id with the etag it was read at, naming each patched field", () => {
    const { resource, paths } = maskedEdit(LOADED, buildAgentProto, {
      instructions: "Review drafts only.",
      skillRefs: [{ org: "org_acme", slug: "triage" }],
    });
    expect(resource.metadata?.id).toBe("agt_1");
    expect(resource.metadata?.etag).toBe("etag-at-load");
    expect(resource.spec?.instructions).toBe("Review drafts only.");
    expect(paths).toEqual(["spec.instructions", "spec.skill_refs"]);
  });

  it("names metadata keys by their metadata paths and never the address or the save's arguments", () => {
    const { paths } = maskedEdit(LOADED, buildAgentProto, {
      name: "Senior reviewer",
      labels: { team: "core" },
      runConfig: { modelName: "model-b" },
      id: "agt_other",
      org: "org_other",
      slug: "other",
      versionMessage: "renamed",
    });
    expect(paths).toEqual(["metadata.name", "metadata.labels", "spec.run_config"]);
  });

  it("names a key set to undefined, so the update clears it", () => {
    const { resource, paths } = maskedEdit(LOADED, buildAgentProto, { description: undefined });
    expect(paths).toEqual(["spec.description"]);
    expect(resource.spec?.description).toBe("");
  });
});

describe("saveErrorMessage", () => {
  it("says to reload a resource changed since it was opened", () => {
    expect(saveErrorMessage(refusal(ETAG_MISMATCH), "agent")).toBe(
      "This agent changed since you opened it. Reload it to see the change, then make your edit again.",
    );
  });

  it("says to try again when the resource kept changing while it was saved", () => {
    expect(saveErrorMessage(refusal(WRITE_CONFLICT), "schedule")).toBe(
      "This schedule kept changing while your edit was saved. Try again.",
    );
  });

  it("shows the server's message for any other refusal", () => {
    expect(saveErrorMessage(new ConnectError("instructions are too short", Code.InvalidArgument), "agent")).toBe(
      "[invalid_argument] instructions are too short",
    );
    expect(saveErrorMessage("plain failure", "agent")).toBe("plain failure");
  });
});
