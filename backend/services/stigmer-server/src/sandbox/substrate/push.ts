/**
 * The attach push: how the driver tells a sandbox which queue to serve
 * and hands it the runner's secrets, through Substrate's router.
 *
 * The contract is the runner's attach waiter (runner src/attach/push.ts
 * and waiter.ts): `POST /attach` with `{ taskQueue, secrets }`, routed by
 * the `ate-target-actor: <atespace>/<actor>` header to the actor's port
 * 80. The waiter accepts a queue only when the sandbox's own name is the
 * one derived from it, starts the runner on the first push, and on later
 * pushes only rotates the token the runner would restart with. Every
 * refusal carries a stable `code`, which the driver acts on; the `error`
 * text is for people.
 *
 * Retried: a connection failure and the router's 502, 503 and 504, which
 * mean the actor is still coming up (the router wakes and waits for an
 * actor on every request) or briefly unreachable, for up to 15 seconds.
 * Never retried: a refusal from the waiter itself. Neither the body nor
 * any secret is ever logged; only the code and the waiter's text.
 */

import { delay } from "./delay.js";

/** What the waiter answered. */
export type PushResult =
  | { readonly ok: true; readonly started: boolean }
  | {
      readonly ok: false;
      readonly status: number;
      /** The waiter's refusal code; "" when the reply carried none. */
      readonly code: string;
      readonly error: string;
    };

export interface PushRequest {
  readonly routerUrl: string;
  readonly atespace: string;
  readonly actor: string;
  readonly taskQueue: string;
  readonly secrets: Readonly<Record<string, string>>;
}

/** How long the router may stay unready before a push fails. */
const RETRY_WINDOW_MS = 15_000;
const RETRY_DELAY_MS = 250;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export async function pushAttach(
  request: PushRequest,
  options: {
    readonly fetch?: typeof fetch;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
  } = {},
): Promise<PushResult> {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? delay;
  const now = options.now ?? Date.now;
  const deadline = now() + RETRY_WINDOW_MS;
  const body = JSON.stringify({
    taskQueue: request.taskQueue,
    secrets: request.secrets,
  });

  for (;;) {
    let response: Response | undefined;
    let failure: string | undefined;
    try {
      response = await fetchImpl(`${request.routerUrl}/attach`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "ate-target-actor": `${request.atespace}/${request.actor}`,
        },
        body,
        signal: AbortSignal.timeout(RETRY_WINDOW_MS),
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (response !== undefined && !RETRYABLE_STATUSES.has(response.status)) {
      return readReply(response);
    }
    if (now() >= deadline) {
      if (response !== undefined) return readReply(response);
      throw new Error(
        `the attach push to ${request.actor} could not reach the router: ${failure ?? "no reply"}`,
      );
    }
    await response?.body?.cancel();
    await sleep(RETRY_DELAY_MS);
  }
}

async function readReply(response: Response): Promise<PushResult> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const fields =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  if (response.status === 200) {
    return { ok: true, started: fields["started"] === true };
  }
  return {
    ok: false,
    status: response.status,
    code: typeof fields["code"] === "string" ? fields["code"] : "",
    error:
      typeof fields["error"] === "string"
        ? fields["error"]
        : text.slice(0, 200),
  };
}
