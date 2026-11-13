"use client";

// The journey's last step, whole, on one page: name the organization, invite
// the team, and see who has joined. The dashboard's card (row 6) and the
// launcher's next line lead here; the settings navigation does not list it,
// since it is a step of the journey, composed from the hooks the settings
// pages read, beside those pages rather than over them.
//
//   Name your organization   the display name, saved as the profile page
//                            saves it (`can_edit`). While the name still
//                            equals the address (a sign-up that named it
//                            from an email) the part asks for the company's
//                            name before anyone is invited, with "Keep" for
//                            a person who chose it; once named it is one
//                            quiet line. The address is never changed here:
//                            the code handed over at step 5 names it. Left
//                            out on a server that holds one organization,
//                            where nobody ever names it.
//   Invite your team         where the edition serves invitations and the
//                            viewer may grant access (`can_grant_access`,
//                            fail closed): Member or Admin, said in plain
//                            words, and one link, many uses, for 7 days (a
//                            credential pasted into a chat lives a week, not
//                            a month). A link still live is shown again on
//                            return, with Revoke. Where invitations are not
//                            served, people join by signing in, and this
//                            console's address is what to send them.
//   Who's here               the people on the organization's access list
//                            (`useAppAccess`), app users and service accounts
//                            left out, re-read while nobody else is there.
//                            An access entry carries no time, so it says who
//                            is here, never when they came. Once someone
//                            else is, the page says the journey is done and
//                            what a company selling to other companies needs
//                            next: an organization per customer where the
//                            edition has them (Cloud's plan read first), a
//                            vault per customer on one organization.
//
// On a server that trusts every caller nobody else can reach it, so the page
// says that and where sign-in is set up, and nothing else.

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { buildOrganizationProto, iamRoleDisplayName } from "@stigmer/client";
import { useDeploymentMode, useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind, maskedEdit, saveErrorMessage } from "@stigmer/react-core/internal";
import type { Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "../button/Button.js";
import { anchorLink, type RenderLink } from "../button/LinkButton.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useAppAccess } from "../app-handover/useAppAccess.js";
import { useMyIdentityAccount } from "../identity-account/useMyIdentityAccount.js";
import { useCreateInvitation } from "../invitation/useCreateInvitation.js";
import { useOrgInvitations } from "../invitation/useOrgInvitations.js";
import { useRevokeInvitation } from "../invitation/useRevokeInvitation.js";
import { useOptionalOrg } from "../organization/OrgProvider.js";
import { useOrganization } from "../organization/useOrganization.js";
import { useUpdateOrganization } from "../organization/useUpdateOrganization.js";
import { UpgradeNotice } from "../billing/UpgradeNotice.js";
import { unlockingPlanName } from "../billing/plan-features.js";
import { useEntitlements } from "../billing/useEntitlements.js";
import { usePlans } from "../billing/usePlans.js";
import { useServerInfo, useSingleOrg } from "../server-info.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import { cardClasses } from "../internal/surface/Card.js";
import { List, ListRow } from "../internal/surface/List.js";
import { Notice } from "../internal/surface/Notice.js";
import { Tag } from "../internal/surface/Tag.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { NoOrganization } from "../settings/NoOrganization.js";
import { SettingsPage } from "../settings/SettingsPage.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";

/** Props for {@link BringOthersIn}. */
export interface BringOthersInProps {
  /**
   * Build the full invite URL from a token, when invitees accept somewhere
   * other than this origin's `/invite/<token>` (a desktop app's links open
   * the web console).
   *
   * @default `${window.location.origin}/invite/${token}`
   */
  readonly buildInviteUrl?: (token: string) => string;
  /**
   * The address people sign in at, where the edition has no invitations and
   * people join by signing in.
   *
   * @default `window.location.origin`
   */
  readonly consoleUrl?: string;
  /** Where roles are set (the console's members page), in the host's routing. */
  readonly membersHref?: string;
  /** Where the plans are, for the upgrade notice, in the host's routing. */
  readonly billingHref?: string;
  /** Draws each link; a plain anchor otherwise. */
  readonly renderLink?: RenderLink;
  /** Additional CSS class names for the page's root. */
  readonly className?: string;
}

/** How long the journey's link lives: a week, since it is a credential sent through a chat. */
export const BRING_OTHERS_IN_LINK_DAYS = 7;

/** The label the journey's links carry, so a return visit finds the one still live. */
export const BRING_OTHERS_IN_LINK_LABEL = "Bring others in";

const ONE_ORG_PER_CUSTOMER_DOCS_URL = "https://stigmer.ai/docs/getting-started/one-organization-per-customer";
const CUSTOMER_KEYS_DOCS_URL = "https://stigmer.ai/docs/guides/authentication/customer-keys";
const SELF_HOSTED_SIGN_IN_DOCS_URL = "https://stigmer.ai/docs/guides/self-hosting/authentication";

/** Re-read the access list on this interval while nobody else has joined. */
const WAITING_FOR_TEAM_MS = 15_000;

const INLINE_LINK = "stg:text-foreground stg:underline stg:underline-offset-2";

/** The two roles the journey offers, in plain words. Viewer and Owner stay on the Invitations page. */
const ROLE_CHOICES: readonly { readonly role: IamRole; readonly label: string }[] = [
  { role: IamRole.member, label: "Member" },
  { role: IamRole.admin, label: "Admin" },
];

/**
 * The journey's last step: the organization named, an invite link with its
 * roles in plain words, and who has joined. Mount inside an
 * {@link OrgProvider}, in the settings frame.
 *
 * @example
 * ```tsx
 * <BringOthersIn membersHref="/settings/members" renderLink={nextLink} />
 * ```
 */
export function BringOthersIn({
  buildInviteUrl = defaultBuildInviteUrl,
  consoleUrl,
  membersHref,
  billingHref,
  renderLink = anchorLink,
  className,
}: BringOthersInProps) {
  const orgContext = useOptionalOrg();
  const orgId = orgContext?.activeOrg?.metadata?.id ?? "";
  const singleOrg = useSingleOrg();
  const server = useServerInfo();
  const trusting = server.serverInfo?.authenticationRequired === false;
  const signsIn = server.serverInfo !== null && !trusting;

  return (
    <SettingsPage
      title="Bring others in"
      description={
        singleOrg === false
          ? "The last step: give your organization its name, then invite your team."
          : "The last step: invite your team."
      }
      className={className}
    >
      {!orgId ? (
        <NoOrganization what="its people" />
      ) : server.serverInfo === null && server.error === null ? (
        <SettingsSkeleton label="Loading" rows={2} />
      ) : trusting ? (
        <Notice tone="plain" role="note" headline="This Stigmer is on your computer, so only you can reach it.">
          <p className="stg:m-0">
            To bring others in, run it on{" "}
            {renderLink({ href: SELF_HOSTED_SIGN_IN_DOCS_URL, className: INLINE_LINK, children: "a server with sign-in turned on" })}.
          </p>
        </Notice>
      ) : (
        <div className="stg:flex stg:flex-col stg:gap-4">
          {singleOrg === false && <NameYourOrganization key={orgId} orgId={orgId} onRenamed={() => orgContext?.refresh(orgId)} />}
          <InviteYourTeam orgId={orgId} buildInviteUrl={buildInviteUrl} consoleUrl={consoleUrl} membersHref={membersHref} renderLink={renderLink} />
          <WhosHere
            orgId={orgId}
            signsIn={signsIn}
            singleOrg={singleOrg === true}
            billingHref={billingHref}
            renderLink={renderLink}
          />
        </div>
      )}
    </SettingsPage>
  );
}

function defaultBuildInviteUrl(token: string): string {
  return typeof window === "undefined" ? `/invite/${token}` : `${window.location.origin}/invite/${token}`;
}

function Part({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className={cn(cardClasses(), "stg:flex stg:flex-col stg:gap-3")}>
      <h3 className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{title}</h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Name your organization
// ---------------------------------------------------------------------------

/** Where a "Keep its name" answer is remembered, per organization, in this browser. */
const KEPT_NAME_KEY = "stigmer:journey:kept-org-name:";

function readKept(orgId: string): boolean {
  try {
    return localStorage.getItem(KEPT_NAME_KEY + orgId) === "1";
  } catch {
    return false;
  }
}

function writeKept(orgId: string): void {
  try {
    localStorage.setItem(KEPT_NAME_KEY + orgId, "1");
  } catch {
    // Storage unavailable: the question is asked again next time.
  }
}

function NameYourOrganization({ orgId, onRenamed }: { readonly orgId: string; readonly onRenamed: () => void }) {
  const inputId = useId();
  const { organization, refetch } = useOrganization(orgId);
  const editCheck = useCheckPermission({ kind: "organization", id: orgId }, "can_edit", { fail: "closed" });
  const { update, isUpdating, error, clearError } = useUpdateOrganization();
  const name = organization?.metadata?.name ?? "";
  const slug = organization?.metadata?.slug ?? "";
  // A sign-up that named the organization from an email left name and
  // address equal; nothing else marks it, and a person who chose that name
  // answers "Keep" once. Read as the first state, so a kept name never
  // flashes the question.
  const [kept, setKept] = useState(() => readKept(orgId));
  const unnamed = name !== "" && name === slug && !kept;
  const [editing, setEditing] = useState(false);
  const asking = unnamed || editing;

  const save = useCallback(
    async (next: string) => {
      if (organization === null || next === "") return;
      clearError();
      try {
        const { resource, paths } = maskedEdit(organization, buildOrganizationProto, { name: next });
        await update(resource, paths);
        setEditing(false);
        refetch();
        onRenamed();
      } catch {
        // The update hook holds the error the form shows.
      }
    },
    [organization, clearError, update, refetch, onRenamed],
  );

  if (organization === null) {
    return <SettingsSkeleton label="Loading your organization" rows={1} />;
  }
  const canEdit = !editCheck.isLoading && editCheck.allowed;
  const address = (
    <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
      Its address, <span className="stg:font-mono">{slug}</span>, stays as it is: your app&rsquo;s code uses it.
    </p>
  );

  if (!asking) {
    return (
      <Part title="Your organization">
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
          <span className="stg:text-sm stg:font-medium stg:text-foreground">{name}</span>
          {canEdit && (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              Rename
            </Button>
          )}
        </div>
        {address}
      </Part>
    );
  }

  return (
    <Part title="Name your organization">
      {unnamed && (
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          Stigmer named it from your email when you signed up. Give it your company&rsquo;s name before you invite anyone.
        </p>
      )}
      {canEdit ? (
        <NameForm
          // A new start whenever the question changes: blank while the name
          // is still the address, the name itself when renaming.
          key={unnamed ? "unnamed" : `rename:${name}`}
          inputId={inputId}
          initial={unnamed ? "" : name}
          isUpdating={isUpdating}
          onSave={save}
          secondary={
            unnamed ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  writeKept(orgId);
                  setKept(true);
                }}
              >
                Keep {slug}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )
          }
          error={error === null ? null : saveErrorMessage(error, "organization")}
        />
      ) : (
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          It&rsquo;s called <span className="stg:font-medium stg:text-foreground">{name}</span>. Only organization admins can rename it.
        </p>
      )}
      {address}
    </Part>
  );
}

