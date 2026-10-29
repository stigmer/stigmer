/**
 * A fake server for the readiness faces' tests: the readiness answer (which
 * a test may change between reads, as a saved key changes it), the key list
 * and its writes, the permission check that decides the admin's face, the
 * person's account, and the organization list, mounted with the providers
 * the faces read (the fetch cache, the deployment mode, the model registry).
 *
 * Not a `.test` file and inside `__tests__` deliberately: vitest does not
 * collect it, and the build excludes keep it out of the published package.
 */
import { vi } from "vitest";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  ProviderKeyCheck,
  ProviderKeySchema,
  type ProviderKey,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import {
  GetModelReadinessOutputSchema,
  ModelReadinessSchema,
  ProviderAvailability,
  ProviderReadinessSchema,
  type GetModelReadinessOutput,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { DeploymentMode } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheProvider } from "../../internal/FetchCacheProvider";
import { OrgProvider } from "../../organization/OrgProvider";
import { ModelRegistryContext, type ModelRegistryState } from "../ModelRegistryContext";
import { parseRegistryJson } from "../registry";

export const ORG_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
export const PARENT_ID = "org_01jpppppppppppppppppppppppp";

/** The person's organization, and its parent (named, so a card can say "through Acme Holdings"). */
export const ORGS: Organization[] = [
  { metadata: { id: ORG_ID, slug: "acme", name: "Acme Research" } } as Organization,
  { metadata: { id: PARENT_ID, slug: "acme-holdings", name: "Acme Holdings" } } as Organization,
];

function registryModel(id: string, displayName: string, provider: string, harness: string, featured = true) {
  return {
    id,
    displayName,
    shortDescription: "",
    speedTier: "fast",
    provider,
    harness,
    costTier: "standard",
    featured,
    pricing: { inputPricePerMillion: 3, outputPricePerMillion: 15, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.3 },
  };
}

/** The registry: two native models on two providers, and one Claude Agent model. The native default is the first. */
export const REGISTRY: ModelRegistryState = {
  models: parseRegistryJson({
    models: [
      registryModel("claude-sonnet-4.6", "Claude Sonnet 4.6", "anthropic", "stigmer"),
      registryModel("gpt-5", "GPT-5", "openai", "stigmer"),
      registryModel("claude-sonnet-5", "Claude Sonnet 5", "anthropic", "claude"),
    ],
  }),
  isLoading: false,
  error: null,
  refetch: () => {},
};

/** Every model the registry lists, with the provider it needs, as the server judges them. */
const CATALOG = [
  { harness: Harness.STIGMER, model: "claude-sonnet-4.6", provider: "anthropic" },
  { harness: Harness.STIGMER, model: "gpt-5", provider: "openai" },
  { harness: Harness.CLAUDE, model: "claude-sonnet-5", provider: "anthropic" },
] as const;

/** A provider's availability, with the parent it names when its key serves. */
export type Standing = ProviderAvailability | { readonly availability: ProviderAvailability; readonly parentOrg: string };

/** The server's readiness answer for these standings, every catalog model judged by its provider's. */
export function readiness(standings: { readonly anthropic: Standing; readonly openai: Standing }): GetModelReadinessOutput {
  const of = (provider: "anthropic" | "openai") => {
    const standing = standings[provider];
    return typeof standing === "number" ? { availability: standing, parentOrg: "" } : standing;
  };
  return create(GetModelReadinessOutputSchema, {
    providers: (["anthropic", "openai"] as const).map((provider) =>
      create(ProviderReadinessSchema, { provider, ...of(provider) }),
    ),
    models: CATALOG.map((entry) =>
      create(ModelReadinessSchema, {
        harness: entry.harness,
        model: entry.model,
        provider: entry.provider,
        availability: of(entry.provider).availability,
      }),
    ),
  });
}

export const NOTHING_CONNECTED = readiness({
  anthropic: ProviderAvailability.missing_from_organization,
  openai: ProviderAvailability.missing_from_organization,
});

/**
 * Nothing connected, beside a model the server judges no provider for (a
 * catalog's Ollama row on the cloud): it says nothing either way, so
 * nothing can run still.
 */
export const NOTHING_CONNECTED_BESIDE_UNJUDGED = create(GetModelReadinessOutputSchema, {
  providers: NOTHING_CONNECTED.providers,
  models: [
    ...NOTHING_CONNECTED.models,
    create(ModelReadinessSchema, {
      harness: Harness.STIGMER,
      model: "qwen2.5-coder:7b",
      provider: "",
      availability: ProviderAvailability.availability_unknown,
    }),
  ],
});

export const ANTHROPIC_CONNECTED = readiness({
  anthropic: ProviderAvailability.served_by_organization,
  openai: ProviderAvailability.missing_from_organization,
});

