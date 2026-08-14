"use client";

import { useId, useMemo, useState } from "react";
import { ArrowLeft, LayoutTemplate, Send, X } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { ChannelSendOutcome } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import type {
  ChannelTemplate,
  SendChannelMessageOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { DialogShell } from "../internal/DialogShell.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { splitTemplateBody } from "../channel/templatePresentation.js";
import { useChannelTemplateList } from "../channel/useChannelTemplateList.js";
import type { ConversationReplyPayload } from "./useConversationParticipation.js";

/** Props for {@link ConversationTemplatePickerDialog}. */
export interface ConversationTemplatePickerDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /**
   * The conversation's channel, addressed as the template registry
   * addresses it: `metadata.slug` + `metadata.org` (the registry is
   * derived from the channel's phone number, not stored on a resource).
   */
  readonly channelSlug: string;
  readonly org: string;
  /**
   * Send the chosen template as a staff reply — the SAME seam the
   * composer's textarea uses (`useConversationParticipation().reply`
   * or the host's wrapper around it), so a template send takes over,
   * settles, and reports outcomes exactly like a text send.
   */
  readonly onSend: (payload: ConversationReplyPayload) => Promise<SendChannelMessageOutput>;
  /** `true` while a reply is in flight. */
  readonly isSending: boolean;
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
 * Pick a provider-approved template, fill its variables, and send it as
 * a staff reply — the one lane WhatsApp offers a business once the
 * customer's 24-hour service window has closed (cloud#260).
 *
 * Where {@link ChannelTemplatesDialog} is the channel surface's
 * read-only registry *viewer* (every status, diagnosis copy), this is
 * the conversation surface's *picker*: it lists only approved
 * templates, marks the ones this platform version cannot send (an
 * `unsupported_reason` from the server, or an IMAGE header — the send
 * payload needs a public HTTPS asset no console surface can supply
 * yet), and walks the two steps of a send: choose, then fill the
 * `{{...}}` variables with a live preview of the exact body the
 * customer will receive.
 *
 * Outcome honesty mirrors the composer's contract: a `refused` outcome
 * keeps the dialog open with every filled value intact and renders the
 * server's corrective detail verbatim (the pre-check names missing
 * parameters, wrong languages, paused templates); a thrown failure does
 * the same with the transport error. `accepted` and `queued` close the
 * dialog — the ledger row exists, so the timeline shows the real item
 * with its true delivery status (the SDK never fabricates one).
 *
 * The body mounts only while open, so each opening fetches the registry
 * fresh (approval statuses change on the provider's side at any time)
 * and a closed dialog holds no draft — the same clean-reset rule that
 * keys the workbench's detail column (F-22).
 */
export function ConversationTemplatePickerDialog({
  open,
  onOpenChange,
  channelSlug,
  org,
  onSend,
  isSending,
  modal = true,
}: ConversationTemplatePickerDialogProps) {
  const titleId = useId();

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      // Template bodies are the content — the templates-dialog width.
      width="2xl"
      aria-labelledby={titleId}
    >
      {open && (
        <PickerBody
          titleId={titleId}
          channelSlug={channelSlug}
          org={org}
          onSend={onSend}
          isSending={isSending}
          onClose={() => onOpenChange(false)}
        />
      )}
    </DialogShell>
  );
}

/** Why a listed template cannot be sent from here, or null when it can. */
function unsendableReasonOf(template: ChannelTemplate): string | null {
  if (template.unsupportedReason) {
    return `Not sendable: ${template.unsupportedReason}`;
  }
  if (template.headerFormat === "IMAGE") {
    // The wire's header_image_link needs a public HTTPS asset at send
    // time; no console surface can supply one yet (v1 scope cut,
    // recorded on cloud#260).
    return "Not sendable from the console yet: this template's image header needs a hosted image at send time.";
  }
  return null;
}

/** The verbatim `{{ key }}` placeholder's inner key. */
function placeholderKeyOf(placeholder: string): string {
  return placeholder.replace(/^\{\{\s*|\s*\}\}$/g, "");
}