function NameForm({
  inputId,
  initial,
  isUpdating,
  onSave,
  secondary,
  error,
}: {
  readonly inputId: string;
  readonly initial: string;
  readonly isUpdating: boolean;
  readonly onSave: (name: string) => Promise<void>;
  readonly secondary: ReactNode;
  readonly error: string | null;
}) {
  const [draft, setDraft] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave(draft.trim());
  };
  return (
    <form onSubmit={submit} className="stg:flex stg:flex-col stg:gap-2">
      <label htmlFor={inputId} className="stg:text-xs stg:font-medium stg:text-foreground">
        Name
      </label>
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
        <input
          id={inputId}
          type="text"
          value={draft}
          placeholder="Your company's name"
          onChange={(event) => setDraft(event.target.value)}
          disabled={isUpdating}
          required
          className={cn(INPUT_CLASSES, "stg:max-w-xs stg:flex-1 stg:text-sm")}
        />
        <Button type="submit" size="sm" disabled={isUpdating || draft.trim() === ""}>
          {isUpdating ? "Saving…" : "Save"}
        </Button>
        {secondary}
      </div>
      {error !== null && (
        <p role="alert" className="stg:m-0 stg:text-xs stg:text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Invite your team
// ---------------------------------------------------------------------------

function InviteYourTeam({
  orgId,
  buildInviteUrl,
  consoleUrl,
  membersHref,
  renderLink,
}: {
  readonly orgId: string;
  readonly buildInviteUrl: (token: string) => string;
  readonly consoleUrl: string | undefined;
  readonly membersHref: string | undefined;
  readonly renderLink: RenderLink;
}) {
  const served = useResourceAvailable(ApiResourceKind.invitation);
  const grant = useCheckPermission(served ? { kind: "organization", id: orgId } : null, "can_grant_access", { fail: "closed" });

  if (!served) {
    const address = consoleUrl ?? (typeof window === "undefined" ? "" : window.location.origin);
    return (
      <Part title="Invite your team">
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          People join by signing in at this console&rsquo;s address. You set their roles under{" "}
          {membersHref ? renderLink({ href: membersHref, className: INLINE_LINK, children: "Members" }) : "Members"}.
        </p>
        <CopyLine value={address} label="Copy the address" />
      </Part>
    );
  }
  if (grant.isLoading) {
    return <SettingsSkeleton label="Loading invitations" rows={1} />;
  }
  if (!grant.allowed) {
    return (
      <Part title="Invite your team">
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">Only an admin can invite people.</p>
      </Part>
    );
  }
  return <InviteLink orgId={orgId} buildInviteUrl={buildInviteUrl} />;
}

/** The newest link this page made that still lets people in. */
function liveJourneyLink(invitations: readonly Invitation[], now: Date): Invitation | undefined {
  return invitations.find((invitation) => {
    if (invitation.spec?.label !== BRING_OTHERS_IN_LINK_LABEL) return false;
    if (invitation.status?.state !== InvitationState.active) return false;
    const expires = invitation.spec?.expiresAt;
    return expires === undefined || timestampDate(expires) > now;
  });
}

function InviteLink({ orgId, buildInviteUrl }: { readonly orgId: string; readonly buildInviteUrl: (token: string) => string }) {
  const groupName = useId();
  const list = useOrgInvitations(orgId);
  const { create, isCreating, error: createError } = useCreateInvitation();
  const { revoke, isRevoking, error: revokeError } = useRevokeInvitation();
  const [role, setRole] = useState<IamRole>(IamRole.member);
  const [made, setMade] = useState<Invitation | null>(null);
  const [revokedId, setRevokedId] = useState<string | null>(null);
  const live = useMemo(() => {
    const listed = liveJourneyLink(list.invitations, new Date());
    const candidate = made ?? listed;
    return candidate !== undefined && candidate.metadata?.id !== revokedId ? candidate : undefined;
  }, [list.invitations, made, revokedId]);

  const makeLink = useCallback(async () => {
    try {
      const invitation = await create({
        name: `bring-others-in-${Date.now()}`,
        org: orgId,
        role,
        expiresAt: new Date(Date.now() + BRING_OTHERS_IN_LINK_DAYS * 86_400_000),
        maxRedemptions: 0,
        label: BRING_OTHERS_IN_LINK_LABEL,
      });
      setMade(invitation);
      setRevokedId(null);
    } catch {
      // The create hook holds the error the part shows.
    }
  }, [create, orgId, role]);

  const revokeLink = useCallback(async () => {
    const id = live?.metadata?.id ?? "";
    if (id === "") return;
    try {
      await revoke(id);
      setRevokedId(id);
      setMade(null);
      list.refetch();
    } catch {
      // The revoke hook holds the error the part shows.
    }
  }, [live, revoke, list]);

  if (list.isLoading && made === null) {
    return <SettingsSkeleton label="Loading invitations" rows={1} />;
  }

  if (live !== undefined) {
    const token = live.status?.token ?? "";
    const liveRole = live.spec?.role ?? IamRole.member;
    const until = live.spec?.expiresAt ? timestampDate(live.spec.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "";
    return (
      <Part title="Invite your team">
        <CopyLine value={buildInviteUrl(token)} label="Copy the invite link" />
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          Send it to your team in your own chat or email. Anyone with it can join as {articleFor(liveRole)} {iamRoleDisplayName(liveRole)}
          {until ? ` until ${until}` : ""}.
        </p>
        <div>
          <Button size="xs" variant="ghost" onClick={revokeLink} disabled={isRevoking}>
            {isRevoking ? "Revoking…" : "Revoke this link"}
          </Button>
        </div>
        {revokeError !== null && (
          <p role="alert" className="stg:m-0 stg:text-xs stg:text-destructive">
            Couldn&rsquo;t revoke the link. Try again.
          </p>
        )}
      </Part>
    );
  }

  return (
    <Part title="Invite your team">
      <fieldset className="stg:m-0 stg:flex stg:flex-col stg:gap-2 stg:border-0 stg:p-0">
        <legend className="stg:mb-1 stg:text-xs stg:font-medium stg:text-foreground">They join as</legend>
        <div className="stg:flex stg:flex-wrap stg:gap-2">
          {ROLE_CHOICES.map((choice) => {
            const checked = role === choice.role;
            return (
              <label
                key={choice.role}
                className={cn(
                  "stg:cursor-pointer stg:rounded-md stg:border stg:px-3 stg:py-1.5 stg:text-sm stg:transition-colors",
                  "stg:focus-within:ring-2 stg:focus-within:ring-ring",
                  checked
                    ? "stg:border-foreground stg:font-medium stg:text-foreground"
                    : "stg:border-input stg:text-muted-foreground stg:hover:text-foreground",
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={choice.label}
                  checked={checked}
                  onChange={() => setRole(choice.role)}
                  className="stg:sr-only"
                />
                {choice.label}
              </label>
            );
          })}
        </div>
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
          Members use your agents. Admins can also change them and add keys.
        </p>
      </fieldset>
      <div>
        <Button size="sm" onClick={makeLink} disabled={isCreating}>
          {isCreating ? "Making the link…" : "Make an invite link"}
        </Button>
      </div>
      <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
        One link for your whole team. It works for {BRING_OTHERS_IN_LINK_DAYS} days.
      </p>
      {createError !== null && (
        <p role="alert" className="stg:m-0 stg:text-xs stg:text-destructive">
          Couldn&rsquo;t make the link. Try again.
        </p>
      )}
    </Part>
  );
}

function articleFor(role: IamRole): string {
  return role === IamRole.admin || role === IamRole.owner ? "an" : "a";
}

function CopyLine({ value, label }: { readonly value: string; readonly label: string }) {
  const { copy, copied } = useCopyFeedback();
  return (
    <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
      <code
        className={cn(
          "stg:min-w-0 stg:flex-1 stg:select-all stg:truncate stg:rounded-md",
          "stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5",
          "stg:font-mono stg:text-xs stg:text-foreground",
        )}
      >
        {value}
      </code>
      <Button size="xs" variant="outline" onClick={() => void copy(value)} aria-label={label}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Who's here
// ---------------------------------------------------------------------------

function WhosHere({
  orgId,
  signsIn,
  singleOrg,
  billingHref,
  renderLink,
}: {
  readonly orgId: string;
  readonly signsIn: boolean;
  readonly singleOrg: boolean;
  readonly billingHref: string | undefined;
  readonly renderLink: RenderLink;
}) {
  const me = useMyIdentityAccount({ enabled: signsIn });
  const myId = me.account?.metadata?.id ?? "";
  const [someoneElse, setSomeoneElse] = useState(false);
  const access = useAppAccess(orgId, { enabled: signsIn, refetchInterval: someoneElse ? false : WAITING_FOR_TEAM_MS });
  const people = access.people;
  const others = people?.filter((person) => person.id !== myId) ?? [];
  useEffect(() => setSomeoneElse(others.length > 0), [others.length]);

  if (access.allowed === false || access.error !== null) {
    return null;
  }
  return (
    <Part title="Who's here">
      {people === undefined ? (
        <SettingsSkeleton label="Loading who's here" rows={1} />
      ) : (
        <List bare aria-label="People in this organization">
          {people.map((person) => (
            <ListRow
              key={person.id}
              name={person.name}
              nameAdornment={person.id === myId ? <Tag>You</Tag> : undefined}
              trailing={
                person.role === null ? undefined : (
                  <span className="stg:text-xs stg:text-muted-foreground">{iamRoleDisplayName(person.role)}</span>
                )
              }
            />
          ))}
        </List>
      )}
      {people !== undefined && others.length === 0 && (
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">Nobody else yet. They appear here once they join.</p>
      )}
      {others.length > 0 && <DoneLine orgId={orgId} singleOrg={singleOrg} billingHref={billingHref} renderLink={renderLink} />}
    </Part>
  );
}

function DoneLine({
  orgId,
  singleOrg,
  billingHref,
  renderLink,
}: {
  readonly orgId: string;
  readonly singleOrg: boolean;
  readonly billingHref: string | undefined;
  readonly renderLink: RenderLink;
}) {
  // Only Cloud reads a plan; Enterprise's license gives every organization
  // its children (TeamsSection's rule).
  const onCloud = useDeploymentMode() === "cloud";
  const plan = useEntitlements(orgId, { enabled: onCloud && !singleOrg });
  const lacksChildren = plan.allows(Feature.child_orgs) === false;
  const catalog = usePlans({ enabled: lacksChildren });
  const unlocking = unlockingPlanName(catalog.plans ?? [], Feature.child_orgs);

  return (
    <div role="status" className="stg:flex stg:flex-col stg:gap-2 stg:border-t stg:border-border-muted stg:pt-3">
      <p className="stg:m-0 stg:text-sm stg:font-medium stg:text-foreground">All six steps done.</p>
      {singleOrg ? (
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          Building for several customers on this server?{" "}
          {renderLink({ href: CUSTOMER_KEYS_DOCS_URL, className: INLINE_LINK, children: "Give each one a vault of their own" })}.
        </p>
      ) : (
        <>
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            Selling to other companies?{" "}
            {renderLink({ href: ONE_ORG_PER_CUSTOMER_DOCS_URL, className: INLINE_LINK, children: "Give each customer an organization of their own" })}
            , made by your app when they sign up.
          </p>
          {lacksChildren && (
            <UpgradeNotice
              feature={Feature.child_orgs}
              unlockingPlanName={unlocking}
              {...(billingHref === undefined ? {} : { billingHref })}
            />
          )}
        </>
      )}
    </div>
  );
}
