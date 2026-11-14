"use client";

// The launcher's two readiness faces. When nothing on any engine can run,
// the connect panel takes the composer's place: the provider the chosen
// model needs, as Models & providers draws it, with the act this person can
// take right there (an admin saves the key, a member learns who does, a
// laptop gets its command), so a new person's first screen is the step that
// gets them a first answer. To the person who adds the key it first says
// why Stigmer wants it (their agents think with a model, on their own key,
// billed to them by the provider); to a member or a server's user it says
// whose key it is instead, since theirs would be untrue. When another model could run but the chosen one
// cannot, one line above the composer says why Send is held and what fixes
// it. Both read the hub's data, so the launcher and the hub never disagree.

import { Fragment, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { DEFAULT_MODELS_HUB_HREF } from "../billing/refusals.js";
import { type HarnessOption } from "@stigmer/react-core";
import { HARNESS_META } from "@stigmer/react-core/internal";
import { ProviderKeyCheck } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import { keyingFace, ProviderCard, providerFace, type ProviderFace } from "./hub/ProviderCard.js";
import type { ModelsHubData } from "./hub/ModelsHub.js";
import { keyPhrase, keyReason, presentationOf, type SentencePart } from "./provider-presentation.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

/** Props for {@link ConnectProviderPanel}. */
export interface ConnectProviderPanelProps {
  /** The hub's data for the launcher's organization, from `useModelsHubData`. */
  readonly hub: ModelsHubData;
  /** The engine the launcher has chosen. */
  readonly harness: HarnessOption;
  /** The provider to connect: the one the chosen model needs. */
  readonly provider: string;
  /** The chosen model's name, as the picker shows it. */
  readonly modelName: string;
  /** Where Models & providers is, in the host's routing. Defaults to {@link DEFAULT_MODELS_HUB_HREF}. */
  readonly modelsHubHref?: string;
  /**
   * Whether the panel draws its own heading. A screen that already says
   * what comes next above it (the launcher's chosen example) passes
   * `false`, and the panel opens on its lead sentence. @default true
   */
  readonly showHeading?: boolean;
  /**
   * Called after this panel's card saves a key, beside the refresh, so the
   * launcher can say once what the save's check found.
   */
  readonly onKeySaved?: () => void;
}

/**
 * The launcher's first screen while nothing can run: the provider the
 * chosen model needs, with the act this person can take, in the composer's
 * place. Once a key lands, the launcher asks the server again and the
 * composer comes back with Send enabled.
 */
export function ConnectProviderPanel({
  hub,
  harness,
  provider,
  modelName,
  modelsHubHref = DEFAULT_MODELS_HUB_HREF,
  showHeading = true,
  onKeySaved,
}: ConnectProviderPanelProps) {
  const report = hub.providers?.find((entry) => entry.provider === provider);
  if (report === undefined || hub.models === null) return null;
  const others = (hub.providers ?? []).filter((entry) => entry.provider !== provider);
  const name = presentationOf(provider).name;
  const face = providerFace(report.availability, hub.viewer);
  // The person who adds the key hears why first; anyone else, which model
  // waits on whose key.
  const lead = keyingFace(face) ? keyReason(provider) : `${modelName} on ${HARNESS_META[harness].label} runs on ${name}.`;
  const then =
    face === "local-command"
      ? "Give this machine's runner a key, and you can send your first task."
      : face === "runners-line"
        ? `Once this server's runners have ${keyPhrase(provider)}, you can send your first task.`
        : `Once ${hub.orgName} has ${keyPhrase(provider)}, you can send your first task.`;
  return (
    <div className="stg:space-y-4">
      <div className="stg:text-center">
        {showHeading && <h1 className="stg:text-lg stg:font-medium stg:text-foreground">Connect a model provider to start</h1>}
        {hub.isLoading ? (
          // Who adds the key is not known until the permission answers: an
          // admin would read the member's lead, then the reason, so the
          // lead holds its place until then.
          // The card below says what is being checked; this only holds the place.
          <LoadingRegion
            className={cn("stg:mx-auto stg:h-5 stg:max-w-md stg:animate-pulse stg:rounded stg:bg-muted", showHeading && "stg:mt-1")}
          />
        ) : (
          <p className={showHeading ? "stg:mt-1 stg:text-sm stg:text-muted-foreground" : "stg:m-0 stg:text-sm stg:text-muted-foreground"}>
            {lead} {then}
          </p>
        )}
      </div>
      {hub.isLoading ? (
        <LoadingRegion label="Checking who can connect a provider" className="stg:h-40 stg:animate-pulse stg:rounded-xl stg:bg-muted" />
      ) : (
      <ProviderCard
        org={hub.org}
        orgName={hub.orgName}
        report={report}
        storedKey={hub.keyOf(provider)}
        parentOrgName={hub.parentOrgNameOf(provider)}
        viewer={hub.viewer}
        prominent
        initiallyEditing
        models={hub.models.filter((model) => model.provider === provider)}
        onChanged={() => {
          hub.refresh();
          onKeySaved?.();
        }}
      />
      )}
      <p className="stg:text-center stg:text-xs stg:text-muted-foreground">
        {others.length > 0 && <>Or connect {others.map((entry) => presentationOf(entry.provider).name).join(" or ")}: </>}
        <a
          href={modelsHubHref}
          className="stg:font-medium stg:text-foreground stg:underline stg:underline-offset-2 stg:hover:text-foreground-hover"
        >
          every provider is in Models &amp; providers
        </a>
      </p>
    </div>
  );
}

/** Whether the key that serves `provider` was saved without the provider answering the check. */
export function keyUnchecked(hub: ModelsHubData, provider: string): boolean {
  return hub.keyOf(provider)?.check === ProviderKeyCheck.unchecked;
}

/** Props for {@link KeySavedUncheckedNote}. */
export interface KeySavedUncheckedNoteProps {
  /** The provider whose key was just saved without the provider answering the check. */
  readonly provider: string;
}

/**
 * One quiet line above the composer, right after a key is saved that the
 * provider did not answer the check for: the key is kept, Send works, and
 * a key that turns out wrong is said by the run itself. Shown once, by the
 * launcher that saved it; Models & providers keeps saying it on the card.
 */
export function KeySavedUncheckedNote({ provider }: KeySavedUncheckedNoteProps) {
  const name = presentationOf(provider).name;
  return (
    // A div, not a paragraph: the launcher's column spaces its rows, and a
    // paragraph's margin reset would set the note flush on the composer.
    <div
      role="status"
      data-stgm-key-unchecked=""
      className="stg:rounded-xl stg:border stg:border-border stg:bg-card stg:px-4 stg:py-2.5 stg:text-xs stg:text-muted-foreground"
    >
      {name} didn&apos;t answer, so the key is saved but not checked. You can send now; if the key doesn&apos;t work,
      the run stops and says why.
    </div>
  );
}

/** Props for {@link ModelNeedsProvider}. */
export interface ModelNeedsProviderProps {
  /** The hub's data for the launcher's organization, from `useModelsHubData`. */
  readonly hub: ModelsHubData;
  /** The provider the chosen model needs. */
  readonly provider: string;
  /** The chosen model's name, as the picker shows it. */
  readonly modelName: string;
  /** Where Models & providers is, in the host's routing. Defaults to {@link DEFAULT_MODELS_HUB_HREF}. */
  readonly modelsHubHref?: string;
}

/** The words of the held Send's reason, the notice's first sentence: "Connect Anthropic to run Claude Sonnet 4.6." */
export function connectReason(provider: string, modelName: string): string {
  return `Connect ${presentationOf(provider).name} to run ${modelName}.`;
}

/**
 * One line above the composer while the chosen model cannot run here but
 * another could: what the model needs, the act this person can take, and a
 * link to Models & providers. Send is held while it shows.
 */
export function ModelNeedsProvider({
  hub,
  provider,
  modelName,
  modelsHubHref = DEFAULT_MODELS_HUB_HREF,
}: ModelNeedsProviderProps) {
  const report = hub.providers?.find((entry) => entry.provider === provider);
  if (report === undefined) return null;
  const name = presentationOf(provider).name;
  const face = providerFace(report.availability, hub.viewer);
  return (
    <div
      data-stgm-model-needs-provider=""
      className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-3 stg:gap-y-1 stg:rounded-xl stg:border stg:border-border stg:bg-card stg:px-4 stg:py-2.5"
    >
      <p className="stg:min-w-0 stg:flex-1 stg:text-xs stg:text-foreground">
        {connectReason(provider, modelName)}{" "}
        <span className="stg:text-muted-foreground">
          <ActSentence face={face} provider={provider} orgName={hub.orgName} />
        </span>
      </p>
      <a
        href={modelsHubHref}
        className="stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1 stg:text-xs stg:font-medium stg:text-foreground stg:hover:text-foreground-hover"
      >
        {face === "admin-form" ? `Connect ${name}` : "Models & providers"}
        <ArrowRight aria-hidden className="stg:size-3" />
      </a>
    </div>
  );
}

/** What {@link ActSentence} says a sentence about. */
interface ActSubject {
  readonly name: string;
  readonly provider: string;
  readonly orgName: string;
}

/**
 * What this person can do about the missing provider, in one sentence, by
 * the act the card offers; a provider that serves, or one the server cannot
 * see, needs no sentence. Keyed by every face, so a new one cannot be left
 * without its words.
 */
const ACT_SENTENCES: Readonly<Record<ProviderFace, ((subject: ActSubject) => ReactNode) | null>> = {
  "admin-form": ({ name }) => <>Send waits until {name} is connected, or pick a model marked ready.</>,
  "member-line": ({ orgName }) => <>An admin of {orgName} connects it; until then, pick a model marked ready.</>,
  "local-command": ({ name, provider }) => {
    const setup = presentationOf(provider).runnerSetup;
    return setup === null ? (
      <>This machine&apos;s runner has no {name} key; pick a model marked ready.</>
    ) : (
      <Sentence parts={setup.inline} />
    );
  },
  "runners-line": ({ name }) => <>This server&apos;s runners have no {name} key; whoever runs them gives them one.</>,
  served: null,
  unknown: null,
};

/** What this person can do about the missing provider, in one sentence. */
function ActSentence({
  face,
  provider,
  orgName,
}: {
  readonly face: ProviderFace;
  readonly provider: string;
  readonly orgName: string;
}) {
  return ACT_SENTENCES[face]?.({ name: presentationOf(provider).name, provider, orgName }) ?? null;
}

function Sentence({ parts }: { readonly parts: readonly SentencePart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {typeof part === "string" ? (
            part
          ) : (
            <code className="stg:rounded stg:bg-muted-subtle stg:px-1 stg:font-mono stg:text-foreground">{part.code}</code>
          )}
        </Fragment>
      ))}
    </>
  );
}
