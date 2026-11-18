// The desktop app's own screens, drawn by the kit's views the app renders:
// its sign-in (with its other-site warning, its wait for the browser and its
// failure), connecting to a server and the three ways one can't be used,
// choosing another (as a screen, when the build's server can't be used, and
// as a dialog over the app), the app starting and failing to start, and the
// agents' status row at the sidebar's foot. Each is held in one state, as the
// app hands it; none reads the server.
import type { ReactElement } from "react";
import { ErrorMessage } from "@stigmer/react-sdk";
import {
  ServerChooserForm,
  ServerConnectionView,
  SidebarStatusRow,
  SignInView,
  StandaloneScreen,
  type ServerConnectionState,
  type SidebarStatusTone,
} from "@stigmer/react-sdk/console";
import type { Drawing } from "./drawing.ts";

const HOST = "stigmer.acme.example";

/** The app's mark: here a plain 40px square stands in, as on the other frame scenes. */
function Mark(): ReactElement {
  return (
    <span aria-hidden="true" className="stg:grid stg:size-10 stg:place-items-center stg:rounded-xl stg:bg-foreground stg:text-background">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M17 7.5c-1-1.6-2.8-2.5-5-2.5-2.8 0-4.6 1.5-4.6 3.5 0 4.6 9.8 2.4 9.8 7.4 0 2-2 3.6-5.1 3.6-2.5 0-4.4-1-5.4-2.8" />
      </svg>
    </span>
  );
}

const noop = (): void => {};

/** The desktop's sign-in, in one of its states. */
export function desktopSignInScene(face: "ready" | "elsewhere" | "waiting" | "failed"): Drawing {
  return {
    render: () => (
      <SignInView
        state={
          face === "waiting"
            ? { status: "waiting" }
            : face === "failed"
              ? { status: "failed", error: new Error("the browser closed before the sign-in page answered"), headline: "The sign-in didn't finish." }
              : { status: "ready" }
        }
        serverName="Acme"
        lead={HOST}
        onSignIn={noop}
        elsewhere={face === "elsewhere" ? { server: HOST, provider: "login.othercorp.example" } : undefined}
        onReopen={noop}
        onCancel={noop}
        onUseAnotherServer={noop}
        mark={<Mark />}
      />
    ),
  };
}

/** Connecting to a server, or why it can't be used. */
export function serverConnectionScene(state: ServerConnectionState): Drawing {
  return {
    render: () => (
      <ServerConnectionView state={state} host={HOST} onRetry={noop} onChooseAnother={noop} onOpenGuide={noop} mark={<Mark />} />
    ),
  };
}

/** Choosing a server: as a screen, when the build's own server can't be used, or as a dialog over the app. */
export function serverChooserScene(face: "screen" | "unusable" | "dialog"): Drawing {
  const choose = async (): Promise<string | null> => null;
  return {
    render: () =>
      face === "dialog" ? (
        <ServerChooserForm presentation="dialog" open onChoose={choose} onBack={noop} />
      ) : (
        <ServerChooserForm
          onChoose={choose}
          onBack={face === "unusable" ? undefined : noop}
          unusable={face === "unusable" ? { host: HOST, detail: "it signs people in at an address the app may not open" } : undefined}
          mark={<Mark />}
        />
      ),
  };
}

/** The app starting, and the boot failure the app's own boundary draws. */
export function desktopStartScene(face: "starting" | "failed"): Drawing {
  return {
    render: () =>
      face === "starting" ? (
        <StandaloneScreen mark={<Mark />} wait="Starting Stigmer Desktop…" />
      ) : (
        <StandaloneScreen mark={<Mark />}>
          <ErrorMessage
            error={new Error("a part of the app failed to load")}
            title="Stigmer Desktop couldn't start."
            comfort="Your conversations are safe on your server."
            retry={noop}
            reference="TypeError: a part of the app failed to load"
          />
        </StandaloneScreen>
      ),
  };
}

const RUNNER: Record<string, { tone: SidebarStatusTone; label: string; detail?: string; action?: string }> = {
  idle: { tone: "quiet", label: "Agents start with a conversation" },
  starting: { tone: "quiet", label: "Starting agents…" },
  ready: { tone: "live", label: "Agents ready" },
  working: { tone: "live", label: "Agents working on 2 conversations" },
  stopped: { tone: "alert", label: "Agents stopped", action: "Restart" },
  failed: {
    tone: "alert",
    label: "Agents couldn't start",
    detail: "The agents' process exited: port 7466 is in use by another app.",
    action: "Try again",
  },
};

/** The agents' status row, at the foot of a sidebar's width. */
export function sidebarStatusScene(face: keyof typeof RUNNER): Drawing {
  const row = RUNNER[face];
  return {
    render: () => (
      <div className="stg:bg-sidebar stg:pt-3" style={{ width: 240 }}>
        <SidebarStatusRow
          tone={row.tone}
          label={row.label}
          detail={row.detail}
          action={row.action !== undefined ? { label: row.action, onClick: noop } : undefined}
        />
      </div>
    ),
  };
}

/** Every drawing of this file, by the catalogue's id. */
export const DESKTOP_SCREEN_DRAWINGS = {
  "desktop-sign-in-ready": () => desktopSignInScene("ready"),
  "desktop-sign-in-elsewhere": () => desktopSignInScene("elsewhere"),
  "desktop-sign-in-waiting": () => desktopSignInScene("waiting"),
  "desktop-sign-in-failed": () => desktopSignInScene("failed"),
  "server-connecting": () => serverConnectionScene({ status: "connecting" }),
  "server-unreachable": () => serverConnectionScene({ status: "unreachable" }),
  "server-not-stigmer": () => serverConnectionScene({ status: "not-stigmer" }),
  "server-not-set-up": () => serverConnectionScene({ status: "not-set-up", serverName: "Acme" }),
  "server-chooser": () => serverChooserScene("screen"),
  "server-chooser-unusable": () => serverChooserScene("unusable"),
  "server-chooser-dialog": () => serverChooserScene("dialog"),
  "desktop-starting": () => desktopStartScene("starting"),
  "desktop-start-failed": () => desktopStartScene("failed"),
  "sidebar-status-idle": () => sidebarStatusScene("idle"),
  "sidebar-status-starting": () => sidebarStatusScene("starting"),
  "sidebar-status-ready": () => sidebarStatusScene("ready"),
  "sidebar-status-working": () => sidebarStatusScene("working"),
  "sidebar-status-stopped": () => sidebarStatusScene("stopped"),
  "sidebar-status-failed": () => sidebarStatusScene("failed"),
} as const satisfies Record<string, () => Drawing>;
