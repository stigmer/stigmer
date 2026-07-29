"use client";

// Registers <stigmer-agent> on load (SSR-safe: no-ops without
// customElements) and teaches TSX its attributes. Runtime + types, one pair.
import "@stigmer/embed/define";
import "@stigmer/embed/jsx";

import { Dialog } from "@base-ui/react/dialog";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { useDocsColorMode } from "@/components/docs/useDocsColorMode";
import { useAskAi } from "./AskAiProvider";
import { ASK_AI_AGENT, ASK_AI_APP_ORIGIN, ASK_AI_ORG } from "./config";

/**
 * The Ask AI side panel: a non-modal Base UI dialog hosting the
 * `stigmer/stigmer-docs` agent through the `<stigmer-agent>` embed element.
 *
 * Non-modal on purpose — answers can take a while, so the reader must be
 * able to keep reading (and follow cited links) while the agent works; it
 * also avoids trapping focus around a cross-origin iframe, which no focus
 * trap can traverse. `disablePointerDismissal` keeps clicks into the docs
 * from closing the panel; `keepMounted` keeps the closed panel (hidden,
 * `display: none`) in the DOM so the iframe — and the conversation — survive
 * close/reopen. Escape only closes while focus is on panel chrome (keydowns
 * inside a cross-origin iframe never reach this document), so the close
 * button is the guaranteed affordance, not decoration.
 */
export function AskAiPanel() {
  const { open, setOpen, everOpened, status, retry, embedEpoch, elementRef } =
    useAskAi();
  // The site is dark-only, so this is a constant — which is exactly what the
  // embed element needs: it rebuilds its iframe (wiping the conversation) on
  // ANY attribute change, so the theme attribute must never vary mid-session.
  const colorMode = useDocsColorMode();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false} disablePointerDismissal>
      <Dialog.Portal keepMounted>
        <Dialog.Popup
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col",
            "border-l border-fd-border bg-fd-background text-fd-foreground shadow-lg",
            "transition-transform duration-300 motion-reduce:transition-none",
            "data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
          )}
        >
          <div className="flex items-start justify-between gap-2 border-b border-fd-border px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold">Ask AI</Dialog.Title>
              <Dialog.Description className="text-xs text-fd-muted-foreground">
                Answers come from the live Stigmer docs, with citations.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close Ask AI"
              className={cn(
                "rounded-md p-1.5 text-fd-muted-foreground transition-colors",
                "hover:bg-fd-accent hover:text-fd-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",
              )}
            >
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>

          {/* Latch-gated: nothing mounts (and no guest session is minted or
              billed) until the reader first opens the panel. After that the
              element stays mounted for the life of the page. */}
          <div className="relative min-h-0 flex-1 p-2">
            {everOpened &&
              (status === "unavailable" ? (
                <AskAiUnavailable onRetry={retry} />
              ) : (
                <>
                  {/* Every attribute below must stay referentially stable:
                      the element rebuilds its iframe — destroying the
                      conversation — on ANY attribute change. `key` is the
                      one sanctioned rebuild path (retry). */}
                  <stigmer-agent
                    key={embedEpoch}
                    ref={elementRef}
                    org={ASK_AI_ORG}
                    agent={ASK_AI_AGENT}
                    app-origin={ASK_AI_APP_ORIGIN}
                    theme={colorMode}
                    width="100%"
                    height="100%"
                  />
                  {status === "connecting" && (
                    <div
                      className={cn(
                        "absolute inset-2 flex flex-col items-center justify-center gap-2",
                        "rounded-xl bg-fd-background",
                      )}
                    >
                      <LoaderCircle
                        className="size-5 animate-spin text-fd-muted-foreground motion-reduce:animate-none"
                        aria-hidden
                      />
                      <p className="text-xs text-fd-muted-foreground" role="status">
                        Connecting to Ask AI…
                      </p>
                    </div>
                  )}
                </>
              ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Shown when the embed reported `stigmer:refused` (origin not allowed — what
 * local dev sees) or never signalled within the readiness timeout. The
 * reader opened this panel on purpose, so a silently hidden widget is not
 * acceptable here; name the failure and offer ways forward.
 */
function AskAiUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <CircleAlert className="size-5 text-fd-muted-foreground" aria-hidden />
      <p className="text-sm text-fd-muted-foreground">
        Ask AI isn&apos;t available right now. The search box still covers the
        docs, or let us know what you were looking for.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm text-fd-foreground transition-colors",
            "hover:bg-fd-accent hover:text-fd-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring",
          )}
        >
          Try again
        </button>
        <a
          href={`${SITE_CONFIG.githubUrl}/issues/new?labels=documentation`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-fd-muted-foreground underline underline-offset-4 transition-colors hover:text-fd-accent-foreground"
        >
          Report an issue
        </a>
      </div>
    </div>
  );
}
