import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, ChevronRight, Loader2, Network, X } from "lucide-react";
import "./APIExchangeView.css";

export interface CheckItem {
  readonly label: string;
  readonly detail?: string;
  readonly status: "pass" | "fail" | "pending";
}

interface APIExchangeViewProps {
  readonly title?: string;
  readonly request?: {
    readonly method: string;
    readonly url: string;
    readonly header?: string;
  };
  readonly checks?: readonly CheckItem[];
  readonly result?: {
    readonly label: string;
    readonly detail?: string;
    readonly status: "pass" | "fail";
  };
  readonly contentKey: string;
  readonly slideDirection?: "forward" | "backward";
}

const TABS = ["Elements", "Console", "Network", "Application"] as const;

function StatusIcon({ status }: { readonly status: CheckItem["status"] }): ReactNode {
  if (status === "pass") {
    return <Check size={12} className="sx-apx__icon-pass" aria-hidden />;
  }
  if (status === "fail") {
    return <X size={12} className="sx-apx__icon-fail" aria-hidden />;
  }
  return <Loader2 size={12} className="sx-apx__icon-pending sx-apx__spin" aria-hidden />;
}

/**
 * DevTools-style network/API inspector panel for Scenar tours.
 *
 * Renders a Chrome DevTools-like Network panel: an inbound request, a numbered
 * validation pipeline with pass/fail indicators, and a response status card.
 * Used to illustrate Stigmer API processing during token validation, identity
 * resolution, and authorization.
 *
 * Each validation row carries `data-cursor-target="check-N"` so a tour's
 * `set_cursor` interactions can walk the animated cursor down the pipeline in
 * sync with narration.
 *
 * Theme-adaptive (colors via `--scenar-*` tokens) and prop-driven so it can be
 * promoted to `@scenar/react` as a reusable shell with minimal change.
 */
export function APIExchangeView({
  title = "Stigmer API",
  request,
  checks,
  result,
  contentKey,
  slideDirection,
}: APIExchangeViewProps) {
  const slideX =
    slideDirection === "forward" ? 24 : slideDirection === "backward" ? -24 : 0;

  return (
    <div
      className="sx-apx"
      style={{ height: "var(--scenar-shell-height, 480px)" }}
    >
      {/* DevTools tab bar */}
      <div className="sx-apx__header">
        <div className="sx-apx__tabs">
          {TABS.map((tab) => (
            <span
              key={tab}
              className={
                tab === "Network"
                  ? "sx-apx__tab sx-apx__tab--active"
                  : "sx-apx__tab"
              }
            >
              {tab}
            </span>
          ))}
        </div>
        <div className="sx-apx__spacer" />
        <X size={12} className="sx-apx__close" aria-hidden />
      </div>

      {/* Toolbar */}
      <div className="sx-apx__toolbar">
        <Network size={12} className="sx-apx__toolbar-icon" aria-hidden />
        <span className="sx-apx__toolbar-title">{title}</span>
        <span className="sx-apx__toolbar-count">{checks?.length ?? 0} checks</span>
      </div>

      {/* Content */}
      <motion.div
        key={contentKey}
        className="sx-apx__content"
        initial={{ opacity: 0, x: slideX }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {/* Request */}
        {request && (
          <div className="sx-apx__card">
            <div className="sx-apx__card-head">
              <span className="sx-apx__card-label">Request</span>
            </div>
            <div className="sx-apx__req-body">
              <div className="sx-apx__req-line">
                <span className="sx-apx__method">{request.method}</span>
                <span className="sx-apx__req-url">{request.url}</span>
              </div>
              {request.header && (
                <div className="sx-apx__req-header">
                  <ChevronRight size={8} aria-hidden />
                  <span className="sx-apx__req-header-text">{request.header}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Validation pipeline */}
        {checks && checks.length > 0 && (
          <div className="sx-apx__card">
            <div className="sx-apx__card-head">
              <span className="sx-apx__card-label">Validation Pipeline</span>
            </div>
            <div>
              {checks.map((check, i) => (
                <div
                  key={check.label}
                  className="sx-apx__check"
                  data-cursor-target={`check-${i}`}
                >
                  <span className="sx-apx__check-num">{i + 1}</span>
                  <span className="sx-apx__check-icon">
                    <StatusIcon status={check.status} />
                  </span>
                  <div className="sx-apx__check-body">
                    <span className="sx-apx__check-label">{check.label}</span>
                    {check.detail && (
                      <span className="sx-apx__check-detail">{check.detail}</span>
                    )}
                  </div>
                  <span className="sx-apx__check-timing">
                    {check.status === "pass" ? `${2 + i}ms` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Response */}
        {result && (
          <div
            className={
              result.status === "pass"
                ? "sx-apx__result sx-apx__result--pass"
                : "sx-apx__result sx-apx__result--fail"
            }
          >
            <div className="sx-apx__result-head">
              <span className="sx-apx__card-label">Response</span>
            </div>
            <div className="sx-apx__result-body">
              {result.status === "pass" ? (
                <Check size={14} className="sx-apx__icon-pass" aria-hidden />
              ) : (
                <X size={14} className="sx-apx__icon-fail" aria-hidden />
              )}
              <span
                className={
                  result.status === "pass"
                    ? "sx-apx__result-label sx-apx__result-label--pass"
                    : "sx-apx__result-label sx-apx__result-label--fail"
                }
              >
                {result.label}
              </span>
            </div>
            {result.detail && (
              <div className="sx-apx__result-detail">{result.detail}</div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
