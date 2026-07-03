"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { PushSkillFromExecutionArtifactRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { parseResourceYaml } from "./parse-resource-yaml.js";

/**
 * Result returned after successfully applying a resource to an organization.
 *
 * Contains the minimum metadata needed to display a success message and
 * link to the resource in the Library (e.g., `/library/agents`).
 */
export interface ApplyResourceResult {
  /** The resource kind that was applied. */
  readonly kind: "Agent" | "McpServer" | "Skill";
  /** The resource name (from response metadata). */
  readonly name: string;
  /** The organization the resource was applied to. */
  readonly org: string;
  /** The URL-friendly slug (from response metadata). */
  readonly slug: string;
}

/**
 * Parameters for pushing a skill package from an execution artifact.
 *
 * The server reads the directory artifact (ZIP) from execution storage
 * and pushes it as a skill — no ZIP download reaches the browser.
 */
export interface PushSkillParams {
  /** Organization that will own the skill. */
  readonly org: string;
  /** ID of the execution that produced the artifact (format: `aex_{ulid}`). */
  readonly executionId: string;
  /** Storage key of the directory artifact. Must start with `artifacts/{executionId}/`. */
  readonly storageKey: string;
  /** Optional version tag (e.g., `"stable"`, `"v1.0"`). */
  readonly tag?: string;
}

/** Return value of {@link useApplyResource}. */
export interface UseApplyResourceReturn {
  /**
   * Apply a Stigmer resource YAML (Agent or McpServer) to an organization.
   *
   * Parses the YAML content, converts it to the appropriate SDK input type,
   * and calls `stigmer.agent.apply()` or `stigmer.mcpServer.apply()` based
   * on the detected `kind`.
   *
   * The `org` parameter overrides `metadata.org` in the YAML — matching
   * the "Apply to [my-org]" UX intent.
   *
   * @throws Re-throws the original error after setting `error` state, so
   *   callers can optionally catch for flow control.
   */
  readonly applyYamlResource: (
    content: string,
    org: string,
  ) => Promise<ApplyResourceResult>;

  /**
   * Push a skill package from an execution artifact to an organization.
   *
   * Uses the server-side `pushFromExecutionArtifact` RPC — the server reads
   * the ZIP from execution storage and pushes it as a skill. No ZIP download
   * reaches the browser.
   *
   * @throws Re-throws the original error after setting `error` state.
   */
  readonly pushSkillPackage: (
    params: PushSkillParams,
  ) => Promise<ApplyResourceResult>;

  /** `true` while an apply or push operation is in-flight. */
  readonly isApplying: boolean;

  /** Error from the last failed operation, or `null` when healthy. */
  readonly error: Error | null;

  /** Clear the error state (e.g., when the user dismisses an error message). */
  readonly clearError: () => void;
}

/**
 * Behavior hook for applying detected Stigmer resources to an organization.
 *
 * Bridges the detection layer ({@link detectStigmerResource},
 * {@link useDetectSkillPackage}) to the apply action — the user clicks
 * "Apply to [org]" and the resource is created or updated.
 *
 * Handles two parallel apply paths:
 *
 * 1. **YAML resources** (Agent, McpServer): `applyYamlResource(content, org)`
 *    parses the YAML, converts snake_case fields to SDK input types, and
 *    calls the appropriate `apply()` method.
 *
 * 2. **Skill packages** (directory artifacts): `pushSkillPackage(params)`
 *    delegates to the server-side `pushFromExecutionArtifact` RPC.
 *
 * Follows the established mutation hook pattern: `isApplying` + `error` +
 * `clearError`. The result is returned from the promise (not stored in
 * hook state) — consistent with {@link useCreateOrganization} and other
 * SDK mutation hooks.
 *
 * @example
 * ```tsx
 * const { applyYamlResource, pushSkillPackage, isApplying, error, clearError } =
 *   useApplyResource();
 * const [result, setResult] = useState<ApplyResourceResult | null>(null);
 *
 * const handleApply = async () => {
 *   clearError();
 *   try {
 *     if (yamlDetection.detected) {
 *       setResult(await applyYamlResource(content!, activeOrg));
 *     } else if (skillDetection.detected) {
 *       setResult(await pushSkillPackage({
 *         org: activeOrg,
 *         executionId,
 *         storageKey: artifact.storageKey,
 *       }));
 *     }
 *   } catch {
 *     // error state is set by the hook
 *   }
 * };
 * ```
 *
 * @see {@link parseResourceYaml} for the pure YAML-to-input conversion
 * @see {@link detectStigmerResource} for YAML resource detection
 * @see {@link useDetectSkillPackage} for skill package detection
 */
export function useApplyResource(): UseApplyResourceReturn {
  const stigmer = useStigmer();
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const applyYamlResource = useCallback(
    async (content: string, org: string): Promise<ApplyResourceResult> => {
      setIsApplying(true);
      setError(null);

      try {
        const parsed = parseResourceYaml(content, org);

        switch (parsed.kind) {
          case "Agent": {
            const agent = await stigmer.agent.apply(parsed.input);
            return {
              kind: "Agent",
              name: agent.metadata?.name ?? parsed.input.name,
              org: agent.metadata?.org ?? org,
              slug: agent.metadata?.slug ?? parsed.input.name,
            };
          }
          case "McpServer": {
            const mcpServer = await stigmer.mcpServer.apply(parsed.input);
            return {
              kind: "McpServer",
              name: mcpServer.metadata?.name ?? parsed.input.name,
              org: mcpServer.metadata?.org ?? org,
              slug: mcpServer.metadata?.slug ?? parsed.input.name,
            };
          }
        }
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsApplying(false);
      }
    },
    [stigmer],
  );

  const pushSkillPackage = useCallback(
    async (params: PushSkillParams): Promise<ApplyResourceResult> => {
      setIsApplying(true);
      setError(null);

      try {
        const request = create(PushSkillFromExecutionArtifactRequestSchema, {
          org: params.org,
          executionId: params.executionId,
          storageKey: params.storageKey,
          tag: params.tag ?? "",
        });

        const skill = await stigmer.skill.pushFromExecutionArtifact(request);
        return {
          kind: "Skill",
          name: skill.metadata?.name ?? "",
          org: skill.metadata?.org ?? params.org,
          slug: skill.metadata?.slug ?? "",
        };
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsApplying(false);
      }
    },
    [stigmer],
  );

  return { applyYamlResource, pushSkillPackage, isApplying, error, clearError };
}
