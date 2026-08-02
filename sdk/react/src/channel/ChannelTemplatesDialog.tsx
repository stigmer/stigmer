"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { ExternalLink, LayoutTemplate, X } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { ChannelTemplate } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { StatusBadge } from "../resource-workbench/components/StatusBadge.js";
import {
  channelPresentationOf,
  DEFAULT_CHANNEL_PRESENTATION,
} from "./providerPresentation.js";
import {
  splitTemplateBody,
  templateStatusPhase,
} from "./templatePresentation.js";
import { useChannelTemplateList } from "./useChannelTemplateList.js";
import { useChannelTemplateReadiness } from "./useChannelTemplateReadiness.js";

/**
 * Where businesses author and manage WhatsApp message templates — the
 * provider's own console. Stigmer keeps no copy of the list (DD-003:
 * the provider is the registry), so this surface links out rather than
 * offering any editing of its own.
 */
const WHATSAPP_MANAGER_TEMPLATES_URL =
  "https://business.facebook.com/wa/manage/message-templates/";

/** Props for {@link ChannelTemplatesDialog}. */
export interface ChannelTemplatesDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /** The channel whose provider template registry is listed. */
  readonly channel: AgentChannel;
  /**
   * Opens the channel's YAML editor — the only place
   * `proactive_messaging_enabled` can be granted today. Wired by
   * {@link AgentChannelsPanel} to its Edit YAML dialog; when absent,
   * the teaching state renders without the affordance.
   */
  readonly onEditYaml?: () => void;
  /**
   * When `false`, renders as an in-flow open dialog instead of a
   * top-layer modal — for embedding in constrained surfaces
   * (documentation demos, visual tests). Interactive hosts keep the
   * default.
   * @default true
   */
  readonly modal?: boolean;
}

/**
 * Lists a channel's message templates as the provider's registry
 * reports them — for WhatsApp, the templates a business authored in
 * WhatsApp Manager, each with its approval status.
 *
 * This is the diagnosis surface for business-initiated messaging: it is
 * the one place that shows the provider's rejection copy AND Stigmer's
 * own `unsupported_reason` (why an approved template still cannot be
 * sent by the agent). The runner's prompt deliberately filters
 * unsendable templates rather than annotating them, so a template
 * "missing" from the agent's repertoire is explained here and nowhere
 * else.
 *
 * The dialog is a window onto the provider, never an editor: templates
 * are authored and approved in WhatsApp Manager, and the empty state
 * says so. Before fetching, a readiness pre-check answers the
 * preconditions the channel resource already knows (cloud runtime,
 * installed, serving, proactive grant) as teaching states instead of
 * relayed refusals; once a fetch does fail, the server's message
 * renders verbatim.
 *
 * Built on the native `<dialog>` element, matching the SDK's modal
 * convention. Most hosts mount it via {@link AgentChannelsPanel}'s
 * channel card action menu, which shows the action only for providers
 * whose descriptor declares `supportsMessageTemplates`.
 */
export function ChannelTemplatesDialog({
  open,
  onOpenChange,
  channel,
  onEditYaml,
  modal = true,
}: ChannelTemplatesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleClose = useCallback(() => {
    dialogRef.current?.close();
    onOpenChange(false);
  }, [onOpenChange]);

  // Sync native dialog open state (matches the SDK dialog convention).
  const prevOpenRef = useRef(false);
  if (modal && open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    if (open) {
      requestAnimationFrame(() => {
        if (dialogRef.current && !dialogRef.current.open) {
          dialogRef.current.showModal();
        }
      });
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      open={modal ? undefined : open}
      onClose={handleClose}
      className={cn(
        // Wider than the conversations dialog on purpose: template
        // bodies are the content, and a narrow column shreds them.
        "w-full max-w-2xl rounded-xl border border-border bg-popover p-0 shadow-xl",
        modal ? "fixed inset-0 m-auto backdrop:bg-black/50" : "relative",
      )}
      aria-labelledby="channel-templates-title"
    >
      {/* Body mounts only while open so each opening fetches fresh —
          approval statuses change on the provider's side at any time. */}
      {open && (
        <ChannelTemplatesDialogBody
          channel={channel}
          onEditYaml={onEditYaml}
          onClose={handleClose}
        />
      )}
    </dialog>
  );
}

function ChannelTemplatesDialogBody({
  channel,
  onEditYaml,
  onClose,
}: {
  readonly channel: AgentChannel;
  readonly onEditYaml?: () => void;
  readonly onClose: () => void;
}) {
  const channelName =
    channel.metadata?.name || channel.metadata?.slug || "this channel";

  return (
    <div className="flex max-h-[75vh] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2
            id="channel-templates-title"
            className="text-sm font-semibold text-popover-foreground"
          >
            Templates
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The message templates WhatsApp holds for {channelName} — authored
            and approved in WhatsApp Manager, listed here as WhatsApp reports
            them.
          </p>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onClose}
          aria-label="Close templates"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ChannelTemplatesContent channel={channel} onEditYaml={onEditYaml} />
      </div>
    </div>
  );
}

/**
 * The readiness gate: each precondition the channel resource already
 * answers renders as a teaching state without a network call — the
 * courtesy-pre-check posture (project DD-007 D4). Only `ready` fetches;
 * the server stays authoritative for everything past this point.
 */
