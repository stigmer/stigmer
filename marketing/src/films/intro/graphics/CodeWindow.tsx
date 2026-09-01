import type * as React from "react";

/**
 * The film's code-window chrome — same visual constants as the S3b
 * YamlPanel (scenes/YamlPanel.tsx) so every "editor" surface in the film
 * is the same window, at whatever size a graphic needs.
 */
export const CodeWindow = ({
  title,
  width,
  height,
  children,
  style,
}: {
  title: string;
  width: number;
  height: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => (
  <div
    style={{
      width,
      height,
      borderRadius: 16,
      overflow: "hidden",
      background: "#101418",
      boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
      border: "1px solid rgba(255,255,255,0.08)",
      ...style,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 18px",
        background: "#161b21",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
      ))}
      <div style={{ marginLeft: 12, color: "#8b98a5", fontSize: 18 }}>{title}</div>
    </div>
    <div style={{ height: height - 46, overflow: "hidden" }}>{children}</div>
  </div>
);

/** Just enough syntax color for YAML to read as an editor (YamlPanel's palette). */
export const yamlColor = (line: string): string => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) return "#5f6b76";
  if (/^[\w.-]+:/.test(trimmed)) return "#7dd3a8";
  if (trimmed.startsWith("-")) return "#d3dae1";
  return "#aeb8c2";
};
