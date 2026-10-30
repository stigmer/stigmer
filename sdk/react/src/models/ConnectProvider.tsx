"use client";

// The launcher's two readiness faces. When nothing on any engine can run,
// the connect panel takes the composer's place: the provider the chosen
// model needs, as Models & providers draws it, with the act this person can
// take right there (an admin saves the key, a member learns who does, a
// laptop gets its command), so a new person's first screen is the step that
// gets them a first answer. When another model could run but the chosen one
// cannot, one line above the composer says why Send is held and what fixes
// it. Both read the hub's data, so the launcher and the hub never disagree.

import { Fragment, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { DEFAULT_MODELS_HUB_HREF } from "../billing/ProviderKeyNotice.js";
import { type HarnessOption } from "@stigmer/react-core";
import { HARNESS_META } from "@stigmer/react-core/internal";
import { ProviderCard, providerFace, type ProviderFace } from "./hub/ProviderCard.js";
import type { ModelsHubData } from "./hub/ModelsHub.js";
import { keyPhrase, presentationOf, type SentencePart } from "./provider-presentation.js";
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
}: ConnectProviderPanelProps) {
  const report = hub.providers?.find((entry) => entry.provider === provider);
  if (report === undefined || hub.models === null) return null;
  const others = (hub.providers ?? []).filter((entry) => entry.provider !== provider);
  const name = presentationOf(provider).name;
  const face = providerFace(report.availability, hub.viewer);
  const runs = `${modelName} on ${HARNESS_META[harness].label} runs on ${name}.`;
  const then =
    face === "local-command"
      ? "Give this machine's runner a key, and you can send your first task."
      : face === "runners-line"
        ? `Once this server's runners have ${keyPhrase(provider)}, you can send your first task.`
        : `Once ${hub.orgName} has ${keyPhrase(provider)}, you can send your first task.`;
  return (
    <div className="stg:space-y-4">
      <div className="stg:text-center">
        <h1 className="stg:text-lg stg:font-medium stg:text-foreground">Connect a model provider to start</h1>
        <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
          {runs} {then}
        </p>
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
        onChanged={hub.refresh}
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
