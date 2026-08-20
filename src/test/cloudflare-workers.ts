export class WorkflowEntrypoint<Env = unknown, _Params = unknown> {
  ctx: unknown;
  env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export type WorkflowEvent<Params> = { payload: Params };

export type WorkflowStep = {
  do: (name: string, optsOrFn: unknown, maybeFn?: unknown) => Promise<unknown>;
};
