// ---------------------------------------------------------------------------
// Services (Layer 1 — pure TS, no React)
// ---------------------------------------------------------------------------

export { createSkillQueryService } from "./services/skill-query-service";
export type {
  SkillQueryService,
  SearchSkillsOptions,
} from "./services/skill-query-service";

// ---------------------------------------------------------------------------
// Hooks (Layer 2 — binds transport from context)
// ---------------------------------------------------------------------------

export { useSkillQueryService } from "./services/useSkillQueryService";
