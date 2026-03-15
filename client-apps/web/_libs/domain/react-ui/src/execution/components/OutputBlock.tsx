"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@stigmer/theme";

interface OutputBlockProps {
  content: string;
  isStreaming?: boolean;
  model?: string;
  className?: string;
}

export const OutputBlock = memo(function OutputBlock({
  content,
  isStreaming = false,
  model,
  className,
}: OutputBlockProps) {
  if (!content && !isStreaming) return null;

  return (
    <div className={cn("relative", className)}>
      <div className="prose prose-sm dark:prose-invert [&_pre]:bg-muted [&_code]:bg-muted max-w-none break-words [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:before:content-none [&_code]:after:content-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_table]:text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        {isStreaming && <StreamingCursor />}
      </div>
      {model && !isStreaming && (
        <p className="text-muted-foreground/60 mt-1.5 text-[10px]">{model}</p>
      )}
    </div>
  );
});

function StreamingCursor() {
  return (
    <span
      className="bg-foreground ml-0.5 inline-block h-4 w-0.5 animate-pulse align-text-bottom"
      aria-label="Generating..."
    />
  );
}
