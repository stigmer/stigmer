/**
 * Pins where the search handler finds each kind's candidates (reach.ts)
 * and what it hands the store: with a composed list read scope every
 * effective kind is in the allowlist map (a kind left out is
 * unrestricted); an organization's kinds are the searched organizations'
 * rows offered to the restrict verb in one call per kind; the searched
 * organizations are the named one, or the directory's and each child's
 * parent; organizations are the directory's ids; sessions and runs ride
 * the enumeration; where the directory cannot name the caller's
 * organizations, every kind rides the enumeration; a row that will not
 * decode is skipped and logged; the server itself and a scope-less
 * composition are unscoped; and a scope fault is the sanitized Internal. The scope and the directory are recording fakes and the rows
 * are a real store's, so the pins are about the handler's reads, not a
 * driver's answers (authorization/__tests__/ holds those).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SearchRequestSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type {
  ListEntryMeta,
  ListReadScope,
} from "../../../extensions/list-read-scope.js";
import type { OrganizationDirectory } from "../../../extensions/organization-directory.js";
import { ALL_ORGANIZATIONS } from "../../../extensions/organization-directory.js";
import {
  tempStore,
  type TempStore,
} from "../../../store/sqlite/__tests__/support.js";
import { apiResourceKindName } from "../../../store/proto-fields.js";
import { agentListIndex } from "../../../domain/agent/list-index.js";
import { searchIndexedKinds } from "../criteria.js";
import { SearchHandler } from "../handler.js";
import { emptyResult } from "../paged-result.js";
import type { SearchQueryStore } from "../query-store.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => undefined,
});

const PERSON: CallerIdentity = {
  identityId: "acct-person",
  callerClass: "user",
  issuer: "https://issuer.example",
  rawToken: "",
};

// The parent, its child, the parent's other child, an organization the
// person belongs to with no parent, and one they have nothing to do with.
const PARENT = "org-parent";
const CHILD = "org-child";
const SIBLING = "org-sibling";
const OWN = "org-own";
const UNRELATED = "org-unrelated";

let temp: TempStore;

beforeEach(async () => {
  temp = tempStore();
  for (const [id, parentOrg] of [
    [PARENT, ""],
    [CHILD, PARENT],
    [SIBLING, PARENT],
    [OWN, ""],
    [UNRELATED, ""],
  ] as const) {
    await temp.store.saveResource(
      ApiResourceKind.organization,
      id,
      OrganizationSchema,
      create(OrganizationSchema, {
        metadata: { id, name: id, slug: id },
        spec: { parentOrg },
      }),
    );
  }
  for (const org of [PARENT, CHILD, SIBLING, OWN, UNRELATED]) {
    const id = `agent-${org}`;
    await temp.store.saveResource(
      ApiResourceKind.agent,
      id,
      AgentSchema,
      create(AgentSchema, { metadata: { id, name: id, slug: id, org } }),
    );
  }
  await temp.store.saveResource(
    ApiResourceKind.skill,
    "skill-own",
    SkillSchema,
    create(SkillSchema, {
      metadata: { id: "skill-own", name: "skill-own", slug: "skill-own", org: OWN },
    }),
  );
  await temp.store.saveResource(
    ApiResourceKind.plugin,
    "plugin-own",
    PluginSchema,
    create(PluginSchema, {
      metadata: { id: "plugin-own", name: "plugin-own", slug: "plugin-own", org: OWN },
    }),
  );
});

afterEach(async () => {
  await temp.cleanup();
});

interface Recorded {
  readonly offered: Map<string, string[][]>;
  readonly enumerated: string[];
}

/**
 * A scope that keeps every offered row but the unrelated organization's
 * and records what it is offered (by kind, one list per call) and which
 * kinds it is asked to enumerate.
 */
function recordingScope(recorded: Recorded): ListReadScope {
  return {
    authorizedResourceIds(_caller, kind) {
      recorded.enumerated.push(apiResourceKindName(kind));
      return Promise.resolve(new Set([`enumerated-${apiResourceKindName(kind)}`]));
    },
    restrictListEntries(_caller, kind, entries: ReadonlyArray<ListEntryMeta>) {
      const name = apiResourceKindName(kind);
      const calls = recorded.offered.get(name) ?? [];
      calls.push(entries.map((entry) => entry.id));
      recorded.offered.set(name, calls);
      return Promise.resolve(
        new Set(
          entries.filter((entry) => entry.org !== UNRELATED).map((entry) => entry.id),
        ),
      );
    },
  };
}

function directoryOf(
  answer: ReadonlyArray<string> | typeof ALL_ORGANIZATIONS,
): OrganizationDirectory & { readonly calls: () => number } {
  let calls = 0;
  return {
    listMyOrganizationIds() {
      calls += 1;
      return Promise.resolve(answer);
    },
    calls: () => calls,
  };
}

