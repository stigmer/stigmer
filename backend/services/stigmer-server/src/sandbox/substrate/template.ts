/**
 * The one ActorTemplate every sandbox of this server is created from, and
 * the keeper that makes it ready before an actor needs it.
 *
 * The template holds nothing per sandbox and nothing secret. Substrate
 * stores a template's environment as literal values and freezes it into
 * the template's golden snapshot, which every actor resumed from it
 * clones; so the runner's credentials and its queue arrive later, pushed
 * by the driver at every wakeup (push.ts). The snapshot holds the
 * runner's attach waiter (`dist/attach/main.js`), never a runner: every
 * clone of one snapshot shares the snapshotted process's random state,
 * so a runner started there would hand unrelated sessions the same keys
 * (the runner's src/attach/waiter.ts has the measurement). The waiter's
 * `/readyz` is the template's only wakeup probe, so Substrate takes the
 * snapshot the moment the waiter listens.
 *
 * The template is named by its content: `stigmer-runner-<12 hex of the
 * SHA-256 of its encoding>`. Changing the runner image or any setting
 * makes a new template and nothing else does; the previous one keeps
 * serving the actors on it until they move (driver.ts, sweep.ts).
 * Substrate templates are immutable, so this is also how an upgrade is
 * expressed at all.
 *
 * The keeper: one preparation in flight per process (a turn that arrives
 * during it awaits the same promise). It creates this server's atespace
 * when missing, creates the template when missing, and waits for its
 * golden snapshot, because an actor created before the snapshot is
 * published cold-boots for the rest of its life (Substrate's API guide).
 * A template whose snapshot failed (a terminal error on its status) is
 * deleted and created once more per process; after that its error is
 * thrown into every ensure until the operator fixes the cause.
 */
import { createHash } from "node:crypto";

import { create, toBinary } from "@bufbuild/protobuf";

import type { SandboxDriverConfig } from "../provisioner.js";
import type { SubstrateDriverSettings } from "./config.js";
import {
  ActorMetadataField,
  ActorTemplateSchema,
  ResourceMetadataSchema,
  ResumeSource,
  SandboxClass,
  SnapshotContentScope,
  type ActorTemplate,
} from "./gen/ateapipb/ateapi_pb.js";
import { delay } from "./delay.js";
import type { SubstrateGateway } from "./gateway.js";

/** The waiter entry the template runs (the runner package's dist/attach/main.js). */
const WAITER_COMMAND = ["node", "/runner/dist/attach/main.js"];
/** The waiter's port: the one Substrate's router reaches without a CONNECT tunnel. */
const WAITER_PORT = 80;
/** The workspace mount, the same path every driver gives the runner. */
const WORKSPACE_MOUNT_PATH = "/workspace";
/** Where the actor's own name is projected; the waiter reads it on every push. */
const SYSTEM_INFO_MOUNT_PATH = "/run/ate";
const ACTOR_NAME_FILE = "actor-name";
/** The egress gateway's CA, projected when HTTPS egress is on. */
const TRUST_BUNDLE_NAME = "egress-mitm.ate.dev";
const TRUST_BUNDLE_FILE = "trust-bundle.pem";
/**
 * The variables through which each common tool trusts a CA file: Node,
 * OpenSSL-based tools, git, curl (which ignores SSL_CERT_FILE), Python's
 * requests. Go reads SSL_CERT_FILE. Every agent tool must trust the
 * gateway's CA, because the gateway re-signs every HTTPS connection.
 */
const TRUST_VARIABLES = [
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "GIT_SSL_CAINFO",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
];
/** The kubernetes driver's limits: 2 CPU, 2 GiB. */
const LIMITS = [
  { name: "cpu", quantity: "2" },
  { name: "memory", quantity: "2Gi" },
];
/** Every template this driver writes carries this prefix; nothing else may. */
export const TEMPLATE_NAME_PREFIX = "stigmer-runner-";

/**
 * Where the runner believes it runs, its MODE. Open source's sandboxes are
 * `local`, the runner's own default. A composition that hosts many
 * organisations' sandboxes runs them `cloud`, which makes the runner's
 * web-fetch guard refuse private addresses, forbids a user's stdio MCP
 * servers and expects the composition's lanes (the runner's config.ts,
 * url-guard.ts, mcp-transport-guard.ts). It is the driver's to write, never
 * an operator's runner setting, because the runner reads it once as the
 * single statement of where it is.
 */
export type SubstrateRunnerMode = "local" | "cloud";

/** What a template is built from. */
export interface RunnerTemplateInput {
  readonly config: SandboxDriverConfig;
  readonly settings: SubstrateDriverSettings;
  readonly runnerMode: SubstrateRunnerMode;
}

