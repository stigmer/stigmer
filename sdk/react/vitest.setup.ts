import { configure } from "@testing-library/react";

// Portaled Base UI content (menus, dialogs, popovers) mounts asynchronously,
// so tests wait for it with `findBy*`/`waitFor`. Testing-library's default
// 1s async timeout races that mount on loaded CI runners — the same test
// passes locally and flakes in CI. Raise the suite-wide default instead of
// sprinkling per-call timeouts: passing tests are unaffected (waits resolve
// the moment the element appears); only genuinely failing waits report later.
//
// Kept below the raised vitest testTimeout (vitest.config.ts) so a failing
// wait still surfaces the informative testing-library error with a DOM dump,
// never a bare vitest "test timed out".
configure({ asyncUtilTimeout: 4000 });
