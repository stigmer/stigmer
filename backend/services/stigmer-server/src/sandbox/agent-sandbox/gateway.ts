/**
 * The agent-sandbox driver's gateway: the ONLY surface that touches the
 * cluster, so the driver's logic stays pure above it and a test drives it
 * with a fake (__test-utils__/fake-gateway.ts).
 *
 * It speaks to two resources in the driver's namespace through
 * @kubernetes/client-node: agent-sandbox's `Sandbox` (resource.ts), through
 * CustomObjectsApi, and the per-sandbox Secret. The client resolves its
 * cluster as kubectl does: the in-cluster service account, or the
 * operator's kubeconfig.
 *
 * A change to a Sandbox is a JSON Patch whose `add` operations replace
 * `spec.operatingMode` and, on a wake, `spec.podTemplate` whole. A merge
 * patch would keep any key of the old template the new one leaves out, so
 * a woken sandbox would not run exactly this server's template. The
 * content type is set explicitly rather than left to the client's default.
 *
 * Errors are translated where the driver acts on them and passed on
 * otherwise: 404 is "absent" on a read and success on a delete; 409 on a
 * create is "already exists"; a 404 on a create means the namespace or
 * the resource type is missing, which becomes AgentSandboxNotInstalledError
 * naming what to install.
 *
 * A Sandbox is deleted in the foreground: it stays, marked as being
 * deleted, until the pod and the claim it controls are gone, and its
 * Secret goes with it too. The pod and the claim carry the Sandbox's name,
 * and the controller will not build a new Sandbox's pod or claim over
 * objects an old one still controls, so an ensure that finds a Sandbox
 * being deleted waits for it (driver.ts) and is then free to create.
 * agent-sandbox's controller does nothing to a Sandbox being deleted.
 */
import {
  ApiException,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  PatchStrategy,
  setHeaderOptions,
} from "@kubernetes/client-node";
import type { V1Secret } from "@kubernetes/client-node";

import {
  AGENT_SANDBOX_GROUP,
  AGENT_SANDBOX_PLURAL,
  AGENT_SANDBOX_VERSION,
  type AgentSandboxOperatingMode,
  type AgentSandboxPodTemplate,
  type AgentSandboxResource,
  type AgentSandboxView,
} from "./resource.js";

/** How many Sandboxes one list call asks for; a longer list is paged. */
const LIST_PAGE_SIZE = 500;

/** The cluster does not serve agent-sandbox's Sandbox in the namespace. */
export class AgentSandboxNotInstalledError extends Error {
  constructor(namespace: string, detail: string) {
    super(
      `agent-sandbox's Sandbox resource (${AGENT_SANDBOX_PLURAL}.${AGENT_SANDBOX_GROUP}/${AGENT_SANDBOX_VERSION}) cannot be created in namespace '${namespace}': install agent-sandbox in the cluster (its core manifest, sandbox.yaml) and check that the namespace exists (${detail})`,
    );
    this.name = "AgentSandboxNotInstalledError";
  }
}

/** One change to a Sandbox: its operating mode, and on a wake its pod template. */
export interface AgentSandboxChange {
  readonly operatingMode: AgentSandboxOperatingMode;
  readonly podTemplate?: AgentSandboxPodTemplate;
}

export interface AgentSandboxGateway {
  /** The named Sandbox; undefined when it does not exist. */
  getSandbox(name: string): Promise<AgentSandboxView | undefined>;
  /** Every Sandbox in the namespace whose labels match `labelSelector` (`key=value,...`). */
  listSandboxes(labelSelector: string): Promise<AgentSandboxView[]>;
  /** Creates the Sandbox; undefined when one of that name already exists. */
  createSandbox(
    sandbox: AgentSandboxResource,
  ): Promise<AgentSandboxView | undefined>;
  patchSandbox(name: string, change: AgentSandboxChange): Promise<void>;
  /** Deletes the Sandbox and, through ownership, its pod, claim and Secret; missing is success. */
  deleteSandbox(name: string): Promise<void>;
  /** Creates the Secret, or replaces it whole when it exists. */
  applySecret(secret: V1Secret): Promise<void>;
}

function isStatus(error: unknown, code: number): boolean {
  return error instanceof ApiException && error.code === code;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record(value))) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Reads the fields the driver uses from a Sandbox the API returned. */
