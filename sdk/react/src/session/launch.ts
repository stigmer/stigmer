"use client";

// One launch into the launcher: the agent it starts on, and what the
// composer starts with (files, a written message, a heading). A launch is
// keyed, and the launcher mounts a fresh composer for each key, because a
// composer reads its agent, files and message once, when it mounts; the
// hosts keep the launcher mounted while a session is open, so a second link
// into it must not find the first one's composer.
//
// The agent page's "Make it yours" tab links into the launcher with
// `?agent=<org>/<slug>&example=<id>&with=sample|own`. `useLinkedLaunch`
// turns each arrival of those parameters into a new launch (the same link
// clicked twice is two launches, because the hosts clean the address after
// each), and `exampleLaunch` builds one from an example: on the sample, its
// files and its first message; on the person's own file, no files, the
// example's message for a file of their own, and the composer's attach
// invited. No agent is made on this path: the agent already exists.

import { useState } from "react";
import type { ResourceRef } from "@stigmer/client";
import { exampleById, type Example } from "@stigmer/examples";
import { sampleFiles } from "./first-question/useStartFromExample.js";

/** One launch into the launcher. See {@link NewSessionViewerProps.launch}. */
export interface SessionLaunch {
  /** Identifies this launch: a new key mounts a new composer. */
  readonly key: string;
  /** The agent the conversation starts on. */
  readonly agentRef: ResourceRef;
  /** Files the composer starts with. */
  readonly files?: readonly File[];
  /** The message the composer starts with, written for the person to send or change. */
  readonly message?: string;
  /** The launcher's heading for this launch; its usual heading otherwise. */
  readonly heading?: string;
  /** The composer's placeholder for this launch. */
  readonly placeholder?: string;
}

/** Where a launch runs the agent: on the example's sample, or on a file of the person's own. */
export type LaunchMode = "sample" | "own";

/**
 * A launch of `agentRef` on an example's sample (its files and first
 * message) or on the person's own file (no files, the example's message for
 * a file of their own, the composer's attach invited). `example` is
 * undefined for an agent described in the person's own words, which has no
 * sample: its launch is always on their own file, with no message.
 */
export function exampleLaunch(input: {
  readonly key: string;
  readonly agentRef: ResourceRef;
  readonly example: Example | undefined;
  readonly mode: LaunchMode;
}): SessionLaunch {
  const { key, agentRef, example, mode } = input;
  if (mode === "sample" && example !== undefined) {
    return { key, agentRef, files: sampleFiles(example), message: example.message, heading: "Run it on the sample" };
  }
  return {
    key,
    agentRef,
    message: example?.ownFileMessage,
    heading: "Try it on your own file",
    placeholder: "Attach your file, then send",
  };
}

/** The launch parameters as a host's router reads them; `null` for each one absent. */
export interface LaunchParams {
  /** `org/slug` of the agent. */
  readonly agent: string | null;
  /** An example's id, for its sample and its messages. */
  readonly example: string | null;
  /** `sample` or `own`; a launch is read only when this is present. */
  readonly with: string | null;
}

/** An `org/slug` parameter as a reference, or undefined when malformed. */
function refOf(value: string | null): ResourceRef | undefined {
  if (!value) return undefined;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { org: value.slice(0, slash), slug: value.slice(slash + 1) };
}

/**
 * The launch a host's address names, if any: each time `?with=` arrives with
 * a well-formed `?agent=`, a new launch (a new key); while the parameters
 * are absent, the last launch is kept, so a host may clean its address
 * after reading it. Returns undefined until a launch has arrived.
 *
 * @example
 * ```tsx
 * function Launcher({ org, params, onOpen }: { org: string; params: URLSearchParams; onOpen: (id: string) => void }) {
 *   const launch = useLinkedLaunch({ agent: params.get("agent"), example: params.get("example"), with: params.get("with") });
 *   return <NewSessionViewer org={org} onSessionCreated={onOpen} launch={launch} />;
 * }
 * ```
 */
export function useLinkedLaunch(params: LaunchParams): SessionLaunch | undefined {
  const [held, setHeld] = useState<{ readonly signature: string | null; readonly count: number; readonly launch: SessionLaunch | undefined }>({
    signature: null,
    count: 0,
    launch: undefined,
  });
  const mode: LaunchMode | undefined = params.with === "sample" || params.with === "own" ? params.with : undefined;
  const agentRef = refOf(params.agent);
  const signature = mode !== undefined && agentRef !== undefined ? `${params.agent ?? ""}|${params.example ?? ""}|${mode}` : null;
  // Set during render, as React allows for a component's own state, so the
  // frame that reads the parameters already draws their launch.
  if (signature !== held.signature) {
    if (signature === null) {
      setHeld({ ...held, signature: null });
    } else if (mode !== undefined && agentRef !== undefined) {
      const count = held.count + 1;
      const example = params.example ? exampleById(params.example) : undefined;
      const launch = exampleLaunch({ key: `link-${count}`, agentRef, example, mode });
      setHeld({ signature, count, launch });
      return launch;
    }
  }
  return held.launch;
}
