"use client";

// What a new organization's dashboard says in place of four zeros: the
// first things to do, in order, each a link the host routes. A step is
// shown done when the server says so (a provider serves a model; the
// organization has an agent), and the
// step a person may not take (creating an agent, for a viewer) says who
// can, rather than offering a link the server would refuse; its link
// appears only once the server has said yes (`can_create_agent`, asked fail
// closed, so a failed check offers none).

import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { useAgentList } from "../agent/useAgentList.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useModelReadiness } from "../models/useModelReadiness.js";

/** Where each first step leads, as the host routes it. */
export interface DashboardFirstStepLinks {
  /** Models & providers, where a provider key is connected. */
  readonly connectProvider: string;
  /**
   * Where a newcomer says what their agent should do: the launcher, whose
   * first question offers the example jobs and "Describe your own".
   */
  readonly createAgent: string;
  /** The launcher, where a session starts. */
  readonly startSession: string;
}

/** Props for {@link DashboardFirstSteps}. */
export interface DashboardFirstStepsProps {
  readonly org: string;
  readonly links: DashboardFirstStepLinks;
  /** Draws a link; a host with its own router passes its link component. A plain anchor otherwise. */
  readonly renderLink?: (props: { readonly href: string; readonly className: string; readonly children: ReactNode }) => ReactNode;
  readonly className?: string;
}

const anchor: NonNullable<DashboardFirstStepsProps["renderLink"]> = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/** A new organization's first steps: connect a provider, say what the agent should do, start a session. */
export function DashboardFirstSteps({ org, links, renderLink = anchor, className }: DashboardFirstStepsProps) {
  const headingId = useId();
  const { providers } = useModelReadiness(org);
  // Asked fail closed: making an agent is an act, so a check in flight or
  // one that failed offers no link (the shared `useCanCreateAgent` fails
  // open, for the create surfaces that gate themselves on the server).
  const createAgent = useCheckPermission(org ? { kind: "organization", id: org } : null, "can_create_agent", { fail: "closed" });
  const providerServed = (providers ?? []).some((provider) => provider.availability.state === "served");
  // Done once the organization has an agent, by the server's own list.
  const { agents } = useAgentList(org || null, { pageSize: 1 });
  const hasAgent = agents.length > 0;
  // Making an agent is an act: its link appears only on the server's yes,
  // never while the check is in flight; a refusal says who can instead.
  const mayCreateAgent = createAgent.allowed;
  // Only the server's no says who may; a failed check claims nothing.
  const refusedCreateAgent = !createAgent.isLoading && createAgent.error === null && !createAgent.allowed;

  const steps: readonly Step[] = [
    {
      title: "Connect a model provider",
      body: "Add an Anthropic or OpenAI key, so your agents have a model to think with.",
      href: links.connectProvider,
      act: "Connect a provider",
      done: providerServed,
    },
    {
      title: "Say what your agent should do",
      body: refusedCreateAgent
        ? "An admin of this organization makes agents; you can run the ones shared with you."
        : "Pick an example or describe your own; it runs on a sample file.",
      href: mayCreateAgent ? links.createAgent : undefined,
      act: "Pick an example",
      done: hasAgent,
    },
    {
      title: "Start a session",
      body: "Ask an agent for something and watch it work: what it reads, what it runs, what it makes.",
      href: links.startSession,
      act: "Start a session",
      done: false,
    },
  ];

  return (
    <section aria-labelledby={headingId} className={cn("stg:rounded-xl stg:border stg:border-border stg:bg-card", className)}>
      <div className="stg:border-b stg:border-border stg:px-5 stg:py-4">
        <h2 id={headingId} className="stg:m-0 stg:text-base stg:font-semibold stg:text-foreground">
          Get your organization running
        </h2>
        <p className="stg:m-0 stg:mt-0.5 stg:text-sm stg:text-muted-foreground">Nothing has run here yet. Three steps to a first answer.</p>
      </div>
      <ol className="stg:m-0 stg:list-none stg:divide-y stg:divide-border stg:p-0">
        {steps.map((step, index) => (
          <li key={step.title} className="stg:flex stg:items-center stg:gap-4 stg:px-5 stg:py-4">
            <span
              aria-hidden="true"
              className={cn(
                "stg:flex stg:size-7 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:text-xs stg:font-semibold",
                step.done ? "stg:bg-foreground stg:text-background" : "stg:border stg:border-border stg:text-muted-foreground",
              )}
            >
              {step.done ? <Check className="stg:size-3.5" /> : index + 1}
            </span>
            <div className="stg:min-w-0 stg:flex-1">
              <p className={cn("stg:m-0 stg:text-sm stg:font-medium", step.done ? "stg:text-muted-foreground stg:line-through" : "stg:text-foreground")}>
                {step.title}
                {step.done && <span className="stg:sr-only"> (done)</span>}
              </p>
              <p className="stg:m-0 stg:mt-0.5 stg:text-sm stg:text-muted-foreground">{step.body}</p>
            </div>
            {!step.done &&
              step.href !== undefined &&
              renderLink({
                href: step.href,
                className:
                  "stg:shrink-0 stg:rounded-md stg:border stg:border-border stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-foreground stg:no-underline stg:hover:bg-muted-subtle",
                children: step.act,
              })}
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Step {
  readonly title: string;
  readonly body: string;
  readonly href: string | undefined;
  readonly act: string;
  readonly done: boolean;
}