export function agentSandboxViewOf(object: unknown): AgentSandboxView {
  const metadata = record(record(object).metadata);
  const spec = record(record(object).spec);
  const name = metadata.name;
  const uid = metadata.uid;
  if (typeof name !== "string" || typeof uid !== "string") {
    throw new Error("a Sandbox from the cluster carries no name or uid");
  }
  return {
    name,
    uid,
    // The resource defaults an unset mode to Running.
    operatingMode: spec.operatingMode === "Suspended" ? "Suspended" : "Running",
    deleting: typeof metadata.deletionTimestamp === "string",
    createdAt:
      typeof metadata.creationTimestamp === "string"
        ? new Date(metadata.creationTimestamp)
        : undefined,
    labels: stringRecord(metadata.labels),
  };
}

/** The API server's own words for a refusal: its Status message, else its text. */
function errorDetail(error: ApiException<unknown>): string {
  const text = typeof error.body === "string" ? error.body.trim() : "";
  const message = record(text === "" ? error.body : safeJson(text)).message;
  const detail = typeof message === "string" ? message : text;
  return detail === "" ? `HTTP ${error.code}` : `HTTP ${error.code}: ${detail}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The gateway over a resolved kubeconfig (the factory loads the default one). */
export function newAgentSandboxClientGateway(
  kubeConfig: KubeConfig,
  namespace: string,
): AgentSandboxGateway {
  const custom = kubeConfig.makeApiClient(CustomObjectsApi);
  const core = kubeConfig.makeApiClient(CoreV1Api);
  const resource = {
    group: AGENT_SANDBOX_GROUP,
    version: AGENT_SANDBOX_VERSION,
    namespace,
    plural: AGENT_SANDBOX_PLURAL,
  };

  return {
    async getSandbox(name) {
      try {
        const object: unknown = await custom.getNamespacedCustomObject({
          ...resource,
          name,
        });
        return agentSandboxViewOf(object);
      } catch (error) {
        if (isStatus(error, 404)) return undefined;
        throw error;
      }
    },
    async listSandboxes(labelSelector) {
      const views: AgentSandboxView[] = [];
      let continueToken: string | undefined;
      do {
        const page: unknown = await custom.listNamespacedCustomObject({
          ...resource,
          labelSelector,
          limit: LIST_PAGE_SIZE,
          ...(continueToken === undefined ? {} : { _continue: continueToken }),
        });
        const items = record(page).items;
        for (const item of Array.isArray(items) ? items : []) {
          views.push(agentSandboxViewOf(item));
        }
        const next = record(record(page).metadata).continue;
        continueToken =
          typeof next === "string" && next !== "" ? next : undefined;
      } while (continueToken !== undefined);
      return views;
    },
    async createSandbox(sandbox) {
      try {
        const object: unknown = await custom.createNamespacedCustomObject({
          ...resource,
          body: sandbox,
        });
        return agentSandboxViewOf(object);
      } catch (error) {
        if (isStatus(error, 409)) return undefined;
        if (error instanceof ApiException && error.code === 404) {
          throw new AgentSandboxNotInstalledError(
            namespace,
            errorDetail(error),
          );
        }
        throw error;
      }
    },
    async patchSandbox(name, change) {
      const operations: Array<{ op: "add"; path: string; value: unknown }> = [];
      if (change.podTemplate !== undefined) {
        operations.push({
          op: "add",
          path: "/spec/podTemplate",
          value: change.podTemplate,
        });
      }
      operations.push({
        op: "add",
        path: "/spec/operatingMode",
        value: change.operatingMode,
      });
      await custom.patchNamespacedCustomObject(
        { ...resource, name, body: operations },
        setHeaderOptions("Content-Type", PatchStrategy.JsonPatch),
      );
    },
    async deleteSandbox(name) {
      try {
        await custom.deleteNamespacedCustomObject({
          ...resource,
          name,
          propagationPolicy: "Foreground",
        });
      } catch (error) {
        if (!isStatus(error, 404)) throw error;
      }
    },
    async applySecret(secret) {
      try {
        await core.createNamespacedSecret({ namespace, body: secret });
      } catch (error) {
        if (!isStatus(error, 409)) throw error;
        await core.replaceNamespacedSecret({
          name: secret.metadata?.name ?? "",
          namespace,
          body: secret,
        });
      }
    },
  };
}
