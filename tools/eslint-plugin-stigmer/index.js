"use strict";

const noMainTokensInSidebar = require("./rules/no-main-tokens-in-sidebar");
const noNativeTitle = require("./rules/no-native-title");
const noTokenOpacityModifiers = require("./rules/no-token-opacity-modifiers");
const sdkImportBoundaries = require("./rules/sdk-import-boundaries");

const plugin = {
  meta: {
    name: "eslint-plugin-stigmer",
    version: "0.0.0",
  },
  rules: {
    "no-main-tokens-in-sidebar": noMainTokensInSidebar,
    "no-native-title": noNativeTitle,
    "no-token-opacity-modifiers": noTokenOpacityModifiers,
    "sdk-import-boundaries": sdkImportBoundaries,
  },
};

module.exports = plugin;
