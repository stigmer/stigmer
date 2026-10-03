/**
 * An in-memory Substrate behind the SubstrateGateway seam, for the driver's
 * and the sweep's suites: actors and templates with Substrate's state rules
 * (a created actor is SUSPENDED; resume wakes SUSPENDED or PAUSED; pause
 * needs RUNNING; suspend takes RUNNING or PAUSED; a move needs SUSPENDED;
 * revert takes CRASHED), every call recorded in order, and a queue of
 * scripted failures per method so a test can make one call answer
 * ABORTED, crash, or run out of workers. An egress policy is created when
 * missing and replaced when its rules differ, as the real gateway does.
 */
import { equals } from "@bufbuild/protobuf";

import {
  ActorState,
  EgressRuleSchema,
  type ActorTemplate,
  type EgressRule,
} from "../gen/ateapipb/ateapi_pb.js";
import type {
  SubstrateActorView,
  SubstrateGateway,
  SubstrateTemplateView,
} from "../gateway.js";

type Method = keyof SubstrateGateway;

export interface FakeActor {
  name: string;
  uid: string;
  version: bigint;
  state: ActorState;
  template: string;
  createTime: Date;
  updateTime: Date;
  policy: readonly EgressRule[] | undefined;
}

export interface FakeTemplate {
  name: string;
  uid: string;
  version: bigint;
  createTime: Date;
  /** Polls of getTemplate left before the golden snapshot reads published. */
  pollsUntilReady: number;
  goldenError: string;
  spec: ActorTemplate;
}

export class FakeSubstrate implements SubstrateGateway {
  readonly actors = new Map<string, FakeActor>();
  readonly templates = new Map<string, FakeTemplate>();
  readonly calls: string[] = [];
  /** Failures to throw, per method, oldest first. */
  readonly failures = new Map<
    Method,
    Array<Error | ((name: string) => Error)>
  >();
  /** Polls a newly created template takes before it is ready. */
  goldenPolls = 0;
  /** Templates whose golden snapshot fails, by name, with the error. */
  readonly goldenErrors = new Map<string, string>();
  /** Answer "refused" to moves. */
  refuseMoves = false;
  private uid = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  fail(method: Method, error: Error | ((name: string) => Error)): void {
    const queue = this.failures.get(method) ?? [];
    queue.push(error);
    this.failures.set(method, queue);
  }

  /** Adds an actor directly, as if another process or an earlier run had made it. */
  put(
    actor: Partial<FakeActor> & {
      name: string;
      state: ActorState;
      template: string;
    },
  ): FakeActor {
    const now = new Date(this.clock());
    const full: FakeActor = {
      uid: `uid-${(this.uid += 1)}`,
      version: 1n,
      createTime: now,
      updateTime: now,
      policy: [],
      ...actor,
    };
    this.actors.set(actor.name, full);
    return full;
  }

  putTemplate(name: string, options: Partial<FakeTemplate> = {}): FakeTemplate {
    const template: FakeTemplate = {
      name,
      uid: `tpl-${(this.uid += 1)}`,
      version: 1n,
      createTime: new Date(this.clock()),
      pollsUntilReady: 0,
      goldenError: "",
      spec: {} as ActorTemplate,
      ...options,
    };
    this.templates.set(name, template);
    return template;
  }

  private enter(method: Method, name: string): void {
    this.calls.push(`${method} ${name}`);
    const queue = this.failures.get(method);
    const next = queue?.shift();
    if (next !== undefined)
      throw typeof next === "function" ? next(name) : next;
  }

  private mutate(actor: FakeActor, state: ActorState): void {
    actor.state = state;
    actor.version += 1n;
    actor.updateTime = new Date(this.clock());
  }

  private need(name: string): FakeActor {
    const actor = this.actors.get(name);
    if (actor === undefined) throw new Error(`actor ${name} not found`);
    return actor;
  }

  private precondition(name: string, ok: boolean, what: string): void {
    if (!ok) throw new Error(`FailedPrecondition: ${what} for ${name}`);
  }

  async ensureAtespace(): Promise<void> {
    this.enter("ensureAtespace", "");
  }

  async getActor(name: string): Promise<SubstrateActorView | undefined> {
    this.enter("getActor", name);
    const actor = this.actors.get(name);
    return actor === undefined ? undefined : view(actor);
  }

  async listActors(): Promise<SubstrateActorView[]> {
    this.enter("listActors", "");
    return [...this.actors.values()].map(view);
  }

  async createActor(
    name: string,
    template: string,
  ): Promise<"created" | "exists"> {
    this.enter("createActor", name);
    if (this.actors.has(name)) return "exists";
    if (!this.templates.has(template))
      throw new Error("FailedPrecondition: actor template not found");
    this.put({
      name,
      state: ActorState.SUSPENDED,
      template,
      policy: undefined,
    });
    return "created";
  }

  async moveActor(
    actor: SubstrateActorView,
    template: string,
  ): Promise<"moved" | "refused"> {
    this.enter("moveActor", actor.name);
    const stored = this.need(actor.name);
    if (this.refuseMoves || stored.state !== ActorState.SUSPENDED)
      return "refused";
    stored.template = template;
    stored.version += 1n;
    return "moved";
  }

