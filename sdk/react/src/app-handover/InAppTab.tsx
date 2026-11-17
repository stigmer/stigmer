"use client";

// The agent page's "In your app" tab: everything that puts this agent's chat
// in a builder's own product, in one place, with their organization and
// agent already written into the code.
//
// Which tab a server gets is its posture, never its edition
// (`useServerInfo().authenticationRequired`):
//
//   - A server that signs people in (Stigmer Cloud, or a self-hosted server
//     with sign-in turned on) has the builder's backend sign each user in
//     with a service account's key. The tab is five rows: a service account
//     for the backend (made here, as an admin, since signing users in needs
//     admin rights; its key shown once, inside the backend's settings file
//     ready to copy, and the same file without it afterwards), accounts made
//     on first sign-in (the organization's embedding settings), the token
//     route for their stack, the chat for their React app with a page to try
//     it, each named by its path (one install for a Next.js app, which holds
//     all three), and the first person their app signs in, which ticks by
//     itself. Rows 1, 2 and 5
//     are the organization's, not the agent's: each says so and links its
//     settings page, and each is offered only to someone the server lets act
//     (asked fail closed), with who can named otherwise.
//   - A server that trusts every caller (`stigmer up`) mints nothing and can
//     tell no app user from anyone, so the tab hands over the chat for
//     development, with one line on what going live needs.
//
// The code is `buildAppHandover`'s (`@stigmer/client`), the one writer every
// surface hands over. The embed line is not drawn as an equal way in: its
// visitors are guests, who cannot attach a file, on a public chat link only
// Stigmer Cloud serves; one quiet line points at the chat link's Embed tab.

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import {
  APP_DEV_USER_VARIABLE,
  APP_HANDOVER_STACKS,
  APP_TOKEN_ROUTE,
  APP_TOKEN_ROUTE_PORT,
  StigmerError,
  appSettingsText,
  buildAppHandover,
  iamRoleDisplayName,
  type AppHandover,
  type AppHandoverFile,
  type AppHandoverStack,
} from "@stigmer/client";
import { useWhoAmI } from "@stigmer/react-core";
import { cn } from "@stigmer/design-tokens";
import { ApiKeyCreatedAlert } from "../api-key/ApiKeyCreatedAlert.js";
import { keyExpiryFields } from "../api-key/KeyExpiryFieldset.js";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { serverSentence } from "../internal/server-words.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { CopyBlock } from "../internal/CopyBlock.js";
import { ChoiceGroup } from "../internal/form/ChoiceGroup.js";
import { FieldError } from "../internal/form/Field.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { cardClasses } from "../internal/surface/Card.js";
import { Notice } from "../internal/surface/Notice.js";
import { UnknownPublicAddressNotice } from "../internal/UnknownPublicAddressNotice.js";
import { anchorLink, type RenderJourneyLink } from "../journey/links.js";
import { useOrganization } from "../organization/useOrganization.js";
import { organizationEmbeddingOf, useUpdateOrganizationEmbedding } from "../organization/useUpdateOrganizationEmbedding.js";
import { usePublicBaseUrl } from "../public-base-url-context.js";
import { useServerInfo } from "../server-info.js";
import { useCreateServiceAccount } from "../service-account/useCreateServiceAccount.js";
import { useCreateServiceAccountKey } from "../service-account/useCreateServiceAccountKey.js";
import { Switch } from "../switch/Switch.js";
import { useRememberedStack } from "./rememberedStack.js";
import { useAppAccess } from "./useAppAccess.js";

/** Where the tab's settings links lead, in the host's routing. */
export interface InAppLinks {
  /** Settings → Service accounts, linked from the service account's row. */
  readonly serviceAccounts?: string;
  /** Settings → Embedding, linked from the sign-in row. */
  readonly embedding?: string;
  /** Draws each link; a plain anchor otherwise. */
  readonly renderLink?: RenderJourneyLink;
}

/** Props for {@link InAppTab}. */
export interface InAppTabProps {
  /** The agent, as the page holds it. */
  readonly agent: Agent;
  /** Where its settings links lead. */
  readonly links: InAppLinks;
  /** Opens the agent's Channels tab, where a chat link's Embed tab is; the embed line is drawn only with it. */
  readonly onOpenChannels?: () => void;
}

/** How often row 5 asks for a first app user while it waits. */
export const FIRST_APP_USER_POLL_MS = 5000;

