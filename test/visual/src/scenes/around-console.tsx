// The screens a person meets around the console rather than inside it: the
// gates between signing in and the app (the identity account, the
// organizations) and the console's first moments (opening, the hand-off to
// sign in, a setup that didn't load, a console that stopped), all on the
// kit's standalone frame; the console's page states inside its frame (an
// address that leads nowhere, a page that broke, a run's address); and the
// kit's views for arriving from a link (an invitation, a connect link and
// its return, the OAuth pop-up), each on the frame its console page gives
// it; and signing in (the sign-in screen, its return, the pages that hand
// the browser back to the desktop app). The gates and the sign-in are drawn
// from a fixed state, as their hosts hand it; the rest run their own reads
// against the fake server.
import type { ReactElement, ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { InvitationCommandController } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/command_pb";
import { InvitationQueryController } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/query_pb";
import { InvitationPreviewSchema } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/io_pb";
import { InvitationSchema } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import {
  CompleteConnectLinkOutputSchema,
  ConnectLinkController,
  ConnectLinkInfoSchema,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { StigmerError } from "@stigmer/client";
import {
  ConnectLinkCallback,
  ErrorMessage,
  ConnectLinkView,
  InvitationRedemption,
  OAuthCallbackHandler,
  type IdentityAccountGateState,
  type OrgGateState,
} from "@stigmer/react-sdk";
import {
  AppHandoffView,
  IdentityAccountGateView,
  OrgGateView,
  PageFailure,
  PageNotFound,
  RunResolveView,
  SignInReturnView,
  SignInView,
  StandaloneScreen,
  UserMenu,
} from "@stigmer/react-sdk/console";
import { sampleDate } from "@stigmer/react-sdk/test";
import type { Drawing } from "./drawing.ts";

/** A server's help, as `stigmer up` announces it: the Stigmer community. */
const COMMUNITY_HELP = { url: "https://discord.com/invite/EtANnfsJ8B", label: "Ask the Stigmer community" };

/** A server that names where to ask, so the screens that end with the help line show it. */
function serverWithHelp(router: ConnectRouter): void {
  router.service(PlatformQueryController, {
    getServerInfo: () =>
      create(GetServerInfoOutputSchema, {
        edition: ServerEdition.cloud,
        version: "dev",
        authenticationRequired: true,
        help: COMMUNITY_HELP,
      }),
  });
}

/** Never answers: a read still in flight when the picture is taken. */
const pending = (): Promise<never> => new Promise<never>(() => {});

const unavailable = (what: string) => () => {
  throw new ConnectError(`${what} did not answer`, Code.Unavailable);
};
const notFound = (what: string) => () => {
  throw new ConnectError(`${what} not found`, Code.NotFound);
};

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

/** A host's mark: the apps pass their own logo; here a plain 40px square stands in. */
function Mark(): ReactElement {
  return (
    <span aria-hidden="true" className="stg:grid stg:size-10 stg:place-items-center stg:rounded-xl stg:bg-foreground stg:text-background">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M17 7.5c-1-1.6-2.8-2.5-5-2.5-2.8 0-4.6 1.5-4.6 3.5 0 4.6 9.8 2.4 9.8 7.4 0 2-2 3.6-5.1 3.6-2.5 0-4.4-1-5.4-2.8" />
      </svg>
    </span>
  );
}

/** The corner a host passes: the account menu, as the sidebar's foot draws it. */
function SignedInCorner(): ReactElement {
  return <UserMenu user={{ name: "Ada Lovelace", email: "ada@acme.example" }} onSignOut={() => {}} />;
}

/** The server's line when it doesn't answer, and when the session has ended. */
const NO_ANSWER = new StigmerError("unavailable", "the server did not answer in time", 14);
const SIGNED_OUT = new StigmerError("unauthenticated", "your session ended", 16);

/** The identity account gate, held in one state. */
export function accountGateScene(state: IdentityAccountGateState): Drawing {
  return {
    routes: serverWithHelp,
    // Both consoles end their failure notes with the server's help line.
    showHelpLink: true,
    render: () => (
      <IdentityAccountGateView
        state={state}
        retry={() => {}}
        signIn={() => {}}
        displayName="Ada Lovelace"
        mark={<Mark />}
        corner={<SignedInCorner />}
      />
    ),
  };
}

/** The organization gate, held in one state. */
export function orgGateScene(state: OrgGateState): Drawing {
  return {
    routes: serverWithHelp,
    // Both consoles end their failure notes with the server's help line.
    showHelpLink: true,
    render: () => (
      <OrgGateView state={state} retry={() => {}} signIn={() => {}} onCreated={() => {}} mark={<Mark />} corner={<SignedInCorner />} />
    ),
  };
}

/**
 * The console's first moments, as the web console composes them on the
 * standalone frame: opening, the hand-off to sign in, a setup that didn't
 * load (`providers/Providers.tsx`), and the console stopping (`global-error.tsx`).
 */
export function consoleMomentScene(moment: "opening" | "to-sign-in" | "config-failed" | "stopped"): Drawing {
  return {
    render: () => {
      switch (moment) {
        case "opening":
          return <StandaloneScreen mark={<Mark />} wait="Opening Stigmer…" />;
        case "to-sign-in":
          return <StandaloneScreen mark={<Mark />} wait="Taking you to sign in…" />;
        case "config-failed":
          return (
            <StandaloneScreen mark={<Mark />}>
              <ErrorMessage
                error={new Error("sign-in is on, but no sign-in client is set up for the console")}
                title="Stigmer couldn't load its setup."
                comfort="This is the server's setup, not your account: nothing was lost. If it keeps happening, tell whoever runs Stigmer for you."
                retry={() => {}}
              />
            </StandaloneScreen>
          );
        case "stopped":
          return (
            <StandaloneScreen mark={<Mark />}>
              <ErrorMessage
                error={new Error("an unexpected error")}
                title="The console stopped working."
                comfort="Your agents and conversations are safe on the server; trying again usually brings it back."
                retry={() => {}}
                reference="4071923856"
              />
            </StandaloneScreen>
          );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The console's page states
// ---------------------------------------------------------------------------

const link = ({ href, className, children }: { readonly href: string; readonly className: string; readonly children: ReactNode }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/** An address that leads nowhere. */
export function pageNotFoundScene(): Drawing {
  return { render: () => <PageNotFound homeHref="/" renderLink={link} /> };
}

/** The failure each scene draws, by the kind a page's read failed with. */
const FAILURES = {
  unavailable: NO_ANSWER,
  permission: new StigmerError("permission-denied", "permission denied", 7),
  unknown: Object.assign(new StigmerError("internal", "internal error", 13), { digest: "4071923856" }),
  "signed-out": SIGNED_OUT,
} as const;

/** A page that broke, as the root boundary draws it, or settings' inside its frame. */
export function pageFailureScene(kind: keyof typeof FAILURES, placement: "page" | "section" = "page"): Drawing {
  const section = placement === "section";
  return {
    routes: serverWithHelp,
    // Both consoles end their failure notes with the server's help line.
    showHelpLink: true,
    render: () => (
      <PageFailure
        error={FAILURES[kind]}
        onRetry={() => {}}
        signIn={() => {}}
        placement={placement}
        comfort={section ? "Your settings are as you left them; only this page didn't load." : undefined}
        link={
          section
            ? { label: "Back to Settings", href: "/settings" }
            : kind === "permission"
              ? { label: "Go to the dashboard", href: "/" }
              : undefined
        }
        renderLink={link}
      />
    ),
  };
}

/** A run's address while its run resolves, whose run isn't there, or whose read failed. */
export function runResolveScene(read: "opening" | "not-found" | "failed"): Drawing {
  return {
    uncounted: read === "opening" ? ["get"] : undefined,
    showHelpLink: true,
    routes: (router) => {
      serverWithHelp(router);
      router.service(RunQueryController, {
        get:
          read === "opening"
            ? pending
            : read === "failed"
              ? () => {
                  throw new ConnectError(NO_ANSWER.message, Code.Unavailable);
                }
              : notFound("run"),
      });
    },
    render: () => (
      <RunResolveView runId="run_01j0000000000000000000000r" onResolved={() => {}} conversationsHref="/conversations" renderLink={link} />
    ),
  };
}

// ---------------------------------------------------------------------------
// Arriving from a link
// ---------------------------------------------------------------------------

/** Acme's invitation to its finance team, as a member, for six more days. */
function preview(valid = true) {
  return create(InvitationPreviewSchema, {
    orgName: "Acme Corp",
    orgSlug: "acme",
    role: IamRole.member,
    label: "Finance team",
    expiresAt: timestampFromDate(sampleDate(6 * 86_400_000)),
    isValid: valid,
    invalidReason: valid ? "" : "This invitation has expired.",
  });
}

type InviteFace = "ready" | "signed-out" | "sign-in-only" | "expired" | "not-found" | "load-failed" | "loading" | "redeem-failed" | "accepting" | "accepted";

/** The invitation page's card, in one of its states. */
export function invitationScene(face: InviteFace): Drawing {
  const signedIn = !["signed-out", "sign-in-only"].includes(face);
  return {
    uncounted: face === "loading" ? ["getByToken"] : face === "accepting" ? ["redeem"] : undefined,
    routes: (router) => {
      serverWithHelp(router);
      router.service(InvitationQueryController, {
        getByToken: face === "loading" ? pending : face === "load-failed" ? unavailable("the invitation store") : () => preview(face !== "expired"),
      });
      router.service(InvitationCommandController, {
        redeem:
          face === "accepting"
            ? pending
            : face === "redeem-failed"
              ? unavailable("the invitation store")
              : () => create(InvitationSchema, {}),
      });
    },
    showHelpLink: true,
    render: () => (
      <StandaloneScreen mark={<Mark />} help>
        <InvitationRedemption
          token={face === "not-found" ? "" : "inv_tok_finance"}
          isAuthenticated={signedIn}
          onAuthRequired={() => {}}
          onSignUp={face === "signed-out" ? () => {} : undefined}
          headingLevel={1}
        />
      </StandaloneScreen>
    ),
  };
}

type ConnectFace = "ready" | "dead" | "loading" | "failed" | "starting";

/** A connect link's page: GitHub, for Acme Corp. */
export function connectLinkScene(face: ConnectFace): Drawing {
  return {
    uncounted: face === "loading" ? ["getConnectLink"] : face === "starting" ? ["startConnectLink"] : undefined,
    routes: (router) => {
      serverWithHelp(router);
      router.service(ConnectLinkController, {
        getConnectLink:
          face === "loading"
            ? pending
            : face === "dead"
              ? notFound("connect link")
              : () => create(ConnectLinkInfoSchema, { providerName: "GitHub", organizationName: "Acme Corp" }),
        startConnectLink: face === "starting" ? pending : unavailable("the vault"),
      });
    },
    showHelpLink: true,
    render: () => (
      <StandaloneScreen mark={<Mark />} help>
        <ConnectLinkView token="cl_tok_github" />
      </StandaloneScreen>
    ),
  };
}

type ReturnFace = "working" | "failed" | "dead" | "unsafe";

/** A connect link's return from the provider's sign-in. */
export function connectReturnScene(face: ReturnFace): Drawing {
  return {
    uncounted: face === "working" ? ["completeConnectLink"] : undefined,
    routes: (router) => {
      serverWithHelp(router);
      router.service(ConnectLinkController, {
        completeConnectLink:
          face === "working"
            ? pending
            : face === "failed"
              ? unavailable("the vault")
              : face === "dead"
                ? notFound("connect link")
                : () => create(CompleteConnectLinkOutputSchema, { returnUrl: "acme-app://connected" }),
      });
    },
    showHelpLink: true,
    render: () => (
      <StandaloneScreen mark={<Mark />} help>
        <ConnectLinkCallback token="cl_tok_github" />
      </StandaloneScreen>
    ),
  };
}

/**
 * Puts the provider's answer in the page's address before the pop-up reads
 * it, keeping the gallery's own parameters, as the redirect would.
 */
function WithReturnQuery({ query, children }: { readonly query: Record<string, string>; readonly children: ReactNode }) {
  const url = new URL(window.location.href);
  let changed = false;
  for (const [key, value] of Object.entries(query)) {
    if (url.searchParams.get(key) !== value) {
      url.searchParams.set(key, value);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(window.history.state, "", url);
  return <>{children}</>;
}

type PopupFace = "done" | "declined" | "missing";

const POPUP_QUERIES: Record<PopupFace, Record<string, string>> = {
  done: { code: "c_0001", state: "st_0001" },
  declined: { error: "access_denied", error_description: "The person declined access.", state: "st_0001" },
  missing: {},
};

/** The OAuth pop-up a vault's sign-in returns to. */
export function oauthPopupScene(face: PopupFace): Drawing {
  return {
    render: () => (
      <WithReturnQuery query={POPUP_QUERIES[face]}>
        <StandaloneScreen mark={<Mark />}>
          <OAuthCallbackHandler appName="Stigmer" />
        </StandaloneScreen>
      </WithReturnQuery>
    ),
  };
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

/** The console's sign-in, in one of its states. */
export function signInScene(face: "ready" | "handing-off" | "failed"): Drawing {
  return {
    routes: serverWithHelp,
    showHelpLink: true,
    render: () => (
      <SignInView
        state={
          face === "failed"
            ? { status: "failed", error: new Error("the sign-in page didn't answer") }
            : face === "handing-off"
              ? { status: "handing-off" }
              : { status: "ready" }
        }
        serverName="Stigmer"
        onSignIn={() => {}}
        mark={<Mark />}
      />
    ),
  };
}

/** The return from the sign-in page: finishing, or why it didn't. */
export function signInReturnScene(face: "finishing" | "failed"): Drawing {
  return {
    routes: serverWithHelp,
    showHelpLink: true,
    render: () => (
      <SignInReturnView
        error={face === "failed" ? new Error("the sign-in page sent back: access_denied") : null}
        onSignInAgain={() => {}}
        mark={<Mark />}
      />
    ),
  };
}

const DESKTOP_DEEP_LINK = "stigmer://billing/return";
const GO_BACK = "Go back to Stigmer Desktop to carry on. You can close this tab.";

/** A page that hands the browser back to the desktop app. */
export function handoffScene(face: "card-saved" | "nothing-changed" | "going-back" | "signed-in"): Drawing {
  return {
    render: () =>
      face === "going-back" ? (
        <AppHandoffView mark={<Mark />} wait="Going back to Stigmer Desktop…" />
      ) : (
        <AppHandoffView
          mark={<Mark />}
          title={face === "card-saved" ? "Your card is saved" : face === "nothing-changed" ? "Nothing was changed" : "You're signed in"}
          lead={face === "signed-in" ? "If Stigmer Desktop didn't open, open it here. You can close this tab after." : GO_BACK}
          href={DESKTOP_DEEP_LINK}
          actLabel="Open Stigmer Desktop"
        />
      ),
  };
}

/** Every drawing of this file, by the catalogue's id. */
export const AROUND_CONSOLE_DRAWINGS = {
  "gate-account-checking": () => accountGateScene({ status: "checking" }),
  "gate-account-provisioning": () => accountGateScene({ status: "provisioning" }),
  "gate-account-failed": () => accountGateScene({ status: "error", message: NO_ANSWER.message, error: NO_ANSWER }),
  "gate-account-signed-out": () => accountGateScene({ status: "error", message: SIGNED_OUT.message, error: SIGNED_OUT }),
  "gate-org-loading": () => orgGateScene({ status: "loading" }),
  "gate-org-failed": () => orgGateScene({ status: "error", message: NO_ANSWER.message, error: NO_ANSWER }),
  "gate-org-none": () => orgGateScene({ status: "no-orgs" }),
  "page-not-found": pageNotFoundScene,
  "page-failure-unavailable": () => pageFailureScene("unavailable"),
  "page-failure-permission": () => pageFailureScene("permission"),
  "page-failure-unknown": () => pageFailureScene("unknown"),
  "page-failure-signed-out": () => pageFailureScene("signed-out"),
  "page-failure-section": () => pageFailureScene("unknown", "section"),
  "run-resolve-opening": () => runResolveScene("opening"),
  "run-resolve-not-found": () => runResolveScene("not-found"),
  "run-resolve-failed": () => runResolveScene("failed"),
  "console-opening": () => consoleMomentScene("opening"),
  "console-to-sign-in": () => consoleMomentScene("to-sign-in"),
  "console-config-failed": () => consoleMomentScene("config-failed"),
  "console-stopped": () => consoleMomentScene("stopped"),
  "invite-ready": () => invitationScene("ready"),
  "invite-signed-out": () => invitationScene("signed-out"),
  "invite-sign-in-only": () => invitationScene("sign-in-only"),
  "invite-expired": () => invitationScene("expired"),
  "invite-not-found": () => invitationScene("not-found"),
  "invite-load-failed": () => invitationScene("load-failed"),
  "invite-loading": () => invitationScene("loading"),
  "invite-redeem-failed": () => invitationScene("redeem-failed"),
  "invite-accepting": () => invitationScene("accepting"),
  "invite-accepted": () => invitationScene("accepted"),
  "connect-link-ready": () => connectLinkScene("ready"),
  "connect-link-dead": () => connectLinkScene("dead"),
  "connect-link-loading": () => connectLinkScene("loading"),
  "connect-link-failed": () => connectLinkScene("failed"),
  "connect-link-starting": () => connectLinkScene("starting"),
  "connect-return-working": () => connectReturnScene("working"),
  "connect-return-failed": () => connectReturnScene("failed"),
  "connect-return-dead": () => connectReturnScene("dead"),
  "connect-return-unsafe": () => connectReturnScene("unsafe"),
  "oauth-popup-done": () => oauthPopupScene("done"),
  "oauth-popup-declined": () => oauthPopupScene("declined"),
  "oauth-popup-missing": () => oauthPopupScene("missing"),
  "sign-in-ready": () => signInScene("ready"),
  "sign-in-handing-off": () => signInScene("handing-off"),
  "sign-in-failed": () => signInScene("failed"),
  "sign-in-return-finishing": () => signInReturnScene("finishing"),
  "sign-in-return-failed": () => signInReturnScene("failed"),
  "handoff-card-saved": () => handoffScene("card-saved"),
  "handoff-nothing-changed": () => handoffScene("nothing-changed"),
  "handoff-going-back": () => handoffScene("going-back"),
  "handoff-signed-in": () => handoffScene("signed-in"),
} as const satisfies Record<string, () => Drawing>;
