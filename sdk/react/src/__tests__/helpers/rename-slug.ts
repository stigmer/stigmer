import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * Rename a resource through its page's slug field (`RenameSlugField`) the
 * way a person does, and fail with the exact stage that died.
 *
 * WHY THIS EXISTS: a page renders its slug field behind a permission check
 * and a fetch, and the field's Rename button enables only once the typed
 * slug differs from the stored one. A test that types and clicks in one
 * breath, then waits the default second for the rename, passes at human
 * speed and times out on a loaded runner (the vmForks and coverage pools)
 * as "expected spy to be called once, but got 0 times", which names
 * neither the field, the click nor the request. Each stage below waits on
 * its own observable fact with a budget sized for that load.
 *
 * Failure semantics, as in `open-menu.ts`: each stage throws a named error
 * (field never rendered / Rename never enabled), and there are no retries:
 * one click is sent, so a page that drops it fails rather than being
 * clicked again. The caller keeps its own assertion on what the rename
 * reported, and waits for it with the same budget ({@link RENAME_BUDGET_MS}).
 *
 * Not a `.test` file and inside `__tests__` deliberately: vitest does not
 * collect it, and the build/typedoc excludes keep it out of the published
 * package.
 */

/** How long each stage, and the caller's wait for the rename, may take. */
export const RENAME_BUDGET_MS = 5000;

/** Type `slug` into the field labelled `label` ("Slug") and press Rename once it enables. */
export async function renameThroughSlugField(slug: string, label = "Slug"): Promise<void> {
  // Stage 1: the field, which renders only after the page's reads land.
  let field: HTMLElement;
  try {
    field = await screen.findByLabelText(label, undefined, { timeout: RENAME_BUDGET_MS });
  } catch (cause) {
    throw new Error(
      `renameThroughSlugField stage "field": no field labelled ${JSON.stringify(label)} ` +
        `rendered within ${RENAME_BUDGET_MS} ms (the page's reads or its permission check never settled).`,
      { cause },
    );
  }

  fireEvent.change(field, { target: { value: slug } });

  // Stage 2: Rename enables once the field holds a new slug and nothing is in flight.
  const button = screen.getByRole("button", { name: "Rename" });
  await waitFor(
    () => {
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error(
          `renameThroughSlugField stage "enabled": Rename stayed disabled after typing ` +
            `${JSON.stringify(slug)} (field value ${JSON.stringify((field as HTMLInputElement).value)}).`,
        );
      }
    },
    { timeout: RENAME_BUDGET_MS },
  );

  // Stage 3: the one click.
  fireEvent.click(button);
}