/** A search store that records the allowlist map it is handed. */
function capturingStore(): SearchQueryStore & {
  readonly maps: Array<ReadonlyMap<string, ReadonlySet<string>> | undefined>;
} {
  const maps: Array<ReadonlyMap<string, ReadonlySet<string>> | undefined> = [];
  return {
    maps,
    search(_criteria, authorizedIdsByKind) {
      maps.push(authorizedIdsByKind);
      return Promise.resolve(emptyResult());
    },
    rebuildIndex: () => Promise.resolve(0),
  };
}

function handlerOver(options: {
  readonly store: SearchQueryStore;
  readonly scope: ListReadScope | undefined;
  readonly directory: OrganizationDirectory | undefined;
}): SearchHandler {
  return new SearchHandler({
    store: options.store,
    rows: temp.store,
    organizationDirectory: options.directory,
    listReadScope: options.scope,
    logger: silentLogger,
  });
}

function sorted(ids: Iterable<string> | undefined): string[] {
  return [...(ids ?? [])].sort();
}

function newRecorded(): Recorded {
  return { offered: new Map(), enumerated: [] };
}

describe("search allowlists by each kind's reach", () => {
  it("puts every effective kind in the map, so none is left unrestricted", async () => {
    const store = capturingStore();
    await handlerOver({
      store,
      scope: recordingScope(newRecorded()),
      directory: directoryOf([OWN]),
    }).handle(create(SearchRequestSchema, {}), PERSON);

    expect(sorted(store.maps[0]?.keys())).toEqual(
      sorted(searchIndexedKinds().map(apiResourceKindName)),
    );
  });

  it("reads a named organization's agents alone and offers them in one call", async () => {
    const store = capturingStore();
    const recorded = newRecorded();
    const directory = directoryOf([OWN]);
    await handlerOver({ store, scope: recordingScope(recorded), directory }).handle(
      create(SearchRequestSchema, { kinds: [ApiResourceKind.agent], org: CHILD }),
      PERSON,
    );

    expect(recorded.offered.get("agent")).toEqual([[`agent-${CHILD}`]]);
    expect(sorted(store.maps[0]?.get("agent"))).toEqual([`agent-${CHILD}`]);
    expect(recorded.enumerated).toEqual([]);
    expect(directory.calls(), "a named organization needs no directory").toBe(0);
  });

  it("with no organization named, offers the directory's organizations' rows and each child's parent's, never another organization's", async () => {
    const store = capturingStore();
    const recorded = newRecorded();
    await handlerOver({
      store,
      scope: recordingScope(recorded),
      directory: directoryOf([CHILD, OWN]),
    }).handle(
      create(SearchRequestSchema, {
        kinds: [ApiResourceKind.agent, ApiResourceKind.skill],
      }),
      PERSON,
    );

    expect(recorded.offered.get("agent")?.map(sorted)).toEqual([
      sorted([`agent-${CHILD}`, `agent-${OWN}`, `agent-${PARENT}`]),
    ]);
    expect(recorded.offered.get("skill")).toEqual([["skill-own"]]);
    expect(recorded.offered.has("plugin")).toBe(false);
    expect(sorted(store.maps[0]?.get("agent"))).toEqual(
      sorted([`agent-${CHILD}`, `agent-${OWN}`, `agent-${PARENT}`]),
    );
    expect(recorded.enumerated).toEqual([]);
  });

  it("offers a plugin's rows like an agent's", async () => {
    const store = capturingStore();
    const recorded = newRecorded();
    await handlerOver({
      store,
      scope: recordingScope(recorded),
      directory: directoryOf([OWN]),
    }).handle(create(SearchRequestSchema, { kinds: [ApiResourceKind.plugin] }), PERSON);

    expect(recorded.offered.get("plugin")).toEqual([["plugin-own"]]);
    expect(sorted(store.maps[0]?.get("plugin"))).toEqual(["plugin-own"]);
  });

  it("skips and logs a row that will not decode, and offers the rest", async () => {
    const warnings: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: (line) => {
        warnings.push(line);
      },
    });
    const good = (await temp.store.queryResources(agentListIndex, { org: OWN }))[0];
    if (good === undefined) {
      throw new Error("the fixture's agent row is missing");
    }
    const store = capturingStore();
    const recorded = newRecorded();
    await new SearchHandler({
      store,
      rows: {
        getResource: temp.store.getResource.bind(temp.store),
        queryResources: () =>
          Promise.resolve([
            { id: "agent-torn", data: new Uint8Array([0x0a, 0x05]), cursor: good.cursor },
            good,
          ]),
      },
      organizationDirectory: undefined,
      listReadScope: recordingScope(recorded),
      logger,
    }).handle(
      create(SearchRequestSchema, { kinds: [ApiResourceKind.agent], org: OWN }),
      PERSON,
    );

    expect(recorded.offered.get("agent")).toEqual([[`agent-${OWN}`]]);
    expect(warnings.join("\n")).toContain("agent-torn");
  });

  it("keeps only what the restrict verb keeps", async () => {
    const store = capturingStore();
    const recorded = newRecorded();
    await handlerOver({
      store,
      scope: recordingScope(recorded),
      directory: directoryOf([OWN]),
    }).handle(
      create(SearchRequestSchema, { kinds: [ApiResourceKind.agent], org: UNRELATED }),
      PERSON,
    );

    expect(recorded.offered.get("agent")).toEqual([[`agent-${UNRELATED}`]]);
    expect(sorted(store.maps[0]?.get("agent"))).toEqual([]);
  });

  it("answers organizations with the directory's ids, and sessions and runs with the enumeration", async () => {
    const store = capturingStore();
    const recorded = newRecorded();
    await handlerOver({
      store,
      scope: recordingScope(recorded),
      directory: directoryOf([CHILD, OWN]),
    }).handle(
      create(SearchRequestSchema, {
        kinds: [
          ApiResourceKind.organization,
          ApiResourceKind.session,
          ApiResourceKind.run,
        ],
      }),
      PERSON,
    );

    expect(sorted(store.maps[0]?.get("organization"))).toEqual(sorted([CHILD, OWN]));
    expect(sorted(store.maps[0]?.get("session"))).toEqual(["enumerated-session"]);
    expect(sorted(store.maps[0]?.get("run"))).toEqual(["enumerated-run"]);
    expect(sorted(recorded.enumerated)).toEqual(["run", "session"]);
    expect(recorded.offered.size).toBe(0);
  });

  it("asks the directory once per request, however many kinds need it", async () => {
    const directory = directoryOf([OWN]);
    await handlerOver({
      store: capturingStore(),
      scope: recordingScope(newRecorded()),
      directory,
    }).handle(create(SearchRequestSchema, {}), PERSON);

    expect(directory.calls()).toBe(1);
  });

  it.each([
    ["no directory is composed", undefined],
    ["the directory answers every organization", directoryOf(ALL_ORGANIZATIONS)],
  ])(
    "rides the enumeration for every kind when %s",
    async (_case, directory) => {
      const store = capturingStore();
      const recorded = newRecorded();
      await handlerOver({ store, scope: recordingScope(recorded), directory }).handle(
        create(SearchRequestSchema, {
          kinds: [ApiResourceKind.agent, ApiResourceKind.organization],
        }),
        PERSON,
      );

      expect(sorted(recorded.enumerated)).toEqual(["agent", "organization"]);
      expect(recorded.offered.size).toBe(0);
      expect(sorted(store.maps[0]?.get("agent"))).toEqual(["enumerated-agent"]);
    },
  );

  it("still reads a named organization's rows when the directory answers every organization", async () => {
    const store = capturingStore();
    const recorded = newRecorded();
    await handlerOver({
      store,
      scope: recordingScope(recorded),
      directory: directoryOf(ALL_ORGANIZATIONS),
    }).handle(
      create(SearchRequestSchema, { kinds: [ApiResourceKind.agent], org: OWN }),
      PERSON,
    );

    expect(recorded.offered.get("agent")).toEqual([[`agent-${OWN}`]]);
    expect(recorded.enumerated).toEqual([]);
  });

  it("leaves the server acting as itself, and a composition with no scope, unscoped", async () => {
    const internal = capturingStore();
    const recorded = newRecorded();
    await handlerOver({
      store: internal,
      scope: recordingScope(recorded),
      directory: directoryOf([OWN]),
    }).handle(create(SearchRequestSchema, {}), {
      ...PERSON,
      callerClass: "internal",
    });
    expect(internal.maps).toEqual([undefined]);
    expect(recorded.offered.size).toBe(0);
    expect(recorded.enumerated).toEqual([]);

    const scopeless = capturingStore();
    await handlerOver({
      store: scopeless,
      scope: undefined,
      directory: directoryOf([OWN]),
    }).handle(create(SearchRequestSchema, {}), PERSON);
    expect(scopeless.maps).toEqual([undefined]);
  });

  it("answers a scope fault as the sanitized Internal, never an unscoped search", async () => {
    const store = capturingStore();
    const failing: ListReadScope = {
      authorizedResourceIds: () => Promise.reject(new Error("engine down")),
      restrictListEntries: () => Promise.reject(new Error("invalid engine state")),
    };
    let caught: unknown;
    try {
      await handlerOver({
        store,
        scope: failing,
        directory: directoryOf([OWN]),
      }).handle(create(SearchRequestSchema, { kinds: [ApiResourceKind.agent] }), PERSON);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConnectError);
    expect((caught as ConnectError).code).toBe(Code.Internal);
    expect(store.maps).toEqual([]);
  });
});
