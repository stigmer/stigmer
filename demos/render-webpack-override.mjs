/**
 * Remotion webpack override for `scenar render` runs in this workspace.
 *
 * The workspace `@stigmer/react` resolves to raw TypeScript source
 * (`"exports": { ".": "./src/index.ts" }`) whose relative imports carry
 * NodeNext `.js` suffixes. Vite maps those to `.ts`/`.tsx` out of the box;
 * Remotion's webpack needs `resolve.extensionAlias` to do the same.
 *
 * Usage: `scenar render tours/<slug> --webpack-override
 * ../render-webpack-override.mjs` (path relative to the CWD of the run).
 */
export default (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: {
      ...(config.resolve?.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
});
