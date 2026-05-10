/**
 * Re-export of Sonner's `toast` function with Stigmer defaults.
 *
 * Platform builders use this as their primary feedback mechanism:
 * ```tsx
 * import { toast } from "@stigmer/react";
 *
 * toast.success("Agent created");
 * toast.error("Failed to save");
 * toast("Skill removed", { action: { label: "Undo", onClick: undo } });
 * ```
 */
export { toast } from "sonner";
