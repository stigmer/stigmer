/**
 * A plugin's page in the console's Library, at the console's own
 * composition: the real `PluginDetailView` (what the plugin holds, "Start
 * a chat", each MCP server with its sign-in and "Check tools") inside the
 * Library zone's scroll pane and content column. Three Getting Started
 * tours land on the same page, so it renders once here.
 *
 * The view fetches the plugin and My vault itself; the tour's
 * `.scenar/providers.tsx` answers those reads (`PluginQueryController.
 * getByReference`, `VaultQueryController.getMine`). `org` is passed through
 * to the view as the organization the page is viewed in, which is the one
 * whose My vault the sign-in cell reads: a tour that depicts the page
 * before and after a sign-in names the organization two ways (its slug,
 * its id; the API takes either) and answers `getMine` by which one asked.
 *
 * "Start a chat" is offered as the console offers it (the host passes the
 * route); here the callback is inert. The page's controls carry cursor
 * targets through `CursorTargets`, by the names a person reads:
 * `start-chat`, `sign-in`, `check-tools`. The root is `inert`: a depicted
 * page is not interactive during playback.
 */
import { useMemo, type CSSProperties } from "react";
import { PluginDetailView } from "@stigmer/react";
import { CursorTargets, type CursorTargetSpec } from "./CursorTargets";

const noop = () => {};

/**
 * The library zone's page scroll pane and content column, at the console's
 * own geometry (`LibraryLayout`: `mx-auto max-w-4xl px-6 py-8`). No zoom —
 * one scale factor per frame.
 */
const PAGE_SCROLL: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: "32px 24px",
};
const PAGE_CONTENT: CSSProperties = {
  margin: "0 auto",
  maxWidth: "56rem",
};

interface PluginPageProps {
  /** The organization the page is viewed in, by slug or id: the one whose My vault holds the login. */
  readonly org: string;
  /** The plugin's slug. */
  readonly slug: string;
  /** The server's name in the plugin, as its "Sign in" button names it. */
  readonly serverName: string;
}

/** The plugin page's controls a tour points at, by the names a person reads. */
function targetsFor(serverName: string): readonly CursorTargetSpec[] {
  return [
    { name: "Start a chat", target: "start-chat" },
    { name: `Sign in to ${serverName}`, target: "sign-in" },
    { name: "Check tools", target: "check-tools" },
  ];
}

/** The real plugin page for one installed plugin. */
export function PluginPage({ org, slug, serverName }: PluginPageProps) {
  const targets = useMemo(() => targetsFor(serverName), [serverName]);
  return (
    <div style={PAGE_SCROLL} inert>
      <div style={PAGE_CONTENT}>
        <CursorTargets targets={targets}>
          <PluginDetailView org={org} slug={slug} onStartChat={noop} />
        </CursorTargets>
      </div>
    </div>
  );
}