function ChannelTemplatesContent({
  channel,
  onEditYaml,
}: {
  readonly channel: AgentChannel;
  readonly onEditYaml?: () => void;
}) {
  const readiness = useChannelTemplateReadiness(channel);
  const presentation =
    channelPresentationOf(channel.spec?.providerConfig?.case) ??
    DEFAULT_CHANNEL_PRESENTATION;

  switch (readiness.status) {
    case "cloud-only":
      return (
        <CloudFeatureNotice>
          Message templates come from the provider through Stigmer
          Cloud&apos;s channel runtime. Channel configuration still works
          here, but the template registry can only be read on a cloud
          deployment.
        </CloudFeatureNotice>
      );
    case "not-installed":
      // describeChannel already carries the right sentence per provider
      // and per install state (pending vs revoked) — the card's copy,
      // reused so the two surfaces cannot drift.
      return (
        <EmptyState
          variant="first-use"
          icon={<LayoutTemplate className="size-8" />}
          title="Connect this channel first"
          description={`${presentation.describeChannel(channel)} Templates become readable once the connection is complete.`}
        />
      );
    case "channel-off":
      return (
        <EmptyState
          variant="first-use"
          icon={<LayoutTemplate className="size-8" />}
          title="This channel is turned off"
          description="Turn the channel on with the switch on its card, then check back here."
        />
      );
    case "not-proactive":
      return (
        <EmptyState
          variant="first-use"
          icon={<LayoutTemplate className="size-8" />}
          title="Business-initiated messaging is not enabled"
          description={
            "Templates power messages your agent sends first — reminders, " +
            "invoices, notifications. To allow them, set " +
            "proactive_messaging_enabled on this channel's definition."
          }
        >
          {onEditYaml && (
            <Button variant="primary" onClick={onEditYaml}>
              Edit channel YAML
            </Button>
          )}
        </EmptyState>
      );
    case "ready":
      return <ChannelTemplatesList channel={channel} />;
  }
}

function ChannelTemplatesList({
  channel,
}: {
  readonly channel: AgentChannel;
}) {
  const { templates, isLoading, error } = useChannelTemplateList(
    channel.metadata?.slug ?? "",
    channel.metadata?.org ?? "",
  );

  if (isLoading) {
    return <TemplatesSkeleton />;
  }

  if (error) {
    // The server's copy is the teaching state past the pre-check —
    // its refusals name the fix (scope, token, app binding) verbatim.
    return (
      <p className="px-2 py-6 text-center text-sm text-destructive">
        {getUserMessage(error)}
      </p>
    );
  }

  if (templates.length === 0) {
    // "found", never "you have none": an empty success is
    // indistinguishable from a filtered or truncated one on the wire.
    return (
      <EmptyState
        variant="first-use"
        icon={<LayoutTemplate className="size-8" />}
        title="No templates found for this channel"
        description={
          "Templates are authored in WhatsApp Manager and approved by " +
          "WhatsApp — Stigmer keeps no copy. Once a template is approved, " +
          "it appears here and in your agent's repertoire automatically."
        }
      >
        <WhatsAppManagerLink label="Open WhatsApp Manager" />
      </EmptyState>
    );
  }

  const sendable = templates.filter(
    (t) => t.status === "APPROVED" && t.unsupportedReason === "",
  ).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-1 pb-3">
        <p className="text-xs text-muted-foreground">
          {templates.length} {templates.length === 1 ? "template" : "templates"}
          {" \u00b7 "}
          {sendable} ready to send
        </p>
        <WhatsAppManagerLink label="Manage in WhatsApp Manager" />
      </div>
      <ul className="space-y-2">
        {templates.map((template) => (
          <TemplateRow
            key={`${template.name}\u0000${template.language}`}
            template={template}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row — one (name, language) template as the provider reports it
// ---------------------------------------------------------------------------

function TemplateRow({ template }: { readonly template: ChannelTemplate }) {
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="truncate text-sm font-medium text-foreground"
            title={template.name}
          >
            {template.name}
          </span>
          {/* (name, language) is the template's identity — each
              language is approved independently, so it always shows. */}
          <span className="shrink-0 text-xs text-muted-foreground">
            {template.language}
          </span>
          {template.category && <FactChip>{template.category}</FactChip>}
          {template.headerFormat && (
            <FactChip>{template.headerFormat} header</FactChip>
          )}
        </div>
        <StatusBadge
          phase={templateStatusPhase(template.status)}
          label={template.status}
          className="shrink-0"
        />
      </div>

      {template.bodyText && <TemplateBody body={template.bodyText} />}

      {template.rejectionReason && (
        <p className="mt-2 text-xs text-destructive">
          Rejected: {template.rejectionReason}
        </p>
      )}
      {template.unsupportedReason && (
        <p className="mt-2 text-xs text-warning" role="status">
          Not sendable: {template.unsupportedReason}
        </p>
      )}
    </li>
  );
}

/**
 * The body verbatim, with `{{...}}` placeholders set off visually —
 * they are the parts the agent fills at send time, and the reason the
 * full text is on the wire at all.
 */
function TemplateBody({ body }: { readonly body: string }) {
  return (
    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
      {splitTemplateBody(body).map((segment, i) =>
        segment.kind === "placeholder" ? (
          <code
            key={i}
            className="rounded bg-muted-subtle px-1 font-mono text-foreground"
          >
            {segment.value}
          </code>
        ) : (
          <span key={i}>{segment.value}</span>
        ),
      )}
    </p>
  );
}

/** Provider-verbatim fact rendered small and quiet (category, header). */
function FactChip({ children }: { readonly children: ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-muted-subtle px-1.5 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function WhatsAppManagerLink({ label }: { readonly label: string }) {
  return (
    <a
      href={WHATSAPP_MANAGER_TEMPLATES_URL}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-medium text-foreground",
        "underline underline-offset-2 hover:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
      )}
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

function TemplatesSkeleton() {
  return (
    <div className="space-y-2 p-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted-faint" />
      ))}
    </div>
  );
}