function PickerBody({
  titleId,
  channelSlug,
  org,
  onSend,
  isSending,
  onClose,
}: {
  readonly titleId: string;
  readonly channelSlug: string;
  readonly org: string;
  readonly onSend: (payload: ConversationReplyPayload) => Promise<SendChannelMessageOutput>;
  readonly isSending: boolean;
  readonly onClose: () => void;
}) {
  // Approved-only is the wire filter; unsupported/image-header entries
  // still list (marked unsendable) so "why is my template missing"
  // never needs a second surface.
  const { templates, isLoading, error } = useChannelTemplateList(channelSlug, org, {
    approvedOnly: true,
  });
  const [selected, setSelected] = useState<ChannelTemplate | null>(null);

  return (
    <div className="stg:flex stg:max-h-[75vh] stg:flex-col">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3 stg:border-b stg:border-border stg:px-5 stg:py-4">
        <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
          {selected !== null && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelected(null)}
              disabled={isSending}
              aria-label="Back to the template list"
            >
              <ArrowLeft className="stg:size-4" />
            </Button>
          )}
          <div className="stg:min-w-0">
            <h2
              id={titleId}
              className="stg:text-sm stg:font-semibold stg:text-popover-foreground"
            >
              {selected === null ? "Send a template" : selected.name}
            </h2>
            <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
              {selected === null
                ? "Approved templates deliver even after the 24-hour reply window closes."
                : "Fill the template's variables — the preview is the exact message the customer receives."}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close template picker">
          <X className="stg:size-4" />
        </Button>
      </div>

      <div className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:p-4">
        {selected === null ? (
          <TemplateChoiceList
            templates={templates}
            isLoading={isLoading}
            error={error}
            onChoose={setSelected}
          />
        ) : (
          <TemplateFillForm
            template={selected}
            onSend={onSend}
            isSending={isSending}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function TemplateChoiceList({
  templates,
  isLoading,
  error,
  onChoose,
}: {
  readonly templates: readonly ChannelTemplate[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly onChoose: (template: ChannelTemplate) => void;
}) {
  if (isLoading) {
    return (
      <div className="stg:space-y-2 stg:p-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="stg:h-16 stg:animate-pulse stg:rounded-lg stg:bg-muted-faint" />
        ))}
      </div>
    );
  }
  if (error) {
    // Past the fetch, the server's copy is the teaching state — its
    // refusals name the fix verbatim (the templates-dialog posture).
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
        title="No approved templates found"
        description={
          "Templates are authored and approved in WhatsApp Manager — " +
          "Stigmer keeps no copy. Approved templates appear here " +
          "automatically; the channel card's Templates dialog shows every " +
          "status, including pending and rejected ones."
        }
      />
    );
  }

  return (
    <ul className={cn(UNSTYLED_LIST, "stg:space-y-2")}>
      {templates.map((template) => {
        const unsendable = unsendableReasonOf(template);
        return (
          <li key={`${template.name}\u0000${template.language}`}>
            <button
              type="button"
              onClick={() => onChoose(template)}
              disabled={unsendable !== null}
              className={cn(
                "stg:w-full stg:rounded-lg stg:border stg:border-border stg:p-3 stg:text-left",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                unsendable === null
                  ? "stg:hover:border-ring stg:hover:bg-muted-faint"
                  : "stg:opacity-60",
              )}
            >
              <div className="stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1">
                <TruncatedText
                  text={template.name}
                  className="stg:text-sm stg:font-medium stg:text-foreground"
                />
                {/* (name, language) is the template's identity — each
                    language is approved independently. */}
                <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
                  {template.language}
                </span>
                {template.headerFormat && (
                  <span className="stg:shrink-0 stg:rounded stg:bg-muted-subtle stg:px-1.5 stg:py-0.5 stg:text-xs stg:text-muted-foreground">
                    {template.headerFormat} header
                  </span>
                )}
              </div>
              {template.bodyText && (
                <p className="stg:mt-1.5 stg:line-clamp-2 stg:whitespace-pre-wrap stg:text-xs stg:leading-relaxed stg:text-muted-foreground">
                  {template.bodyText}
                </p>
              )}
              {unsendable !== null && (
                <p className="stg:mt-1.5 stg:text-xs stg:text-warning">{unsendable}</p>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TemplateFillForm({
  template,
  onSend,
  isSending,
  onClose,
}: {
  readonly template: ChannelTemplate;
  readonly onSend: (payload: ConversationReplyPayload) => Promise<SendChannelMessageOutput>;
  readonly isSending: boolean;
  readonly onClose: () => void;
}) {
  const fieldIdPrefix = useId();
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [notice, setNotice] = useState<{
    readonly kind: "refused" | "error";
    readonly text: string;
  } | null>(null);

  const segments = useMemo(() => splitTemplateBody(template.bodyText), [template.bodyText]);
  // The declared parameters are the contract: names for NAMED
  // templates, positions ("1", "2", …) for POSITIONAL — the pre-check
  // refuses anything missing or extra, so the form asks for exactly
  // this list.
  const parameterKeys = template.parameterNames;
  const allFilled = parameterKeys.every((key) => (values[key] ?? "").trim() !== "");

  const handleSend = () => {
    setNotice(null);
    const parameters = Object.fromEntries(
      parameterKeys.map((key) => [key, (values[key] ?? "").trim()]),
    );
    onSend({
      kind: "template",
      name: template.name,
      // Always the chosen entry's language: (name, language) is the
      // identity we listed, and sending it structurally avoids the
      // wire's ambiguous-language refusal.
      language: template.language,
      parameters,
    }).then(
      (output) => {
        if (output.outcome === ChannelSendOutcome.refused) {
          // The words never left; every filled value stays for the
          // correction the detail asks for (the composer's contract).
          setNotice({
            kind: "refused",
            text: output.detail || "The provider refused this template.",
          });
        } else {
          // accepted or queued: the ledger row exists — the timeline
          // shows the real item with its true delivery status.
          onClose();
        }
      },
      (err) => {
        setNotice({ kind: "error", text: getUserMessage(err) });
      },
    );
  };

  return (
    <div className="stg:space-y-4">
      {notice && (
        <p className="stg:text-xs stg:text-destructive" role="status">
          {notice.text}
        </p>
      )}

      {parameterKeys.length > 0 && (
        <div className="stg:space-y-3">
          {parameterKeys.map((key) => (
            <div key={key}>
              <label
                htmlFor={`${fieldIdPrefix}-${key}`}
                className="stg:mb-1 stg:block stg:text-xs stg:font-medium stg:text-foreground"
              >
                {key}
              </label>
              <input
                id={`${fieldIdPrefix}-${key}`}
                type="text"
                value={values[key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                disabled={isSending}
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-background",
                  "stg:px-3 stg:py-2 stg:text-sm stg:text-foreground stg:placeholder:text-muted-foreground-faint",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="stg:mb-1 stg:text-xs stg:font-medium stg:text-foreground">Preview</p>
        <p className="stg:whitespace-pre-wrap stg:rounded-md stg:border stg:border-border stg:bg-muted-faint stg:p-3 stg:text-sm stg:leading-relaxed stg:text-foreground">
          {segments.map((segment, i) => {
            if (segment.kind === "text") {
              return <span key={i}>{segment.value}</span>;
            }
            const value = (values[placeholderKeyOf(segment.value)] ?? "").trim();
            return value !== "" ? (
              <span key={i}>{value}</span>
            ) : (
              <code
                key={i}
                className="stg:rounded stg:bg-muted-subtle stg:px-1 stg:font-mono stg:text-muted-foreground"
              >
                {segment.value}
              </code>
            );
          })}
        </p>
      </div>

      <div className="stg:flex stg:justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSend}
          disabled={!allFilled || isSending}
          aria-label="Send template"
        >
          {isSending ? <SpinnerIcon /> : <Send aria-hidden="true" className="stg:size-4" />}
          {isSending ? "Sending…" : "Send template"}
        </Button>
      </div>
    </div>
  );
}
