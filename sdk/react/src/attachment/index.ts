export { MAX_MESSAGE_FILES, useFileUploads, toAttachmentView } from "./useFileUploads.js";
export type {
  AddFilesOptions,
  FileHandOff,
  FileUploadPhase,
  FileUploadEntry,
  UseFileUploadsOptions,
  UseFileUploadsReturn,
} from "./useFileUploads.js";

export { AttachmentChipList } from "./AttachmentChipList.js";
export type { AttachmentChipListProps } from "./AttachmentChipList.js";

export {
  MAX_ATTACHMENT_BYTES,
  detectContentType,
  formatFileSize,
  uniquifyFilename,
  validateAttachmentSize,
} from "./attachment-utils.js";

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
  VisionPreflightAttachment,
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
