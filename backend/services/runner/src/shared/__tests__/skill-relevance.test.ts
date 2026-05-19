import { describe, it, expect } from "vitest";
import {
  tokenize,
  scoreSkills,
  filterSkills,
  SKILL_COUNT_THRESHOLD,
  type ScoredSkill,
  type SkillFilterResult,
} from "../skill-relevance.js";

// ─── Tokenisation ────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("extracts meaningful tokens from a sentence", () => {
    const tokens = tokenize("Deploy Kubernetes pods to the cluster");
    expect(tokens).toContain("deploy");
    expect(tokens).toContain("kubernetes");
    expect(tokens).toContain("pods");
    expect(tokens).toContain("cluster");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("to");
  });

  it("strips punctuation and splits on non-alphanumeric", () => {
    const tokens = tokenize("hello-world! (v2.0)");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("v2");
  });

  it("drops single-character tokens", () => {
    const tokens = tokenize("a b c deploy x");
    expect(tokens).toContain("deploy");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("b");
    expect(tokens).not.toContain("x");
  });

  it("returns empty for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("returns empty for stop-words-only input", () => {
    expect(tokenize("the a is to in for")).toEqual([]);
  });

  it("preserves numbers within tokens", () => {
    const tokens = tokenize("python3 version 42");
    expect(tokens).toContain("python3");
    expect(tokens).toContain("version");
    expect(tokens).toContain("42");
  });

  it("splits kebab-case into individual tokens", () => {
    const tokens = tokenize("code-review-best-practices");
    expect(tokens).toContain("code");
    expect(tokens).toContain("review");
    expect(tokens).toContain("best");
    expect(tokens).toContain("practices");
  });
});

// ─── BM25 scoring ────────────────────────────────────────────────────────