/** The service account's name, then `-2` and on, up to this many tries. */
const BACKEND_NAME = "app-backend";
const BACKEND_NAME_TRIES = 10;

/** The open-source docs on turning sign-in on for a server of your own. */
const SELF_HOSTED_SIGN_IN_DOCS_URL = "https://stigmer.ai/docs/guides/self-hosting/authentication";

/** A release the Java dependency can pin; a dev build is not published to Maven. */
const RELEASE = /^\d+\.\d+\.\d+$/;

/** The roles a person signed in from the app can chat with. */
const CHATTING_ROLES: ReadonlySet<IamRole> = new Set([IamRole.owner, IamRole.admin, IamRole.member]);

/** The "In your app" tab's body: what puts the agent's chat in the builder's app, for the server it runs on. */
export function InAppTab({ agent, links, onOpenChannels }: InAppTabProps) {
  const orgId = agent.metadata?.org ?? "";
  const name = agent.metadata?.name || agent.metadata?.slug || "this agent";
  const server = useServerInfo();
  const org = useOrganization(orgId || null);
  const baseUrl = usePublicBaseUrl();

  let body: ReactNode;
  if (server.error !== null || org.error !== null) {
    const error = server.error ?? org.error;
    body = <ErrorMessage error={error} title="Stigmer couldn't load the code for your app" retry={server.error ? server.refetch : org.refetch} />;
  } else if (server.serverInfo === null || org.organization === null) {
    body = <LoadingRegion label="Loading" className="stg:h-48 stg:animate-pulse stg:rounded-xl stg:bg-muted" />;
  } else if (baseUrl === null) {
    body = <UnknownPublicAddressNotice subject="the code for your app" />;
  } else if (server.serverInfo.authenticationRequired === false) {
    body = <LocalHandover agent={agent} organization={org.organization} baseUrl={baseUrl} renderLink={links.renderLink ?? anchorLink} />;
  } else {
    // A server that predates the posture field is offered the signed-in way:
    // its own answer to a mint decides, as `useServerInfo` says.
    const version = server.serverInfo.version;
    body = (
      <SignInHandover
        agent={agent}
        organization={org.organization}
        onOrganizationSaved={org.refetch}
        baseUrl={baseUrl}
        sdkVersion={RELEASE.test(version) ? version : undefined}
        links={links}
        onOpenChannels={onOpenChannels}
      />
    );
  }

  return (
    <div className="stg:flex stg:max-w-3xl stg:flex-col stg:gap-4">
      <div>
        <h3 className="stg:m-0 stg:text-base stg:font-semibold stg:text-foreground">Put {name} in your app</h3>
        <p className="stg:m-0 stg:mt-0.5 stg:text-sm stg:text-muted-foreground">Your organization and agent are already filled in.</p>
      </div>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A server that trusts every caller
// ---------------------------------------------------------------------------

function LocalHandover({
  agent,
  organization,
  baseUrl,
  renderLink,
}: {
  readonly agent: Agent;
  readonly organization: Organization;
  readonly baseUrl: string;
  readonly renderLink: RenderJourneyLink;
}) {
  const handover = buildAppHandover({
    mode: "local",
    stack: "node",
    baseUrl,
    org: organization.metadata?.slug ?? "",
    agent: agent.metadata?.slug ?? "",
  });
  const { chat } = handover;
  return (
    <>
      <Notice
        tone="plain"
        role="note"
        headline="This Stigmer runs on your computer and trusts every caller, so your app talks to it with no sign-in while you build."
      >
        <p className="stg:m-0">
          Going live needs a Stigmer that signs people in: Stigmer Cloud, or{" "}
          {renderLink({ href: SELF_HOSTED_SIGN_IN_DOCS_URL, className: "stg:text-foreground stg:underline stg:underline-offset-2", children: "your own server with sign-in turned on" })}.
        </p>
      </Notice>
      <section aria-label="Show the chat in your app" className={cn(cardClasses(), "stg:flex stg:flex-col stg:gap-3")}>
        <h4 className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">Show the chat in your app</h4>
        <HandedOverFile file={chat} install="own" />
        <TryItPage handover={handover} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// A server that signs people in
// ---------------------------------------------------------------------------

function SignInHandover({
  agent,
  organization,
  onOrganizationSaved,
  baseUrl,
  sdkVersion,
  links,
  onOpenChannels,
}: {
  readonly agent: Agent;
  readonly organization: Organization;
  readonly onOrganizationSaved: () => void;
  readonly baseUrl: string;
  readonly sdkVersion: string | undefined;
  readonly links: InAppLinks;
  readonly onOpenChannels: (() => void) | undefined;
}) {
  const orgId = organization.metadata?.id ?? agent.metadata?.org ?? "";
  const [stack, pickStack] = useRememberedStack();
  const handover = useMemo(
    () =>
      buildAppHandover({
        mode: "sign-in",
        stack,
        baseUrl,
        org: organization.metadata?.slug ?? "",
        agent: agent.metadata?.slug ?? "",
        sdkVersion,
      }),
    [stack, baseUrl, organization.metadata?.slug, agent.metadata?.slug, sdkVersion],
  );
  // Row 5 asks again on a timer only while it waits for a first app user.
  const [waiting, setWaiting] = useState(false);
  const access = useAppAccess(orgId, { refetchInterval: waiting ? FIRST_APP_USER_POLL_MS : false });
  const nowWaiting = access.appUsers !== undefined && access.appUsers.length === 0;
  if (nowWaiting !== waiting) setWaiting(nowWaiting);
  const render = links.renderLink ?? anchorLink;
  const backend = handover.backend;
  // The settings name the person here as the route's development user.
  const { account: me } = useWhoAmI();
  const devUser = me?.spec?.email || undefined;

  return (
    <>
      <StackPicker stack={stack} onPick={pickStack} />
      <ol className={cn(cardClasses({ flush: true }), "stg:m-0 stg:list-none stg:divide-y stg:divide-border stg:p-0")}>
        <ServiceAccountRow
          org={orgId}
          access={access}
          settingsFile={handover.settingsFile ?? ".env"}
          readsSettingsFile={handover.readsSettingsFile ?? true}
          devUser={devUser}
          serviceAccountsHref={links.serviceAccounts}
          renderLink={render}
        />
        <EmbeddingRow org={orgId} organization={organization} onSaved={onOrganizationSaved} embeddingHref={links.embedding} renderLink={render} />
        <Row number={3} state="todo" title="Add a token route to your backend">
          {backend && <HandedOverFile file={backend} install={handover.oneApp ? "once" : "own"} />}
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            Return your signed-in user from <code className="stg:font-mono stg:text-xs">currentUser</code>. Until then it signs in the
            email in <code className="stg:font-mono stg:text-xs">STIGMER_DEV_USER</code>, and nobody when that is unset.
          </p>
        </Row>
        <Row number={4} state="todo" title="Show the chat in your app">
          {!handover.oneApp && (
            <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
              These go in your React app, which is apart from your backend. Your app reaches the route at{" "}
              <code className="stg:font-mono stg:text-xs">{APP_TOKEN_ROUTE}</code>: proxy that path to your backend (port {APP_TOKEN_ROUTE_PORT}{" "}
              unless you set <code className="stg:font-mono stg:text-xs">PORT</code>).
            </p>
          )}
          <HandedOverFile file={handover.chat} install={handover.oneApp ? "none" : "own"} />
          <TryItPage handover={handover} />
        </Row>
        <FirstUserRow access={access} />
      </ol>
      {onOpenChannels && (
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          Want a public helper anyone on your site can use without signing in? A chat link&apos;s Embed tab gives you one line to paste. Visitors
          can&apos;t attach files.{" "}
          <button type="button" onClick={onOpenChannels} className="stg:p-0 stg:text-sm stg:text-foreground stg:underline stg:underline-offset-2">
            Open Channels
          </button>
        </p>
      )}
    </>
  );
}

function StackPicker({ stack, onPick }: { readonly stack: AppHandoverStack; readonly onPick: (stack: AppHandoverStack) => void }) {
  const labelId = useId();
  return (
    <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-3">
      <span id={labelId} className="stg:text-sm stg:text-muted-foreground">
        Your backend
      </span>
      <ChoiceGroup
        aria-labelledby={labelId}
        size="xs"
        value={stack}
        onChange={onPick}
        options={APP_HANDOVER_STACKS.map((option) => ({ value: option.id, label: option.name }))}
      />
    </div>
  );
}

type RowState = "done" | "todo" | "waiting";

function Row({ number, state, title, children }: { readonly number: number; readonly state: RowState; readonly title: string; readonly children: ReactNode }) {
  return (
    <li className="stg:flex stg:gap-4 stg:px-4 stg:py-4">
      <span
        aria-hidden="true"
        className={cn(
          "stg:flex stg:size-7 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:text-xs stg:font-semibold",
          state === "done" ? "stg:bg-foreground stg:text-background" : "stg:border stg:border-border stg:text-muted-foreground",
        )}
      >
        {state === "done" ? (
          <Check className="stg:size-3.5" />
        ) : state === "waiting" ? (
          <span className="stg:size-2 stg:animate-pulse stg:rounded-full stg:bg-muted-foreground stg:motion-reduce:animate-none" />
        ) : (
          number
        )}
      </span>
      <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col stg:gap-2">
        <p className="stg:m-0 stg:text-sm stg:font-medium stg:text-foreground">
          {title}
          {state === "done" && <span className="stg:sr-only"> (done)</span>}
        </p>
        {children}
      </div>
    </li>
  );
}

/**
 * A file to add, each block with Copy: its install line first, unless
 * another row's covers it (`"none"`), said to be the only one where the
 * whole app installs once (`"once"`); then the file under its path.
 */
function HandedOverFile({ file, install }: { readonly file: AppHandoverFile; readonly install: "own" | "once" | "none" }) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      {install !== "none" && (
        <CopyBlock label={file.installLanguage === "xml" ? "Add to pom.xml" : install === "once" ? "Install, once" : "Install"} value={file.install} />
      )}
      <CopyBlock label={file.file} value={file.code} tall />
    </div>
  );
}

/** The page that shows the chat, to try it, and where to open it. */
function TryItPage({ handover }: { readonly handover: AppHandover }) {
  const open = handover.pagePath === "/" ? "Start your React app and open it." : `Start your app and open ${handover.pagePath}.`;
  return (
    <>
      <CopyBlock label={handover.page.file} caption="a page to try it" value={handover.page.code} />
      <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">{open} To put the chat elsewhere, give it a box with a height.</p>
    </>
  );
}

/**
 * The backend's settings file, with Copy, and what to keep in mind about
 * it: for a backend that does not read the file as handed over, how the
 * values reach it.
 */
function SettingsBlock({ file, text, readsFile }: { readonly file: string; readonly text: string; readonly readsFile: boolean }) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      <CopyBlock label={file} value={text} />
      <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
        Keep this file out of git. <code className="stg:font-mono stg:text-2xs">{APP_DEV_USER_VARIABLE}</code> signs you in while your app has no
        sign-in of its own.
        {!readsFile && (
          <>
            {" "}
            Your backend reads these from its environment: load {file} the way your framework does, or export them in the shell you start it from.
          </>
        )}
      </p>
    </div>
  );
}

