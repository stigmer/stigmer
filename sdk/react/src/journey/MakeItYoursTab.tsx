"use client";

// The agent page's "Make it yours" tab: three short acts that turn the agent
// the journey made into the person's own, and one line to the next step.
//
// 1. Change what it does: the instructions in the same click-to-edit field
//    the Overview uses, saved through the page's own save (one copy of the
//    agent, one etag, so Overview shows the change at once). A save is a new
//    version; the card says so and offers a run on the sample (on their own
//    file, for an agent described in their own words, which has none).
//    Every save is kept under Versions; nothing here promises a way back.
// 2. Try your own file: the launcher, on this agent, with the message for a
//    file of their own written and the composer's attach invited.
// 3. Give it a skill: "Spreadsheet export", from `@stigmer/examples`. An
//    organization that has a skill of that name keeps it as it is (pushing
//    over it would make a new version of their skill); one that has none
//    gets it made from the shipped SKILL.md, by a person the server lets
//    make skills (`can_create_skill`, asked fail closed); anyone else is told
//    an admin adds skills, with no button. Then the reference is added to
//    the agent through the page's save.
//
// The page draws the tab only for a host that opts in, a journey agent and
// a person who may edit it (`AgentDetailView`'s `makeItYours`).

import { useCallback, useState, type ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { PushSkillRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";
import { isNotFound, type AgentInput, type ResourceRef } from "@stigmer/client";
import { asSentence, serverSentence } from "../internal/server-words.js";
import { EXAMPLES, skillById, type Example } from "@stigmer/examples";
import { cn } from "@stigmer/design-tokens";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import { Button } from "../button/Button.js";
import { LinkButton } from "../button/LinkButton.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea.js";
import { keptReference } from "../internal/kept-reference.js";
import { cardClasses } from "../internal/surface/Card.js";
import type { LaunchMode } from "../session/launch.js";
import { anchorLink, type RenderJourneyLink } from "./links.js";

/** The ready-made skill the tab offers. */
export const OFFERED_SKILL_ID = "spreadsheet-export";

/** Its shipped SKILL.md; examples/scripts/generate.test.mjs holds this id in the catalogue. */
const OFFERED_SKILL = skillById(OFFERED_SKILL_ID);

/** Where the tab's acts lead, in the host's routing. */
export interface MakeItYoursLinks {
  /**
   * The launcher on `agent`: on its example's sample, or on a file of the
   * person's own (`mode`). The console builds
   * `/?agent=<org>/<slug>&example=<id>&with=<mode>`, which its launcher
   * reads with `useLinkedLaunch`.
   */
  readonly launch: (input: { readonly agent: ResourceRef; readonly example: string | undefined; readonly mode: LaunchMode }) => string;
  /** Where the agent is put in its builder's own app (its "In your app" tab); the tab's last line links there. */
  readonly putInApp?: (agent: ResourceRef) => string;
  /** Draws each link; a plain anchor otherwise. */
  readonly renderLink?: RenderJourneyLink;
}

/** Props for {@link MakeItYoursTab}. */
export interface MakeItYoursTabProps {
  /** The agent, as the page holds it. */
  readonly agent: Agent;
  readonly links: MakeItYoursLinks;
  /** The page's own field save, so a save here shows on Overview at once. */
  readonly saveField: <K extends keyof AgentInput>(field: K, value: AgentInput[K]) => Promise<boolean>;
  readonly isSaving: boolean;
  /** The page's last failed save, attributed to its field. */
  readonly saveError: { readonly field: string; readonly message: string } | null;
  /** Opens the Versions tab. */
  readonly onOpenVersions: () => void;
}

// Every act here is an outlined Button or LinkButton: the page's one filled
// action is its header's Start session.

/** The example whose agent this is, or undefined for an agent described in the person's own words. */
function exampleOf(slug: string): Example | undefined {
  return EXAMPLES.find((example) => example.agent.slug === slug);
}

/** The "Make it yours" tab's body: three acts on the agent, and the next step. */
export function MakeItYoursTab({ agent, links, saveField, isSaving, saveError, onOpenVersions }: MakeItYoursTabProps) {
  const slug = agent.metadata?.slug ?? "";
  const ref: ResourceRef = { org: agent.metadata?.org ?? "", slug };
  const example = exampleOf(slug);
  const render = links.renderLink ?? anchorLink;
  const [saved, setSaved] = useState(false);

  const saveInstructions = useCallback(
    async (value: string) => {
      const ok = await saveField("instructions", value || undefined);
      if (ok) setSaved(true);
      return ok;
    },
    [saveField],
  );

  const rerun = example
    ? { href: links.launch({ agent: ref, example: example.id, mode: "sample" }), words: "Run it on the sample" }
    : { href: links.launch({ agent: ref, example: undefined, mode: "own" }), words: "Run it on your file" };

  return (
    <div className="stg:flex stg:flex-col stg:gap-4">
      <div className="stg:grid stg:gap-4 stg:md:grid-cols-3">
        <Card title="Change what it does" className="stg:md:col-span-3">
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            Its instructions are plain words. Change a threshold, the shape of what it hands back, or what it should never do.
          </p>
          <div className="stg:max-h-80 stg:overflow-y-auto stg:rounded-md stg:border stg:border-border stg:p-3">
            <InlineEditTextarea
              value={agent.spec?.instructions ?? ""}
              onSave={saveInstructions}
              isSaving={isSaving}
              error={saveError?.field === "instructions" ? saveError.message : undefined}
              placeholder="Add instructions for the agent"
              minRows={6}
            />
          </div>
          <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-3">
            {saved && (
              <>
                <span role="status" className="stg:text-sm stg:font-medium stg:text-foreground">
                  Saved as a new version.
                </span>
                <LinkButton href={rerun.href} variant="outline" size="xs" renderLink={render}>
                  {rerun.words}
                </LinkButton>
              </>
            )}
            <span className="stg:text-xs stg:text-muted-foreground">
              Every save is kept under{" "}
              <button type="button" onClick={onOpenVersions} className="stg:p-0 stg:text-xs stg:text-foreground stg:underline stg:underline-offset-2">
                Versions
              </button>
              .
            </span>
          </div>
        </Card>
        <Card title="Try your own file" className="stg:md:col-span-3 stg:lg:col-span-1">
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            Run it on a real file from your product, not the sample. It runs the same instructions; your file stays in this organization.
          </p>
          <div className="stg:mt-auto">
            <LinkButton href={links.launch({ agent: ref, example: example?.id, mode: "own" })} variant="outline" size="xs" renderLink={render}>
              Choose a file
            </LinkButton>
          </div>
        </Card>
        <SkillCard agent={agent} saveField={saveField} isSaving={isSaving} saveError={saveError} sample={example ? rerun : undefined} renderLink={render} />
      </div>
      {links.putInApp && (
        <div className={cn(cardClasses(), "stg:flex stg:flex-wrap stg:items-center stg:gap-3")}>
          <span className="stg:min-w-[12rem] stg:flex-1 stg:text-sm stg:text-muted-foreground">
            When it does the job your way, put it where your users are.
          </span>
          <LinkButton href={links.putInApp(ref)} variant="outline" size="xs" renderLink={render}>
            Put it in your app
          </LinkButton>
        </div>
      )}
    </div>
  );
}

function Card({ title, className, children }: { readonly title: string; readonly className?: string; readonly children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className={cn(cardClasses(), "stg:flex stg:flex-col stg:gap-3", className)}
    >
      <h3 className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Whether the organization has the offered skill: `true`, `false`, or undefined while asking. */
function useSkillExists(org: string, ask: boolean): { readonly exists: boolean | undefined; readonly error: Error | null; readonly recheck: () => void } {
  const stigmer = useStigmer();
  const { data, error, refetch } = useFetch<boolean | undefined>(
    ask && org !== ""
      ? async () => {
          try {
            await stigmer.skill.getByReference({ org, slug: OFFERED_SKILL_ID });
            return true;
          } catch (err) {
            if (isNotFound(err)) return false;
            throw err;
          }
        }
      : null,
    [stigmer, org, ask],
    undefined,
  );
  return { exists: data, error, recheck: refetch };
}

function SkillCard({
  agent,
  saveField,
  isSaving,
  saveError,
  sample,
  renderLink,
}: {
  readonly agent: Agent;
  readonly saveField: MakeItYoursTabProps["saveField"];
  readonly isSaving: boolean;
  readonly saveError: MakeItYoursTabProps["saveError"];
  readonly sample: { readonly href: string; readonly words: string } | undefined;
  readonly renderLink: RenderJourneyLink;
}) {
  const stigmer = useStigmer();
  const skill = OFFERED_SKILL;
  const org = agent.metadata?.org ?? "";
  const refs = agent.spec?.skillRefs ?? [];
  const has = refs.some((ref) => ref.slug === OFFERED_SKILL_ID);
  const { exists, error: readError, recheck } = useSkillExists(org, !has);
  // Making a skill is an act: asked only while the organization has none.
  const createSkill = useCheckPermission(!has && exists === false ? { kind: "organization", id: org } : null, "can_create_skill", { fail: "closed" });
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const add = useCallback(async (offered: NonNullable<typeof OFFERED_SKILL>) => {
    setAdding(true);
    setFailure(null);
    try {
      if (exists === false) {
        const { strToU8, zipSync } = await import("fflate");
        const artifact = zipSync({ "SKILL.md": strToU8(offered.text) });
        await stigmer.skill.push(create(PushSkillRequestSchema, { org, artifact }));
        // Made now: a retry after a failed save adds it, never pushes again.
        recheck();
      }
      const kept = refs.map((ref) => keptReference({ org: ref.org || org, slug: ref.slug, ...(ref.id ? { id: ref.id } : {}), ...(ref.version ? { version: ref.version } : {}) }));
      await saveField("skillRefs", [...kept, { org, slug: OFFERED_SKILL_ID }]);
    } catch (err) {
      setFailure(`${offered.name} wasn't added. ${serverSentence(err)} Try again.`);
    } finally {
      setAdding(false);
    }
  }, [exists, stigmer, org, refs, saveField, recheck]);

  /* v8 ignore next -- @preserve: examples/scripts/generate.test.mjs holds the id spreadsheet-export in the shipped catalogue */
  if (skill === undefined) return null;
  const refused = exists === false && !createSkill.isLoading && !createSkill.allowed;
  const ready = has || exists === true || (exists === false && createSkill.allowed);
  const saveFailed = saveError?.field === "skillRefs" ? `${skill.name} wasn't added. ${asSentence(saveError.message)} Try again.` : null;

  return (
    <Card title="Give it a skill" className="stg:md:col-span-3 stg:lg:col-span-2">
      {has ? (
        <>
          <p role="status" className="stg:m-0 stg:text-sm stg:text-foreground">
            <span className="stg:font-medium">{skill.name}</span> is on. Its runs hand back a .csv beside the report.
          </p>
          {sample && (
            <div className="stg:mt-auto">
              <LinkButton href={sample.href} variant="outline" size="xs" renderLink={renderLink}>
                {sample.words}
              </LinkButton>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            Skills add know-how. <span className="stg:font-medium stg:text-foreground">{skill.name}</span> also hands back the table as a .csv file
            your users can open in any spreadsheet.
          </p>
          {refused ? (
            <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">An admin of this organization adds skills.</p>
          ) : (
            <div className="stg:mt-auto">
              <Button variant="outline" size="xs" onClick={() => void add(skill)} disabled={!ready || adding || isSaving}>
                {adding ? "Adding…" : "Add it"}
              </Button>
            </div>
          )}
          {readError !== null && (
            <p role="alert" className="stg:m-0 stg:text-xs stg:text-destructive">
              Stigmer couldn&apos;t check whether {skill.name} is in this organization. {serverSentence(readError)} Reload the page to try
              again.
            </p>
          )}
          {(failure ?? saveFailed) !== null && (
            <p role="alert" className="stg:m-0 stg:text-xs stg:text-destructive">
              {failure ?? saveFailed}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
