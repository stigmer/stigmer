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
 */
import type { V1Secret } from "@kubernetes/client-node";

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
      createdAt: this.clock(),
    };
    this.sandboxes.set(resource.metadata.name, sandbox);
    return sandbox;
  }

  private view(name: string, sandbox: FakeSandbox): AgentSandboxView {
    return {
      name,
      uid: sandbox.uid,
      operatingMode: sandbox.operatingMode,
      deleting: sandbox.deletingReads !== undefined,
      createdAt: sandbox.createdAt,
      labels: sandbox.resource.metadata.labels,
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
    return this.view(name, sandbox);
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
