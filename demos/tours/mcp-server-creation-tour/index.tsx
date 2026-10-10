/**
 * Pure `renderStep` for the Add MCP server tour. The player, cursor,
 * narration, and viewport are supplied by `scenar pack` — this file only
 * maps step data to views.
 *
 * The Plugins list is the shared `ResourceListPage` (the real
 * `ResourceWorkbench` over fixture rows) with the Plugins page's own copy
 * and its three ways in; the closing beats are the real plugin page
 * (`_shared/PluginPage`, the real `PluginDetailView`).
 *
 * The form beats are a tour-local replica of `AddMcpServerDialog`: the real
 * dialog opens with `<dialog>.showModal()`, which escapes to the browser top
 * layer where the embed's canvas does not reach (it would render unscaled
 * over the player controls), and its fields are its own state, which a
 * beat may not drive with synthetic events. The replica renders the same
 * form inside the canonical container, from the step's phase: the same
 * labels, placeholders and help text, and an Add button that is disabled
 * until a name and a URL are in, as the real one is.
 */
import type { ReactNode } from "react";
import { BrowserView } from "@scenar/react";
import { Server, Store, Upload } from "lucide-react";
import { AppShell } from "../_shared/AppShell";
import { ORDER_MGMT } from "../_shared/order-management-plugin";
import { PluginPage } from "../_shared/PluginPage";
import { ResourceListPage, type ListPageAction } from "../_shared/ResourceListPage";
import { SessionView } from "../_shared/SessionView";
import {
  type AddFormPhase,
  type McpServerCreationTourStep,
  DEMO_ORG,
  EXISTING_PLUGINS,
} from "./steps";
import "./tour.css";

/**
 * Console beats render inside a browser window whose address bar tracks the
 * depicted route — a screen recording shows an app in its container.
 */
function consoleWindow(contentKey: string, path: string, children: ReactNode) {
  return (
    <BrowserView url={`app.stigmer.ai${path}`} contentKey={contentKey}>
      {children}
    </BrowserView>
  );
}

/** The Plugins page's copy, transcribed from the console's `PluginListPage`. */
const PLUGINS_SUBTITLE =
  "What you have installed. A plugin is what you install; the agent it installs is what runs.";

/** The ways in before "Add MCP server", as the console's Plugins page shows them. */
const PLUGINS_LEADING_ACTIONS: readonly ListPageAction[] = [
  { label: "Browse Marketplace", icon: <Store size={14} />, primary: true },
  { label: "Upload plugin", icon: <Upload size={14} /> },
];

function PluginsList({ highlightAdd }: { readonly highlightAdd?: boolean }) {
  return (
    <ResourceListPage
      title="Plugins"
      nounPlural="plugins"
      subtitle={PLUGINS_SUBTITLE}
      leadingActions={PLUGINS_LEADING_ACTIONS}
      createLabel="Add MCP server"
      createIcon={<Server size={14} />}
      createSecondary
      cursorTarget="add-mcp-server"
      items={EXISTING_PLUGINS}
      highlightCreate={highlightAdd}
    />
  );
}

/** What the form holds at each phase: untouched, or filled in for the Order Management API. */
const FORM_VALUES: Record<AddFormPhase, { name: string; url: string; description: string }> = {
  empty: { name: "", url: "", description: "" },
  filled: { name: ORDER_MGMT.name, url: ORDER_MGMT.url, description: ORDER_MGMT.description },
};

/** One labelled field of the replica: the value when filled, the real placeholder when not. */
function Field({
  label,
  optional,
  value,
  placeholder,
  help,
}: {
  readonly label: string;
  readonly optional?: boolean;
  readonly value: string;
  readonly placeholder?: string;
  readonly help?: string;
}) {
  return (
    <div className="add-mcp__field">
      <span className={optional ? "add-mcp__label add-mcp__label--optional" : "add-mcp__label"}>
        {label}
        {optional && <span className="add-mcp__optional"> (optional)</span>}
      </span>
      <span className={value === "" ? "add-mcp__input add-mcp__input--placeholder" : "add-mcp__input"}>
        {value === "" ? (placeholder ?? " ") : value}
      </span>
      {help && <span className="add-mcp__help">{help}</span>}
    </div>
  );
}

