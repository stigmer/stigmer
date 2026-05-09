"use client";

/**
 * Re-export of the SDK's themed toaster.
 *
 * The Console previously had its own Sonner wrapper here. Now the
 * canonical implementation lives in @stigmer/react (SDK-first per DD-001).
 * This file remains as a re-export to avoid churn across existing imports.
 */
export { StigmerToaster as Toaster } from "@stigmer/react";
