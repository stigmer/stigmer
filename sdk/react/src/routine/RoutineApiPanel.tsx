"use client";

import { useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { Button } from "../button/Button.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { CopyBlock } from "../internal/CopyBlock.js";
import { DialogShell } from "../internal/DialogShell.js";
import { UnknownPublicAddressNotice } from "../internal/UnknownPublicAddressNotice.js";
import { usePublicBaseUrl } from "../public-base-url-context.js";
import { useServerInfo } from "../server-info.js";
import { SERVICE_ACCOUNTS_SETTINGS_HREF } from "../service-account/copy.js";
import { CreateServiceAccountForm } from "../service-account/CreateServiceAccountForm.js";

/** Arguments for {@link buildRoutineFireCurl}. */
export interface BuildRoutineFireCurlArgs {
  /** The server's public base URL, as `usePublicBaseUrl` answers it. */
  readonly baseUrl: string;
  /** The routine's id (`rtn_…`). */
  readonly routineId: string;
  /**
   * Whether the call carries a bearer key. `false` only for a server that
   * trusts every request (`authenticationRequired === false`).
   */
  readonly withKey: boolean;
}

/** The example note the call carries, so the `text` field is never a mystery. */
const EXAMPLE_NOTE = "Sentry alert SEN-4521 fired";

/**
 * The one `curl` that starts a routine from another system: a POST to the
 * fire RPC's Connect path with the routine's id and a note. The path comes
 * from the generated service descriptor, so it cannot drift from the wire;
 * the key is read from `$STIGMER_API_KEY`, so the copied command never
 * holds a secret. The JSON body is single-quoted for the shell, with any
 * quote in it closed and reopened, so the line stays one argument whatever
 * the id holds.
 */
export function buildRoutineFireCurl({
  baseUrl,
  routineId,
  withKey,
}: BuildRoutineFireCurlArgs): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = `${RoutineCommandController.typeName}/${RoutineCommandController.method.fire.name}`;
  const body = JSON.stringify({ id: routineId, text: EXAMPLE_NOTE });
  return [
    `curl -X POST ${base}/${path} \\`,
    ...(withKey ? [`  -H "Authorization: Bearer $STIGMER_API_KEY" \\`] : []),
    `  -H "Content-Type: application/json" \\`,
    `  -d ${shellQuote(body)}`,
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Props for {@link RoutineApiPanel}. */
export interface RoutineApiPanelProps {
  /** The routine another system will start. */
  readonly routine: Routine;
  /**
   * Opens the routine's Manage access, where its creator grants Participant.
   * When omitted, the step names the grant without a button.
   */
  readonly onManageAccess?: () => void;
  /**
   * Where the panel links to manage service accounts, for someone who may
   * not create one (a hash route in the desktop app).
   * @default SERVICE_ACCOUNTS_SETTINGS_HREF
   */
  readonly serviceAccountsHref?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * How another system starts this routine: the one HTTP call, what it
 * answers, and, where the edition shares a routine with a service account,
 * the three steps that set a caller up.
 *
 * The setup is three existing acts by up to two people, never one wizard:
 * an organization admin creates the service account and its key (offered
 * here, with Viewer preset, to someone who may), the routine's creator
 * grants it Participant (Manage access), and the caller sends the key. The
 * key's reach beyond this routine is stated, since a key acts with its
 * account's whole organization role.
 *
 * What shows follows the server:
 * - the setup steps only where `can_grant_access` on the routine is
 *   allowed, which open source answers `false` (it grants roles on
 *   organizations only); there the panel says to use the creator's key;
 * - the Authorization line unless the server trusts every request;
 * - the shared unknown-address notice when the server's public address
 *   cannot be known.
 *
 * Zero Console dependencies; all visual properties flow through `--stgm-*`
 * design tokens.
 */
export function RoutineApiPanel({
  routine,
  onManageAccess,
  serviceAccountsHref = SERVICE_ACCOUNTS_SETTINGS_HREF,
  className,
}: RoutineApiPanelProps) {
  const routineId = routine.metadata?.id ?? "";
  const org = routine.metadata?.org ?? "";
  const creator = routine.status?.audit?.specAudit?.createdBy;
  const creatorLabel =
    creator?.displayName || creator?.email || creator?.id || "the person who created it";

  const baseUrl = usePublicBaseUrl();
  const { serverInfo } = useServerInfo();
  // Only an explicit false means the server trusts every request.
  const withKey = serverInfo?.authenticationRequired !== false;

  const grantCheck = useCheckPermission(
    routineId ? { kind: "routine", id: routineId } : null,
    "can_grant_access",
  );
  const sharesWithAccounts = withKey && !grantCheck.isLoading && grantCheck.allowed;
  const ownerKeyOnly = withKey && !grantCheck.isLoading && !grantCheck.allowed;

  const curl =
    baseUrl === null ? null : buildRoutineFireCurl({ baseUrl, routineId, withKey });

  return (
    <div className={cn("stg:flex stg:max-w-2xl stg:flex-col stg:gap-5", className)}>
      <p className="stg:text-sm stg:text-foreground">
        Another system starts this routine with one HTTP call. Each call is a
        run that acts as {creatorLabel}, with the text as its note.
      </p>

      <section className="stg:space-y-2">
        {curl !== null ? (
          <CopyBlock label="Start a run" value={curl} />
        ) : (
          <div className="stg:space-y-1">
            <p className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
              Start a run
            </p>
            <UnknownPublicAddressNotice subject="the command" />
          </div>
        )}
        <p className={hintClasses}>
          It answers with the run&rsquo;s id, or the reason it did not start. A
          disabled routine refuses, and by default a routine starts at most 30
          times an hour outside its schedule.
        </p>
      </section>

      {ownerKeyOnly && (
        <p className="stg:text-xs stg:text-muted-foreground">
          Use an API key of the person who created this routine.
        </p>
      )}

      {sharesWithAccounts && (
        <CallerSetup
          org={org}
          onManageAccess={onManageAccess}
          serviceAccountsHref={serviceAccountsHref}
        />
      )}
    </div>
  );
}

function CallerSetup({
  org,
  onManageAccess,
  serviceAccountsHref,
}: {
  readonly org: string;
  readonly onManageAccess?: () => void;
  readonly serviceAccountsHref: string;
}) {
  const headingId = useId();
  const createCheck = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_create_identity_account",
  );
  const canCreateAccount = !createCheck.isLoading && createCheck.allowed;
  const [creating, setCreating] = useState(false);

  return (
    <section aria-labelledby={headingId} className="stg:space-y-3">
      <h3 id={headingId} className="stg:text-xs stg:font-semibold stg:text-foreground">
        Who may call it
      </h3>
      <ol className="stg:m-0 stg:list-none stg:space-y-3 stg:p-0">
        <Step number={1} title="A service account">
          {canCreateAccount ? (
            <>
              <p className={hintClasses}>
                Create one for the calling system, as Viewer. Its key is shown
                once.
              </p>
              <Button variant="outline" size="xs" onClick={() => setCreating(true)}>
                Create a service account
              </Button>
            </>
          ) : (
            <p className={hintClasses}>
              An organization admin creates service accounts and their keys.{" "}
              <a href={serviceAccountsHref} className={linkClasses}>
                Service accounts
              </a>
            </p>
          )}
        </Step>
        <Step number={2} title="Participant on this routine">
          <p className={hintClasses}>
            Only the person who created this routine may do this.
          </p>
          {onManageAccess && (
            <Button variant="outline" size="xs" onClick={onManageAccess}>
              Give it Participant
            </Button>
          )}
        </Step>
        <Step number={3} title="The key">
          <p className={hintClasses}>Send the account&rsquo;s key as the bearer token.</p>
        </Step>
      </ol>
      <p className="stg:text-xs stg:text-muted-foreground">
        The key can also read and run whatever its account&rsquo;s organization
        role allows; Viewer is the least.
      </p>

      {canCreateAccount && (
        <CreateAccountDialog org={org} open={creating} onOpenChange={setCreating} />
      )}
    </section>
  );
}

function Step({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <li className="stg:flex stg:gap-3">
      <span
        aria-hidden="true"
        className="stg:flex stg:size-5 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground"
      >
        {number}
      </span>
      <div className="stg:min-w-0 stg:flex-1 stg:space-y-1.5">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">{title}</p>
        {children}
      </div>
    </li>
  );
}

function CreateAccountDialog({
  org,
  open,
  onOpenChange,
}: {
  readonly org: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const titleId = useId();
  const close = () => onOpenChange(false);

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} width="md" aria-labelledby={titleId}>
      {open && (
        <div className="stg:flex stg:flex-col">
          <div className="stg:border-b stg:border-border stg:px-5 stg:py-4">
            <h2 id={titleId} className="stg:text-sm stg:font-semibold stg:text-foreground">
              Create a service account
            </h2>
            <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
              For the system that starts this routine. Give it Participant on
              the routine next.
            </p>
          </div>
          <div className="stg:px-5 stg:py-4">
            <CreateServiceAccountForm
              org={org}
              defaultRole={IamRole.viewer}
              onDone={close}
              onCancel={close}
            />
          </div>
        </div>
      )}
    </DialogShell>
  );
}

const hintClasses = "stg:text-xs stg:text-muted-foreground";

const linkClasses =
  "stg:text-primary stg:hover:text-primary-hover stg:underline stg:underline-offset-2";
