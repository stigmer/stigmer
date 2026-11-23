import { describe, expect, it } from "vitest";

import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import {
  ENTERPRISE_CLOUD_PLAN,
  FEATURE_COPY,
  defineCustomTool,
  useAnswerCustomToolUse,
  type CustomToolAnswer,
  type CustomToolInput,
  type OnCustomToolUse,
  type UseAnswerCustomToolUseReturn,
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
import * as ChatEntry from "../chat.js";
import * as Root from "../index.js";

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

  // A slot draws the cases it changes and hands the rest back to ours, so the
  // light chat entry carries every slot's built-in. Each is a thin component
  // named like the root's, which draws the root's real one, so importing it
  // does not pull the renderer into the page's first download
  // (run/lazy-built-ins.tsx; what it draws: run/__tests__/lazy-built-ins.test.tsx).
  // `Required` makes a new slot fail this file's typecheck until its
  // built-in is exported here too.
  it("every slot's built-in is importable from the chat entry, a thin one named like the root's", () => {
    const fromChat: Required<Chat.MessageThreadSlots> = {
      MessageEntry: ChatEntry.MessageEntry,
      ApprovalCard: ChatEntry.ApprovalCard,
      TodoCard: ChatEntry.TodoCard,
      TodoRow: ChatEntry.TodoRow,
      PlanFileCard: ChatEntry.PlanFileCard,
      PlanCompletionCard: ChatEntry.PlanCompletionCard,
      PlanStreamingCard: ChatEntry.PlanStreamingCard,
      SetupProgress: ChatEntry.SetupProgress,
      RecalledMemoriesCard: ChatEntry.RecalledMemoriesCard,
      RunErrorNotice: ChatEntry.RunErrorNotice,
      LivenessStatusLine: ChatEntry.LivenessStatusLine,
    };
    for (const [name, builtIn] of Object.entries(fromChat)) {
      const real = Root[name as keyof typeof Root];
      expect(builtIn, name).toBeDefined();
      expect(real, name).toBeDefined();
      expect(builtIn, name).not.toBe(real);
      expect((builtIn as { displayName?: string }).displayName, name).toBe(name);
    }
  });

  // A host declares its own tools with the client's helper (re-exported at
  // the root), answers them through a card or its callback, and a host
  // drawing its own screen answers with the hook. The light chat entry
  // names the types, never the client's values.
  it("the app's own tools are declared, heard and answered from the root and the chat entry", async () => {
    const tool: CustomToolInput = defineCustomTool({
      name: "register_cloud_account",
      description: "Show the account form, filled in.",
      inputSchema: { type: "object", properties: { account_name: { type: "string" } } },
    });
    expect(tool.name).toBe("register_cloud_account");
    expect(typeof useAnswerCustomToolUse).toBe("function");
    const answer: CustomToolAnswer = async () => undefined;
    const heard: OnCustomToolUse = (call, reply) => void reply(call.tool, { isError: false });
    const fromChat: [Chat.CustomToolAnswer, Chat.OnCustomToolUse] = [answer, heard];
    const returned: Pick<UseAnswerCustomToolUseReturn, "submittingIds"> = { submittingIds: new Set() };
    await expect(answer("ok")).resolves.toBeUndefined();
    expect(fromChat).toHaveLength(2);
    expect(returned.submittingIds.size).toBe(0);
  });

  // stigmer.ai's pricing page renders plan features through these, so the
  // site and the console name a feature alike.
  it("the plan vocabulary is importable from the package root", () => {
    const named: NamedFeature = Feature.access_history;
    expect(FEATURE_COPY[named].label).toBe("Access history");
    expect(ENTERPRISE_CLOUD_PLAN.features).toContain(named);
  });
});
