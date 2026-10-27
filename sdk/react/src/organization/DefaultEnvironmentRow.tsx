"use client";

/**
 * The organization's default Environment: one row of its preferences, the
 * Environment a conversation in a sandbox the server starts runs in when
 * neither the conversation, its routine nor its agent names one.
 *
 * Saved the moment it is picked, as the memory switch beside it is, and
 * naming only `spec.preferences.default_environment_ref`, with the etag
 * the organization was loaded at. The picker's first row is "None": the
 * organization's default is the last step of the order, and below it is
 * the server's standard sandbox. Read-only for someone who may not edit
 * the organization. On a server whose conversations run in no sandbox it
 * starts, the row says so in place of its helper.
 */
import { useCallback } from "react";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { ResourceRef } from "@stigmer/client";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { ENVIRONMENTS_NOT_APPLYING_COPY } from "../environment/copy.js";
import { environmentName, useEnvironmentList } from "../environment/useEnvironmentList.js";
import { saveErrorMessage } from "../internal/maskedEdit.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useEnvironmentAvailability } from "../server-info.js";
import { useUpdateOrganization } from "./useUpdateOrganization.js";

/** What the row says under its title where the default applies. */
export const DEFAULT_ENVIRONMENT_HELPER_TEXT =
  "Conversations in sandboxes this server starts use it when neither the conversation, its routine nor its agent names one. Conversations on a person's own machine ignore it.";

/** Props for {@link DefaultEnvironmentRow}. */
export interface DefaultEnvironmentRowProps {
  /** Id prefix for the row's controls. */
  readonly id: string;
  /** The organization as loaded: its id, etag and current default. */
  readonly organization: Organization;
  /** `true` when the caller may not edit the organization. */
  readonly readOnly: boolean;
  /** Called with the updated organization after a save. */
  readonly onSaved: (updated: Organization) => void;
}

/** The "Default environment" row of {@link OrgPreferencesPanel}. */
export function DefaultEnvironmentRow({ id, organization, readOnly, onSaved }: DefaultEnvironmentRowProps) {
  const { update, isUpdating, error } = useUpdateOrganization();
  const availability = useEnvironmentAvailability();
  const orgId = organization.metadata?.id ?? "";
  const stored = organization.spec?.preferences?.defaultEnvironmentRef;
  const value: ResourceRef | undefined =
    stored !== undefined && stored.slug !== "" ? { org: stored.org || orgId, slug: stored.slug } : undefined;
  const { environments } = useEnvironmentList(readOnly && orgId !== "" ? orgId : null);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  const handleChange = useCallback(
    async (next: ResourceRef | undefined) => {
      try {
        const updated = await update(
          {
            metadata: { id: orgId, etag: organization.metadata?.etag ?? "" },
            spec: { preferences: { defaultEnvironmentRef: next } },
          },
          ["spec.preferences.default_environment_ref"],
        );
        onSaved(updated);
      } catch {
        // error state is managed by this row's own hook instance
      }
    },
    [update, orgId, organization.metadata?.etag, onSaved],
  );

  const shownName = (() => {
    if (value === undefined) return "None";
    const found = environments.find((environment) => environment.metadata?.slug === value.slug);
    return found ? environmentName(found) : value.slug;
  })();

  return (
    <div className="stg:space-y-1" role="group" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <span id={titleId} className="stg:block stg:text-xs stg:font-medium stg:text-foreground">
        Default environment
      </span>
      <p id={descriptionId} className="stg:text-2xs stg:leading-snug stg:text-muted-foreground">
        {availability?.applies === false ? ENVIRONMENTS_NOT_APPLYING_COPY["not-on-server"] : DEFAULT_ENVIRONMENT_HELPER_TEXT}
      </p>
      {readOnly ? (
        <p className="stg:text-sm stg:text-foreground">{shownName}</p>
      ) : (
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <EnvironmentPicker
            org={orgId}
            value={value}
            onChange={(next) => void handleChange(next)}
            defaultLabel="None"
            label="Default environment"
            disabled={isUpdating}
            className="stg:min-w-0 stg:flex-1"
          />
          {isUpdating && <SpinnerIcon size={12} />}
        </div>
      )}
      {error && (
        <p className="stg:text-2xs stg:text-destructive" role="alert">
          {saveErrorMessage(error, "organization")}
        </p>
      )}
    </div>
  );
}
