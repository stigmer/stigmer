/**
 * The addresses an organization's login app signs in to, as the forms take
 * them: a comma- or newline-separated list of tool URLs and Git hosts. The
 * server normalizes each and refuses one that is no address, or one another
 * login app of the organization already lists.
 */

/** The most addresses one login app may list (OAuthAppSpec.addresses). */
export const MAX_ADDRESSES = 20;

/** The addresses in a comma- or newline-separated list, blanks dropped. */
export function parseAddressList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((address) => address.trim())
    .filter(Boolean);
}
