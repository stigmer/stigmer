"use client";

/**
 * What a person reads in place of a bare refusal when the organization they
 * reached requires sign-in through its SSO provider (SSO_REQUIRED): the
 * organization's own sentence, a button to sign in through that provider,
 * and, for someone who worked there under another sign-in, the way to move
 * their access to the account the provider makes for them.
 *
 * The host does the sign-in and the routing: `onSignIn` starts the
 * provider's sign-in for the organization, `moveHref` is where its access
 * move starts.
 */
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { useSsoProvider } from "./useSsoProvider.js";
import type { SsoProviderInfo } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { ssoRequirementOf } from "./sso-requirement.js";

/** Props for {@link SsoRequiredNotice}. */
export interface SsoRequiredNoticeProps {
  /** The refusal; the notice renders nothing for any other error. */
  readonly error: unknown;
  /** Start signing in through the provider, for the organization. */
  readonly onSignIn: (provider: SsoProviderInfo, org: string) => void;
  /** Where the access move starts for the organization; absent, it is not offered. */
  readonly moveHref?: (org: string) => string;
  readonly className?: string;
}

export function SsoRequiredNotice({ error, onSignIn, moveHref, className }: SsoRequiredNoticeProps) {
  const requirement = ssoRequirementOf(error);
  const { ssoProvider } = useSsoProvider(requirement?.org || null);
  if (requirement === null) {
    return null;
  }
  return (
    <div
      role="alert"
      className={cn("stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4 stg:text-sm", className)}
    >
      <p className="stg:text-foreground stg:font-medium">{getUserMessage(error)}</p>
      <p className="stg:text-muted-foreground stg:mt-1 stg:text-xs">
        You are signed in another way, which this organization no longer accepts.
      </p>
      <div className="stg:mt-3 stg:flex stg:flex-wrap stg:items-center stg:gap-3">
        <button
          type="button"
          disabled={ssoProvider === null}
          onClick={() => ssoProvider && onSignIn(ssoProvider, requirement.org)}
          className="stg:rounded-md stg:bg-primary stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-primary-foreground stg:disabled:opacity-50"
        >
          {ssoProvider ? `Sign in with ${ssoProvider.displayName}` : "Sign in with SSO"}
        </button>
        {moveHref && (
          <a href={moveHref(requirement.org)} className="stg:text-primary stg:text-xs stg:font-medium stg:hover:underline">
            Bring my access with me
          </a>
        )}
      </div>
    </div>
  );
}
