// Ambient shim for the untyped `marked-terminal` package.
//
// The in-process Ink renderer imports @stigmer/ink, which the monorepo resolves
// to its TypeScript *source* (sdk/ink/package.json "exports": "./src/index.ts").
// That source uses `marked-terminal`, which ships no types, so @stigmer/ink
// carries its own ambient declaration — but ambient declarations are scoped to
// the program that includes them, and this CLI's tsconfig does not reach into
// the SDK's src/types. We mirror the minimal surface the SDK relies on so the
// CLI's typecheck sees the same contract. Keep in sync with
// sdk/ink/src/types/marked-terminal.d.ts; remove if @types/marked-terminal ships
// or @stigmer/ink is consumed as built declarations.

declare module "marked-terminal" {
  import type { MarkedExtension } from "marked";

  interface MarkedTerminalOptions {
    width?: number;
    reflowText?: boolean;
    showSectionPrefix?: boolean;
    tab?: number;
    unescape?: boolean;
    emoji?: boolean;
  }

  export function markedTerminal(
    options?: MarkedTerminalOptions,
    highlightOptions?: Record<string, unknown>,
  ): MarkedExtension;

  export default class Renderer {}
}