/** The template, named by its content. */
export function buildRunnerTemplate(input: RunnerTemplateInput): ActorTemplate {
  const { config, settings, runnerMode } = input;
  const https = settings.httpsEgress === "all";
  const trustBundlePath = `${SYSTEM_INFO_MOUNT_PATH}/${TRUST_BUNDLE_FILE}`;

  const env: Record<string, string> = {
    ...config.runnerEnv,
    MODE: runnerMode,
    STIGMER_BACKEND_ENDPOINT: config.backendEndpoint,
    TEMPORAL_SERVICE_ADDRESS: config.temporalAddress,
    TEMPORAL_NAMESPACE: config.temporalNamespace,
    WORKSPACE_ROOT_DIR: WORKSPACE_MOUNT_PATH,
    STIGMER_ATTACH_PORT: String(WAITER_PORT),
    STIGMER_SANDBOX_NAME_FILE: `${SYSTEM_INFO_MOUNT_PATH}/${ACTOR_NAME_FILE}`,
  };
  if (config.mcpPublicEndpoint !== "") {
    env["STIGMER_MCP_PUBLIC_ENDPOINT"] = config.mcpPublicEndpoint;
  }
  if (https) {
    for (const name of TRUST_VARIABLES) env[name] = trustBundlePath;
  }

  const template = create(ActorTemplateSchema, {
    metadata: { atespace: settings.atespace },
    workerSelector: { matchLabels: { ...settings.workerSelector } },
    containers: [
      {
        name: "runner",
        image: config.runnerImage,
        command: [...WAITER_COMMAND],
        // Sorted, so the same configuration always encodes the same bytes.
        env: Object.keys(env)
          .sort()
          .map((name) => ({ name, value: env[name] ?? "" })),
        wakeupProbe: { httpGet: { path: "/readyz", port: WAITER_PORT } },
        volumeMounts: [
          { name: "workspace", mountPath: WORKSPACE_MOUNT_PATH },
          { name: "system-info", mountPath: SYSTEM_INFO_MOUNT_PATH },
        ],
      },
    ],
    volumes: [
      { name: "workspace", durableDir: {} },
      {
        name: "system-info",
        systemInfo: {
          dataSources: [
            ...(https
              ? [
                  {
                    trustBundle: {
                      name: TRUST_BUNDLE_NAME,
                      path: TRUST_BUNDLE_FILE,
                    },
                  },
                ]
              : []),
            {
              actorMetadata: {
                items: [
                  { field: ActorMetadataField.NAME, path: ACTOR_NAME_FILE },
                ],
              },
            },
          ],
        },
      },
    ],
    sandboxConfig: {
      sandboxClass: SandboxClass.GVISOR,
      configName: settings.sandboxConfigName,
    },
    resources: { limits: LIMITS.map((limit) => ({ ...limit })) },
    snapshotConfig: {
      // A pause keeps memory; a suspend keeps the workspace only, and a
      // resume from it starts the golden snapshot (the waiter) over it.
      onPause: SnapshotContentScope.FULL,
      onCommit: SnapshotContentScope.DATA,
      onResume: { fromData: ResumeSource.GOLDEN },
      storageLocation: settings.storageLocation,
    },
  });
  const digest = createHash("sha256")
    .update(toBinary(ActorTemplateSchema, template))
    .digest("hex")
    .slice(0, 12);
  template.metadata = create(ResourceMetadataSchema, {
    atespace: settings.atespace,
    name: `${TEMPLATE_NAME_PREFIX}${digest}`,
  });
  return template;
}

/** Polling cadence and cap of the golden-snapshot wait (a publish took 15.4 s on kind, 2026-10-03). */
const GOLDEN_POLL_MS = 2_000;
const GOLDEN_WAIT_MS = 180_000;

export interface TemplateKeeper {
  /** The current template's name. */
  readonly name: string;
  /** Resolves once the current template's golden snapshot is published. */
  ready(): Promise<string>;
  /**
   * Whether ready() has resolved in this process, without waiting: a
   * sandbox that can wake now on its older template is not held for a
   * new template's golden snapshot (driver.ts moves it later).
   */
  readyNow(): boolean;
  /** Forget a ready template that turned out to be gone (another server retired it). */
  invalidate(): void;
}

export function newTemplateKeeper(options: {
  readonly gateway: SubstrateGateway;
  readonly template: ActorTemplate;
  readonly logger: {
    info: (msg: string, fields?: Record<string, unknown>) => void;
  };
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}): TemplateKeeper {
  const { gateway, template, logger } = options;
  const sleep = options.sleep ?? delay;
  const now = options.now ?? Date.now;
  const name = template.metadata?.name ?? "";
  let inFlight: Promise<string> | undefined;
  let isReady = false;
  let recreated = false;

  async function prepare(): Promise<string> {
    const started = now();
    await gateway.ensureAtespace();
    for (;;) {
      const current = await gateway.getTemplate(name);
      if (current === undefined) {
        await gateway.createTemplate(template);
        logger.info("Substrate template created", { template: name });
      } else if (current.goldenReady) {
        logger.info("Substrate template ready", {
          template: name,
          waitedMs: now() - started,
        });
        isReady = true;
        return name;
      } else if (current.goldenError !== "") {
        if (recreated) {
          throw new Error(
            `Substrate template ${name} failed to publish its golden snapshot: ${current.goldenError}`,
          );
        }
        recreated = true;
        logger.info(
          "Substrate template failed its golden snapshot; recreating once",
          {
            template: name,
            error: current.goldenError,
          },
        );
        await gateway.deleteTemplate(current);
        continue;
      }
      if (now() - started > GOLDEN_WAIT_MS) {
        throw new Error(
          `Substrate template ${name} did not publish its golden snapshot within ${GOLDEN_WAIT_MS / 1000} s`,
        );
      }
      await sleep(GOLDEN_POLL_MS);
    }
  }

  return {
    name,
    ready() {
      inFlight ??= prepare().catch((error: unknown) => {
        // A failed preparation is retried by the next caller, not cached.
        inFlight = undefined;
        throw error;
      });
      return inFlight;
    },
    readyNow: () => isReady,
    invalidate() {
      inFlight = undefined;
      isReady = false;
    },
  };
}
