import type { ReactNode } from "react";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { VisibilityResourceKind } from "../library/useUpdateVisibility.js";

/**
 * The resource whose access is being managed. Carries everything the People
 * section needs: the enum {@link ApiResourceKind} (for grantable-role lookup),
 * the FGA/API kind string (for IAM refs and permission checks), the id, and
 * the owning org (drives the org-member typeahead).
 */
export interface AccessResource {
  /** ApiResourceKind enum — drives grantable-role lookup and capability. */
  readonly kind: ApiResourceKind;
  /** FGA/API kind string (e.g. "mcp_server", "session", "workflow_execution"). */
  readonly kindString: string;
  /** Resource id. */
  readonly id: string;
  /** Slug of the owning organization (`metadata.org`). */
  readonly org: string;
  /** Optional display name, shown as the dialog subtitle for context. */
  readonly name?: string;
}

/**
 * Describes the "General access" (visibility) axis for the Manage access
 * dialog. Optional because not every resource has visibility (e.g. sessions
 * and workflow executions do not). When present, the dialog renders the
 * shared `ResourceVisibilityControl`, which owns level selection and
 * the `can_edit` gate.
 */
export interface AccessVisibility {
  /** Resource kind, selecting both the updateVisibility RPC and FGA type. */
  readonly kind: VisibilityResourceKind;
  /** Current visibility of the resource. */
  readonly current: ApiResourceVisibility;
  /**
   * Slug of the owning org (`metadata.org`); gates the Platform option for
   * blueprints. Omit for instances and where Platform should not be offered.
   */
  readonly org?: string;
  /** Called after a successful visibility change so the host can refetch. */
  readonly onChanged?: () => void;
}

/**
 * A generic, resource-specific access section appended below People — the
 * escape hatch for the rare per-kind axis (today: workflow-instance run
 * observability) without baking that knowledge into a generic dialog.
 */
export interface AccessExtraSection {
  /** Section heading. */
  readonly title: string;
  /** Optional one-line explanation under the heading. */
  readonly description?: string;
  /** The section body (e.g. a `<RunVisibilityControl />`). */
  readonly content: ReactNode;
}
