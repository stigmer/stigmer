/**
 * Pins the boot refresh of plugins installed before a plugin was one
 * thing: a stored status still carrying the retired fields 3 (state) or 5
 * (materialized) as unknown fields is legacy, and nothing else is; each
 * legacy plugin is read again from its own stored archive exactly as
 * install reads it (skills, agents, server entries, variables, hooks,
 * warnings, and the sign-in probe completing a URL-only server that
 * answers an OAuth challenge) and saved once under the same id and digest,
 * the retired fields dropped, so a second refresh finds nothing to do; a
 * current plugin is never touched; and a plugin whose archive is missing
 * from the status, cannot be fetched or no longer reads is left as it is,
 * logged, and never fails the refresh.
 *
 * Old rows are built by wire number (the retired fields' schema is gone),
 * the archive by the server's own writer from the library's fixtures; the
 * store, the archive store and the outbound fetch are in-memory fakes.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { claudePlugin } from "@stigmer/plugin-package/testing";
import type { OutboundFetch } from "@stigmer/outbound/egress";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import {
  PluginStatusSchema,
  PluginWarningSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { ContentAddressedArchiveStore } from "../../../archive/content-store.js";
import { writeArchive } from "../../../archive/write.js";
import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { openPluginArchive } from "../archive.js";
import {
  isLegacyStatus,
  refreshLegacyPluginStatuses,
} from "../legacy-status.js";

const encoder = new TextEncoder();

/** The archive a legacy plugin was installed from: a skill, an agent, a URL-only server, a hook. */
const ARCHIVE = writeArchive(
  [
    ...claudePlugin({
      name: "legacy",
      version: "1.0.0",
      skills: [
        {
          name: "review",
          description: "Reviews",
          body: "# Review\nRead it all.",
        },
      ],
      agents: [
        {
          file: "lead",
          frontmatter: { description: "Leads." },
          body: "You lead the review and report back.",
        },
      ],
      mcpServers: {
        linear: { type: "http", url: "https://mcp.linear.test/mcp" },
      },
      userConfig: {
        WEBHOOK: { type: "string", sensitive: true, required: true },
      },
      hooks: {
        PostToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: "node",
                args: ["notify.js", "${user_config.WEBHOOK}"],
              },
            ],
          },
        ],
      },
    }).entries(),
  ].map(([path, content]) => ({
    path,
    bytes: typeof content === "string" ? encoder.encode(content) : content,
  })),
);
const DIGEST = openPluginArchive(ARCHIVE).digest;
const KEY = `plugins/${DIGEST}.zip`;

/** The materialization counts an earlier release wrote as status field 5: skills 1, servers 1, agents 1. */
function materialized(): Uint8Array {
  return new BinaryWriter()
    .tag(1, WireType.Varint)
    .int32(1)
    .tag(2, WireType.Varint)
    .int32(1)
    .tag(3, WireType.Varint)
    .int32(1)
    .finish();
}

/**
 * A Plugin row as an earlier release stored it: the live fields it shares
 * with today's status, then the retired state (field 3) and/or
 * materialized (field 5) written by number.
 */
function legacyRow(options: {
  readonly id: string;
  readonly storageKey?: string;
  readonly state?: boolean;
  readonly materialized?: boolean;
  readonly error?: string;
}): Uint8Array {
  const head = create(PluginSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Plugin",
    metadata: create(ApiResourceMetadataSchema, {
      id: options.id,
      org: "org_acme",
      name: "legacy",
      slug: "legacy",
    }),
    spec: create(PluginSpecSchema, { name: "legacy", version: "1.0.0" }),
  });
  const status = new BinaryWriter().raw(
    toBinary(
      PluginStatusSchema,
      create(PluginStatusSchema, {
        digest: DIGEST,
        artifactStorageKey: options.storageKey ?? KEY,
        warnings: [
          create(PluginWarningSchema, {
            kind: "stale",
            message: "from the old install",
          }),
        ],
      }),
    ),
  );
  if (options.state ?? true) {
    status.tag(3, WireType.Varint).int32(2);
  }
  if ((options.error ?? "") !== "") {
    status.tag(4, WireType.LengthDelimited).string(options.error ?? "");
  }
  if (options.materialized ?? true) {
    status.tag(5, WireType.LengthDelimited).bytes(materialized());
  }
  return new BinaryWriter()
    .raw(toBinary(PluginSchema, head))
    .tag(5, WireType.LengthDelimited)
    .bytes(status.finish())
    .finish();
}

