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
