"use client";

import * as React from "react";
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// Register languages with Prism
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("json", json);

export type CodeBlockSize = "sm" | "md" | "lg";

export interface CodeBlockProps {
  /** The code to display */
  code: string;
  /** The programming language for syntax highlighting */
  language: string;
  /** Whether to show the copy button */
  showCopy?: boolean;
  /** Whether to show the language badge */
  showLanguage?: boolean;
  /** Size variant - affects font size */
  size?: CodeBlockSize;
  /** Additional class name for the container */
  className?: string;
}

const sizeStyles: Record<CodeBlockSize, string> = {
  sm: "text-[11px]",
  md: "text-sm",
  lg: "text-base",
};

/**
 * Code block component with IDE-like syntax highlighting.
 * 
 * Features:
 * - Syntax highlighting for multiple languages (YAML, Go, Bash, TypeScript, Python, etc.)
 * - Copy-to-clipboard functionality
 * - Language badge
 * - Responsive sizing
 * - Accessible with ARIA live region for copy status
 * 
 * @example
 * <CodeBlock
 *   code={`apiVersion: v1\nkind: Agent`}
 *   language="yaml"
 *   size="md"
 * />
 */
export function CodeBlock({
  code,
  language,
  showCopy = true,
  showLanguage = true,
  size = "md",
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  // Dark-only site: the syntax theme is a constant, not a theme resolution.
  const syntaxTheme = oneDark;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const textArea = document.createElement("textarea");
      textArea.value = code;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Map common language aliases
  const languageMap: Record<string, string> = {
    bash: "bash",
    shell: "bash",
    sh: "bash",
    yaml: "yaml",
    yml: "yaml",
    go: "go",
    golang: "go",
    ts: "typescript",
    typescript: "typescript",
    js: "javascript",
    javascript: "javascript",
    py: "python",
    python: "python",
    java: "java",
    rust: "rust",
    json: "json",
  };

  const normalizedLanguage = languageMap[language.toLowerCase()] || language;

  return (
    <div className={cn(
      "relative group rounded-lg overflow-hidden border border-border bg-muted/30",
      className
    )}>
      {/* ARIA live region - announces copy status to screen readers */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {copied && "Code copied to clipboard"}
      </div>

      {/* Header with language badge and copy button */}
      {(showLanguage || showCopy) && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
          {showLanguage && (
            <span className="text-xs font-mono text-muted-foreground uppercase">
              {language}
            </span>
          )}
          {showCopy && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className={cn(
                "h-7 px-2 text-xs",
                "opacity-0 group-hover:opacity-100 transition-opacity",
                "focus:opacity-100"
              )}
              aria-label={copied ? "Copied to clipboard" : `Copy ${language} code`}
            >
              <Icon
                name={copied ? "check" : "copy"}
                size="xs"
                className={cn(copied && "text-green-500")}
                aria-hidden="true"
              />
              <span className="ml-1">{copied ? "Copied!" : "Copy"}</span>
            </Button>
          )}
        </div>
      )}

      {/* Code content with syntax highlighting */}
      <div className={cn("p-4 overflow-x-auto scrollbar-thin", sizeStyles[size])}>
        <SyntaxHighlighter
          language={normalizedLanguage}
          style={syntaxTheme}
          useInlineStyles={true}
          customStyle={{
            margin: 0,
            padding: 0,
            background: "transparent",
            fontSize: "inherit",
            lineHeight: "1.6",
          }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
              fontSize: "inherit",
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

/**
 * Minimal code snippet without header - for compact displays.
 * Used in architecture diagrams and smaller code displays.
 */
export interface CodeSnippetProps {
  /** The code to display */
  code: string;
  /** The programming language for syntax highlighting */
  language: string;
  /** Size variant - affects font size */
  size?: CodeBlockSize;
  /** Additional class name for the container */
  className?: string;
}

export function CodeSnippet({
  code,
  language,
  size = "sm",
  className,
}: CodeSnippetProps) {
  // Dark-only site: the syntax theme is a constant, not a theme resolution.
  const syntaxTheme = oneDark;

  const languageMap: Record<string, string> = {
    bash: "bash",
    shell: "bash",
    sh: "bash",
    yaml: "yaml",
    yml: "yaml",
    go: "go",
    golang: "go",
    ts: "typescript",
    typescript: "typescript",
    js: "javascript",
    javascript: "javascript",
    py: "python",
    python: "python",
    java: "java",
    rust: "rust",
    json: "json",
  };

  const normalizedLanguage = languageMap[language.toLowerCase()] || language;

  return (
    <div className={cn(
      "overflow-x-auto scrollbar-thin",
      sizeStyles[size],
      className
    )}>
      <SyntaxHighlighter
        language={normalizedLanguage}
        style={syntaxTheme}
        useInlineStyles={true}
        customStyle={{
          margin: 0,
          padding: 0,
          background: "transparent",
          fontSize: "inherit",
          lineHeight: "1.6",
        }}
        codeTagProps={{
          style: {
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            fontSize: "inherit",
          },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
