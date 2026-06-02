/**
 * Ambient module declarations for elkjs subpath imports.
 *
 * elkjs is an optional peer dependency (AD-T03-001). These declarations
 * allow TypeScript to resolve the dynamic imports without requiring the
 * package to be installed at type-check time in all environments.
 */

declare module "elkjs/lib/elk-api.js" {
  interface ElkConstructorOptions {
    workerFactory?: () => Worker;
    defaultLayoutOptions?: Record<string, string>;
  }

  class ELK {
    constructor(options?: ElkConstructorOptions);
    layout(graph: unknown): Promise<unknown>;
    terminateWorker(): void;
  }

  export default ELK;
}

declare module "elkjs/lib/elk.bundled.js" {
  interface ElkConstructorOptions {
    defaultLayoutOptions?: Record<string, string>;
  }

  class ELK {
    constructor(options?: ElkConstructorOptions);
    layout(graph: unknown): Promise<unknown>;
  }

  export default ELK;
}
