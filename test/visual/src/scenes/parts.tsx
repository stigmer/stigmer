// The console's shared parts, each in every variant and state it has, on
// one page: the button in each variant and size, a page header with its
// act, the status pill in each phase, the empty state in each variant, and
// the error message as a failed read draws it. Every page in the console
// and the desktop app is built from these, so a change to one of them shows
// here part by part before it shows on the pages that use it.
//
// The labels around the parts are the gallery's own (inline styles on the
// kit's tokens), so they never move when a part does.
import type { ComponentProps, ReactNode } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { ActionMenu, Button, EmptyState, ErrorMessage, LinkButton, PageHeader, StatusBadge } from "@stigmer/react-sdk";
import type { Drawing } from "./drawing.ts";

const PHASES: readonly ComponentProps<typeof StatusBadge>["phase"][] = ["ready", "running", "pending", "degraded", "failed", "disabled", "draft"];

/** A read the server refused because it was down: the error a page's list most often meets. */
const UNAVAILABLE = new ConnectError("the vault service did not answer", Code.Unavailable);

/** The plus a "New …" button leads with, drawn as the kit's icons are (14px, a 2px stroke). */
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** A row's or a page's overflow mark, drawn as the kit's icons are. */
function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

/** One group of parts under a plain label. */
function Group({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <h2
        style={{
          margin: 0,
          fontSize: "var(--stgm-text-xs)",
          lineHeight: "var(--stgm-leading-xs)",
          fontWeight: 500,
          color: "var(--stgm-muted-foreground)",
        }}
      >
        {label}
      </h2>
      {children}
    </section>
  );
}

/** Parts laid side by side, wrapping at a narrow width. */
function Row({ children }: { readonly children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>{children}</div>;
}

function Parts() {
  return (
    <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "2rem 1.5rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <h1 className="gallery-visually-hidden">The console's shared parts</h1>
      <Group label="Buttons, default size">
        <Row>
          <Button variant="primary">Save</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="destructive">Delete</Button>
          <Button variant="primary" icon={<PlusIcon />}>
            New API key
          </Button>
          <Button variant="primary" disabled>
            Saving…
          </Button>
        </Row>
      </Group>
      <Group label="Buttons, small">
        <Row>
          <Button variant="primary" size="xs">Install</Button>
          <Button variant="outline" size="xs">Install</Button>
          <Button variant="ghost" size="xs">Edit</Button>
          <Button variant="destructive" size="xs">Remove</Button>
          <Button variant="outline" size="xs">Install again</Button>
        </Row>
      </Group>
      <Group label="Buttons in their places">
        <Row>
          <Button variant="primary">Run now</Button>
          <Button variant="outline">Change role</Button>
          <Button variant="destructive">Remove</Button>
          <ActionMenu>
            <ActionMenu.Trigger aria-label="More actions" size="sm">
              <MoreIcon />
            </ActionMenu.Trigger>
            <ActionMenu.Content>
              <ActionMenu.Item onSelect={() => {}}>Rename</ActionMenu.Item>
            </ActionMenu.Content>
          </ActionMenu>
          <Button variant="outline">Apply YAML</Button>
          <Button variant="outline" size="xs">Change role</Button>
          <Button variant="destructive" size="xs">Remove</Button>
          <LinkButton href="#create-agent">Create agent</LinkButton>
          <LinkButton href="#models" variant="outline">Open Models &amp; providers</LinkButton>
          <LinkButton href="#runs" variant="ghost">View all runs</LinkButton>
        </Row>
      </Group>
      <Group label="Page header">
        <PageHeader
          headingLevel={2}
          title="API keys"
          description="Keys sign the CLI and your own programs in to Stigmer as you. A key works in every organization you belong to, unless you limit it to one."
          actions={<Button>New API key</Button>}
        />
      </Group>
      <Group label="Status pill">
        <Row>
          {PHASES.map((phase) => (
            <StatusBadge key={phase} phase={phase} />
          ))}
        </Row>
      </Group>
      <Group label="Empty state">
        <EmptyState
          variant="first-use"
          title="No API keys yet"
          description="Make one for the CLI on a server, a CI job or a script. You see its value once, when it is made."
          action={{ label: "New API key", onClick: () => {} }}
        />
        <EmptyState variant="zero-results" />
        <EmptyState variant="permission" resourceLabel="service accounts" />
      </Group>
      <Group label="Error message">
        <ErrorMessage error={UNAVAILABLE} title="Couldn't load the shared vaults." retry={() => {}} />
        <ErrorMessage error={UNAVAILABLE} />
      </Group>
    </div>
  );
}

/** Every shared part, in every variant and state it has. */
export function partsScene(): Drawing {
  return { render: () => <Parts /> };
}
