import type { Toaster } from "sonner";

/** Props for the {@link StigmerToaster} component. */
export type StigmerToasterProps = Omit<
  React.ComponentProps<typeof Toaster>,
  "theme"
>;
