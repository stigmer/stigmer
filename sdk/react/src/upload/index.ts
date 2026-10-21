export { MAX_MESSAGE_FILES, useFileUploads, toFileChipView } from "./useFileUploads.js";
export type {
  AddFilesOptions,
  FileHandOff,
  FileUploadPhase,
  FileUploadEntry,
  UseFileUploadsOptions,
  UseFileUploadsReturn,
} from "./useFileUploads.js";

export { FileChipList } from "./FileChipList.js";
export type { FileChipListProps } from "./FileChipList.js";

export {
  MAX_FILE_BYTES,
  detectContentType,
  uniquifyFilename,
  validateFileSize,
} from "./upload-utils.js";

export { extractClipboardFiles } from "./clipboard.js";
export type { ClipboardFilesSource } from "./clipboard.js";

export { prepareImageForVision } from "./prepare-image.js";
export {
  assessVisionPreflight,
  visionPreflightMessage,
} from "./vision-preflight.js";
export type {
  AssessVisionPreflightOptions,
  VisionPreflight,
  VisionPreflightFile,
  VisionPreflightMessageOptions,
  VisionPreflightReason,
  VisionPreflightWarning,
} from "./vision-preflight.js";
export {
  MAX_VISION_LONG_EDGE_PX,
  MAX_VISION_PIXELS,
  exceedsVisionResolution,
  fitToVisionResolution,
} from "./vision-fit.js";
export type { VisionFitSize } from "./vision-fit.js";
