"use client";

// Makes the agent a newcomer picked on the launcher's first question, and
// hands back everything the first run needs: the agent's reference, the
// sample files and the first message.
//
// An example's agent is made with `create`, never `apply`: create is refused
// when the slug is taken (the server's duplicate check), so nothing an
// organization already has is ever written over. A taken slug is read and
// used as it is, whether a previous pick made it or the organization made
// its own agent of that name; no marker label is needed (an enforcing
// authorizer refuses a client-set `stigmer.ai/*` label anyway). An agent
// described in the person's own words never reuses: reusing `your-agent`
// would silently drop their words, so a taken name is tried again under the
// next number, and the duplicate check stays the only judge.

import { useCallback, useState } from "react";
import type { AgentInput, ResourceRef } from "@stigmer/client";
import { StigmerError } from "@stigmer/client";
import { serverSentence } from "../../internal/server-words.js";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Example } from "@stigmer/examples";
import { useStigmer } from "@stigmer/react-core";
import { OWN_AGENT_TRIES, ownAgentSlug } from "@stigmer/examples/journey";

export { OWN_AGENT_TRIES };

/** The sentence added to an agent described in the person's own words, so what it makes comes back as a file. */
export const OWN_AGENT_FILE_LINE = "When you make something for the person you're helping, save it as a file in your outputs folder.";

/** The name an agent described in the person's own words is made under, before any number. */
export const OWN_AGENT_NAME = "Your agent";

/** What the launcher holds once a pick has made its agent. */
export interface FirstChoice {
  /** The example picked, or `undefined` for an agent described in the person's own words. */
  readonly example: Example | undefined;
  /** The agent the first run uses. */
  readonly agentRef: ResourceRef;
  /** The agent's name, as the person reads it ("Variance Reporter"). */
  readonly agentName: string;
  /** The sample files the first message sends; none for a described agent. */
  readonly files: readonly File[];
  /** The first message, written for the person; undefined for a described agent. */
  readonly message: string | undefined;
}

/** What is being made right now: an example's id, or `"own"`. */
export type FirstChoicePending = string | "own" | null;

/** A pick that could not make its agent, said in plain words. */
export interface FirstChoiceFailure {
  /** What was being made: an example's id, or `"own"`. */
  readonly of: string;
  /** What happened, the line read first ("Variance Reporter wasn't made."). */
  readonly title: string;
  /** Why, and what was not lost. */
  readonly detail: string;
}

/** Return value of {@link useStartFromExample}. */
export interface UseStartFromExampleReturn {
  /** Makes (or finds) the example's agent; resolves with the choice, or `null` when it failed (see `failure`). */
  readonly pickExample: (example: Example) => Promise<FirstChoice | null>;
  /** Makes an agent from the person's own words; resolves with the choice, or `null` when it failed. */
  readonly describeOwn: (words: string) => Promise<FirstChoice | null>;
  /** What is being made right now, or `null`. */
  readonly pending: FirstChoicePending;
  /** The last pick's failure, or `null`. */
  readonly failure: FirstChoiceFailure | null;
  /** Clears `failure`. */
  readonly clearFailure: () => void;
}

/** The agent's reference as the server stored it, falling back to what was asked. */
function refOf(agent: Agent, org: string, slug: string): ResourceRef {
  return { org: agent.metadata?.org || org, slug: agent.metadata?.slug || slug };
}

/** Whether the server refused because the name is taken. */
function nameTaken(error: unknown): boolean {
  return error instanceof StigmerError && error.code === "already-exists";
}

/** What a failed pick says: who may, for a refusal; the server's own words otherwise. */
function failureOf(of: string, agentName: string, error: unknown): FirstChoiceFailure {
  const title = `${agentName} wasn't made.`;
  if (error instanceof StigmerError && error.code === "permission-denied") {
    return { of, title, detail: "You can't make agents in this organization. An admin can make it and share it with you." };
  }
  return { of, title, detail: `${serverSentence(error)} Nothing in your organization changed.` };
}

