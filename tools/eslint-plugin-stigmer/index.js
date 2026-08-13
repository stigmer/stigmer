"use strict";

const noHardcodedBackdrop = require("./rules/no-hardcoded-backdrop");
const noLiteralDomIds = require("./rules/no-literal-dom-ids");
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
    "no-hardcoded-backdrop": noHardcodedBackdrop,
    "no-literal-dom-ids": noLiteralDomIds,
    "no-main-tokens-in-sidebar": noMainTokensInSidebar,
    "no-native-title": noNativeTitle,
    "no-token-opacity-modifiers": noTokenOpacityModifiers,
    "sdk-import-boundaries": sdkImportBoundaries,
  },
};

module.exports = plugin;
