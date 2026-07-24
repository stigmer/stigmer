import { docs, blogPosts } from "~source";
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx/runtime/next";
import { resolveMetaIcon } from "./meta-icons";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  // Lets meta.json entries carry an `icon` name, rendered in the sidebar and
  // layout tabs. Without a resolver Fumadocs ignores the field entirely.
  icon: resolveMetaIcon,
});

export const blog = loader({
  baseUrl: "/blog",
  source: createMDXSource(blogPosts),
});
