"""Tests for skill relevance scoring and filtering.

Covers the BM25-based scoring in ``skill_relevance.py`` and
the threshold-based filtering logic.
"""

from __future__ import annotations

from stigmer_runner.worker.activities.graphton.skill_relevance import (
    SkillFilterResult,
    _tokenize,
    filter_skills,
    score_skills,
)

# ─── Tokenisation ────────────────────────────────────────────────────────


class TestTokenize:
    def test_basic_sentence(self):
        tokens = _tokenize("Deploy Kubernetes pods to the cluster")
        assert "deploy" in tokens
        assert "kubernetes" in tokens
        assert "pods" in tokens
        assert "cluster" in tokens
        assert "the" not in tokens  # stop word
        assert "to" not in tokens  # stop word

    def test_strips_punctuation(self):
        tokens = _tokenize("hello-world! (v2.0)")
        assert "hello" in tokens
        assert "world" in tokens
        assert "v2" in tokens

    def test_drops_single_char_tokens(self):
        tokens = _tokenize("a b c deploy x")
        assert "deploy" in tokens
        assert "a" not in tokens
        assert "b" not in tokens

    def test_empty_string(self):
        assert _tokenize("") == []

    def test_only_stop_words(self):
        assert _tokenize("the a is to in for") == []

    def test_preserves_numbers(self):
        tokens = _tokenize("python3 version 42")
        assert "python3" in tokens
        assert "version" in tokens
        assert "42" in tokens

    def test_kebab_case_split(self):
        tokens = _tokenize("code-review-best-practices")
        assert "code" in tokens
        assert "review" in tokens
        assert "best" in tokens
        assert "practices" in tokens


# ─── BM25 scoring ────────────────────────────────────────────────────────


class TestScoreSkills:
    def test_exact_match_scores_highest(self):
        scored = score_skills(
            "kubernetes deployment",
            skill_names=["kubernetes-operator", "code-review", "docker-expert"],
            skill_descriptions=[
                "Manages Kubernetes deployments and services",
                "Reviews code changes for quality",
                "Docker container management and Dockerfile optimization",
            ],
        )
        assert scored[0].name == "kubernetes-operator"
        assert scored[0].score > 0

    def test_no_overlap_scores_zero(self):
        scored = score_skills(
            "kubernetes deployment",
            skill_names=["code-review"],
            skill_descriptions=["Reviews code changes for quality"],
        )
        assert scored[0].score == 0.0

    def test_empty_query(self):
        scored = score_skills(
            "",
            skill_names=["skill-a", "skill-b"],
            skill_descriptions=["description a", "description b"],
        )
        assert all(s.score == 0.0 for s in scored)

    def test_empty_skills_list(self):
        scored = score_skills(
            "some query",
            skill_names=[],
            skill_descriptions=[],
        )
        assert scored == []

    def test_returns_all_skills(self):
        scored = score_skills(
            "deploy",
            skill_names=["a", "b", "c"],
            skill_descriptions=["deploy", "review", "test"],
        )
        assert len(scored) == 3

    def test_descending_order(self):
        scored = score_skills(
            "kubernetes cluster deployment management",
            skill_names=["kubernetes-operator", "generic-helper", "k8s-deploy"],
            skill_descriptions=[
                "Manages Kubernetes clusters and deployments",
                "Generic task helper with no specialization",
                "Kubernetes deployment automation",
            ],
        )
        scores = [s.score for s in scored]
        assert scores == sorted(scores, reverse=True)

    def test_partial_term_match(self):
        scored = score_skills(
            "review code quality",
            skill_names=["code-review", "deploy-agent"],
            skill_descriptions=[
                "Reviews code for quality and security issues",
                "Deploys applications to cloud infrastructure",
            ],
        )
        assert scored[0].name == "code-review"
        assert scored[0].score > scored[1].score

    def test_preserves_original_index(self):
        scored = score_skills(
            "review",
            skill_names=["deploy", "review", "test"],
            skill_descriptions=["deploy", "review", "test"],
        )
        review_entry = next(s for s in scored if s.name == "review")
        assert review_entry.index == 1

    def test_stop_words_in_query_ignored(self):
        scored_with_stops = score_skills(
            "the kubernetes is a deployment",
            skill_names=["k8s"],
            skill_descriptions=["kubernetes deployment manager"],
        )
        scored_without_stops = score_skills(
            "kubernetes deployment",
            skill_names=["k8s"],
            skill_descriptions=["kubernetes deployment manager"],
        )
        assert scored_with_stops[0].score == scored_without_stops[0].score


