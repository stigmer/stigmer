/**
 * Side-effect entry for bundler consumers: `import "@stigmer/embed/define"`
 * registers `<stigmer-agent>` on load. Elements still need an app origin —
 * via the `app-origin` attribute or {@link setDefaultAppOrigin} — because a
 * bundled import has no script URL to derive it from.
 */

import { defineStigmerAgent } from "./element.js";

defineStigmerAgent();
