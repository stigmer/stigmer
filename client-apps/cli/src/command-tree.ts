// Reads the commander command tree the CLI builds (buildProgram): which
// commands a person sees, where each sits, what arguments and options it
// takes. One walker serves every reader of the tree, the docs generator
// (scripts/gen-cli-docs.ts) and the tests that hold rules over every
// command, so a rule and the reference pages can never disagree about which
// commands exist.
//
// Commander (v12) exposes neither a command's hidden flag, nor whether a
// command has an action of its own, nor, before v11, its positional
// arguments publicly; the three readers below (`isHidden`, `hasOwnAction`,
// `registeredArguments`) are the only places that reach past its public
// surface.

import type { Command } from "commander";

/**
 * Whether a command is hidden from help and the docs. Commander has no
 * public getter; the internal `_hidden` flag (set via
 * `.command(name, { hidden: true })`) is the only signal.
 */
export function isHidden(cmd: Command): boolean {
  return (cmd as unknown as { _hidden?: boolean })._hidden === true;
}

/**
 * Whether a command runs an action of its own (`stigmer up`), rather than only
 * dispatching to its subcommands (`stigmer config`). Commander keeps the
 * handler in the internal `_actionHandler`, null until `.action()` is called.
 */
export function hasOwnAction(cmd: Command): boolean {
  const handler = (cmd as unknown as { _actionHandler?: unknown })._actionHandler;
  return handler !== undefined && handler !== null;
}

/** A positional argument as commander registers it. */
export interface RegisteredArgument {
  name(): string;
  required: boolean;
  variadic: boolean;
}

/**
 * A command's positional arguments. They were renamed from `_args` to
 * `registeredArguments` in commander v11; the public field is read first.
 */
export function registeredArguments(cmd: Command): RegisteredArgument[] {
  const c = cmd as unknown as { registeredArguments?: RegisteredArgument[]; _args?: RegisteredArgument[] };
  return c.registeredArguments ?? c._args ?? [];
}

/** A command's full path from the root, as typed: `stigmer agent versions`. */
export function commandPath(cmd: Command): string {
  const parts: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    parts.unshift(current.name());
    current = current.parent;
  }
  return parts.join(" ");
}

/** The root's commands a person sees, in registration order: neither hidden nor commander's own `help`. */
export function documentedCommands(program: Command): Command[] {
  return program.commands.filter((cmd) => !isHidden(cmd) && cmd.name() !== "help");
}

/** A command's subcommands a person sees, by name. */
export function visibleSubcommands(cmd: Command): Command[] {
  return cmd.commands
    .filter((sub) => !isHidden(sub) && sub.name() !== "help")
    .sort((a, b) => a.name().localeCompare(b.name()));
}

/**
 * Every command a person runs: each visible command with no visible
 * subcommands of its own, depth first, by path. A group (`stigmer agent`)
 * that only dispatches is not one; its leaves are.
 */
export function leafCommands(program: Command): Command[] {
  const leaves: Command[] = [];
  const visit = (cmd: Command): void => {
    const subs = visibleSubcommands(cmd);
    if (subs.length === 0) leaves.push(cmd);
    for (const sub of subs) visit(sub);
  };
  for (const cmd of documentedCommands(program)) visit(cmd);
  return leaves.sort((a, b) => commandPath(a).localeCompare(commandPath(b)));
}

/** Whether a command takes the long option `long` (`--output`) itself, not through its parent. */
export function takesOption(cmd: Command, long: string): boolean {
  return cmd.options.some((option) => option.long === long);
}

/**
 * Every command a person can run, depth first, by path: each leaf, and each
 * group with an action of its own (`stigmer up` runs, and `stigmer up
 * server` is its leaf). A rule over what a command takes walks these, so a
 * runnable group is held like a leaf.
 */
export function runnableCommands(program: Command): Command[] {
  const runnable: Command[] = [];
  const visit = (cmd: Command): void => {
    const subs = visibleSubcommands(cmd);
    if (subs.length === 0 || hasOwnAction(cmd)) runnable.push(cmd);
    for (const sub of subs) visit(sub);
  };
  for (const cmd of documentedCommands(program)) visit(cmd);
  return runnable.sort((a, b) => commandPath(a).localeCompare(commandPath(b)));
}

/** Every command in the tree, the root, hidden ones and commander's own `help` included, depth first. */
export function everyCommand(program: Command): Command[] {
  const all: Command[] = [];
  const visit = (cmd: Command): void => {
    all.push(cmd);
    for (const sub of cmd.commands) visit(sub);
  };
  visit(program);
  return all;
}
