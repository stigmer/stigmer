/**
 * The rename table of a contract rename, computed from the contract itself.
 *
 * A rename of the protobuf contract (a package moved, a message, field, enum
 * value, service or method renamed) is written by hand in `apis/ai/stigmer`
 * and nowhere else; every other name that follows it is derived. This module
 * pairs two buf images (`buf build --exclude-source-info -o <file>.json`), the
 * base and the head, element by element, and answers what each element was
 * called before and is called now, in the contract and in each language's
 * generated code.
 *
 * Pairing never reads the names it is trying to pair. Files pair by path, or,
 * when a directory moved, by base name inside the moved directory; messages,
 * enums, services and methods pair by name first and the rest by position;
 * fields pair by number and enum values by number, which a rename never
 * changes. An element the head adds is listed as added, because a rename may
 * come with a new field. An element the base had and the head lost, or two
 * leftovers that cannot be paired one to one, stop the table: that is a
 * deletion or a reshuffle, not a rename, and no derived rewrite is safe on it.
 *
 * The derived names follow the generators the repository pins (protobuf-es v2
 * for TypeScript, protoc-gen-go for Go): a TypeScript message is its nested
 * path joined by `_` with a `Schema` twin, a field its lower camel case, an
 * enum value its name without the enum's screaming-snake prefix when every
 * value carries it; a Go field is its camel case with a `Get` getter, an enum
 * value `<Enum>_<VALUE>`. A name one old identifier would map to two
 * different new ones is a conflict, and the table refuses it, since a rewrite
 * that sees only the identifier could not choose.
 */

