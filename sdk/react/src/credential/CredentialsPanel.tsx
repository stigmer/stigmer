"use client";

/**
 * "Accounts and keys": the credentials a person keeps in an organization.
 *
 * Two sections. Yours: the keys and sign-ins your own runs use, which only
 * you see and only you can reveal. The organization's: shared keys an
 * admin saves and lets people and teams use. An admin sees every one of
 * them and manages each (its values, what it is used for, who can use
 * it); a member sees the ones they may use, read-only, so they know what
 * their runs will reach without being offered a control the server would
 * refuse. A member who may use none sees no organization section at all.
 *
 * Each credential opens in place: its fields (values edited one at a
 * time, revealed only on your own), its name and "Use for…" targets, and,
 * on an organization's credential, "Who can use it", which grants the
 * `user` role to people and teams through the same access flow every
 * other resource uses.
 *
 * Pinned by `__tests__/CredentialsPanel.test.tsx`.
 */
import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { Button } from "../button/Button.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { PeopleWithAccess } from "../iam-policy/PeopleWithAccess.js";
import { CredentialFieldsEditor } from "./CredentialFieldsEditor.js";
import { CredentialForm } from "./CredentialForm.js";
import {
  credentialDisplayName,
  credentialFieldNames,
  isSignInCredential,
  servedTargets,
  type CredentialOwnerKind,
  type CredentialTargetRef,
} from "./model.js";
import { useCanManageOrgCredentials } from "./useCanManageOrgCredentials.js";
import { useCredentialList } from "./useCredentialList.js";
import { useDeleteCredential } from "./useDeleteCredential.js";

