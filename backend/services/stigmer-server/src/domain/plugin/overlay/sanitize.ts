/**
 * The sanitiser: what an overlay author may NOT say about the resources a
 * plugin materialises on the installing caller's behalf. The materialisers
 * write those resources through the in-process lane, and the in-process
 * lane passes GuardReservedLabels structurally (the controller stamps the
 * membership labels by design), so this module is the one place plugin-
 * provided metadata is judged before it can ride that lane. Without it an
 * archive could carry `stigmer.ai/default-agent: "true"` in its agent
 * overlay and become every organization's default agent.
 *
 * Four rules, each one sentence with the document's path:
 *   - a `stigmer.ai/*` label costs `can_write_reserved_labels` on
 *     `platform:stigmer`, the same check GuardReservedLabels runs and the
 *     same lazy consultation of the one composed Authorizer (the
 *     open-source permissive default allows; an enforcing authorizer
 *     denies with PERMISSION_DENIED naming the keys);
 *   - `metadata.id` is the server's to mint, never an author's;
 *   - the agent overlay's name is the plugin's, a server overlay's name is
 *     its `mcpServers` key, a workflow overlay's name is its file stem: an
 *     overlay describes ONE resource the plugin owns, and a name that says
 *     otherwise is a mistake the author should hear about;
 *   - a foreign `metadata.org` was already refused by the parser.
 *
 * The plugin's own two labels are stamped after this runs, so they never
 * appear here. Proven by __tests__/sanitize.test.ts under a denying and an
 * allowing authorizer.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { RESERVED_LABEL_PREFIX } from "../../../pipeline/apiresource-labels.js";
import {
  internalError,
  invalidArgumentError,
} from "../../../pipeline/errors.js";
import { generateSlug } from "../../../pipeline/steps/slug.js";
import type { ParsedOverlays } from "./documents.js";

/** The plugin the overlays describe, as the sanitiser needs it. */
export interface OverlaySubject {
  readonly pluginName: string;
}

/** Refuses what an author may not say; returns when every document is clean. */
export async function sanitizeOverlays(
  overlays: ParsedOverlays,
  subject: OverlaySubject,
  authorizer: Authorizer,
  caller: CallerIdentity,
): Promise<void> {
  const reservedKeys = new Map<string, string[]>();

  const judge = (
    path: string,
    metadata: ApiResourceMetadata | undefined,
    expectedName: string,
  ): void => {
    if (metadata === undefined) {
      return;
    }
    if (metadata.id !== "") {
      throw invalidArgumentError(
        `overlay document '${path}' sets metadata.id; a plugin's resources take their ids from the server`,
      );
    }
    if (metadata.name !== "" && metadata.name !== expectedName) {
      throw invalidArgumentError(
        `overlay document '${path}' names '${metadata.name}' but describes '${expectedName}'; leave metadata.name empty or make them agree`,
      );
    }
    if (metadata.slug !== "" && metadata.slug !== generateSlug(expectedName)) {
      throw invalidArgumentError(
        `overlay document '${path}' sets slug '${metadata.slug}' but describes '${expectedName}'; leave metadata.slug empty or make them agree`,
      );
    }
    const reserved = Object.keys(metadata.labels)
      .filter((key) => key.startsWith(RESERVED_LABEL_PREFIX))
      .sort();
    if (reserved.length > 0) {
      reservedKeys.set(path, reserved);
    }
  };

  if (overlays.agent !== undefined) {
    judge(
      overlays.agent.path,
      overlays.agent.resource.metadata,
      subject.pluginName,
    );
  }
  for (const document of overlays.mcpServers) {
    judge(document.path, document.resource.metadata, document.server);
  }
  for (const document of overlays.workflows) {
    judge(document.path, document.resource.metadata, document.name);
  }

  if (reservedKeys.size === 0) {
    return;
  }

  // Lazy operator check — only an archive that actually carries a reserved
  // key ever reaches the Authorizer, exactly as GuardReservedLabels does.
  let decision;
  try {
    decision = await authorizer.authorize(caller, {
      permission: IamPermission.can_write_reserved_labels,
      resourceKind: ApiResourceKind.platform,
      resourceId: "stigmer",
    });
  } catch (error) {
    throw internalError(
      error instanceof Error ? error : new Error(String(error)),
      "reserved-label validation could not be completed",
    );
  }
  switch (decision.kind) {
    case "allow":
      return;
    case "deny":
    case "not-found": {
      const listed = [...reservedKeys.entries()]
        .map(([path, keys]) => `${path}: ${keys.join(", ")}`)
        .join("; ");
      throw new ConnectError(
        `Labels in the reserved '${RESERVED_LABEL_PREFIX}' namespace are platform-managed and ` +
          `cannot be set by a plugin (${listed}). Remove them from the plugin's ai.stigmer/ documents.`,
        Code.PermissionDenied,
      );
    }
    case "unavailable":
      throw internalError(
        decision.cause,
        "reserved-label validation could not be completed",
      );
    default: {
      const exhaustive: never = decision;
      throw internalError(
        new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
        "reserved-label validation could not be completed",
      );
    }
  }
}