  async resumeActor(name: string): Promise<void> {
    this.enter("resumeActor", name);
    const actor = this.need(name);
    if (actor.state === ActorState.RUNNING) return;
    this.precondition(
      name,
      actor.state === ActorState.SUSPENDED || actor.state === ActorState.PAUSED,
      `resume from ${ActorState[actor.state]}`,
    );
    this.mutate(actor, ActorState.RUNNING);
  }

  async pauseActor(name: string): Promise<void> {
    this.enter("pauseActor", name);
    const actor = this.need(name);
    if (actor.state === ActorState.PAUSED) return;
    this.precondition(
      name,
      actor.state === ActorState.RUNNING,
      `pause from ${ActorState[actor.state]}`,
    );
    this.mutate(actor, ActorState.PAUSED);
  }

  async suspendActor(name: string): Promise<void> {
    this.enter("suspendActor", name);
    const actor = this.need(name);
    if (actor.state === ActorState.SUSPENDED) return;
    this.precondition(
      name,
      actor.state === ActorState.RUNNING || actor.state === ActorState.PAUSED,
      `suspend from ${ActorState[actor.state]}`,
    );
    this.mutate(actor, ActorState.SUSPENDED);
  }

  async revertActor(name: string): Promise<void> {
    this.enter("revertActor", name);
    const actor = this.need(name);
    this.precondition(
      name,
      actor.state === ActorState.CRASHED,
      `revert from ${ActorState[actor.state]}`,
    );
    this.mutate(actor, ActorState.SUSPENDED);
  }

  async deleteActor(name: string): Promise<void> {
    this.enter("deleteActor", name);
    this.actors.delete(name);
  }

  async ensureEgressPolicy(
    name: string,
    rules: readonly EgressRule[],
  ): Promise<"created" | "unchanged" | "replaced"> {
    this.enter("ensureEgressPolicy", name);
    const actor = this.need(name);
    if (actor.policy === undefined) {
      actor.policy = rules;
      return "created";
    }
    const same =
      actor.policy.length === rules.length &&
      rules.every((rule, i) => {
        const current = actor.policy?.[i];
        return current !== undefined && equals(EgressRuleSchema, current, rule);
      });
    if (same) return "unchanged";
    actor.policy = rules;
    return "replaced";
  }

  async getTemplate(name: string): Promise<SubstrateTemplateView | undefined> {
    this.enter("getTemplate", name);
    const template = this.templates.get(name);
    if (template === undefined) return undefined;
    if (template.pollsUntilReady > 0) template.pollsUntilReady -= 1;
    return templateView(template);
  }

  async listTemplates(): Promise<SubstrateTemplateView[]> {
    this.enter("listTemplates", "");
    return [...this.templates.values()].map(templateView);
  }

  async createTemplate(template: ActorTemplate): Promise<"created" | "exists"> {
    const name = template.metadata?.name ?? "";
    this.enter("createTemplate", name);
    if (this.templates.has(name)) return "exists";
    this.putTemplate(name, {
      pollsUntilReady: this.goldenPolls,
      goldenError: this.goldenErrors.get(name) ?? "",
      spec: template,
    });
    return "created";
  }

  async deleteTemplate(template: SubstrateTemplateView): Promise<void> {
    this.enter("deleteTemplate", template.name);
    this.goldenErrors.delete(template.name);
    this.templates.delete(template.name);
  }
}

function view(actor: FakeActor): SubstrateActorView {
  return {
    name: actor.name,
    uid: actor.uid,
    version: actor.version,
    state: actor.state,
    template: actor.template,
    createTime: actor.createTime,
    updateTime: actor.updateTime,
  };
}

function templateView(template: FakeTemplate): SubstrateTemplateView {
  return {
    name: template.name,
    uid: template.uid,
    version: template.version,
    createTime: template.createTime,
    goldenReady: template.goldenError === "" && template.pollsUntilReady === 0,
    goldenError: template.pollsUntilReady === 0 ? template.goldenError : "",
  };
}

/** A router stand-in: answers each push with what `answer` returns and records the bodies. */
export function fakeRouter(
  answer: (
    actor: string,
    body: { taskQueue: string; secrets: Record<string, string> },
  ) => {
    status: number;
    body?: Record<string, unknown>;
  } = () => ({ status: 200, body: { started: true } }),
): {
  fetch: typeof fetch;
  pushes: Array<{
    actor: string;
    taskQueue: string;
    secrets: Record<string, string>;
  }>;
} {
  const pushes: Array<{
    actor: string;
    taskQueue: string;
    secrets: Record<string, string>;
  }> = [];
  const fetchImpl = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const headers = new Headers(init?.headers);
    const target = headers.get("ate-target-actor") ?? "";
    const actor = target.slice(target.indexOf("/") + 1);
    const body = JSON.parse(String(init?.body)) as {
      taskQueue: string;
      secrets: Record<string, string>;
    };
    pushes.push({ actor, ...body });
    const reply = answer(actor, body);
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, pushes };
}
