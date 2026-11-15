/**
 * An in-memory cluster behind the AgentSandboxGateway seam, for the
 * driver's suites: Sandboxes keep their spec as the API server would (a
 * patch replaces the pod template whole and the operating mode), a create
 * of an existing name answers "exists", a delete of a missing one
 * succeeds, and a Secret is created or replaced whole. Every call is
 * recorded in order. A Sandbox can be marked as being deleted for a number
 * of reads, after which it is gone, as the garbage collector would leave it.
 * A list matches label selectors of `key=value` pairs, as the API server's
 * equality selectors do, and every Sandbox has a creation time a test sets.
 * A Sandbox patched Suspended reports its pod gone (its status's Suspended
 * condition) after `podStopReads` reads, as the controller would once the
 * pod has stopped; `Infinity` keeps the pod forever. A view reads the
 * runner container's image and release from the pod template it holds.
 */
import type { V1Secret } from "@kubernetes/client-node";

import { SERVER_RELEASE_ENV } from "../../runner-launch.js";
import type { AgentSandboxChange, AgentSandboxGateway } from "../gateway.js";
import type {
  AgentSandboxOperatingMode,
  AgentSandboxPodTemplate,
  AgentSandboxResource,
  AgentSandboxView,
} from "../resource.js";

export interface FakeSandbox {
  readonly resource: AgentSandboxResource;
  readonly uid: string;
  operatingMode: AgentSandboxOperatingMode;
  podTemplate: AgentSandboxPodTemplate;
  /** Reads left while it is being deleted; undefined when it is not. */
  deletingReads: number | undefined;
  /** Reads left before a Suspended Sandbox's status reports its pod gone; 0 once it does. */
  podStopReads: number;
  createdAt: Date;
}

export class FakeAgentSandboxCluster implements AgentSandboxGateway {
  readonly sandboxes = new Map<string, FakeSandbox>();
  readonly secrets = new Map<string, V1Secret>();
  readonly calls: string[] = [];
  /** The creation time a new Sandbox gets. */
  clock: () => Date = () => new Date(0);
  /** A Sandbox another server creates between this one's read and create. */
  createdElsewhere: AgentSandboxResource | undefined;
  /** How many reads a Sandbox patched Suspended keeps its pod for (class header). */
  podStopReads = 0;
  private nextUid = 1;

  /** Puts a Sandbox in the cluster as if an earlier ensure had made it. */
  seed(
    resource: AgentSandboxResource,
    operatingMode: AgentSandboxOperatingMode,
  ): FakeSandbox {
    const sandbox: FakeSandbox = {
      resource,
      uid: `uid-${this.nextUid++}`,
      operatingMode,
      podTemplate: resource.spec.podTemplate,
      deletingReads: undefined,
      podStopReads: 0,
      createdAt: this.clock(),
    };
    this.sandboxes.set(resource.metadata.name, sandbox);
    return sandbox;
  }

  private view(name: string, sandbox: FakeSandbox): AgentSandboxView {
    const runner = sandbox.podTemplate.spec.containers.find((container) => container.name === "runner");
    return {
      name,
      uid: sandbox.uid,
      operatingMode: sandbox.operatingMode,
      runner:
        runner === undefined
          ? undefined
          : {
              image: runner.image ?? "",
              release: runner.env?.find((entry) => entry.name === SERVER_RELEASE_ENV)?.value ?? "",
            },
      podGone: sandbox.operatingMode === "Suspended" && sandbox.podStopReads === 0,
      deleting: sandbox.deletingReads !== undefined,
      createdAt: sandbox.createdAt,
      labels: sandbox.resource.metadata.labels,
      claims: (sandbox.resource.spec.volumeClaimTemplates ?? []).map((template) => template.metadata.name),
    };
  }

  async getSandbox(name: string): Promise<AgentSandboxView | undefined> {
    this.calls.push(`get:${name}`);
    const sandbox = this.sandboxes.get(name);
    if (sandbox === undefined) return undefined;
    if (sandbox.deletingReads !== undefined) {
      if (sandbox.deletingReads === 0) {
        this.sandboxes.delete(name);
        return undefined;
      }
      sandbox.deletingReads -= 1;
    }
    const view = this.view(name, sandbox);
    if (sandbox.operatingMode === "Suspended" && sandbox.podStopReads > 0) sandbox.podStopReads -= 1;
    return view;
  }

  async listSandboxes(labelSelector: string): Promise<AgentSandboxView[]> {
    this.calls.push(`list:${labelSelector}`);
    const wanted = labelSelector
      .split(",")
      .filter((pair) => pair !== "")
      .map((pair) => pair.split("=") as [string, string]);
    return [...this.sandboxes.entries()]
      .filter(([, sandbox]) =>
        wanted.every(
          ([key, value]) => sandbox.resource.metadata.labels[key] === value,
        ),
      )
      .map(([name, sandbox]) => this.view(name, sandbox));
  }

  async createSandbox(
    resource: AgentSandboxResource,
  ): Promise<AgentSandboxView | undefined> {
    const name = resource.metadata.name;
    this.calls.push(`create:${name}:${resource.spec.operatingMode}`);
    if (this.createdElsewhere !== undefined) {
      this.seed(
        this.createdElsewhere,
        this.createdElsewhere.spec.operatingMode,
      );
      this.createdElsewhere = undefined;
    }
    if (this.sandboxes.has(name)) return undefined;
    return this.view(name, this.seed(resource, resource.spec.operatingMode));
  }

  async patchSandbox(name: string, change: AgentSandboxChange): Promise<void> {
    this.calls.push(
      `patch:${name}:${change.operatingMode}${change.podTemplate === undefined ? "" : "+template"}`,
    );
    const sandbox = this.sandboxes.get(name);
    if (sandbox === undefined) throw new Error(`no Sandbox '${name}'`);
    if (change.operatingMode === "Suspended" && sandbox.operatingMode === "Running") {
      sandbox.podStopReads = this.podStopReads;
    }
    sandbox.operatingMode = change.operatingMode;
    if (change.podTemplate !== undefined)
      sandbox.podTemplate = change.podTemplate;
  }

  async deleteSandbox(name: string): Promise<void> {
    this.calls.push(`delete:${name}`);
    this.sandboxes.delete(name);
  }

  async applySecret(secret: V1Secret): Promise<void> {
    const name = secret.metadata?.name ?? "";
    this.calls.push(`secret:${name}`);
    this.secrets.set(name, secret);
  }
}
