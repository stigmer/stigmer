// Calls a host's function that the kit runs while it draws (the host's
// `messageActions`, a registered tool presenter's overrides), so one that
// throws never takes the viewer down: the call gives `undefined` and the kit
// draws its own default. The error is reported as a caught one, through
// `console.error`, as React reports an error a boundary caught; once per
// host function, since these run again on every streamed frame.

const reported = new WeakSet<object>();

/**
 * `call()`, or `undefined` when the host gave no `fn` or the call throws.
 * `fn` is the host's own function, which `call` runs (so a presenter's
 * method keeps its `this`); it is the key a report is made once for.
 *
 * @internal
 */
export function callHostPart<R>(what: string, fn: object | undefined, call: () => R): R | undefined {
  if (fn === undefined) return undefined;
  try {
    return call();
  } catch (error) {
    if (!reported.has(fn)) {
      reported.add(fn);
      console.error(`Stigmer: ${what} threw; the kit's own default draws in its place.`, error);
    }
    return undefined;
  }
}