/**
 * Tour-local replica of `AddMcpServerDialog` over the dimmed Plugins page,
 * like the console's modal backdrop (see the file header for why the real
 * dialog cannot render here).
 */
function AddMcpServerOverlay({ phase }: { readonly phase: AddFormPhase }) {
  const values = FORM_VALUES[phase];
  const canSubmit = values.name !== "" && values.url !== "";
  return (
    <div className="add-mcp">
      <div className="add-mcp__underlay" inert>
        <PluginsList />
      </div>

      <div className="add-mcp__backdrop">
        <div className="add-mcp__dialog" role="dialog" aria-label="Add MCP server">
          <header>
            <h3 className="add-mcp__title">Add MCP server</h3>
            <p className="add-mcp__subtitle">
              Installs a plugin of this one server. A chat or an agent that uses the plugin gets the
              server&apos;s tools; if the server asks you to sign in, its plugin page says so.
            </p>
          </header>

          <Field
            label="Name"
            value={values.name}
            placeholder="linear"
            help="Lowercase letters, digits, dots and hyphens. The plugin is named after it."
          />
          <Field label="URL" value={values.url} placeholder="https://mcp.linear.app/mcp" />
          <Field label="Description" optional value={values.description} />

          <div className="add-mcp__field">
            <span className="add-mcp__label add-mcp__label--optional">
              Headers<span className="add-mcp__optional"> (optional)</span>
            </span>
            <span className="add-mcp__button add-mcp__button--small">Add header</span>
            <span className="add-mcp__help">
              Write a key as <code>{"${NAME}"}</code>, never its value: each conversation that uses
              the server asks for it and reads it from a vault.
            </span>
          </div>

          <footer className="add-mcp__actions">
            <span className="add-mcp__button">Cancel</span>
            <span
              className={
                canSubmit
                  ? "add-mcp__button add-mcp__button--primary"
                  : "add-mcp__button add-mcp__button--primary add-mcp__button--disabled"
              }
              data-cursor-target="add-submit"
            >
              Add
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}

export function renderStep(data: McpServerCreationTourStep): ReactNode {
  switch (data.view) {
    // The console home is the zero-prop SessionView — the real launcher
    // at its production defaults (stigmer/stigmer#321). Both beats share
    // contentKey "home", so only the sidebar pulse changes between them.
    case "home":
      return consoleWindow(
        "home",
        "/",
        <AppShell contentKey="home">
          <SessionView />
        </AppShell>,
      );

    case "library-click":
      return consoleWindow(
        "home",
        "/",
        <AppShell highlightNav="library" contentKey="home">
          <SessionView />
        </AppShell>,
      );

    case "plugins-list":
      return consoleWindow(
        "plugins",
        "/library/plugins",
        <AppShell activeNav="library" contentKey="plugins" slideDirection="forward">
          <PluginsList highlightAdd />
        </AppShell>,
      );

    case "add-form":
      // Both form beats share one page: only the fields change between them.
      return consoleWindow(
        "add-form",
        "/library/plugins",
        <AppShell activeNav="library" contentKey="add-form">
          <AddMcpServerOverlay phase={data.form} />
        </AppShell>,
      );

    case "plugin-page":
      return consoleWindow(
        "plugin-page",
        `/library/plugins/${DEMO_ORG}/${ORDER_MGMT.name}`,
        <AppShell activeNav="library" contentKey="plugin-page" slideDirection="forward">
          <PluginPage org={DEMO_ORG} slug={ORDER_MGMT.name} serverName={ORDER_MGMT.name} />
        </AppShell>,
      );
  }
}