/** The files a first run attaches, made from an example's inlined samples. */
export function sampleFiles(example: Example): File[] {
  return example.samples.map((sample) => new File([sample.text], sample.name, { type: sample.type }));
}

/** The instructions of an agent described in the person's own words: their words as written, and the one line about files. */
export function ownInstructions(words: string): string {
  return `${words.trim()}\n\n${OWN_AGENT_FILE_LINE}`;
}

/** A short description from the person's words: their first line, cut at a word near 160 characters. */
function ownDescription(words: string): string {
  const line = words.trim().split("\n")[0] ?? "";
  if (line.length <= 160) return line;
  const cut = line.slice(0, 160);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 120))}…`;
}

/**
 * The launcher's first-question picks: make an example's agent (or find
 * the one already made) and hand back the agent, its sample files and its
 * first message; or make an agent from the person's own words.
 *
 * @param org - The organization the agent is made in (id or slug).
 *
 * @example
 * ```tsx
 * import { EXAMPLES } from "@stigmer/examples";
 *
 * function PickFirst({ org, onChosen }: { org: string; onChosen: (choice: FirstChoice) => void }) {
 *   const { pickExample, pending } = useStartFromExample(org);
 *   const example = EXAMPLES[0];
 *   return (
 *     <button disabled={pending !== null} onClick={() => void pickExample(example).then((c) => c && onChosen(c))}>
 *       {example.name}
 *     </button>
 *   );
 * }
 * ```
 */
export function useStartFromExample(org: string): UseStartFromExampleReturn {
  const stigmer = useStigmer();
  const [pending, setPending] = useState<FirstChoicePending>(null);
  const [failure, setFailure] = useState<FirstChoiceFailure | null>(null);
  const clearFailure = useCallback(() => setFailure(null), []);

  const pickExample = useCallback(
    async (example: Example): Promise<FirstChoice | null> => {
      const { agent } = example;
      setPending(example.id);
      setFailure(null);
      try {
        const input: AgentInput = {
          name: agent.name,
          slug: agent.slug,
          org,
          description: agent.description,
          instructions: agent.instructions,
          disallowedTools: [...agent.disallowedTools],
        };
        let made: Agent;
        try {
          made = await stigmer.agent.create(input);
        } catch (error) {
          if (!nameTaken(error)) throw error;
          // Taken: use the agent of that name as it is, never written over.
          made = await stigmer.agent.getByReference({ org, slug: agent.slug });
        }
        return {
          example,
          agentRef: refOf(made, org, agent.slug),
          agentName: made.metadata?.name || agent.name,
          files: sampleFiles(example),
          message: example.message,
        };
      } catch (error) {
        setFailure(failureOf(example.id, agent.name, error));
        return null;
      } finally {
        setPending(null);
      }
    },
    [stigmer, org],
  );

  const describeOwn = useCallback(
    async (words: string): Promise<FirstChoice | null> => {
      setPending("own");
      setFailure(null);
      try {
        for (let n = 1; n <= OWN_AGENT_TRIES; n++) {
          const name = n === 1 ? OWN_AGENT_NAME : `${OWN_AGENT_NAME} ${n}`;
          const slug = ownAgentSlug(n);
          try {
            const made = await stigmer.agent.create({
              name,
              slug,
              org,
              description: ownDescription(words),
              instructions: ownInstructions(words),
            });
            return { example: undefined, agentRef: refOf(made, org, slug), agentName: made.metadata?.name || name, files: [], message: undefined };
          } catch (error) {
            if (!nameTaken(error)) throw error;
          }
        }
        setFailure({
          of: "own",
          title: `${OWN_AGENT_NAME} wasn't made.`,
          detail: `This organization already has ${OWN_AGENT_TRIES} agents named ${OWN_AGENT_NAME}. Rename or remove one, then try again.`,
        });
        return null;
      } catch (error) {
        setFailure(failureOf("own", OWN_AGENT_NAME, error));
        return null;
      } finally {
        setPending(null);
      }
    },
    [stigmer, org],
  );

  return { pickExample, describeOwn, pending, failure, clearFailure };
}
