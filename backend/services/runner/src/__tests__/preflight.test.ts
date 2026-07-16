/**
 * Boot preflight tests.
 *
 * The preflight is what turns a raw ERR_UNKNOWN_BUILTIN_MODULE from the
 * checkpointer's `node:sqlite` import (on Node < 22.13 / 23.0–23.3) into an
 * actionable first-line-of-output error. These tests pin:
 * - the pass/fail contract of preflightNodeRuntime around an injected probe
 *   (so the failure path is testable on a supported Node), and
 * - the message contract: it must name the found version, the missing
 *   capability, and both known-good floors — that exact text is what reaches
 *   the desktop Run dialog via the IPC handshake.
 */

import { describe, expect, it } from "vitest";
import { isNodeSqliteAvailable, preflightNodeRuntime } from "../preflight.js";

describe("preflightNodeRuntime", () => {
  it("passes (returns null) when node:sqlite is available", () => {
    expect(preflightNodeRuntime(() => true)).toBeNull();
  });

  it("fails with the actionable message contract when node:sqlite is absent", () => {
    const message = preflightNodeRuntime(() => false);

    expect(message).not.toBeNull();
    // Found version, so the operator knows what they are actually running.
    expect(message).toContain(`Node v${process.versions.node}`);
    // The missing capability, so the error is searchable and precise.
    expect(message).toContain("node:sqlite");
    // Both floors — including the 23.4 one whose omission caused the original bug.
    expect(message).toContain("22.13");
    expect(message).toContain("23.4");
  });

  it("wires the real-runtime probe as the default", () => {
    // Asserted as consistency, not as an environment fact: the suite may
    // itself run under a Node without node:sqlite (e.g. 23.0–23.3), in which
    // case BOTH sides must report unsupported.
    expect(preflightNodeRuntime() === null).toBe(isNodeSqliteAvailable());
  });
});
