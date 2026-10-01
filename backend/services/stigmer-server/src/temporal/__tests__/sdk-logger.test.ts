/**
 * Pins the Temporal SDK log adapter and its install bridge (#1037):
 *
 *   - the level mapping (TRACE folds into debug) and the verbatim message;
 *   - the meta table on both sides of the component split: on every line
 *     a `taskToken`, a symbol key, null and undefined are dropped, an
 *     Error becomes its message and a bigint its decimal string; a nested
 *     value passes on a line our code wrote (`workflow`, `activity`,
 *     `nexus`) and is dropped from the SDK's own lines, an unknown
 *     component counting as the SDK's, and the drop holds for the written
 *     line and the sink entry alike;
 *   - the bridge installs once and retargets after, catches exactly the
 *     SDK's IllegalStateError (warned once, never retried) and lets any
 *     other install failure through.
 *
 * Every bridge here is built over a fake install, so nothing creates the
 * native Runtime; the real path is sdk-logger.temporal.test.ts.
 */
import { IllegalStateError, SdkComponent } from "@temporalio/common";
import type { RuntimeOptions } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

import { createLogger, type LogEntry, type Logger } from "../../boot/logger.js";
import {
  createSdkLogBridge,
  createSdkLoggerAdapter,
  toLogFields,
} from "../sdk-logger.js";

function capturingLogger(level = "debug"): {
  logger: Logger;
  lines: string[];
  entries: LogEntry[];
} {
  const lines: string[] = [];
  const entries: LogEntry[] = [];
  const logger = createLogger({
    level,
    pretty: false,
    write: (line) => lines.push(line),
    sink: (entry) => entries.push(entry),
  });
  return { logger, lines, entries };
}

describe("createSdkLoggerAdapter", () => {
  it("maps each SDK level onto the server's and keeps the message verbatim", () => {
    const { logger, entries } = capturingLogger();
    const adapter = createSdkLoggerAdapter(() => logger);

    adapter.trace("t");
    adapter.debug("d");
    adapter.info("i");
    adapter.warn("Activity failed");
    adapter.error("e");
    adapter.log("WARN", "via log");

    expect(entries.map((entry) => [entry.level, entry.message])).toEqual([
      ["debug", "t"],
      ["debug", "d"],
      ["info", "i"],
      ["warn", "Activity failed"],
      ["error", "e"],
      ["warn", "via log"],
    ]);
  });

  it("writes through whichever logger the target returns at call time", () => {
    const first = capturingLogger();
    const second = capturingLogger();
    let current = first.logger;
    const adapter = createSdkLoggerAdapter(() => current);

    adapter.info("one");
    current = second.logger;
    adapter.info("two");

    expect(first.entries.map((entry) => entry.message)).toEqual(["one"]);
    expect(second.entries.map((entry) => entry.message)).toEqual(["two"]);
  });

  it("keeps the SDK's own nested values out of the written line and the sink", () => {
    const { logger, lines, entries } = capturingLogger();
    const adapter = createSdkLoggerAdapter(() => logger);

    adapter.debug("Creating worker", {
      sdkComponent: SdkComponent.worker,
      taskQueue: "q",
      options: { dataConverter: { key: Buffer.from("secret-key-bytes") } },
    });

    expect(entries[0]?.fields).toEqual({
      sdkComponent: "worker",
      taskQueue: "q",
    });
    expect(lines[0]).not.toContain("options");
    expect(lines[0]).not.toContain("Buffer");
  });
});

describe("toLogFields", () => {
  const shared = {
    [Symbol("LogTimestamp")]: 1n,
    taskToken: "dGFzay10b2tlbg==",
    attempt: 1,
    isLocal: false,
    activityType: "FailingActivity",
    runId: null,
    updateId: undefined,
    error: new Error("activity exploded"),
    durationMs: 12n,
  };

  it("applies the every-line rules on the SDK's own lines", () => {
    expect(
      toLogFields({ ...shared, sdkComponent: SdkComponent.worker }),
    ).toEqual({
      sdkComponent: "worker",
      attempt: 1,
      isLocal: false,
      activityType: "FailingActivity",
      error: "activity exploded",
      durationMs: "12",
    });
  });

  it("applies the same every-line rules on our code's lines", () => {
    expect(
      toLogFields({ ...shared, sdkComponent: SdkComponent.workflow }),
    ).toEqual({
      sdkComponent: "workflow",
      attempt: 1,
      isLocal: false,
      activityType: "FailingActivity",
      error: "activity exploded",
      durationMs: "12",
    });
  });

  it("passes nested values on the components our code writes", () => {
    const outcomes = { reaped: 2, kept: 1 };
    for (const component of [
      SdkComponent.workflow,
      SdkComponent.activity,
      SdkComponent.nexus,
    ]) {
      expect(toLogFields({ sdkComponent: component, outcomes })).toEqual({
        sdkComponent: component,
        outcomes,
      });
    }
  });

  it("drops nested values from the SDK's components, unknown and absent ones included", () => {
    const nested = {
      options: { taskQueue: "q" },
      list: ["a"],
      codecs: new Map([["k", Buffer.from("x")]]),
      key: Buffer.from("x"),
    };
    for (const component of [
      SdkComponent.worker,
      SdkComponent.core,
      "a-component-the-sdk-adds-later",
    ]) {
      expect(toLogFields({ sdkComponent: component, ...nested })).toEqual({
        sdkComponent: component,
      });
    }
    expect(toLogFields(nested)).toEqual({});
  });

  it("returns no fields for absent meta", () => {
    expect(toLogFields(undefined)).toEqual({});
  });
});

describe("createSdkLogBridge", () => {
  function recordingInstall(): {
    install: (options: RuntimeOptions) => void;
    calls: RuntimeOptions[];
  } {
    const calls: RuntimeOptions[] = [];
    return { install: (options) => calls.push(options), calls };
  }

  it("installs the adapter on the first attach and only retargets after", () => {
    const { install, calls } = recordingInstall();
    const bridge = createSdkLogBridge(install);
    const first = capturingLogger();
    const second = capturingLogger();

    bridge.attach(first.logger);
    calls[0]?.logger?.info("to first");
    bridge.attach(second.logger);
    calls[0]?.logger?.info("to second");

    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0] ?? {})).toEqual(["logger"]);
    expect(first.entries.map((entry) => entry.message)).toEqual(["to first"]);
    expect(second.entries.map((entry) => entry.message)).toEqual(["to second"]);
  });

  it("warns once and keeps the SDK default when the Runtime already exists", () => {
    let installs = 0;
    const bridge = createSdkLogBridge(() => {
      installs++;
      throw new IllegalStateError(
        "Runtime singleton has already been instantiated. Did you start a Worker before calling `install`?",
      );
    });
    const { logger, entries } = capturingLogger();

    bridge.attach(logger);
    bridge.attach(logger);

    expect(installs).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "warn",
      message:
        "Temporal SDK logger not installed: the Temporal runtime already existed before the worker manager's first connect",
    });
    expect(entries[0]?.fields?.["error"]).toContain(
      "already been instantiated",
    );
  });

  it("lets any other install failure through", () => {
    const bridge = createSdkLogBridge(() => {
      throw new TypeError("Invalid logging filter");
    });

    expect(() => bridge.attach(capturingLogger().logger)).toThrow(
      "Invalid logging filter",
    );
  });
});
