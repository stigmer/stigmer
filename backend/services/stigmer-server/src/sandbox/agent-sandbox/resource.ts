/**
 * The part of agent-sandbox's `Sandbox` resource this driver reads and
 * writes, typed by hand and pinned to `agents.x-k8s.io/v1beta1`
 * (kubernetes-sigs/agent-sandbox, api/v1beta1/sandbox_types.go). Only the
 * fields the driver uses are here: no codegen for a handful of fields, and
 * the kind lane against upstream's releases catches drift.
 *
 * A Sandbox is one pod built from `spec.podTemplate`, plus one claim per
 * `spec.volumeClaimTemplates` entry, named `<template name>-<sandbox name>`
 * and mounted as a volume named after the template. `spec.operatingMode`
 * `Suspended` deletes the pod and keeps the claims; `Running` creates the
 * pod again from the CURRENT template. The pod and the claims are owned by
 * the Sandbox, so deleting it removes them. The claim templates are
 * immutable after creation; the pod template may change, and a change takes
 * effect at the next pod the controller creates.
 *
 * The status reports a suspension's progress in its `Suspended` condition:
 * True, reason `PodTerminated`, once the pod is gone, and False while it is
 * still terminating, each stamped with the generation it observed. The
 * controller leaves the condition behind after a wake, so it counts only
 * under `Suspended` and only when observed at the object's current
 * generation (api/v1beta1/sandbox_types.go, `SandboxConditionSuspended`;
 * controllers/sandbox_controller.go, `computeSuspendedCondition`, at
 * v1.0.5).
 */
import type {
  V1PersistentVolumeClaimSpec,
  V1PodSpec,
} from "@kubernetes/client-node";

export const AGENT_SANDBOX_GROUP = "agents.x-k8s.io";
export const AGENT_SANDBOX_VERSION = "v1beta1";
export const AGENT_SANDBOX_PLURAL = "sandboxes";
export const AGENT_SANDBOX_KIND = "Sandbox";
export const AGENT_SANDBOX_API_VERSION = `${AGENT_SANDBOX_GROUP}/${AGENT_SANDBOX_VERSION}`;

/** spec.operatingMode: whether the Sandbox has a pod. */
export type AgentSandboxOperatingMode = "Running" | "Suspended";

/** spec.podTemplate: a pod spec with the labels its pod carries. */
export interface AgentSandboxPodTemplate {
  readonly metadata: { readonly labels: Readonly<Record<string, string>> };
  readonly spec: V1PodSpec;
}

/** One spec.volumeClaimTemplates entry. */
export interface AgentSandboxVolumeClaimTemplate {
  readonly metadata: { readonly name: string };
  readonly spec: V1PersistentVolumeClaimSpec;
}

/** A Sandbox as this driver creates it. */
export interface AgentSandboxResource {
  readonly apiVersion: typeof AGENT_SANDBOX_API_VERSION;
  readonly kind: typeof AGENT_SANDBOX_KIND;
  readonly metadata: {
    readonly name: string;
    readonly labels: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly podTemplate: AgentSandboxPodTemplate;
    readonly volumeClaimTemplates?: readonly AgentSandboxVolumeClaimTemplate[];
    readonly operatingMode: AgentSandboxOperatingMode;
  };
}

/** What the driver reads back from a Sandbox in the cluster. */
export interface AgentSandboxView {
  readonly name: string;
  /** The object's uid, which the Secret's owner reference names. */
  readonly uid: string;
  readonly operatingMode: AgentSandboxOperatingMode;
  /**
   * The runner container of spec.podTemplate: its image and the server
   * release it was given (SERVER_RELEASE_ENV, "" when unset); undefined
   * when the template has no runner container.
   */
  readonly runner:
    | { readonly image: string; readonly release: string }
    | undefined;
  /**
   * Suspended, and the status says its pod is gone for this generation
   * (the module header); false in every other case.
   */
  readonly podGone: boolean;
  /** The Sandbox has a deletion timestamp: it is going away. */
  readonly deleting: boolean;
  /** When the API server made it; undefined when the object does not say. */
  readonly createdAt: Date | undefined;
  readonly labels: Readonly<Record<string, string>>;
  /** The names of its volume claim templates, fixed when it was created. */
  readonly claims: readonly string[];
}
