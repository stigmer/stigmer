#!/usr/bin/env tsx

import React from "react";
import { Readable } from "node:stream";
import { render } from "ink";
import { SessionApp } from "../app/SessionApp.js";

interface CliConfig {
  sessionId: string;
  org: string;
  baseUrl: string;
  apiKey?: string;
}

function parseArgs(argv: string[]): CliConfig | null {
  const args = argv.slice(2);
  const config: Partial<CliConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--session":
      case "-s":
        config.sessionId = args[++i];
        break;
      case "--org":
      case "-o":
        config.org = args[++i];
        break;
      case "--base-url":
      case "-u":
        config.baseUrl = args[++i];
        break;
      case "--api-key":
      case "-k":
        config.apiKey = args[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        if (args[i].startsWith("-")) {
          console.error(`Unknown option: ${args[i]}`);
          printUsage();
          process.exit(1);
        }
    }
  }

  config.baseUrl ??= process.env.STIGMER_BASE_URL;
  config.apiKey ??= process.env.STIGMER_API_KEY;

  if (!config.sessionId || !config.org || !config.baseUrl) {
    return null;
  }

  return config as CliConfig;
}

async function readStdinJson(): Promise<CliConfig | null> {
  if (process.stdin.isTTY) return null;

  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.sessionId && parsed.org && parsed.baseUrl) {
          resolve(parsed as CliConfig);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
    setTimeout(() => resolve(null), 1000);
  });
}

function printUsage(): void {
  console.log(`
stigmer-ink — Terminal session viewer for the Stigmer platform

Usage:
  stigmer-ink --session <id> --org <slug> [options]
  echo '{"sessionId":"...","org":"...","baseUrl":"..."}' | stigmer-ink

Options:
  -s, --session <id>    Session ID (required)
  -o, --org <slug>      Organization slug (required)
  -u, --base-url <url>  Stigmer API URL (or STIGMER_BASE_URL env)
  -k, --api-key <key>   API key (or STIGMER_API_KEY env)
  -h, --help            Show this help message

Environment:
  STIGMER_BASE_URL      Default API server URL
  STIGMER_API_KEY       Default API key
`);
}

async function main() {
  let config = parseArgs(process.argv);

  if (!config) {
    config = await readStdinJson();
  }

  if (!config) {
    console.error(
      "Error: --session, --org, and --base-url are required.\n" +
        "Run with --help for usage information.",
    );
    process.exit(1);
  }

  const isTTY = Boolean(process.stdin.isTTY);
  const stdin = isTTY
    ? process.stdin
    : new Readable({ read() {} }) as unknown as NodeJS.ReadStream;

  const instance = render(
    <SessionApp
      sessionId={config.sessionId}
      org={config.org}
      baseUrl={config.baseUrl}
      apiKey={config.apiKey}
    />,
    { stdin, exitOnCtrlC: isTTY, debug: !isTTY },
  );

  const cleanup = () => {
    instance.unmount();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await instance.waitUntilExit();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
