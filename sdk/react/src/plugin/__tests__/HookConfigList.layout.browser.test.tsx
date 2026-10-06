// Layout contract for a hook set's commands. Runs in a real Chromium via
// `vitest.a11y.config.ts`: the defect under guard is a long command (a
// plugin-root path with no spaces, a long argument) pushing its row wider
// than the page, which only a real layout engine shows. Commands are shown
// verbatim, so they must wrap inside the list rather than scroll the page;
// at a phone's width the list stays within its host, and every command
// stays on screen whole. Renders against the SHIPPED stylesheet
// (`dist/styles.css`), like the other layout suites.

import "../../../dist/styles.css";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { HookConfigSchema, HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { StigmerProvider } from "../../provider";
import { HookConfigList } from "../HookConfigList";

afterEach(cleanup);

// A minimal client: a null credential keeps the provider's registry fetches
// non-blocking and off the network.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

const LONG_PATH = "${CLAUDE_PLUGIN_ROOT}/hooks/a-very-long-directory-name-that-has-no-spaces-at-all/pretooluse-guard-for-every-tool-call.py";

describe("HookConfigList layout", () => {
  it("wraps a long command inside a phone-width host instead of overflowing it", () => {
    render(
      <StigmerProvider client={makeClient()}>
        <div data-testid="host" style={{ width: "343px" }}>
          <HookConfigList
            config={create(HookConfigSchema, {
              format: HookFormat.CLAUDE_CODE,
              groups: [
                {
                  event: "PreToolUse",
                  matcher: "mcp__a_server_with_a_long_name__and_a_long_tool_name_too",
                  handlers: [{ command: "python3", args: [LONG_PATH, "--mode=strict-and-careful-checking"], condition: "Bash(git push --force *)" }],
                },
              ],
            })}
          />
        </div>
      </StigmerProvider>,
    );

    const host = screen.getByTestId("host");
    const list = screen.getByRole("list", { name: "Hooks (Claude Code format)" });
    expect(list.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);

    const command = screen.getByText(`python3 ${LONG_PATH} --mode=strict-and-careful-checking`);
    const box = command.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(host.getBoundingClientRect().right + 0.5);
    // Wrapped, not clipped: the command takes more than one line.
    expect(box.height).toBeGreaterThan(parseFloat(getComputedStyle(command).lineHeight) * 1.5);
  });
});
