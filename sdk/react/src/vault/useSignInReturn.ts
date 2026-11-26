"use client";

/**
 * The return from a login page, on the page it sends the person back to
 * (`STIGMER_OAUTH_REDIRECT_URI`): hands the login page's answer to Stigmer
 * (`VaultCommandController.handBackSignIn`), for the app or terminal that
 * started the sign-in to collect under its own session (`useVaultSignIn`,
 * `stigmer connect plugin`).
 *
 * Nothing travels between windows, so the return works whatever address
 * the app that started the sign-in lives on, and when the login page cut
 * this window off from its opener (`Cross-Origin-Opener-Policy`). The call
 * is public: the sign-in's state is its only authority, so the hook needs a
 * `StigmerProvider` with no token, and the person need not be signed in to
 * Stigmer here.
 *
 * This page cannot know that the sign-in finished, only that its answer
 * reached Stigmer; the app that started it says "Signed in".
 */
import { useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { HandBackSignInInputSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/**
 * Where a return stands.
 *
 * - `handing-back`: the answer is on its way to Stigmer.
 * - `handed-back`: Stigmer has the login page's code; the app that started
 *   the sign-in finishes it. `providerName` is who the person signed in at,
 *   `address` the address the login is for.
 * - `refused`: the login page did not sign the person in (`reason`, its
 *   words); Stigmer has the refusal, so the app's wait ends with it too.
 * - `failed`: the answer did not reach Stigmer (`error`): the sign-in
 *   expired or was already used, or the request failed on the way.
 * - `no-answer`: the page was opened without a sign-in's answer.
 */
export type SignInReturnState =
  | { readonly kind: "handing-back" }
  | { readonly kind: "handed-back"; readonly providerName: string; readonly address: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly error: Error }
  | { readonly kind: "no-answer" };

/** What the login page put in the return's address. */
interface LoginPageAnswer {
  readonly state: string;
  readonly code: string;
  readonly error: string;
  readonly errorDescription: string;
}

function answerOf(search: string): LoginPageAnswer | null {
  const params = new URLSearchParams(search);
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  const error = params.get("error") ?? "";
  // One answer: a code, or the login page's refusal (RFC 6749 4.1.2).
  if (state === "" || (code === "") === (error === "")) return null;
  return { state, code, error, errorDescription: params.get("error_description") ?? "" };
}

/**
 * Behavior hook for the page a login page returns to: reads the answer
 * from the URL once and hands it to Stigmer. Render {@link SignInReturn}
 * for the styled page.
 *
 * @example
 * ```tsx
 * function MyCallback() {
 *   const back = useSignInReturn();
 *   if (back.kind === "handed-back") return <p>Signed in at {back.providerName}. Go back to the app.</p>;
 *   if (back.kind === "handing-back") return <p>One moment…</p>;
 *   return <p>The sign-in didn't finish.</p>;
 * }
 * ```
 */
export function useSignInReturn(): SignInReturnState {
  const stigmer = useStigmer();
  const [state, setState] = useState<SignInReturnState>({ kind: "handing-back" });
  const didRun = useRef(false);

  useEffect(() => {
    // React may run the effect twice (StrictMode): a sign-in has one answer.
    if (didRun.current) return;
    didRun.current = true;
    const answer = answerOf(window.location.search);
    if (answer === null) {
      setState({ kind: "no-answer" });
      return;
    }
    stigmer.vault
      .handBackSignIn(create(HandBackSignInInputSchema, answer))
      .then((handed) => {
        if (answer.error !== "") {
          setState({ kind: "refused", reason: answer.errorDescription !== "" ? answer.errorDescription : answer.error });
          return;
        }
        setState({ kind: "handed-back", providerName: handed.providerName, address: handed.address });
      })
      .catch((err: unknown) => setState({ kind: "failed", error: toError(err) }));
  }, [stigmer]);

  return state;
}
