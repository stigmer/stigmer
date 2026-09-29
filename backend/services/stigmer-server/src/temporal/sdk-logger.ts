/**
 * The Temporal SDK's log lines, routed through the server logger (#1037).
 *
 * The SDK logs through its process-wide Runtime logger: `Activity failed`
 * with the activity's identity and error, worker lifecycle lines, and every
 * `log.*` a workflow body calls (the workflow sink resolves to the same
 * logger). Left at its default, that logger writes its own format to
 * stderr, outside LOG_LEVEL and outside the sink seam, so a deployable that
 * exports the server's lines (boot/logger.ts's `sink`) never sees the
 * warnings an operator most needs. One `Runtime.install({ logger })` before
 * the first native connection routes them all through the server logger,
 * with the same threshold, shape and export as every other line.
 *
 * Meta becomes fields by one table, keyed on who wrote the line. The SDK
 * tags each line with `sdkComponent`; `workflow`, `activity` and `nexus`
 * are the context loggers user code calls, and the SDK "never publishes
 * messages with" them (@temporalio/common's SdkComponent). Those lines are
 * ours and get the server logger's own contract: values pass as the call
 * site wrote them, and redaction is the call site's. Every other line is
 * the SDK's own, and keeps only strings, numbers and booleans, because
 * its nested values are not ours to vouch for: at debug the SDK logs
 * `Creating worker` with the whole worker options, which hold the payload
 * codecs and their decryption keys. An unknown or absent component is
 * treated as the SDK's, since the SDK says its component list may change.
 * On every line: symbol keys are dropped (the workflow sink's call-time
 * stamp rides one), `taskToken` is dropped (it can complete the activity
 * from outside, and has no business in a log store), null and undefined
 * are dropped, an Error becomes its message as every server call site logs
 * one, and a bigint becomes its decimal string because JSON cannot carry
 * it. Keys keep the SDK's names (`activityType`, `workflowId`), which are
 * Temporal's documented vocabulary.
 *
 * Two consequences, accepted. A workflow line is stamped when its
 * activation's sinks flush, milliseconds after the `log.*` call, because
 * the server Logger takes no instant. And the table runs before the
 * threshold drops a line, because the Logger exposes no level check; it
 * walks a handful of keys, and drops the one large SDK object unwalked.
 *
 * Native (Rust core) lines stay on the console, as the SDK defaults:
 * forwarding them makes the SDK buffer every runtime-logger line for
 * 100 ms (RuntimeOptions' telemetryOptions.logging), which would delay and
 * restamp `Activity failed` itself.
 *
 * The Runtime is a process singleton, so the install is a bridge with one
 * process instance: the first attach installs an adapter that reads the
 * bridge's current target, and every later attach (a reconnect, a second
 * composition in one test process) only retargets it. A Runtime created
 * before the first attach (a test environment, or an embedder that touched
 * the SDK first) keeps the SDK default; the attach says so once and never
 * fails the boot over it. TemporalManager attaches before every native
 * connect, so every worker it builds, OSS and extension alike, is covered.
 * A composition that prebuilds a bundle with `bundleWorkflowCode` passes
 * that call its own logger: the bundler never reads the Runtime.
 */
import {
  IllegalStateError,
  SdkComponent,
  type LogLevel as SdkLogLevel,
  type LogMetadata,
  type Logger as SdkLogger,
} from "@temporalio/common";
import { Runtime, type RuntimeOptions } from "@temporalio/worker";

import type { LogFields, Logger, LogLevel } from "../boot/logger.js";

/** The components whose lines come from our own code (module header). */
const CALLER_COMPONENTS: ReadonlySet<string> = new Set([
  SdkComponent.workflow,
  SdkComponent.activity,
  SdkComponent.nexus,
]);

/** Dropped on every line: it completes the activity from outside. */
const TASK_TOKEN_KEY = "taskToken";

const LEVELS: Record<SdkLogLevel, LogLevel> = {
  TRACE: "debug",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
};

/** The meta table (module header), exported for its own unit arms. */
export function toLogFields(meta: LogMetadata | undefined): LogFields {
  const fields: LogFields = {};
  if (meta === undefined) {
    return fields;
  }
  const fromCaller = CALLER_COMPONENTS.has(String(meta["sdkComponent"]));
  for (const [key, value] of Object.entries(meta)) {
    if (key === TASK_TOKEN_KEY || value === null || value === undefined) {
      continue;
    }
    if (value instanceof Error) {
      fields[key] = value.message;
    } else if (typeof value === "bigint") {
      fields[key] = value.toString();
    } else if (
      fromCaller ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      fields[key] = value;
    }
  }
  return fields;
}

/** The SDK's Logger over whichever server logger `target` returns now. */
export function createSdkLoggerAdapter(target: () => Logger): SdkLogger {
  const log = (level: SdkLogLevel, message: string, meta?: LogMetadata) => {
    target()[LEVELS[level]](message, toLogFields(meta));
  };
  return {
    log,
    trace: (message, meta) => log("TRACE", message, meta),
    debug: (message, meta) => log("DEBUG", message, meta),
    info: (message, meta) => log("INFO", message, meta),
    warn: (message, meta) => log("WARN", message, meta),
    error: (message, meta) => log("ERROR", message, meta),
  };
}

/** `Runtime.install`'s shape, the bridge's test seam. */
export type RuntimeInstall = (options: RuntimeOptions) => unknown;

export interface SdkLogBridge {
  /**
   * Routes the SDK's lines to `logger`: installs the Runtime logger on the
   * first call, retargets it on every later one.
   */
  attach(logger: Logger): void;
}

export function createSdkLogBridge(install: RuntimeInstall): SdkLogBridge {
  let state: "pending" | "installed" | "preempted" = "pending";
  let target: Logger | undefined;
  const adapter = createSdkLoggerAdapter(() => {
    if (target === undefined) {
      throw new Error("Temporal SDK log bridge used before attach");
    }
    return target;
  });

  return {
    attach(logger) {
      target = logger;
      if (state !== "pending") {
        return;
      }
      try {
        install({ logger: adapter });
        state = "installed";
      } catch (error) {
        if (!(error instanceof IllegalStateError)) {
          throw error;
        }
        state = "preempted";
        logger.warn(
          "Temporal SDK logger not installed: the Temporal runtime already existed before the worker manager's first connect",
          { error: error.message },
        );
      }
    },
  };
}

/** The process's one bridge, over the SDK's one Runtime. */
export const processSdkLogBridge: SdkLogBridge = createSdkLogBridge((options) =>
  Runtime.install(options),
);
