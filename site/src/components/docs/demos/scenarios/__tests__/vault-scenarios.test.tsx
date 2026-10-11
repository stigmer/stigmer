/**
 * The two plugin demos on the integrations pages (the marketplace connect
 * tour, the OAuth connect flow) mount with their preview fixtures: the
 * plugin's read, My vault's read and the server's tools listing, the three
 * RPCs a plugin page makes. My vault never answers a value: the OAuth flow
 * opens on a vault holding nothing (its server offers to sign in), and the
 * marketplace tour's holds the one key its server reads, by name, its value
 * blanked as every read blanks it. The management shell lists Vaults in its
 * Configuration group, where the console's settings put them.
 *
 * Pins: each scenario mounts over its fixtures (it draws nothing until the
 * docs page plays it) and hands its preview provider exactly those RPCs;
 * asked My vault's read the way the console asks it (a Connect POST to
 * VaultQueryController/getMine), each answers a Vault holding no login and
 * no secret value, with exactly the secret names it depicts; and the
 * shell's navigation names Vaults.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ComponentType } from "react";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { getResponse, type HttpHandler } from "msw";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";

import { MarketplaceConnectTour } from "../marketplace-connect-tour/index";
import { OAuthConnectFlow } from "../oauth-connect-flow/index";
import { ManagementShell } from "../../views/ManagementShell";

/** The fixtures each mount handed its preview provider, latest last. */
const handedFixtures: (readonly HttpHandler[])[] = [];

vi.mock("../../shared/StigmerPreviewProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/StigmerPreviewProvider")>();
  function RecordingPreviewProvider(props: ComponentProps<typeof actual.StigmerPreviewProvider>) {
    handedFixtures.push(props.fixtures ?? []);
    return <actual.StigmerPreviewProvider {...props} />;
  }
  return { StigmerPreviewProvider: RecordingPreviewProvider };
});

afterEach(() => {
  cleanup();
  handedFixtures.length = 0;
});

/** The Connect path of one RPC, as a fixture matches it. */
function rpcPath(service: { readonly typeName: string; readonly method: Record<string, { readonly name: string }> }, method: string) {
  return `*/${service.typeName}/${service.method[method].name}`;
}

const GET_MINE = rpcPath(VaultQueryController, "getMine");
const GET_PLUGIN = rpcPath(PluginQueryController, "getByReference");
const LIST_TOOLS = rpcPath(PluginCommandController, "listTools");

/** Mounts a scenario and returns the fixtures it handed its preview provider. */
function fixturesOf(Scenario: ComponentType): readonly HttpHandler[] {
  render(<Scenario />);
  const fixtures = handedFixtures.at(-1);
  if (fixtures === undefined) throw new Error("the scenario handed its preview provider no fixtures");
  return fixtures;
}

describe("the plugin demos over My vault", () => {
  it.each([
    ["marketplace connect tour", MarketplaceConnectTour, ["NEON_API_KEY"]],
    ["OAuth connect flow", OAuthConnectFlow, []],
  ] as const)("%s answers a plugin page's reads, My vault's with no value in it", async (_name, Scenario, secretNames) => {
    const fixtures = fixturesOf(Scenario);
    expect(fixtures.map((fixture) => `${String(fixture.info.method)} ${String(fixture.info.path)}`)).toEqual(
      [GET_PLUGIN, GET_MINE, LIST_TOOLS].map((path) => `POST ${path}`),
    );

    const request = new Request(`https://api.example/${VaultQueryController.typeName}/getMine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const response = await getResponse([...fixtures], request);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("application/json");
    const vault = fromJson(VaultSchema, (await response!.json()) as JsonValue);
    expect(vault.$typeName).toBe("ai.stigmer.agentic.vault.v1.Vault");
    const secrets = vault.spec?.secrets ?? {};
    expect(Object.keys(secrets)).toEqual([...secretNames]);
    expect(Object.values(secrets).map((secret) => secret.value)).toEqual(secretNames.map(() => ""));
    expect(vault.spec?.connections ?? {}).toEqual({});
  });
});

describe("the management shell", () => {
  it("lists Vaults under Configuration", () => {
    render(
      <ManagementShell contentKey="vaults" activeNav="vaults">
        <p>content</p>
      </ManagementShell>,
    );
    expect(screen.getAllByText("Vaults").length).toBeGreaterThan(0);
  });
});