# ─── Filtering ───────────────────────────────────────────────────────────


class TestFilterSkills:
    def _make_names_and_descs(self, n: int):
        """Generate n skill names and descriptions."""
        names = [f"skill-{i}" for i in range(n)]
        descs = [f"Description for skill number {i}" for i in range(n)]
        return names, descs

    def test_below_threshold_includes_all(self):
        names, descs = self._make_names_and_descs(5)
        result = filter_skills("any query", names, descs, threshold=8)
        assert result.included_indices == [0, 1, 2, 3, 4]
        assert result.excluded_indices == []
        assert result.excluded_names == []

    def test_at_threshold_boundary_includes_all(self):
        names, descs = self._make_names_and_descs(7)
        result = filter_skills("any query", names, descs, threshold=8)
        assert len(result.included_indices) == 7
        assert result.excluded_indices == []

    def test_above_threshold_filters_irrelevant(self):
        names = [
            "kubernetes-operator",
            "docker-expert",
            "code-review",
            "terraform-iac",
            "postgres-admin",
            "redis-cache",
            "monitoring-agent",
            "security-scanner",
            "api-tester",
            "log-analyzer",
        ]
        descs = [
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
        ]
        result = filter_skills(
            "deploy kubernetes pods",
            names, descs,
            threshold=8,
        )
        assert 0 in result.included_indices  # kubernetes-operator
        assert len(result.excluded_names) > 0
        assert "kubernetes-operator" not in result.excluded_names

    def test_safety_floor_keeps_half(self):
        names = [f"skill-{i}" for i in range(10)]
        descs = ["completely unrelated" for _ in range(10)]
        result = filter_skills(
            "xyzzy nonsense query",
            names, descs,
            threshold=8,
        )
        assert len(result.included_indices) >= 5  # at least half

    def test_excluded_names_sorted_alphabetically(self):
        names = [
            "zebra-skill", "alpha-skill", "middle-skill",
            "beta-skill", "gamma-skill", "delta-skill",
            "epsilon-skill", "zeta-skill", "eta-skill", "theta-skill",
        ]
        descs = ["unrelated"] * 10
        result = filter_skills(
            "something specific to alpha",
            names, descs,
            threshold=8,
        )
        assert result.excluded_names == sorted(result.excluded_names)

    def test_included_indices_in_original_order(self):
        names = [f"skill-{i}" for i in range(10)]
        descs = [
            "kubernetes deployment",
            "code review",
            "kubernetes pods",
            "docker containers",
            "unrelated thing",
            "another unrelated",
            "still unrelated",
            "more unrelated stuff",
            "kubernetes services",
            "very unrelated",
        ]
        result = filter_skills(
            "kubernetes deployment",
            names, descs,
            threshold=8,
        )
        assert result.included_indices == sorted(result.included_indices)

    def test_empty_skills(self):
        result = filter_skills("query", [], [])
        assert result.included_indices == []
        assert result.excluded_indices == []

    def test_all_relevant_none_excluded(self):
        names = [
            "k8s-deploy", "k8s-monitor", "k8s-scale",
            "k8s-network", "k8s-storage", "k8s-secrets",
            "k8s-rbac", "k8s-helm", "k8s-ingress", "k8s-cronjob",
        ]
        descs = [f"Kubernetes {n.split('-')[1]} management" for n in names]
        result = filter_skills(
            "kubernetes cluster management",
            names, descs,
            threshold=8,
        )
        # All skills are k8s-related so most or all should be included
        assert len(result.excluded_names) < len(names)

    def test_filter_result_types(self):
        names, descs = self._make_names_and_descs(10)
        result = filter_skills("query", names, descs, threshold=8)
        assert isinstance(result, SkillFilterResult)
        assert isinstance(result.included_indices, list)
        assert isinstance(result.excluded_indices, list)
        assert isinstance(result.excluded_names, list)

    def test_included_and_excluded_are_disjoint_partition(self):
        names = [f"skill-{i}" for i in range(12)]
        descs = [
            "kubernetes deploy", "code review", "docker build",
            "terraform plan", "postgres query", "redis cache",
            "monitoring alert", "security scan", "api test",
            "log analysis", "network debug", "storage manage",
        ]
        result = filter_skills(
            "kubernetes deployment",
            names, descs,
            threshold=8,
        )
        all_indices = set(result.included_indices) | set(result.excluded_indices)
        assert all_indices == set(range(12))
        assert not (set(result.included_indices) & set(result.excluded_indices))
