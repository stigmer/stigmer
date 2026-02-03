import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names using clsx and tailwind-merge.
 * This utility handles conditional classes and resolves Tailwind conflicts.
 *
 * @example
 * cn("px-4 py-2", "px-6") // → "py-2 px-6" (px-6 wins)
 * cn("text-red-500", isError && "text-green-500") // → conditional
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date string into a human-readable format.
 *
 * @param dateString - The date string to format (ISO format: YYYY-MM-DD)
 * @returns A formatted date string (e.g., "February 3, 2026")
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Formats a date string into a short, compact format.
 *
 * @param dateString - The date string to format (ISO format: YYYY-MM-DD)
 * @returns A formatted date string (e.g., "Feb 3, 2026")
 */
export function formatShortDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Removes markdown file extensions (.md) from a slug.
 *
 * @param slug - The slug string to clean
 * @returns The slug without markdown file extensions
 */
export function cleanSlug(slug: string): string {
  return slug.replace(/\.md$/i, "");
}

/**
 * Generates a clean text excerpt from markdown content.
 * Removes markdown symbols, code blocks, and formatting.
 *
 * @param content - The markdown content to generate excerpt from
 * @param maxLength - Maximum length of the excerpt (default: 500)
 * @returns Clean text excerpt without markdown symbols
 */
export function generateExcerpt(
  content: string,
  maxLength: number = 500
): string {
  // Remove frontmatter
  const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---/, "");

  // Remove markdown symbols and formatting
  const cleanText = contentWithoutFrontmatter
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove headers
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Remove HTML tags
    .replace(/<[^>]*>/g, "")
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, "")
    // Remove blockquotes
    .replace(/^>\s+/gm, "")
    // Remove list markers
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    // Remove emphasis
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, "$1")
    // Remove tables
    .replace(/\|.*\|/g, "")
    // Remove multiple newlines and spaces
    .replace(/\n\s*\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

  // If content is shorter than maxLength, return as is
  if (cleanText.length <= maxLength) {
    return cleanText;
  }

  // Truncate to maxLength and add ellipsis if needed
  const truncated = cleanText.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + "...";
  }

  return truncated + "...";
}

/**
 * Debounces a function call.
 *
 * @param fn - The function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