/** Thrown when two images do not describe a rename. */
export class RenameTableError extends Error {
  constructor(problems) {
    super(`not a rename:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

/** protobuf's own lower camel case of a snake-case name (protoc's json_name rule). */
export function protoCamelCase(snake) {
  let out = "";
  let upper = false;
  for (const ch of snake) {
    if (ch === "_") {
      upper = true;
    } else if (upper) {
      out += ch.toUpperCase();
      upper = false;
    } else {
      out += ch;
    }
  }
  return out;
}

/** protoc-gen-go's GoCamelCase: `agent_run_id` is `AgentRunId`, `Outer.Inner` is `Outer_Inner`. */
export function goCamelCase(name) {
  const lower = (c) => c >= "a" && c <= "z";
  const digit = (c) => c >= "0" && c <= "9";
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === "." && i + 1 < name.length && lower(name[i + 1])) {
      continue;
    } else if (c === ".") {
      out += "_";
    } else if (c === "_" && (i === 0 || name[i - 1] === ".")) {
      out += "X";
    } else if (c === "_" && i + 1 < name.length && lower(name[i + 1])) {
      continue;
    } else if (digit(c)) {
      out += c;
    } else {
      out += lower(c) ? c.toUpperCase() : c;
      while (i + 1 < name.length && lower(name[i + 1])) {
        out += name[i + 1];
        i++;
      }
    }
  }
  return out;
}

/** `AgentRunSummaryTimeWindow` as protobuf-es spells its value prefix: `AGENT_RUN_SUMMARY_TIME_WINDOW_`. */
function screamingSnakePrefix(enumName) {
  return `${enumName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_`;
}

/** The TypeScript name of each value of an enum, protobuf-es v2's prefix rule. */
export function tsEnumValueNames(enumName, valueNames) {
  const prefix = screamingSnakePrefix(enumName);
  const strip = valueNames.every((v) => v.startsWith(prefix) && /^[A-Za-z_]/.test(v.slice(prefix.length)));
  return valueNames.map((v) => (strip ? v.slice(prefix.length) : v));
}

/**
 * Pair two lists of named things: same name first, then the leftovers by
 * position. Returns `[pairs, added]` and pushes a problem when the base has a
 * leftover the head cannot take.
 */
function pairByNameThenPosition(base, head, where, problems) {
  const headByName = new Map(head.map((h) => [h.name, h]));
  const pairs = [];
  const baseLeft = [];
  const taken = new Set();
  for (const b of base) {
    const h = headByName.get(b.name);
    if (h) {
      pairs.push([b, h]);
      taken.add(h);
    } else {
      baseLeft.push(b);
    }
  }
  const headLeft = head.filter((h) => !taken.has(h));
  if (baseLeft.length > 0 && baseLeft.length !== headLeft.length) {
    problems.push(
      `${where}: ${baseLeft.map((b) => b.name).join(", ")} in the base pair with nothing one to one in the head (${
        headLeft.map((h) => h.name).join(", ") || "none left"
      })`,
    );
    return [pairs, []];
  }
  baseLeft.forEach((b, i) => pairs.push([b, headLeft[i]]));
  return [pairs, baseLeft.length === 0 ? headLeft : []];
}

/** Pair by a numeric key (field and enum value numbers). */
function pairByNumber(base, head, where, problems) {
  const headByNumber = new Map(head.map((h) => [h.number, h]));
  const pairs = [];
  for (const b of base) {
    const h = headByNumber.get(b.number);
    if (!h) {
      problems.push(`${where}: ${b.name} = ${b.number} is gone from the head`);
      continue;
    }
    pairs.push([b, h]);
    headByNumber.delete(b.number);
  }
  return [pairs, [...headByNumber.values()]];
}

/** A proto path as the generators spell it in a descriptor's name: `a/b-c.d` is `a_b_c_d`. */
function fileIdentifier(stem) {
  return stem.replace(/[^A-Za-z0-9]/g, "_");
}

function dirOf(path) {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

function baseName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Pair files by path, then moved directories by the set of base names they hold. */
function pairFiles(baseFiles, headFiles, problems) {
  const headByName = new Map(headFiles.map((f) => [f.name, f]));
  const pairs = [];
  const baseLeft = [];
  for (const b of baseFiles) {
    const h = headByName.get(b.name);
    if (h) {
      pairs.push([b, h]);
      headByName.delete(b.name);
    } else {
      baseLeft.push(b);
    }
  }
  const group = (files) => {
    const byDir = new Map();
    for (const f of files) {
      const d = dirOf(f.name);
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d).push(f);
    }
    return byDir;
  };
  const key = (files) =>
    files
      .map((f) => baseName(f.name))
      .sort()
      .join("\n");
  const headDirs = group([...headByName.values()]);
  const added = new Set(headByName.values());
  for (const [dir, files] of group(baseLeft)) {
    const candidates = [...headDirs.entries()].filter(([, hs]) => key(hs) === key(files));
    if (candidates.length !== 1) {
      problems.push(
        `files in ${dir} (${files.map((f) => baseName(f.name)).join(", ")}) pair with ${candidates.length} moved directories in the head, not one`,
      );
      continue;
    }
    const [headDir, headDirFiles] = candidates[0];
    headDirs.delete(headDir);
    for (const b of files) {
      const h = headDirFiles.find((f) => baseName(f.name) === baseName(b.name));
      pairs.push([b, h]);
      added.delete(h);
    }
  }
  return [pairs, [...added]];
}

/**
 * Compute the table from two parsed buf JSON images, the base and the head.
 * Element names inside a file are carried relative to its package, dotted
 * (`Outer.Inner`), because each generator derives its own spelling from that:
 * protobuf-es joins with `_`, protoc-gen-go camel-cases the dotted name.
 */
export function computeRenameTable(base, head) {
  const problems = [];
  const conflicts = [];
  const renamed = [];
  const added = [];
  const files = [];
  const packages = new Map();
  const typeNames = new Map();
  const json = new Map();
  const rpc = new Map();
  const ts = new Map();
  const goIdentifiers = new Map();

  const note = (kind, from, to) => {
    if (from !== to) renamed.push({ kind, from, to });
  };
  const put = (map, from, to, where) => {
    if (from === to) return;
    const had = map.get(from);
    if (had !== undefined && had !== to) {
      conflicts.push(`${where}: ${from} is renamed to both ${had} and ${to}`);
      return;
    }
    map.set(from, to);
  };
  const tsName = (rel) => rel.replaceAll(".", "_");

  const walkEnum = (b, h, bPkg, hPkg, bRel, hRel, bGoValueScope, hGoValueScope) => {
    const bFull = `${bPkg}.${bRel}`;
    const hFull = `${hPkg}.${hRel}`;
    note("enum", bFull, hFull);
    put(typeNames, bFull, hFull, "type name");
    put(ts, tsName(bRel), tsName(hRel), bFull);
    put(ts, `${tsName(bRel)}Schema`, `${tsName(hRel)}Schema`, bFull);
    put(goIdentifiers, goCamelCase(bRel), goCamelCase(hRel), bFull);
    const bValues = b.value ?? [];
    const hValues = h.value ?? [];
    const [pairs, more] = pairByNumber(bValues, hValues, bFull, problems);
    for (const v of more) added.push({ kind: "enumValue", name: `${hFull}.${v.name}` });
    const bTs = tsEnumValueNames(
      b.name,
      bValues.map((v) => v.name),
    );
    const hTs = tsEnumValueNames(
      h.name,
      hValues.map((v) => v.name),
    );
    const bTsOf = new Map(bValues.map((v, i) => [v.number, bTs[i]]));
    const hTsOf = new Map(hValues.map((v, i) => [v.number, hTs[i]]));
    for (const [bv, hv] of pairs) {
      const where = `${bFull}.${bv.name}`;
      note("enumValue", where, `${hFull}.${hv.name}`);
      put(json, bv.name, hv.name, where);
      put(ts, bTsOf.get(bv.number), hTsOf.get(hv.number), where);
      put(goIdentifiers, `${bGoValueScope}_${bv.name}`, `${hGoValueScope}_${hv.name}`, where);
    }
  };

  const walkMessage = (b, h, bPkg, hPkg, bRel, hRel) => {
    const bFull = `${bPkg}.${bRel}`;
    const hFull = `${hPkg}.${hRel}`;
    const bGo = goCamelCase(bRel);
    const hGo = goCamelCase(hRel);
    note("message", bFull, hFull);
    put(typeNames, bFull, hFull, "type name");
    put(ts, tsName(bRel), tsName(hRel), bFull);
    put(ts, `${tsName(bRel)}Schema`, `${tsName(hRel)}Schema`, bFull);
    put(goIdentifiers, bGo, hGo, bFull);

    const [fieldPairs, moreFields] = pairByNumber(b.field ?? [], h.field ?? [], bFull, problems);
    for (const f of moreFields) added.push({ kind: "field", name: `${hFull}.${f.name}` });
    for (const [bf, hf] of fieldPairs) {
      const where = `${bFull}.${bf.name}`;
      note("field", where, `${hFull}.${hf.name}`);
      put(json, bf.jsonName ?? protoCamelCase(bf.name), hf.jsonName ?? protoCamelCase(hf.name), where);
      put(ts, protoCamelCase(bf.name), protoCamelCase(hf.name), where);
      const bfGo = goCamelCase(bf.name);
      const hfGo = goCamelCase(hf.name);
      put(goIdentifiers, bfGo, hfGo, where);
      put(goIdentifiers, `Get${bfGo}`, `Get${hfGo}`, where);
      if (bf.oneofIndex !== undefined) put(goIdentifiers, `${bGo}_${bfGo}`, `${hGo}_${hfGo}`, where);
    }
    const [oneofPairs, moreOneofs] = pairByNameThenPosition(
      b.oneofDecl ?? [],
      h.oneofDecl ?? [],
      `${bFull} oneofs`,
      problems,
    );
    for (const o of moreOneofs) added.push({ kind: "oneof", name: `${hFull}.${o.name}` });
    for (const [bo, ho] of oneofPairs) {
      const where = `${bFull}.${bo.name}`;
      note("oneof", where, `${hFull}.${ho.name}`);
      put(ts, protoCamelCase(bo.name), protoCamelCase(ho.name), where);
      put(goIdentifiers, goCamelCase(bo.name), goCamelCase(ho.name), where);
      put(goIdentifiers, `Get${goCamelCase(bo.name)}`, `Get${goCamelCase(ho.name)}`, where);
    }
    const [nestedPairs, moreNested] = pairByNameThenPosition(
      b.nestedType ?? [],
      h.nestedType ?? [],
      `${bFull} messages`,
      problems,
    );
    for (const m of moreNested) added.push({ kind: "message", name: `${hFull}.${m.name}` });
    for (const [bm, hm] of nestedPairs) walkMessage(bm, hm, bPkg, hPkg, `${bRel}.${bm.name}`, `${hRel}.${hm.name}`);
    const [enumPairs, moreEnums] = pairByNameThenPosition(
      b.enumType ?? [],
      h.enumType ?? [],
      `${bFull} enums`,
      problems,
    );
    for (const e of moreEnums) added.push({ kind: "enum", name: `${hFull}.${e.name}` });
    for (const [be, he] of enumPairs)
      walkEnum(be, he, bPkg, hPkg, `${bRel}.${be.name}`, `${hRel}.${he.name}`, bGo, hGo);
  };

  const [filePairs, addedFiles] = pairFiles(base.file ?? [], head.file ?? [], problems);
  for (const f of addedFiles) added.push({ kind: "file", name: f.name });

  for (const [bf, hf] of filePairs) {
    if (bf.name !== hf.name) files.push({ from: bf.name, to: hf.name });
    put(packages, bf.package, hf.package, bf.name);
    const [msgPairs, moreMsgs] = pairByNameThenPosition(
      bf.messageType ?? [],
      hf.messageType ?? [],
      `${bf.name} messages`,
      problems,
    );
    for (const m of moreMsgs) added.push({ kind: "message", name: `${hf.package}.${m.name}` });
    for (const [bm, hm] of msgPairs) walkMessage(bm, hm, bf.package, hf.package, bm.name, hm.name);
    const [enumPairs, moreEnums] = pairByNameThenPosition(
      bf.enumType ?? [],
      hf.enumType ?? [],
      `${bf.name} enums`,
      problems,
    );
    for (const e of moreEnums) added.push({ kind: "enum", name: `${hf.package}.${e.name}` });
    for (const [be, he] of enumPairs) {
      walkEnum(be, he, bf.package, hf.package, be.name, he.name, goCamelCase(be.name), goCamelCase(he.name));
    }
    const [svcPairs, moreSvcs] = pairByNameThenPosition(
      bf.service ?? [],
      hf.service ?? [],
      `${bf.name} services`,
      problems,
    );
    for (const s of moreSvcs) added.push({ kind: "service", name: `${hf.package}.${s.name}` });
    for (const [bs, hs] of svcPairs) {
      const bFull = `${bf.package}.${bs.name}`;
      const hFull = `${hf.package}.${hs.name}`;
      note("service", bFull, hFull);
      put(typeNames, bFull, hFull, "type name");
      put(ts, bs.name, hs.name, bFull);
      put(goIdentifiers, goCamelCase(bs.name), goCamelCase(hs.name), bFull);
      const [methodPairs, moreMethods] = pairByNameThenPosition(
        bs.method ?? [],
        hs.method ?? [],
        `${bFull} methods`,
        problems,
      );
      for (const m of moreMethods) added.push({ kind: "method", name: `${hFull}/${m.name}` });
      for (const [bm, hm] of methodPairs) {
        const where = `${bFull}/${bm.name}`;
        note("method", where, `${hFull}/${hm.name}`);
        put(rpc, where, `${hFull}/${hm.name}`, where);
        put(ts, protoCamelCase(bm.name), protoCamelCase(hm.name), where);
        put(goIdentifiers, goCamelCase(bm.name), goCamelCase(hm.name), where);
      }
    }
  }

  if (problems.length > 0) throw new RenameTableError(problems);
  if (conflicts.length > 0) throw new RenameTableError(conflicts);

  const modules = {};
  const directories = {};
  for (const { from, to } of files) {
    const b = from.replace(/\.proto$/, "");
    const h = to.replace(/\.proto$/, "");
    modules[`${b}_pb`] = `${h}_pb`;
    modules[`${b}_connect`] = `${h}_connect`;
    if (dirOf(from) !== dirOf(to)) directories[dirOf(from).replace(/\/$/, "")] = dirOf(to).replace(/\/$/, "");
    // Each generator exports the file's own descriptor under a name built from its path.
    put(ts, `file_${fileIdentifier(b)}`, `file_${fileIdentifier(h)}`, from);
    put(goIdentifiers, `File_${fileIdentifier(b)}_proto`, `File_${fileIdentifier(h)}_proto`, from);
  }
  if (conflicts.length > 0) throw new RenameTableError(conflicts);
  const goAlias = (dir) => {
    const parts = dir.split("/");
    const last = parts.at(-1);
    return /^v\d+/.test(last) && parts.length > 1 ? `${parts.at(-2)}${last}` : last;
  };
  const packageAliases = {};
  for (const [b, h] of Object.entries(directories)) {
    if (goAlias(b) !== goAlias(h)) packageAliases[goAlias(b)] = goAlias(h);
  }

  return {
    renamed,
    added,
    files,
    directories,
    packages: Object.fromEntries(packages),
    typeNames: Object.fromEntries(typeNames),
    json: Object.fromEntries(json),
    rpc: Object.fromEntries(rpc),
    ts: { identifiers: Object.fromEntries(ts), modules },
    go: { identifiers: Object.fromEntries(goIdentifiers), packageAliases },
  };
}

/**
 * Merge a hand list into a table: names the generators do not derive but that
 * mirror the contract (an SDK's client field, a React hook). `extra` is
 * `{ ts: {old: new}, go: {old: new} }`; a hand name that contradicts a derived
 * one is refused.
 */
export function withHandNames(table, extra) {
  const problems = [];
  const merge = (into, more, lang) => {
    const out = { ...into };
    for (const [from, to] of Object.entries(more ?? {})) {
      if (Object.hasOwn(out, from) && out[from] !== to) {
        problems.push(`${lang}: ${from} is ${out[from]} in the contract and ${to} in the hand list`);
        continue;
      }
      out[from] = to;
    }
    return out;
  };
  const ts = merge(table.ts.identifiers, extra.ts, "ts");
  const go = merge(table.go.identifiers, extra.go, "go");
  if (problems.length > 0) throw new RenameTableError(problems);
  return { ...table, ts: { ...table.ts, identifiers: ts }, go: { ...table.go, identifiers: go } };
}
