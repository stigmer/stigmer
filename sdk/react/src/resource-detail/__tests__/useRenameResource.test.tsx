/**
 * Pins useRenameResource: each renamable kind's rename goes to that kind's
 * client with the RenameInput the server takes (the resource's id and the
 * new slug), and a refusal is held as the hook's error and rethrown.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code, ConnectError } from "@connectrpc/connect";

import { StigmerContext } from "../../context.js";
import {
  type RenamableResourceKind,
  useRenameResource,
} from "../useRenameResource.js";

afterEach(cleanup);

/** Each kind, and the client property its rename lives on. */
const KINDS: ReadonlyArray<readonly [RenamableResourceKind, string]> = [
  ["agent", "agent"],
  ["vault", "vault"],
  ["schedule", "schedule"],
  ["channel_app", "channelapp"],
  ["oauth_app", "oauthapp"],
  ["team", "team"],
  ["federation_issuer", "federationIssuer"],
];

function clientWith(
  property: string,
  rename: (input: unknown) => Promise<unknown>,
) {
  return { [property]: { rename: vi.fn(rename) } };
}

function renderRename(
  kind: RenamableResourceKind,
  client: Record<string, { rename: ReturnType<typeof vi.fn> }>,
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client as never}>
      {children}
    </StigmerContext.Provider>
  );
  return renderHook(() => useRenameResource(kind), { wrapper });
}

describe("useRenameResource", () => {
  for (const [kind, property] of KINDS) {
    it(`renames ${kind} through its client's rename`, async () => {
      const renamed = { metadata: { id: "id_1", slug: "next" } };
      const client = clientWith(property, async () => renamed);
      const hook = renderRename(kind, client);

      let answer: unknown;
      await act(async () => {
        answer = await hook.result.current.rename("id_1", "next");
      });

      expect(answer).toBe(renamed);
      expect(client[property]!.rename).toHaveBeenCalledOnce();
      expect(client[property]!.rename.mock.calls[0]![0]).toMatchObject({
        resourceId: "id_1",
        slug: "next",
      });
      expect(hook.result.current.isRenaming).toBe(false);
      expect(hook.result.current.error).toBeNull();
    });
  }

  it("holds a refusal as its error and rethrows it; clearError resets it", async () => {
    const client = clientWith("agent", async () => {
      throw new ConnectError(
        "Agent slug 'next' was recently another agent's, and still leads to it",
        Code.AlreadyExists,
      );
    });
    const hook = renderRename("agent", client);

    await act(async () => {
      await expect(hook.result.current.rename("agt_1", "next")).rejects.toThrow(
        /recently another agent's/,
      );
    });
    expect(hook.result.current.error?.message).toMatch(
      /recently another agent's/,
    );

    act(() => hook.result.current.clearError());
    expect(hook.result.current.error).toBeNull();
  });
});
