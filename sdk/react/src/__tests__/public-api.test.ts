import { describe, expect, it } from "vitest";

import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import {
  ENTERPRISE_CLOUD_PLAN,
  FEATURE_COPY,
  type MessageAction,
  type MessageInfo,
  type NamedFeature,
  type SessionRunConfig,
  type ToolCallInfo,
  type ToolCallState,
  type ToolCardProps,
  type ToolCards,
} from "../index.js";
import type * as Chat from "../chat.js";

// Root-surface pin (oss#802): the package's exports map exposes only the root
// barrel, so a type an embedder must name has to be re-exported from
// src/index.ts. The type-only import above is enforced by the typecheck gate
// (`tsc --noEmit`), which fails this file if the root export regresses —
// vitest alone would not catch it (esbuild strips types unchecked).
describe("public API surface", () => {
  it("SessionRunConfig is importable from the package root", () => {
    // Compile-time is the real assertion; construct a value against the type
    // so the import cannot be flagged unused.
    const pinned: SessionRunConfig = {
      modelName: "claude-opus-5",
      serviceTier: "fast",
      thinkingMode: "enabled",
    };
    expect(pinned.modelName).toBe("claude-opus-5");
  });

  // A host makes the chat its own through these: its tool cards, its
  // message actions, and the thread's slots with the props each receives.
  // The light chat entry names them too, so a page on `/chat` alone can.
  it("the host-customization types are importable from the root and the chat entry", () => {
    const state: ToolCallState = "needs-approval";
    const call: ToolCallInfo = { id: "t1", tool: "create_invoice", server: "billing", input: {}, state, result: undefined, sessionId: "s1", runId: "r1" };
    const card = (props: ToolCardProps): string => props.call.tool;
    const cards: ToolCards = {};
    const info: MessageInfo = { id: "m1", role: "agent", text: "Done.", isFinalAnswer: true, sessionId: "s1", runId: "r1" };
    const act: MessageAction = { id: "a1", label: "Open in Billing", onAction: () => undefined };
    const fromChat: [Chat.ToolCards, Chat.ToolCardProps, Chat.ToolCallInfo, Chat.ToolCallState, Chat.MessageInfo, Chat.MessageAction] = [cards, { call }, call, state, info, act];
    const slots: Chat.MessageThreadSlots = {};
    const entry: Pick<Chat.MessageEntryProps, "messageInfo" | "messageActions"> = { messageInfo: info, messageActions: [act] };
    expect(card({ call })).toBe("create_invoice");
    expect(fromChat).toHaveLength(6);
    expect(slots).toEqual({});
    expect(entry.messageActions).toHaveLength(1);
  });

  // stigmer.ai's pricing page renders plan features through these, so the
  // site and the console name a feature alike.
  it("the plan vocabulary is importable from the package root", () => {
    const named: NamedFeature = Feature.access_history;
    expect(FEATURE_COPY[named].label).toBe("Access history");
    expect(ENTERPRISE_CLOUD_PLAN.features).toContain(named);
  });
});