const LINK = "stg:text-foreground stg:underline stg:underline-offset-2";

/** A service-account name for the `n`th try: `app-backend`, then `app-backend-2`. */
export function backendNameFor(attempt: number): string {
  return attempt <= 1 ? BACKEND_NAME : `${BACKEND_NAME}-${attempt}`;
}

function ServiceAccountRow({
  org,
  access,
  settingsFile,
  readsSettingsFile,
  devUser,
  serviceAccountsHref,
  renderLink,
}: {
  readonly org: string;
  readonly access: ReturnType<typeof useAppAccess>;
  /** The backend's settings file, which holds the key. */
  readonly settingsFile: string;
  /** Whether the backend reads that file as handed over. */
  readonly readsSettingsFile: boolean;
  /** The person viewing, as the settings' development user, when known. */
  readonly devUser: string | undefined;
  readonly serviceAccountsHref: string | undefined;
  readonly renderLink: RenderJourneyLink;
}) {
  const permission = useCheckPermission(org ? { kind: "organization", id: org } : null, "can_create_identity_account", { fail: "closed" });
  const canCreate = !permission.isLoading && permission.allowed;
  const createAccount = useCreateServiceAccount();
  const createKey = useCreateServiceAccountKey();
  const [made, setMade] = useState<IdentityAccount | null>(null);
  // The key's raw value is held only until dismissed: the server never shows it again.
  const [revealed, setRevealed] = useState<{ readonly key: string | null; readonly name: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = createAccount.isCreating || createKey.isCreating;

  const make = useCallback(async () => {
    setFailure(null);
    let account = made;
    try {
      // A taken name tries the next one; the server is the judge of taken.
      for (let attempt = 1; account === null && attempt <= BACKEND_NAME_TRIES; attempt++) {
        try {
          account = await createAccount.create({ org, name: backendNameFor(attempt), role: IamRole.admin });
        } catch (err) {
          if (!(err instanceof StigmerError && err.code === "already-exists")) throw err;
        }
      }
      if (account === null) {
        setFailure(`Every name from ${backendNameFor(1)} to ${backendNameFor(BACKEND_NAME_TRIES)} is taken. Make one in Settings.`);
        return;
      }
      // Made now: a retry after a failed key makes only the key.
      setMade(account);
      const name = account.metadata?.name ?? BACKEND_NAME;
      // The app's own server holds this key; one that stopped on its own would
      // break the app it was made for, so it never expires (the forms' 90-day
      // default is for a key a person makes by hand).
      const key = await createKey.create({ serviceAccountId: account.metadata?.id ?? "", name, ...keyExpiryFields("never") });
      setRevealed({ key: key.spec?.keyHash ?? "", name });
      access.refetch();
    } catch (err) {
      const what = account === null ? "The service account wasn't made." : `${account.metadata?.name ?? BACKEND_NAME} was made, but its key wasn't.`;
      setFailure(`${what} ${serverSentence(err)} Try again.`);
    }
  }, [made, createAccount, createKey, org, access]);

  const settings = serviceAccountsHref ? renderLink({ href: serviceAccountsHref, className: LINK, children: "Service accounts" }) : "Service accounts";
  const existing = access.adminServiceAccounts ?? [];
  const keyMissing = made !== null && revealed === null;

  // Without the key on screen, the same settings say where the key goes.
  const keylessSettings = <SettingsBlock file={settingsFile} text={appSettingsText({ devUser })} readsFile={readsSettingsFile} />;

  if (revealed !== null) {
    return (
      <Row number={1} state="done" title="A service account for your backend">
        {revealed.key !== null && (
          <ApiKeyCreatedAlert
            rawKey={revealed.key}
            keyName={revealed.name}
            instruction="Copy your settings now. The key is shown once."
            onDismiss={() => setRevealed({ key: null, name: revealed.name })}
          >
            <SettingsBlock file={settingsFile} text={appSettingsText({ apiKey: revealed.key, devUser })} readsFile={readsSettingsFile} />
          </ApiKeyCreatedAlert>
        )}
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          {revealed.key === null ? `${revealed.name} is made. ` : ""}Its key goes in your backend&apos;s settings. One key serves every agent in your app.
        </p>
        {revealed.key === null && keylessSettings}
      </Row>
    );
  }

  if (access.adminServiceAccounts === undefined && access.allowed !== false && access.error === null) {
    return (
      <Row number={1} state="todo" title="A service account for your backend">
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">Checking…</p>
      </Row>
    );
  }
  const done = existing.length > 0 && !keyMissing;
  return (
    <Row number={1} state={done ? "done" : "todo"} title="A service account for your backend">
      <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
        {done ? (
          <>
            You have <span className="stg:font-medium stg:text-foreground">{existing[0]}</span>
            {existing.length > 1 ? ` and ${existing.length - 1} more` : ""}. Use its key, or make another. Keys are in {settings}.
          </>
        ) : (
          <>
            Your backend signs your users in with its key, so the key needs admin rights. It belongs to the organization and serves every agent.
            Its key is shown once.
          </>
        )}
      </p>
      {done && keylessSettings}
      {canCreate ? (
        <div>
          {/* Outlined: the page's one filled act is its header's Start session. */}
          <Button variant="outline" onClick={() => void make()} disabled={busy}>
            {busy ? "Making…" : keyMissing ? "Make its key" : done ? "Make another" : "Make it"}
          </Button>
        </div>
      ) : (
        !permission.isLoading && !done && <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">An admin of this organization makes the service account.</p>
      )}
      {failure !== null && (
        <FieldError>{failure}</FieldError>
      )}
    </Row>
  );
}

function EmbeddingRow({
  org,
  organization,
  onSaved,
  embeddingHref,
  renderLink,
}: {
  readonly org: string;
  readonly organization: Organization;
  readonly onSaved: () => void;
  readonly embeddingHref: string | undefined;
  readonly renderLink: RenderJourneyLink;
}) {
  const permission = useCheckPermission(org ? { kind: "organization", id: org } : null, "can_edit", { fail: "closed" });
  const canEdit = !permission.isLoading && permission.allowed;
  const update = useUpdateOrganizationEmbedding();
  // The server's answer to a save, until the page's next read arrives: held
  // against the read it answered, so a newer read (another admin's change)
  // always wins, and the next save starts from it.
  const [saved, setSaved] = useState<{ readonly after: Organization; readonly value: Organization } | null>(null);
  const stored = organizationEmbeddingOf(saved !== null && saved.after === organization ? saved.value : organization);
  const chats = CHATTING_ROLES.has(stored.signInRole);
  const on = stored.createAccountsOnSignIn;
  const done = on && chats;
  const switchId = useId();

  const save = useCallback(
    async (createAccountsOnSignIn: boolean) => {
      try {
        const next = await update.updateEmbedding(org, {
          ...stored,
          createAccountsOnSignIn,
          // Turned on, a role that can chat: kept if it already can.
          signInRole: createAccountsOnSignIn && !chats ? IamRole.member : stored.signInRole,
        });
        setSaved({ after: organization, value: next });
        onSaved();
      } catch {
        // The hook holds the error; the row says it.
      }
    },
    [update, org, stored, chats, onSaved, organization],
  );

  const settings = embeddingHref ? renderLink({ href: embeddingHref, className: LINK, children: "Embedding settings" }) : "Embedding settings";
  const anyAddress = stored.allowedOrigins.length === 0;

  let line: ReactNode;
  if (done) {
    line = (
      <>
        On for this organization: they join as {iamRoleDisplayName(stored.signInRole)}.{" "}
        {anyAddress ? (
          <>Any website address may host the chat; name yours in {settings} before you ship.</>
        ) : (
          <>
            Only {stored.allowedOrigins.join(", ")} may host the chat; change that in {settings}.
          </>
        )}
      </>
    );
  } else if (on) {
    line = <>They&apos;d get accounts but couldn&apos;t chat: they join with no role that can. Let them chat as Member.</>;
  } else {
    line = (
      <>
        Off for this organization, so your backend can&apos;t sign anyone in yet. Turned on, they join as Member.{" "}
        {anyAddress ? "Any website address may host the chat; name yours before you ship." : `Only ${stored.allowedOrigins.join(", ")} may host the chat.`}
      </>
    );
  }

  return (
    <Row number={2} state={done ? "done" : "todo"} title="Your users get accounts the first time your app signs them in">
      <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">{line}</p>
      {canEdit ? (
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-3">
          <Switch id={switchId} checked={on} onCheckedChange={(next) => void save(next)} disabled={update.isUpdating} />
          <label htmlFor={switchId} className="stg:text-sm stg:text-foreground">
            Create accounts on sign-in
          </label>
          {on && !chats && (
            <Button variant="outline" onClick={() => void save(true)} disabled={update.isUpdating}>
              Let them chat as Member
            </Button>
          )}
        </div>
      ) : (
        !permission.isLoading && !done && <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">An admin of this organization turns this on.</p>
      )}
      {update.error !== null && (
        <FieldError>The setting wasn&apos;t saved. {serverSentence(update.error)} Try again.</FieldError>
      )}
    </Row>
  );
}

function FirstUserRow({ access }: { readonly access: ReturnType<typeof useAppAccess> }) {
  const users = access.appUsers;
  const first = users?.[0];
  if (first !== undefined) {
    const others = (users?.length ?? 1) - 1;
    return (
      <Row number={5} state="done" title="Your first user from your app">
        <p role="status" className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          <span className="stg:font-medium stg:text-foreground">{first.name}</span>
          {others > 0 ? ` and ${others} ${others === 1 ? "other" : "others"}` : ""} signed in from your app.
        </p>
      </Row>
    );
  }
  let line: ReactNode;
  if (access.error !== null) {
    line = (
      <span role="alert">
        Stigmer couldn&apos;t say who has signed in. {serverSentence(access.error)}{" "}
        <button type="button" onClick={access.refetch} className="stg:p-0 stg:text-sm stg:text-foreground stg:underline stg:underline-offset-2">
          Try again
        </button>
      </span>
    );
  } else if (access.allowed === false) {
    line = "An admin of this organization sees who signs in.";
  } else if (users === undefined) {
    line = "Checking…";
  } else {
    line = <span role="status">Waiting for the first person your app signs in. This ticks by itself.</span>;
  }
  return (
    <Row number={5} state={users !== undefined && access.error === null ? "waiting" : "todo"} title="Your first user from your app">
      <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">{line}</p>
    </Row>
  );
}
