/**
 * No RPCs — every beat renders from local fixtures. The provider exists for
 * the theme: `ManagementShell` is console-depicting chrome colored with the
 * real `--stgm-sidebar-*` tokens, and `createStigmerPreview` is what puts
 * the compiled @stigmer/react stylesheet + the `.stgm` scope (with the
 * embed's color mode) into the bundle.
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {});
