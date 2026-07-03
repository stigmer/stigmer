"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { GetArtifactRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useAgent } from "../agent/index.js";
import { useMcpServer } from "../mcp-server/index.js";
import { useSkill } from "../skill/index.js";
import { serializeAgentYaml, serializeMcpServerYaml } from "../library/index.js";
import type { DraftResourceType } from "./draft.js";

/** Return value of {@link useEditSessionPrep}. */
export interface UseEditSessionPrepReturn {
  /** Files ready to be passed as `initialAttachments` to SessionComposer. */
  readonly files: File[] | undefined;
  /** Non-null when resource fetch or serialization failed. */
  readonly error: string | null;
}

/**
 * Prepares initial attachment files for an edit-mode draft session.
 *
 * Given a resource type and an org/slug reference, this hook fetches the
 * existing resource and serializes it into a `File` object suitable for
 * the `initialAttachments` prop of `SessionComposer`:
 *
 * - **agent** / **mcp-server**: serialized to YAML
 * - **skill**: downloaded as a ZIP package
 *
 * Pass `null` for `draftType` or `editRef` to skip preparation (used
 * when the session is in create-mode rather than edit-mode).
 */
export function useEditSessionPrep(
  draftType: DraftResourceType | null,
  editRef: { readonly org: string; readonly slug: string } | null,
): UseEditSessionPrepReturn {
  const stigmer = useStigmer();
  const editOrg = editRef?.org ?? null;
  const editSlug = editRef?.slug ?? null;

  const { agent: editAgent } = useAgent(
    draftType === "agent" ? editOrg : null,
    draftType === "agent" ? editSlug : null,
  );

  const { mcpServer: editMcpServer } = useMcpServer(
    draftType === "mcp-server" ? editOrg : null,
    draftType === "mcp-server" ? editSlug : null,
  );

  const { skill: editSkill } = useSkill(
    draftType === "skill" ? editOrg : null,
    draftType === "skill" ? editSlug : null,
  );

  const [files, setFiles] = useState<File[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const built = useRef(false);

  useEffect(() => {
    if (built.current) return;

    if (draftType === "agent" && editAgent) {
      built.current = true;
      try {
        const yaml = serializeAgentYaml(editAgent);
        const slug = editAgent.metadata?.slug ?? "agent";
        setFiles([new File([yaml], `${slug}.yaml`, { type: "text/yaml" })]);
      } catch {
        setError("Failed to serialize agent for editing");
      }
    }

    if (draftType === "mcp-server" && editMcpServer) {
      built.current = true;
      try {
        const yaml = serializeMcpServerYaml(editMcpServer);
        const slug = editMcpServer.metadata?.slug ?? "mcp-server";
        setFiles([new File([yaml], `${slug}.yaml`, { type: "text/yaml" })]);
      } catch {
        setError("Failed to serialize MCP server for editing");
      }
    }
  }, [draftType, editAgent, editMcpServer]);

  useEffect(() => {
    if (built.current) return;
    if (draftType !== "skill" || !editSkill) return;

    const storageKey = editSkill.status?.artifactStorageKey;
    if (!storageKey) return;

    built.current = true;
    const slug = editSkill.metadata?.slug ?? "skill";

    stigmer.skill
      .getArtifact(create(GetArtifactRequestSchema, { artifactStorageKey: storageKey }))
      .then((resp) => {
        const buf = new ArrayBuffer(resp.artifact.byteLength);
        new Uint8Array(buf).set(resp.artifact);
        const blob = new Blob([buf], { type: "application/zip" });
        setFiles([new File([blob], `${slug}.zip`, { type: "application/zip" })]);
      })
      .catch(() => {
        setError("Failed to download skill package for editing");
      });
  }, [draftType, editSkill, stigmer]);

  return { files, error };
}
