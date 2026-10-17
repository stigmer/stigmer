/**
 * Test support for the routine domain's store-fault cases: a real store
 * with one method replaced (the fault), and a logger whose lines a case
 * reads back as parsed NDJSON.
 */
import { createLogger } from "../../../boot/logger.js";
import type { Logger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";

/** `store` with `method` answered by `replacement`; every other call reaches the real store. */
export function storeWith<K extends keyof Store>(store: Store, method: K, replacement: Store[K]): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === method) {
        return replacement;
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A logged line: its message and its fields. */
export type LoggedLine = Readonly<Record<string, unknown>> & { readonly level: string; readonly message: string };

/** A warn-level logger and the lines it wrote, parsed. */
export function capturingLogger(): { readonly logger: Logger; readonly lines: LoggedLine[] } {
  const lines: LoggedLine[] = [];
  const logger = createLogger({
    level: "warn",
    pretty: false,
    write: (line) => lines.push(JSON.parse(line) as LoggedLine),
  });
  return { logger, lines };
}
