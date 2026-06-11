// Tracks resources created during a test and removes them in reverse order.
// Domain: conformance harness (test isolation).
//
// Cleanup is best-effort: a delete that fails (e.g. the test already deleted the
// resource, or a deviation left it in an odd state) must never mask the test's
// own assertions. Server teardown is the ultimate backstop; this keeps a
// long-lived per-file server from accumulating cross-test residue.
export class FixtureTracker {
  private cleanups: Array<() => Promise<unknown>> = [];

  defer(cleanup: () => Promise<unknown>): void {
    this.cleanups.push(cleanup);
  }

  async cleanup(): Promise<void> {
    const pending = this.cleanups.splice(0).reverse();
    for (const cleanup of pending) {
      try {
        await cleanup();
      } catch {
        // best-effort
      }
    }
  }
}