/** Props for {@link CredentialsPanel}. */
export interface CredentialsPanelProps {
  /** The organization whose credentials are shown (an id; a slug is also accepted). */
  readonly org: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The full "Accounts and keys" surface for one organization.
 *
 * @example
 * ```tsx
 * <CredentialsPanel org={activeOrgId} />
 * ```
 */
export function CredentialsPanel({ org, className }: CredentialsPanelProps) {
  const list = useCredentialList(org || null);
  const { allowed: isAdmin } = useCanManageOrgCredentials(org || null);
  const [creating, setCreating] = useState<CredentialOwnerKind | null>(null);
  const { refetch } = list;

  const handleCreated = useCallback(() => {
    setCreating(null);
    refetch();
  }, [refetch]);

  const showOrganization = isAdmin || list.organization.length > 0;

  return (
    <div className={cn("stg:space-y-10", className)}>
      <CredentialSection
        title="Yours"
        loadingLabel="Loading your keys"
        badge="You"
        description="Keys and sign-ins your own runs use. Only you see them, and only you can reveal their values."
        addLabel="+ Add a key"
        onAdd={() => setCreating("person")}
        isAdding={creating === "person"}
        form={
          <CredentialForm
            org={org}
            defaultOwner="person"
            onSaved={handleCreated}
            onCancel={() => setCreating(null)}
          />
        }
        credentials={list.mine}
        isLoading={list.isLoading}
        error={list.error}
        empty="You have no keys saved yet. Add one, or sign in to a tool when an agent asks."
        manage
        onChanged={refetch}
        org={org}
      />

      {showOrganization && (
        <CredentialSection
          title="The organization's"
          loadingLabel="Loading the organization's keys"
          description={
            isAdmin
              ? "Shared keys for the organization. You decide who may use each one; their values can be replaced, never read back."
              : "Shared keys an admin lets you use. Your runs use them when you have no key of your own for the same thing."
          }
          addLabel={isAdmin ? "+ Add an organization key" : undefined}
          onAdd={isAdmin ? () => setCreating("org") : undefined}
          isAdding={creating === "org"}
          form={
            <CredentialForm
              org={org}
              defaultOwner="org"
              onSaved={handleCreated}
              onCancel={() => setCreating(null)}
            />
          }
          credentials={list.organization}
          isLoading={list.isLoading}
          error={list.error}
          empty="The organization has no shared keys yet."
          manage={isAdmin}
          onChanged={refetch}
          org={org}
        />
      )}
    </div>
  );
}

function CredentialSection({
  title,
  loadingLabel,
  badge,
  description,
  addLabel,
  onAdd,
  isAdding,
  form,
  credentials,
  isLoading,
  error,
  empty,
  manage,
  onChanged,
  org,
}: {
  readonly title: string;
  readonly loadingLabel: string;
  readonly badge?: string;
  readonly description: string;
  readonly addLabel?: string;
  readonly onAdd?: () => void;
  readonly isAdding: boolean;
  readonly form: React.ReactNode;
  readonly credentials: readonly Credential[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly empty: string;
  readonly manage: boolean;
  readonly onChanged: () => void;
  readonly org: string;
}) {
  const headingId = useId();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section aria-labelledby={headingId}>
      <div className="stg:mb-1 stg:flex stg:items-center stg:justify-between stg:gap-3">
        <div className="stg:flex stg:items-baseline stg:gap-2">
          <h2 id={headingId} className="stg:text-foreground stg:text-sm stg:font-semibold">
            {title}
          </h2>
          {badge && (
            <span className="stg:bg-primary-subtle stg:text-primary stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wider">
              {badge}
            </span>
          )}
        </div>
        {addLabel && onAdd && !isAdding && (
          <button
            type="button"
            onClick={onAdd}
            className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
          >
            {addLabel}
          </button>
        )}
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">{description}</p>

      {isAdding && (
        <div className="stg:border-border stg:bg-card stg:mb-4 stg:rounded-lg stg:border stg:p-4">{form}</div>
      )}

      {isLoading ? (
        <LoadingRegion className="stg:space-y-2" label={loadingLabel}>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg" />
          ))}
        </LoadingRegion>
      ) : error ? (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(error)}
        </p>
      ) : credentials.length === 0 ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">{empty}</p>
      ) : (
        <div className="stg:space-y-2" role="list" aria-label={title}>
          {credentials.map((credential) => {
            const id = credential.metadata?.id ?? "";
            return (
              <CredentialCard
                key={id}
                org={org}
                credential={credential}
                isExpanded={expandedId === id}
                onToggle={() => setExpandedId((current) => (current === id ? null : id))}
                manage={manage}
                onChanged={onChanged}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function CredentialCard({
  org,
  credential,
  isExpanded,
  onToggle,
  manage,
  onChanged,
}: {
  readonly org: string;
  readonly credential: Credential;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly manage: boolean;
  readonly onChanged: () => void;
}) {
  const name = credentialDisplayName(credential);
  const id = credential.metadata?.id ?? "";
  const description = credential.spec?.description;
  const fieldNames = credentialFieldNames(credential);
  const serves = servedTargets(credential);
  const signIn = isSignInCredential(credential);
  const isOrg = credential.spec?.owner.case === "org";
  const [editing, setEditing] = useState(false);

  return (
    <div
      role="listitem"
      className={cn(
        "stg:rounded-lg stg:border stg:transition-colors",
        isExpanded ? "stg:border-border stg:bg-card" : "stg:border-border-muted stg:hover:border-border",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="stg:flex stg:w-full stg:items-center stg:gap-3 stg:px-3 stg:py-2.5 stg:text-left"
      >
        <ChevronIcon expanded={isExpanded} />
        <span className="stg:min-w-0 stg:flex-1">
          <span className="stg:flex stg:items-center stg:gap-2">
            <span className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">{name}</span>
            {signIn && (
              <span className="stg:shrink-0 stg:rounded-full stg:bg-muted-subtle stg:px-1.5 stg:py-0.5 stg:text-[0.6rem] stg:text-muted-foreground">
                Signed in
              </span>
            )}
          </span>
          <span className="stg:block stg:truncate stg:text-xs stg:text-muted-foreground">
            {serves.length > 0 ? `Used for ${serves.map(servedWords).join(", ")}` : description || "Not used for anything by default"}
          </span>
        </span>
        <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
          {fieldNames.length} {fieldNames.length === 1 ? "value" : "values"}
        </span>
      </button>

      {isExpanded && id !== "" && (
        <div className="stg:border-border-muted stg:space-y-4 stg:border-t stg:px-3 stg:pb-3 stg:pt-3">
          {manage ? (
            editing ? (
              <CredentialForm
                org={org}
                credential={credential}
                onSaved={() => {
                  setEditing(false);
                  onChanged();
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="stg:text-xs stg:font-medium stg:text-primary stg:hover:text-foreground"
                >
                  Edit name and use
                </button>
                <DeleteCredentialButton credentialId={id} name={name} onDeleted={onChanged} />
              </div>
            )
          ) : (
            <p className="stg:text-xs stg:text-muted-foreground">
              An admin manages this key. Your runs may use it; its values stay hidden.
            </p>
          )}

          <div className="stg:space-y-1">
            <p className="stg:text-xs stg:font-medium stg:text-foreground">Values</p>
            {manage ? (
              <CredentialFieldsEditor credentialId={id} onFieldUpdated={onChanged} onFieldRemoved={onChanged} />
            ) : fieldNames.length === 0 ? (
              <p className="stg:text-xs stg:text-muted-foreground">No values yet.</p>
            ) : (
              <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-wrap stg:gap-1.5")} aria-label={`Values of ${name}`}>
                {fieldNames.map((field) => (
                  <li key={field} className="stg:rounded stg:bg-muted-subtle stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-xs stg:text-foreground">
                    {field}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isOrg && manage && (
            <div className="stg:space-y-1.5">
              <p className="stg:text-xs stg:font-medium stg:text-foreground">Who can use it</p>
              <p className="stg:text-[0.65rem] stg:text-muted-foreground">
                People and teams you add here can use this key in their runs and assign it to schedules, share links and channels. Nobody can read its values.
              </p>
              <PeopleWithAccess
                resource={{ kind: "credential", id, resourceKind: ApiResourceKind.credential }}
                resourceKindString="credential"
                resourceKind={ApiResourceKind.credential}
                org={org}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function servedWords(target: CredentialTargetRef): string {
  return target.kind === "git_host" ? target.host : target.slug;
}

function DeleteCredentialButton({
  credentialId,
  name,
  onDeleted,
}: {
  readonly credentialId: string;
  readonly name: string;
  readonly onDeleted: () => void;
}) {
  const { remove, isDeleting, error } = useDeleteCredential();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="stg:text-xs stg:text-muted-foreground stg:hover:text-destructive"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="stg:flex stg:flex-wrap stg:items-center stg:gap-2 stg:text-xs">
      <span className="stg:text-destructive">
        Delete {name}? Runs that need it will not start until another key gives its values.
      </span>
      <Button
        variant="destructive"
        size="xs"
        disabled={isDeleting}
        onClick={() => {
          remove(credentialId).then(onDeleted, () => {});
        }}
      >
        Delete
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={isDeleting}
        className="stg:text-muted-foreground stg:hover:text-foreground"
      >
        Cancel
      </button>
      {error && (
        <span className="stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </span>
      )}
    </span>
  );
}

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "stg:shrink-0 stg:text-muted-foreground stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