export const OPENAI_ONLY = readiness({
  anthropic: ProviderAvailability.missing_from_organization,
  openai: ProviderAvailability.served_by_organization,
});

export const LAPTOP_WITHOUT_KEYS = readiness({
  anthropic: ProviderAvailability.missing_from_runners,
  openai: ProviderAvailability.missing_from_runners,
});

const NOW = Date.UTC(2026, 9, 28, 9, 0, 0);
const DAY = 86_400_000;

/** A key row as the key list answers it. */
export function storedKey(
  provider: string,
  fields: { readonly keyHint?: string; readonly check?: ProviderKeyCheck; readonly inheritedFromOrg?: string; readonly baseUrl?: string; readonly lastUsedDaysAgo?: number } = {},
): ProviderKey {
  return create(ProviderKeySchema, {
    org: fields.inheritedFromOrg ?? ORG_ID,
    provider,
    keyHint: fields.keyHint ?? "x7Qa",
    check: fields.check ?? ProviderKeyCheck.provider_key_check_unspecified,
    inheritedFromOrg: fields.inheritedFromOrg ?? "",
    baseUrl: fields.baseUrl ?? "",
    createdBy: "ada@acme.example",
    updatedAt: timestampFromDate(new Date(NOW - 7 * DAY)),
    ...(fields.lastUsedDaysAgo === undefined
      ? {}
      : { lastUsedAt: timestampFromDate(new Date(NOW - fields.lastUsedDaysAgo * DAY)) }),
  });
}

export const ACCOUNT: IdentityAccount = create(IdentityAccountSchema, {
  metadata: { id: "ia-1", name: "Ada", slug: "ada", org: ORG_ID, etag: "e1" },
  spec: { idpId: "auth0|ada", preferences: { defaultStigmerModel: "", defaultClaudeModel: "" } },
});

/** What the fake server answers; a test changes `readiness` (and `keys`) to say what a save changed. */
export interface FakeServer {
  readiness: GetModelReadinessOutput;
  keys: ProviderKey[];
  canManage: boolean;
  account: IdentityAccount;
}

/** The fake client over `server`, with a spy on every call a readiness face makes. */
export function fakeClient(server: FakeServer) {
  const getModelReadiness = vi.fn(async (_org: string) => server.readiness);
  const listKeys = vi.fn(async () => ({ entries: server.keys, nextPageToken: "" }));
  const setKey = vi.fn(async (input: { provider: string }) => storedKey(input.provider));
  const deleteKey = vi.fn(async (input: { provider: string }) => storedKey(input.provider));
  const checkMyPermission = vi.fn(async () => ({ isAuthorized: server.canManage }));
  const whoAmI = vi.fn(async () => server.account);
  // An update applies the preferences it names, as the server would.
  const update = vi.fn(async (resource: { spec?: { preferences?: object } }, _paths: string[]) => {
    const preferences = { ...server.account.spec?.preferences, ...resource.spec?.preferences };
    server.account = create(IdentityAccountSchema, {
      ...server.account,
      metadata: { ...server.account.metadata, etag: `${server.account.metadata?.etag ?? ""}+` },
      spec: { ...server.account.spec, preferences },
    } as never);
    return server.account;
  });
  const client = {
    platform: { getModelReadiness },
    providerkey: { list: listKeys, set: setKey, delete: deleteKey },
    grant: { checkMyPermission },
    identityAccount: { whoAmI, update },
    organization: {
      get: vi.fn(async (id: string) => ORGS.find((org) => org.metadata?.id === id) ?? null),
      listMine: vi.fn(async () => ({ entries: ORGS, nextPageToken: "" })),
    },
  };
  return { client, getModelReadiness, listKeys, setKey, deleteKey, checkMyPermission, whoAmI, update };
}

/** A fake server with nothing connected, an admin looking, on Stigmer Cloud. */
export function server(fields: Partial<FakeServer> = {}): FakeServer {
  return { readiness: NOTHING_CONNECTED, keys: [], canManage: true, account: ACCOUNT, ...fields };
}

/** Mounts `children` under the client, the deployment mode, the registry, the fetch cache and the organizations. */
export function readinessWrapper(client: unknown, mode: DeploymentMode = "cloud") {
  return function ReadinessFixture({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        <DeploymentModeContext.Provider value={mode}>
          <ModelRegistryContext.Provider value={REGISTRY}>
            <FetchCacheProvider>
              <OrgProvider>{children}</OrgProvider>
            </FetchCacheProvider>
          </ModelRegistryContext.Provider>
        </DeploymentModeContext.Provider>
      </StigmerContext.Provider>
    );
  };
}
