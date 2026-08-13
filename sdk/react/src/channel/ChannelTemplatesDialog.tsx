"use client";

import { useCallback, useId, type ReactNode } from "react";
import { ExternalLink, LayoutTemplate, X } from "lucide-react";
import { cn } from "@stigmer/theme";
import { DialogShell } from "../internal/DialogShell.js";
import { getUserMessage } from "@stigmer/sdk";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { ChannelTemplate } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { TruncatedText } from "../internal/truncated-text.js";
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
  const titleId = useId();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      // Wider than the conversations dialog on purpose: template
      // bodies are the content, and a narrow column shreds them.
      width="2xl"
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open so each opening fetches fresh —
          approval statuses change on the provider's side at any time. */}
      {open && (
        <ChannelTemplatesDialogBody
          titleId={titleId}
          channel={channel}
          onEditYaml={onEditYaml}
          onClose={handleClose}
        />
      )}
    </DialogShell>
  );
}

function ChannelTemplatesDialogBody({
  titleId,
  channel,
  onEditYaml,
  onClose,
}: {
  readonly titleId: string;
  readonly channel: AgentChannel;
  readonly onEditYaml?: () => void;
  readonly onClose: () => void;
}) {
  const channelName =
    channel.metadata?.name || channel.metadata?.slug || "this channel";

  return (
    <div className="stg:flex stg:max-h-[75vh] stg:flex-col">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3 stg:border-b stg:border-border stg:px-5 stg:py-4">
        <div className="stg:min-w-0">
          <h2
            id={titleId}
            className="stg:text-sm stg:font-semibold stg:text-popover-foreground"
          >
            Templates
          </h2>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
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
          <X className="stg:size-4" />
        </Button>
      </div>

      <div className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:p-4">
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
          icon={<LayoutTemplate className="stg:size-8" />}
          title="Connect this channel first"
          description={`${presentation.describeChannel(channel)} Templates become readable once the connection is complete.`}
        />
      );
    case "channel-off":
      return (
        <EmptyState
          variant="first-use"
          icon={<LayoutTemplate className="stg:size-8" />}
          title="This channel is turned off"
          description="Turn the channel on with the switch on its card, then check back here."
        />
      );
    case "not-proactive":
      return (
        <EmptyState
          variant="first-use"
          icon={<LayoutTemplate className="stg:size-8" />}
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
      <p className="stg:px-2 stg:py-6 stg:text-center stg:text-sm stg:text-destructive">
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
        icon={<LayoutTemplate className="stg:size-8" />}
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
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3 stg:px-1 stg:pb-3">
        <p className="stg:text-xs stg:text-muted-foreground">
          {templates.length} {templates.length === 1 ? "template" : "templates"}
          {" \u00b7 "}
          {sendable} ready to send
        </p>
        <WhatsAppManagerLink label="Manage in WhatsApp Manager" />
      </div>
      <ul className="stg:space-y-2">
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
    <li className="stg:rounded-lg stg:border stg:border-border stg:p-3">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1">
          <TruncatedText
            text={template.name}
            className="stg:text-sm stg:font-medium stg:text-foreground"
          />
          {/* (name, language) is the template's identity — each
              language is approved independently, so it always shows. */}
          <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
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
          className="stg:shrink-0"
        />
      </div>

      {template.bodyText && <TemplateBody body={template.bodyText} />}

      {template.rejectionReason && (
        <p className="stg:mt-2 stg:text-xs stg:text-destructive">
          Rejected: {template.rejectionReason}
        </p>
      )}
      {template.unsupportedReason && (
        <p className="stg:mt-2 stg:text-xs stg:text-warning" role="status">
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
    <p className="stg:mt-2 stg:whitespace-pre-wrap stg:text-xs stg:leading-relaxed stg:text-muted-foreground">
      {splitTemplateBody(body).map((segment, i) =>
        segment.kind === "placeholder" ? (
          <code
            key={i}
            className="stg:rounded stg:bg-muted-subtle stg:px-1 stg:font-mono stg:text-foreground"
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
    <span className="stg:shrink-0 stg:rounded stg:bg-muted-subtle stg:px-1.5 stg:py-0.5 stg:text-xs stg:text-muted-foreground">
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
        "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1 stg:text-xs stg:font-medium stg:text-foreground",
        "stg:underline stg:underline-offset-2 stg:hover:text-muted-foreground",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
      )}
    >
      {label}
      <ExternalLink aria-hidden="true" className="stg:size-3" />
    </a>
  );
}

function TemplatesSkeleton() {
  return (
    <div className="stg:space-y-2 stg:p-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="stg:h-20 stg:animate-pulse stg:rounded-lg stg:bg-muted-faint" />
      ))}
    </div>
  );
}
