"use client";

// The one error boundary the kit puts around a part a host supplied (a
// `threadSlots` component, a tool card), so a host part that throws never
// takes the viewer down: the kit's own part draws in its place, and the
// approval, the failure notice, Copy and Stop stay on screen. React reports
// the caught error through the root's `onCaughtError` (`console.error`
// unless the host gave its root its own handler, which is where a host wires
// its monitoring).

import { Component, type ErrorInfo, type ReactNode } from "react";

interface HostPartBoundaryProps {
  /** What draws once the host's part threw: the kit's own part, given the same data. */
  readonly fallback: ReactNode;
  /**
   * When set, a part that threw gets one fresh try once this key moves (a
   * tool card, keyed on its call's state, tries again once the result lands).
   * Without it the part stays on the fallback for the boundary's life: a
   * part retried on every changed prop would throw and be reported again on
   * every streamed frame.
   */
  readonly resetKey?: string;
  readonly children: ReactNode;
}

/** Between the throw and its report, before the key the part threw at is known. */
const CAUGHT = Symbol("caught");

interface HostPartBoundaryState {
  /** Whether the host's part threw and the fallback draws. */
  readonly failed: boolean;
  /** The `resetKey` the part threw at, or {@link CAUGHT} until the report. */
  readonly failedAt: string | undefined | typeof CAUGHT;
}

/**
 * Draws a host's part, and the kit's own in its place once the part throws.
 * A part that draws is never remounted, so it keeps its own state.
 *
 * @internal
 */
export class HostPartBoundary extends Component<HostPartBoundaryProps, HostPartBoundaryState> {
  override state: HostPartBoundaryState = { failed: false, failedAt: undefined };

  static getDerivedStateFromError(): Partial<HostPartBoundaryState> {
    return { failed: true, failedAt: CAUGHT };
  }

  static getDerivedStateFromProps(props: HostPartBoundaryProps, state: HostPartBoundaryState): Partial<HostPartBoundaryState> | null {
    // A fresh try once the key moved on from the one the part threw at.
    const moved = state.failed && state.failedAt !== CAUGHT && props.resetKey !== undefined && state.failedAt !== props.resetKey;
    return moved ? { failed: false, failedAt: undefined } : null;
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.setState({ failedAt: this.props.resetKey });
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
