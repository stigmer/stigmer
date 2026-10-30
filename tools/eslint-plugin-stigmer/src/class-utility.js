"use strict";

/**
 * The utility of one class token, shared by the rules that judge what a class
 * paints (`colours-from-tokens`, `no-fill-token-text`): what follows the last
 * `:` outside brackets, so variants (`stg:hover:`, `[&>p]:`, `has-[#id]:`)
 * are dropped and a value holding `:` (`color:#fff`) is kept, with a leading
 * `!` dropped too. A scan, not a pattern, so no input makes it backtrack.
 */
function utilityOf(className) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < className.length; i += 1) {
    const ch = className[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return className.slice(start).replace(/^!/, "");
}

module.exports = { utilityOf };
