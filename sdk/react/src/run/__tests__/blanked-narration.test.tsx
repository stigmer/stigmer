/**
 * A turn paused at a gate whose provisional post-denial narration was
 * blanked (an empty thinking, an empty agent message after the waiting
 * call) renders cleanly: the waiting call's row and the pre-tool text show,
 * the empty message is no thread item, and the empty thinking and message
 * render nothing — so blanked narration never leaks into a surface.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import { MessageEntry } from "../MessageEntry";
import { asked, said, status, thought, toolId, turnsOf, use, user } from "./__fixtures__/thread-events";

afterEach(cleanup);

const R = "exec-hitl";

/** The log of a turn waiting on `c1`, its provisional narration blanked. */
function waitingTurnItems(): ThreadItem[] {
  return buildThreadItems(
    turnsOf(
      user(R, "make the change"),
      status(R, "running"),
      said(R, 0, "Let me create the file."),
      use(R, "c1", "edit", { path: "a.ts" }, { ask: true }),
      asked(R, "c1"),
      thought(R, 0, ""),
      said(R, 1, ""),
      status(R, "waiting"),
    ),
    [],
    { includeApprovals: true },
  );
}

describe("buildThreadItems — blanked post-denial narration", () => {
  it("surfaces the waiting call's row and the pre-tool text, and no empty message", () => {
    const items = waitingTurnItems();
    const groups = items.filter((i): i is Extract<ThreadItem, { kind: "tool-group" }> => i.kind === "tool-group");

    expect(groups.map((g) => g.toolUses.map((tu) => [tu.id, tu.state]))).toEqual([[[toolId(R, "c1"), "waiting"]]]);
    const agentMessages = items.filter((i) => i.kind === "message" && i.message.kind === "message");
    expect(agentMessages.map((i) => i.kind === "message" && i.message.text)).toEqual(["Let me create the file."]);
  });

  it("keeps the blanked thinking only as an item with no text", () => {
    const thinking = waitingTurnItems().filter((i) => i.kind === "message" && i.message.kind === "thinking");

    expect(thinking.map((i) => i.kind === "message" && i.message.text)).toEqual([""]);
  });
});

describe("MessageEntry — blanked narration renders nothing", () => {
  it("renders nothing for a blanked agent message", () => {
    const { container } = render(
      <MessageEntry message={{ kind: "message", id: "m", text: "", live: false, processedAt: "" }} />,
    );
    expect(container.textContent?.trim()).toBe("");
  });

  it("renders nothing for a blanked thinking", () => {
    const { container } = render(
      <MessageEntry message={{ kind: "thinking", id: "t", text: "", live: false, processedAt: "" }} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
