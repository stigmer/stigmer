/**
 * The licence classifier: each class from the text a real licence file
 * opens with, and the one rule the verdict reads from it.
 *
 * Pins: MIT by title and by its grant sentence; Apache by title and
 * version; BSD by name and by its redistribution clause, INCLUDING the
 * "All rights reserved" copyright line every BSD text carries (the order of
 * the checks is what keeps BSD from reading as reserved); a text that only
 * reserves rights; and that anything else stays `unrecognised` rather than
 * becoming a permission nobody granted.
 */

import { describe, expect, it } from "vitest";

import { classifyLicenceText, isRedistributable, type LicenceClass } from "../scripts/audit/licence.js";

describe("classifyLicenceText", () => {
  it("reads MIT from its title, and from the grant sentence when a copyright line comes first", () => {
    expect(classifyLicenceText("MIT License\n\nCopyright (c) 2025 Cursor\n\nPermission is hereby granted...")).toBe("mit");
    expect(classifyLicenceText("Copyright (c) 2025 Someone\n\nPermission is hereby granted, free of charge, to any person")).toBe("mit");
  });

  it("reads Apache 2.0 from the standard opening", () => {
    expect(classifyLicenceText("                                 Apache License\n                           Version 2.0, January 2004\n")).toBe("apache-2.0");
  });

  it("reads BSD before it can read the 'All rights reserved' line every BSD text carries", () => {
    const bsd3 = "BSD 3-Clause License\n\nCopyright (c) 2025, Example\nAll rights reserved.\n\nRedistribution and use in source and binary forms";
    expect(classifyLicenceText(bsd3)).toBe("bsd");
    const bsdNoTitle = "Copyright (c) 2025, Example\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without modification";
    expect(classifyLicenceText(bsdNoTitle)).toBe("bsd");
  });

  it("reads a text that only reserves rights as all-rights-reserved", () => {
    expect(classifyLicenceText("Copyright Anthropic, PBC. All rights reserved.\n")).toBe("all-rights-reserved");
  });

  it("leaves anything else unrecognised rather than guessing a grant", () => {
    expect(classifyLicenceText("")).toBe("unrecognised");
    expect(classifyLicenceText("This software is provided under the Vendor Terms of Service.")).toBe("unrecognised");
    expect(classifyLicenceText("GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007")).toBe("unrecognised");
  });

  it("only looks at the head of the file", () => {
    const deepMit = `${"Some preamble line\n".repeat(20)}MIT License`;
    expect(classifyLicenceText(deepMit)).toBe("unrecognised");
  });
});

describe("isRedistributable", () => {
  const expectations: Record<LicenceClass, boolean> = {
    mit: true,
    "apache-2.0": true,
    bsd: true,
    "all-rights-reserved": false,
    unrecognised: false,
    none: false,
  };
  for (const [licence, redistributable] of Object.entries(expectations) as [LicenceClass, boolean][]) {
    it(`${licence}: ${redistributable ? "may" : "may not"} be copied into the catalogue`, () => {
      expect(isRedistributable(licence)).toBe(redistributable);
    });
  }
});