/** A plugin row in today's shape. */
function currentRow(id: string): Uint8Array {
  return toBinary(
    PluginSchema,
    create(PluginSchema, {
      metadata: create(ApiResourceMetadataSchema, {
        id,
        org: "org_acme",
        slug: "current",
      }),
      status: create(PluginStatusSchema, {
        digest: DIGEST,
        artifactStorageKey: KEY,
      }),
    }),
  );
}

/** Plugin rows by id; listResources and saveResource only, any other member throws. */
class PluginRows {
  readonly rows = new Map<string, Uint8Array>();
  readonly saved: string[] = [];
  constructor(rows: Record<string, Uint8Array>) {
    for (const [id, bytes] of Object.entries(rows)) this.rows.set(id, bytes);
  }
  store(): Store {
    const answers: Partial<Store> = {
      listResources: (kind) => {
        expect(kind).toBe(ApiResourceKind.plugin);
        return Promise.resolve([...this.rows.values()]);
      },
      saveResource: (<Desc extends DescMessage>(
        kind: ApiResourceKind,
        id: string,
        schema: Desc,
        message: MessageShape<Desc>,
      ) => {
        expect(kind).toBe(ApiResourceKind.plugin);
        this.saved.push(id);
        this.rows.set(id, toBinary(schema, message));
        return Promise.resolve();
      }) as Store["saveResource"],
    };
    return new Proxy(answers as Store, {
      get(target, prop) {
        if (prop in target) return target[prop as keyof Store];
        throw new Error(`store.${String(prop)} reached by the refresh`);
      },
    });
  }
  plugin(id: string): Plugin {
    return fromBinary(PluginSchema, this.rows.get(id)!);
  }
}

function archives(
  get: (key: string) => Promise<Uint8Array>,
): ContentAddressedArchiveStore {
  return {
    get,
    store: () => Promise.reject(new Error("the refresh stores no archive")),
    exists: () => Promise.reject(new Error("not used")),
    getStorageKey: (hash) => `plugins/${hash}.zip`,
    size: () => Promise.reject(new Error("not used")),
  };
}

const holding = archives((key) =>
  key === KEY
    ? Promise.resolve(ARCHIVE)
    : Promise.reject(new Error(`no archive at ${key}`)),
);

/** Every probe answers with an OAuth challenge. */
const oauthFetch: OutboundFetch = () =>
  Promise.resolve(
    new Response(null, {
      status: 401,
      headers: { "www-authenticate": 'Bearer realm="OAuth"' },
    }),
  );

function capturingLogger(): {
  logger: ReturnType<typeof createLogger>;
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({
      level: "info",
      pretty: false,
      write: (line) => lines.push(line),
    }),
  };
}

describe("isLegacyStatus", () => {
  it("is true for a status carrying the retired state or materialized fields, and false otherwise", () => {
    expect(
      isLegacyStatus(fromBinary(PluginSchema, legacyRow({ id: "plg_a" }))),
    ).toBe(true);
    expect(
      isLegacyStatus(
        fromBinary(
          PluginSchema,
          legacyRow({ id: "plg_b", materialized: false }),
        ),
      ),
    ).toBe(true);
    expect(
      isLegacyStatus(
        fromBinary(PluginSchema, legacyRow({ id: "plg_c", state: false })),
      ),
    ).toBe(true);
    // Field 4 (error) alone was never written without the state beside it; it does not mark a row.
    expect(
      isLegacyStatus(
        fromBinary(
          PluginSchema,
          legacyRow({
            id: "plg_d",
            state: false,
            materialized: false,
            error: "x",
          }),
        ),
      ),
    ).toBe(false);
    expect(isLegacyStatus(fromBinary(PluginSchema, currentRow("plg_e")))).toBe(
      false,
    );
    expect(isLegacyStatus(create(PluginSchema, {}))).toBe(false);
  });
});

