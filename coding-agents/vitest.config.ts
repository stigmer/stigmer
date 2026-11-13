// The coding-agent plugin's suite: the built plugin read by Stigmer's own
// plugin reader, every manifest and marketplace file, and the guide.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
