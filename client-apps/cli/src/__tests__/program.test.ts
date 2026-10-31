// The CLI's command tree: what buildProgram registers, that an unknown
// option is refused without echoing a value written after '=' (it may be a
// key), and that the run command's vault and plugin flags reach the wire: My
// vault unless --no-my-vault, and each --plugin as a plugin reference.

import { describe, expect, it } from "vitest";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/client";
import type { Command } from "commander";
import { type AgentExecOptions, toAgentExecFlags } from "../commands/agent-exec-flags.js";
import { buildProgram } from "../program.js";
import { type ControllerFn, createAgentRun } from "../resources/run/create.js";
import { prepareAgentExec } from "../resources/run/prepare.js";
import { VERSION } from "../version.js";

// These runs name no vault, plugin or environment by id and attach nothing,
// so prepareAgentExec asks the client nothing.
const STUB_CLIENT = {} as unknown as Stigmer;

// A program whose output is captured; every command's errors already throw
// (errors/command-line.ts) rather than exit.
function capturedProgram(): { program: Command; stderr: () => string } {
  const program = buildProgram();
  let stderr = "";
  program.configureOutput({ writeErr: (text) => void (stderr += text) });
  return { program, stderr: () => stderr };
}

describe("buildProgram", () => {
  it("registers the foundational commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name()).sort();
    expect(names).toContain("version");
    expect(names).toContain("completion");
  });

  it("registers the read commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["search", "usage"]));
  });

  it("registers the package and download commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["push", "download"]));
  });

  it("registers the streaming commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["run", "resume"]));
  });

  it("has no draft command: a plugin is authored outside Stigmer and installed, never drafted by a system agent", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).not.toContain("draft");
  });

  it("exposes the channel subcommands, link taking --name", () => {
    const program = buildProgram();
    const channel = program.commands.find((command) => command.name() === "channel");
    const subs = channel?.commands.map((command) => command.name());
    expect(subs).toEqual(["link", "enable", "disable"]);
    const link = channel?.commands.find((command) => command.name() === "link");
    expect(link?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--off", "--audience", "--reset-link", "--name", "--open", "--json", "--quiet"]),
    );
  });

  it("exposes the usage subcommands", () => {
    const program = buildProgram();
    const usage = program.commands.find((command) => command.name() === "usage");
    const subs = usage?.commands.map((command) => command.name()).sort();
    expect(subs).toEqual(["agent", "hours", "org", "session"]);
  });

  it("exposes the global flags as persistent options", () => {
    const program = buildProgram();
    const longFlags = program.options.map((option) => option.long);
    expect(longFlags).toEqual(
      expect.arrayContaining(["--debug", "--standalone", "--org", "--api-key"]),
    );
  });

  it("exposes the runs subcommands", () => {
    const program = buildProgram();
    const runs = program.commands.find((command) => command.name() === "runs");
    const subs = runs?.commands.map((command) => command.name()).sort();
    expect(subs).toEqual(["approve", "cancel", "logs", "pause", "resume", "scores", "terminate", "to-eval-case", "trace"]);
  });

  it("exposes eval run, which takes its subject by flag, and eval cancel", () => {
    const program = buildProgram();
    const group = program.commands.find((command) => command.name() === "eval");
    const run = group?.commands.find((command) => command.name() === "run");
    expect(group?.commands.map((command) => command.name())).toEqual(["run", "cancel"]);
    expect(run?.registeredArguments).toEqual([]);
    expect(run?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--agent", "--plugin", "--cases-from", "--case", "--tag", "--runs", "--model", "--ablation", "--threshold", "--max-cost-usd", "--concurrency", "--allow-tools", "--judge-model", "--real-mcp-servers", "--json", "--no-wait"]),
    );
  });

  it("lists eval run's exit codes in its help: the format's, and the CLI's own 3 and 4", () => {
    const run = buildProgram()
      .commands.find((command) => command.name() === "eval")
      ?.commands.find((command) => command.name() === "run");
    let help = "";
    run?.configureOutput({ writeOut: (text) => void (help += text) });
    run?.outputHelp();
    for (const code of ["0", "1", "2", "3", "4", "130"]) expect(help).toMatch(new RegExp(`^  ${code} +\\S`, "m"));
  });

  it("keeps stigmer mcp-server, the command that starts Stigmer's own MCP server, beside mcp add", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toContain("mcp-server");
    const mcp = program.commands.find((command) => command.name() === "mcp");
    expect(mcp?.commands.map((command) => command.name())).toEqual(["add"]);
  });

  it.each([
    ["a plain value", "--token=sk-live-123", "sk-live-123"],
    ["a value holding a quote", "--token=TOKEN=ab'cd-secret", "cd-secret"],
    ["a value holding a newline", "--token=TOKEN=first\nsecond-secret", "second-secret"],
  ])("refuses an unknown option without echoing any part of its value written with '=' (%s)", async (_case, arg, leaked) => {
    const { program, stderr } = capturedProgram();
    const refusal = program.parseAsync(["run", "-m", "hi", arg], { from: "user" });
    await expect(refusal).rejects.toMatchObject({ code: "commander.unknownOption", exitCode: 2 });
    const message = await refusal.catch((error: Error) => error.message);
    expect(message).toBe("unknown option '--token'");
    expect(message).not.toContain(leaked);
    expect(stderr()).not.toContain(leaked);
    expect(stderr()).not.toContain("TOKEN");
  });

  it.each([
    [[] as string[], true, [], []],
    [["--no-my-vault", "--vault", "ci-keys"], false, ["acme/ci-keys"], []],
    [["--vault", "support-tools", "--vault", "platform/shared"], true, ["acme/support-tools", "platform/shared"], []],
    [["--plugin", "linear", "--plugin", "platform/github"], true, [], ["acme/linear", "platform/github"]],
  ])(
    "sends the vault and plugin choice the run's flags parse to (%j), through commander to the wire",
    async (flags, includeMyVault, vaults, plugins) => {
      const program = buildProgram();
      const run = program.commands.find((command) => command.name() === "run");
      let parsed: AgentExecOptions | undefined;
      run?.action((_agent: string | undefined, options: AgentExecOptions) => {
        parsed = options;
      });
      await program.parseAsync(["run", "-m", "hi", ...flags], { from: "user" });
      if (parsed === undefined) throw new Error("run's action did not run");

      const prepared = await prepareAgentExec(toAgentExecFlags(parsed), STUB_CLIENT, undefined, { org: "acme" });
      let sent: Run | undefined;
      const controller = (() => ({
        create: (run: Run) => {
          sent = run;
          return Promise.resolve(run);
        },
      })) as unknown as ControllerFn;
      await createAgentRun(controller, {
        orgId: "acme",
        message: prepared.message,
        vaults: prepared.vaults,
        includeMyVault: prepared.includeMyVault,
        plugins: prepared.plugins,
        fileIds: [],
        workspaceFileRefs: [],
        resources: [],
        model: "",
        mode: "",
        serviceTier: "",
        thinking: "",
        autoApproveAll: false,
        harness: "",
      });
      const target = sent?.spec?.target;
      const spec = target?.case === "sessionSpec" ? target.value : undefined;
      expect(spec?.includeMyVault).toBe(includeMyVault);
      expect(spec?.vaults.map((ref) => `${ref.org}/${ref.slug}`)).toEqual(vaults);
      expect(spec?.plugins.map((ref) => `${ref.org}/${ref.slug}`)).toEqual(plugins);
      expect(spec?.plugins.every((ref) => ref.kind === ApiResourceKind.plugin)).toBe(true);
    },
  );

  it("sends each --file-id File in the first message's file_ids, through commander to the wire", async () => {
    const program = buildProgram();
    const run = program.commands.find((command) => command.name() === "run");
    let parsed: AgentExecOptions | undefined;
    run?.action((_agent: string | undefined, options: AgentExecOptions) => {
      parsed = options;
    });
    await program.parseAsync(["run", "-m", "hi", "--file-id", "file_ledger", "--file-id", "file_notes"], { from: "user" });
    if (parsed === undefined) throw new Error("run's action did not run");

    const prepared = await prepareAgentExec(toAgentExecFlags(parsed), STUB_CLIENT, undefined, { org: "acme" });
    expect(prepared.files.fileIds).toEqual(["file_ledger", "file_notes"]);
    let sent: Run | undefined;
    const controller = (() => ({
      create: (run: Run) => {
        sent = run;
        return Promise.resolve(run);
      },
    })) as unknown as ControllerFn;
    await createAgentRun(controller, {
      orgId: "acme",
      message: prepared.message,
      vaults: prepared.vaults,
      includeMyVault: prepared.includeMyVault,
      plugins: prepared.plugins,
      fileIds: prepared.files.fileIds,
      workspaceFileRefs: [],
      resources: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    expect(sent?.spec?.fileIds).toEqual(["file_ledger", "file_notes"]);
  });

  it.each([
    [[] as string[], undefined],
    [["--environment", "data-science"], "acme/data-science"],
    [["--environment", "platform/base-tools"], "platform/base-tools"],
  ])("sends the environment the run's flags parse to (%j), through commander to the wire", async (flags, environment) => {
    const program = buildProgram();
    const run = program.commands.find((command) => command.name() === "run");
    let parsed: AgentExecOptions | undefined;
    run?.action((_agent: string | undefined, options: AgentExecOptions) => {
      parsed = options;
    });
    await program.parseAsync(["run", "-m", "hi", ...flags], { from: "user" });
    if (parsed === undefined) throw new Error("run's action did not run");

    const prepared = await prepareAgentExec(toAgentExecFlags(parsed), STUB_CLIENT, undefined, { org: "acme" });
    let sent: Run | undefined;
    const controller = (() => ({
      create: (run: Run) => {
        sent = run;
        return Promise.resolve(run);
      },
    })) as unknown as ControllerFn;
    await createAgentRun(controller, {
      orgId: "acme",
      message: prepared.message,
      vaults: prepared.vaults,
      includeMyVault: prepared.includeMyVault,
      plugins: prepared.plugins,
      ...(prepared.environment === undefined ? {} : { environment: prepared.environment }),
      fileIds: [],
      workspaceFileRefs: [],
      resources: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    const target = sent?.spec?.target;
    const ref = target?.case === "sessionSpec" ? target.value.environmentRef : undefined;
    expect(ref === undefined ? undefined : `${ref.org}/${ref.slug}`).toBe(environment);
    if (ref !== undefined) expect(ref.kind).toBe(ApiResourceKind.environment);
  });

  it("reports a semver-shaped version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