describe("refreshLegacyPluginStatuses", () => {
  it("reads each legacy plugin again from its archive, saves it once under the same id and digest, and leaves current plugins alone", async () => {
    const rows = new PluginRows({
      plg_old: legacyRow({ id: "plg_old" }),
      plg_new: currentRow("plg_new"),
    });
    const before = rows.rows.get("plg_new");
    const { logger, lines } = capturingLogger();

    const refreshed = await refreshLegacyPluginStatuses({
      store: rows.store(),
      artifactStorage: holding,
      outboundFetch: oauthFetch,
      logger,
    });

    expect(refreshed).toBe(1);
    expect(rows.saved).toEqual(["plg_old"]);
    expect(rows.rows.get("plg_new")).toBe(before);
    expect(
      lines.some((line) =>
        line.includes(
          "Filled the status of plugins installed before plugins were whole",
        ),
      ),
    ).toBe(true);

    const plugin = rows.plugin("plg_old");
    expect(isLegacyStatus(plugin)).toBe(false);
    expect(plugin.metadata?.id).toBe("plg_old");
    const status = plugin.status!;
    expect(status.$unknown ?? []).toEqual([]);
    expect(status.digest).toBe(DIGEST);
    expect(status.artifactStorageKey).toBe(KEY);
    expect(status.skills.map((s) => s.name)).toEqual(["review"]);
    expect(status.agents.map((a) => [a.name, a.instructions])).toEqual([
      ["lead", "You lead the review and report back."],
    ]);
    expect(status.hooks?.groups.map((g) => g.event)).toEqual(["PostToolUse"]);
    expect(status.env["WEBHOOK"]).toMatchObject({
      isSecret: true,
      optional: false,
    });
    // The sign-in probe runs as on install: the URL-only server is completed.
    const linear = status.mcpServers.find((s) => s.name === "linear");
    expect(linear?.signIn?.oauthOnly).toBe(true);
    expect(linear?.env).toEqual(["LINEAR_ACCESS_TOKEN"]);
    expect(status.env["LINEAR_ACCESS_TOKEN"]).toMatchObject({
      isSecret: true,
      optional: false,
    });
    // The old install's warnings are replaced by this reading's.
    expect(status.warnings.map((w) => w.kind)).not.toContain("stale");

    const again = await refreshLegacyPluginStatuses({
      store: rows.store(),
      artifactStorage: holding,
      outboundFetch: oauthFetch,
      logger,
    });
    expect(again).toBe(0);
    expect(rows.saved).toEqual(["plg_old"]);
  });

  it("leaves a plugin whose archive is unrecorded, unreachable or no longer reads as it is, logs it, and refreshes the rest", async () => {
    const broken = writeArchive([
      { path: "README.md", bytes: encoder.encode("not a plugin") },
    ]);
    const brokenKey = `plugins/${openPluginArchive(broken).digest}.zip`;
    const rows = new PluginRows({
      plg_nokey: legacyRow({ id: "plg_nokey", storageKey: "" }),
      plg_gone: legacyRow({
        id: "plg_gone",
        storageKey: `plugins/${"f".repeat(64)}.zip`,
      }),
      plg_broken: legacyRow({ id: "plg_broken", storageKey: brokenKey }),
      plg_ok: legacyRow({ id: "plg_ok" }),
    });
    const untouched = new Map(rows.rows);
    const { logger, lines } = capturingLogger();

    const refreshed = await refreshLegacyPluginStatuses({
      store: rows.store(),
      artifactStorage: archives((key) =>
        key === KEY
          ? Promise.resolve(ARCHIVE)
          : key === brokenKey
            ? Promise.resolve(broken)
            : Promise.reject(new Error("missing")),
      ),
      outboundFetch: oauthFetch,
      logger,
    });

    expect(refreshed).toBe(1);
    expect(rows.saved).toEqual(["plg_ok"]);
    for (const id of ["plg_nokey", "plg_gone", "plg_broken"]) {
      expect(rows.rows.get(id)).toBe(untouched.get(id));
    }
    const warned = lines.filter((line) =>
      line.includes("could not be read again; push it again to use it"),
    );
    expect(warned).toHaveLength(3);
    expect(warned.some((line) => line.includes("it records no archive"))).toBe(
      true,
    );
  });
});
