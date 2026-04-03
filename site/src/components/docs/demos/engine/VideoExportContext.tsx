"use client";

import { createContext, type ReactNode, useContext } from "react";

interface VideoExportSettings {
  /** Whether the component tree is rendering inside the video export pipeline. */
  isVideoExport: boolean;
  /** Hide interactive playback controls (prev/play/next/dots). */
  hideControls: boolean;
  /** Start with narration unmuted so step timing accounts for audio duration. */
  initialMuted: boolean;
}

const defaults: VideoExportSettings = {
  isVideoExport: false,
  hideControls: false,
  initialMuted: true,
};

const VideoExportContext = createContext<VideoExportSettings>(defaults);

/**
 * Wrap scenario components in this provider when rendering for video
 * capture. Sets unmuted timing and hides interactive controls so the
 * recorded output looks like a polished product walkthrough.
 */
export function VideoExportProvider({ children }: { children: ReactNode }) {
  return (
    <VideoExportContext.Provider
      value={{ isVideoExport: true, hideControls: true, initialMuted: false }}
    >
      {children}
    </VideoExportContext.Provider>
  );
}

export function useVideoExport(): VideoExportSettings {
  return useContext(VideoExportContext);
}