describe("scoreSkills", () => {
  it("scores exact match highest", () => {
    const scored = scoreSkills(
      "kubernetes deployment",
      ["kubernetes-operator", "code-review", "docker-expert"],
      [
        "Manages Kubernetes deployments and services",
        "Reviews code changes for quality",
        "Docker container management and Dockerfile optimization",
      ],
    );
    expect(scored[0].name).toBe("kubernetes-operator");
    expect(scored[0].score).toBeGreaterThan(0);
  });

  it("gives zero score when no term overlap", () => {
    const scored = scoreSkills(
      "kubernetes deployment",
      ["code-review"],
      ["Reviews code changes for quality"],
    );
    expect(scored[0].score).toBe(0.0);
  });

  it("returns all zero scores for empty query", () => {
    const scored = scoreSkills(
      "",
      ["skill-a", "skill-b"],
      ["description a", "description b"],
    );
    expect(scored.every(s => s.score === 0.0)).toBe(true);
  });

  it("returns empty for empty skills list", () => {
    const scored = scoreSkills("some query", [], []);
    expect(scored).toEqual([]);
  });

  it("returns all skills", () => {
    const scored = scoreSkills(
      "deploy",
      ["a", "b", "c"],
      ["deploy", "review", "test"],
    );
    expect(scored).toHaveLength(3);
  });

  it("returns results in descending score order", () => {
    const scored = scoreSkills(
      "kubernetes cluster deployment management",
      ["kubernetes-operator", "generic-helper", "k8s-deploy"],
      [
        "Manages Kubernetes clusters and deployments",
        "Generic task helper with no specialization",
        "Kubernetes deployment automation",
      ],
    );
    const scores = scored.map(s => s.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("ranks partial-match skill higher than no-match", () => {
    const scored = scoreSkills(
      "review code quality",
      ["code-review", "deploy-agent"],
      [
        "Reviews code for quality and security issues",
        "Deploys applications to cloud infrastructure",
      ],
    );
    expect(scored[0].name).toBe("code-review");
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  it("preserves original index", () => {
    const scored = scoreSkills(
      "review",
      ["deploy", "review", "test"],
      ["deploy", "review", "test"],
    );
    const reviewEntry = scored.find(s => s.name === "review");
    expect(reviewEntry).toBeDefined();
    expect(reviewEntry!.index).toBe(1);
  });

  it("ignores stop words in query", () => {
    const scoredWithStops = scoreSkills(
      "the kubernetes is a deployment",
      ["k8s"],
      ["kubernetes deployment manager"],
    );
    const scoredWithoutStops = scoreSkills(
      "kubernetes deployment",
      ["k8s"],
      ["kubernetes deployment manager"],
    );
    expect(scoredWithStops[0].score).toBe(scoredWithoutStops[0].score);
  });
});

// ─── Filtering ───────────────────────────────────────────────────────────

describe("filterSkills", () => {
  function makeNamesAndDescs(n: number): { names: string[]; descs: string[] } {
    const names = Array.from({ length: n }, (_, i) => `skill-${i}`);
    const descs = Array.from({ length: n }, (_, i) => `Description for skill number ${i}`);
    return { names, descs };
  }

  it("includes all when below threshold", () => {
    const { names, descs } = makeNamesAndDescs(5);
    const result = filterSkills("any query", names, descs, { threshold: 8 });
    expect(result.includedIndices).toEqual([0, 1, 2, 3, 4]);
    expect(result.excludedIndices).toEqual([]);
    expect(result.excludedNames).toEqual([]);
  });

  it("includes all at threshold boundary (count < threshold)", () => {
    const { names, descs } = makeNamesAndDescs(7);
    const result = filterSkills("any query", names, descs, { threshold: 8 });
    expect(result.includedIndices).toHaveLength(7);
    expect(result.excludedIndices).toEqual([]);
  });

  it("filters irrelevant skills above threshold", () => {
    const names = [
      "kubernetes-operator", "docker-expert", "code-review",
      "terraform-iac", "postgres-admin", "redis-cache",
      "monitoring-agent", "security-scanner", "api-tester", "log-analyzer",
    ];
    const descs = [
      "Manages Kubernetes clusters and deployments",
      "Docker container management",
      "Reviews code changes",
      "Terraform infrastructure as code",
      "PostgreSQL database administration",
      "Redis cache management",
      "Monitoring and alerting setup",
      "Security vulnerability scanning",
      "API endpoint testing",
      "Log analysis and aggregation",
    ];
    const result = filterSkills("deploy kubernetes pods", names, descs, { threshold: 8 });
    expect(result.includedIndices).toContain(0); // kubernetes-operator
    expect(result.excludedNames.length).toBeGreaterThan(0);
    expect(result.excludedNames).not.toContain("kubernetes-operator");
  });

  it("enforces safety floor (at least half included)", () => {
    const names = Array.from({ length: 10 }, (_, i) => `skill-${i}`);
    const descs = Array.from({ length: 10 }, () => "completely unrelated");
    const result = filterSkills("xyzzy nonsense query", names, descs, { threshold: 8 });
    expect(result.includedIndices.length).toBeGreaterThanOrEqual(5);
  });

  it("sorts excluded names alphabetically", () => {
    const names = [
      "zebra-skill", "alpha-skill", "middle-skill",
      "beta-skill", "gamma-skill", "delta-skill",
      "epsilon-skill", "zeta-skill", "eta-skill", "theta-skill",
    ];
    const descs = Array.from({ length: 10 }, () => "unrelated");
    const result = filterSkills("something specific to alpha", names, descs, { threshold: 8 });
    expect(result.excludedNames).toEqual([...result.excludedNames].sort());
  });

  it("maintains original order for included indices", () => {
    const names = Array.from({ length: 10 }, (_, i) => `skill-${i}`);
    const descs = [
      "kubernetes deployment", "code review", "kubernetes pods",
      "docker containers", "unrelated thing", "another unrelated",
      "still unrelated", "more unrelated stuff", "kubernetes services",
      "very unrelated",
    ];
    const result = filterSkills("kubernetes deployment", names, descs, { threshold: 8 });
    expect(result.includedIndices).toEqual([...result.includedIndices].sort((a, b) => a - b));
  });

  it("handles empty skills list", () => {
    const result = filterSkills("query", [], []);
    expect(result.includedIndices).toEqual([]);
    expect(result.excludedIndices).toEqual([]);
    expect(result.excludedNames).toEqual([]);
  });

  it("keeps most skills when all are relevant", () => {
    const names = [
      "k8s-deploy", "k8s-monitor", "k8s-scale",
      "k8s-network", "k8s-storage", "k8s-secrets",
      "k8s-rbac", "k8s-helm", "k8s-ingress", "k8s-cronjob",
    ];
    const descs = names.map(n => `Kubernetes ${n.split("-")[1]} management`);
    const result = filterSkills("kubernetes cluster management", names, descs, { threshold: 8 });
    expect(result.excludedNames.length).toBeLessThan(names.length);
  });

  it("returns correct types", () => {
    const { names, descs } = makeNamesAndDescs(10);
    const result = filterSkills("query", names, descs, { threshold: 8 });
    expect(Array.isArray(result.includedIndices)).toBe(true);
    expect(Array.isArray(result.excludedIndices)).toBe(true);
    expect(Array.isArray(result.excludedNames)).toBe(true);
  });

  it("produces a disjoint partition of all indices", () => {
    const names = Array.from({ length: 12 }, (_, i) => `skill-${i}`);
    const descs = [
      "kubernetes deploy", "code review", "docker build",
      "terraform plan", "postgres query", "redis cache",
      "monitoring alert", "security scan", "api test",
      "log analysis", "network debug", "storage manage",
    ];
    const result = filterSkills("kubernetes deployment", names, descs, { threshold: 8 });
    const allIndices = new Set([...result.includedIndices, ...result.excludedIndices]);
    expect(allIndices.size).toBe(12);
    expect(allIndices).toEqual(new Set(Array.from({ length: 12 }, (_, i) => i)));
    // Verify disjoint
    const intersection = result.includedIndices.filter(i => result.excludedIndices.includes(i));
    expect(intersection).toEqual([]);
  });

  it("uses default threshold constant", () => {
    expect(SKILL_COUNT_THRESHOLD).toBe(8);
    const { names, descs } = makeNamesAndDescs(7);
    const result = filterSkills("any query", names, descs);
    expect(result.includedIndices).toHaveLength(7);
  });
});
