/**
 * The editor of a surface's assignments. Pinned: one row per requirement,
 * grouped by declarer (the agent's own keys, each MCP server's); the
 * sources are the organization's keys the caller may use, plus the
 * caller's own only where a surface accepts them (a schedule); a plain
 * value is offered only for a value not declared secret; picking a
 * credential defaults its field to the key's name, or to the credential's
 * first field when it has no field of that name; every change emits
 * assignments with no writer, the ones kept from the stored surface
 * included; an assignment for a requirement the agent no longer declares
 * is kept until removed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { CredentialAssignmentInput, Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { CredentialAssignmentsEditor } from "../CredentialAssignmentsEditor";
import { storedCredential } from "./credential-world";

afterEach(cleanup);

const ORG = "org_acme";

const AGENT = create(AgentSchema, {
  metadata: { id: "agt_1", org: ORG, slug: "reviewer", name: "Reviewer" },
  spec: {
    env: { REGION: { isSecret: false }, API_KEY: { isSecret: true } },
    mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "linear" } }],
  },
});

function client(): Stigmer {
  return {
    mcpServer: {
      getByReference: vi.fn(async () => ({
        metadata: { id: "mcp_linear", org: ORG, slug: "linear", name: "Linear" },
        spec: { env: { LINEAR_API_KEY: { isSecret: true } } },
      })),
    },
    credential: {
      list: vi.fn(async () => ({
        items: [
          storedCredential({ id: "team-linear", org: ORG, owner: "org", name: "Team Linear", fields: ["LINEAR_API_KEY"] }),
          storedCredential({ id: "team-keys", org: ORG, owner: "org", name: "Team keys", fields: ["PRIMARY", "SECONDARY"] }),
          storedCredential({ id: "mine", org: ORG, owner: "person", name: "My Linear", fields: ["LINEAR_API_KEY"] }),
        ],
        totalCount: 3,
      })),
    },
  } as unknown as Stigmer;
}

function wrap({ children }: { children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={client()}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
}

const STORED: CredentialAssignmentInput = {
  requirement: { declarer: { agent: { org: ORG, slug: "reviewer" } }, key: "API_KEY" },
  credential: { credential: { org: ORG, slug: "team-keys" }, field: "PRIMARY" },
  writer: "ida_owner",
};

const ORPHAN: CredentialAssignmentInput = {
  requirement: { declarer: { gitHost: "github.com" }, key: "GITHUB_TOKEN" },
  credential: { credential: { org: ORG, slug: "team-keys" } },
  writer: "ida_owner",
};

async function renderEditor(props: { value?: CredentialAssignmentInput[]; allowOwnCredentials?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <CredentialAssignmentsEditor
      org={ORG}
      agent={AGENT}
      value={props.value ?? []}
      onChange={onChange}
      allowOwnCredentials={props.allowOwnCredentials}
    />,
    { wrapper: wrap },
  );
  await screen.findByLabelText("LINEAR_API_KEY", { selector: "select" });
  await screen.findAllByRole("option", { name: "Team Linear" });
  return onChange;
}

function optionsOf(key: string): string[] {
  const select = screen.getByLabelText(key, { selector: "select" });
  return within(select).getAllByRole("option").map((option) => option.textContent ?? "");
}

describe("CredentialAssignmentsEditor", () => {
  it("lists each requirement under its declarer", async () => {
    await renderEditor();
    const groups = screen.getByRole("list", { name: "Values the agent needs" });
    expect(groups.textContent).toContain("agent Reviewer");
    expect(groups.textContent).toContain("MCP server Linear");
  });

  it("offers the organization's keys, and the caller's own only where the surface accepts them", async () => {
    await renderEditor();
    expect(optionsOf("LINEAR_API_KEY")).toEqual(["Not assigned", "Team Linear", "Team keys"]);
    cleanup();

    await renderEditor({ allowOwnCredentials: true });
    expect(optionsOf("LINEAR_API_KEY")).toEqual(["Not assigned", "Team Linear", "Team keys", "My Linear"]);
  });

  it("offers a plain value only for a value not declared secret", async () => {
    await renderEditor();
    expect(optionsOf("REGION")).toContain("A plain value…");
    expect(optionsOf("API_KEY")).not.toContain("A plain value…");
  });

  it("emits a picked credential with no writer, keeping stored ones without theirs, the field defaulting by name", async () => {
    const onChange = await renderEditor({ value: [STORED] });
    fireEvent.change(screen.getByLabelText("LINEAR_API_KEY", { selector: "select" }), {
      target: { value: "cred:org_acme/team-linear" },
    });

    const next = onChange.mock.calls.at(-1)![0] as CredentialAssignmentInput[];
    expect(next).toEqual([
      {
        requirement: { declarer: { agent: { org: ORG, slug: "reviewer" } }, key: "API_KEY" },
        credential: { credential: { org: ORG, slug: "team-keys" }, field: "PRIMARY" },
      },
      {
        requirement: { declarer: { mcpServer: { org: ORG, slug: "linear" } }, key: "LINEAR_API_KEY" },
        credential: { credential: { org: ORG, slug: "team-linear" } },
      },
    ]);
    expect(JSON.stringify(next)).not.toContain("writer");
  });

  it("defaults the field to the credential's first when it holds none named like the key", async () => {
    const onChange = await renderEditor();
    fireEvent.change(screen.getByLabelText("LINEAR_API_KEY", { selector: "select" }), {
      target: { value: "cred:org_acme/team-keys" },
    });
    const next = onChange.mock.calls.at(-1)![0] as CredentialAssignmentInput[];
    expect(next[0]?.credential).toEqual({ credential: { org: ORG, slug: "team-keys" }, field: "PRIMARY" });
  });

  it("keeps an assignment the agent no longer needs until it is removed", async () => {
    const onChange = await renderEditor({ value: [ORPHAN] });
    const orphans = screen.getByRole("list", { name: "Assignments the agent no longer needs" });
    expect(orphans.textContent).toContain("GITHUB_TOKEN");

    fireEvent.click(within(orphans).getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
