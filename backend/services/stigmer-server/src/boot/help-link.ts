/**
 * What `getServerInfo` tells every client about where to ask for help.
 *
 * A person stuck on a server (at sign-in, on a failed step, at a refused
 * command) needs one place to ask, and only the server's operator knows
 * where that is: Stigmer Cloud's own ask page, a company's support desk or
 * team chat, or nowhere. The operator says it with two settings,
 * STIGMER_HELP_URL and STIGMER_HELP_LABEL, and the server announces it as
 * the `help` field of its public answer about itself, so the web console,
 * the desktop app and the command line read one source. Nothing about any
 * deployment's help is written into a client.
 *
 * {@link resolveHelpLink} decides as a pure function of the two settings,
 * so every rule is tested without a server. It is lenient like the native
 * client's setting (native-sign-in.ts): a bad value never stops the boot,
 * it is dropped with a warning naming the fix, because a console renders
 * the address as a link and a wrong one must never be served.
 *   - The address must be absolute, with an `https:`, `http:` or `mailto:`
 *     scheme; anything else (a relative path, `javascript:`) is dropped.
 *   - The label is at most {@link HELP_LABEL_MAX} characters; a longer one
 *     is replaced by {@link DEFAULT_HELP_LABEL}, as is an empty one.
 *   - A label with no address announces nothing and is warned as unused.
 */

/** The words a client shows when the operator set only the address. */
export const DEFAULT_HELP_LABEL = "Get help";

/** The longest label a server announces: it sits on one line in a sidebar. */
export const HELP_LABEL_MAX = 40;

/** The schemes a help address may carry: a web page or a mail address. */
const HELP_URL_SCHEMES: ReadonlySet<string> = new Set(["https:", "http:", "mailto:"]);

/** The two settings, as the configuration read them ("" when unset). */
export interface HelpLinkSources {
  /** STIGMER_HELP_URL. */
  readonly url: string;
  /** STIGMER_HELP_LABEL. */
  readonly label: string;
}

/** The announced link: an address and its words. */
export interface HelpLinkAnswer {
  readonly url: string;
  readonly label: string;
}

/** The answer, and what the composition root should warn about. */
export interface ResolvedHelpLink {
  /** What `getServerInfo` announces; undefined announces nothing. */
  readonly answer: HelpLinkAnswer | undefined;
  /** Boot warnings, each a sentence for the operator. */
  readonly warnings: readonly string[];
}

/** Resolves the help link the server announces from its two settings. */
export function resolveHelpLink(sources: HelpLinkSources): ResolvedHelpLink {
  const url = sources.url.trim();
  const label = sources.label.trim();

  if (url === "") {
    return {
      answer: undefined,
      warnings:
        label === ""
          ? []
          : [
              "STIGMER_HELP_LABEL is set but STIGMER_HELP_URL is not — a label with no address announces nothing; set the address, or unset the label",
            ],
    };
  }

  if (!isHelpUrl(url)) {
    return {
      answer: undefined,
      warnings: [
        `STIGMER_HELP_URL is not an absolute https:, http: or mailto: address ('${url}') — this server announces no help link; set a full address such as https://support.example.com`,
      ],
    };
  }

  if ([...label].length > HELP_LABEL_MAX) {
    return {
      answer: { url, label: DEFAULT_HELP_LABEL },
      warnings: [
        `STIGMER_HELP_LABEL is longer than ${HELP_LABEL_MAX} characters — the link says '${DEFAULT_HELP_LABEL}' instead; shorten it`,
      ],
    };
  }

  return { answer: { url, label: label === "" ? DEFAULT_HELP_LABEL : label }, warnings: [] };
}

/** Whether a value is an absolute address with a scheme a help link may carry. */
function isHelpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return HELP_URL_SCHEMES.has(parsed.protocol);
}
