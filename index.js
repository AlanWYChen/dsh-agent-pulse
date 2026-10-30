import { z } from 'zod';
import { initState, reduceEvent, viewState, PROJECTION_KEY } from './engine.js';
import { ActivityCoordinator, generateSummary } from './coordinator.js';
import { withWorkspaceChanges } from './workspace.js';
import { SummaryModelSettings, modelToolDefinition } from './model-settings.js';
import { ChangeContextService } from './change-context.js';
import { RecordedFiles } from './recorded-files.js';

export const inject = [
  'sessionProjections',
  'sessions',
  'storageDomain',
  'connection',
  'llm',
  'webServer',
];

export const Config = z
  .object({
    summaries: z.boolean().default(true),
    summaryProvider: z.string().optional(),
    summaryModel: z.string().optional(),
    maxCards: z.number().int().min(10).max(500).default(100),
    summaryTimeoutMs: z.number().int().min(1000).max(120000).default(45000),
    sensitivePatterns: z.array(z.string().max(200)).max(30).default([]),
    excludedPatterns: z.array(z.string().max(200)).max(30).default([]),
  })
  .refine(
    (value) => Boolean(value.summaryProvider) === Boolean(value.summaryModel),
    {
      message: 'Set summaryProvider and summaryModel together.',
    },
  );

const watchRequest = z
  .object({
    sessionId: z.string().min(1).max(200),
    afterRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

export async function apply(ctx, config) {
  const domain = await ctx.storageDomain.open({
    name: 'agent_activity_intelligence',
    version: 1,
    invalidRecords: 'backup-and-skip',
    layout: 'per-record',
    tables: { cache: { valueSchema: z.json() } },
  });

  const recordedFiles = new RecordedFiles({
    table: domain.table('cache'),
    config,
    cwdOf: (id) => ctx.sessions.get(id)?.header?.cwd,
  });

  ctx.on('tools/result', (exec, result) => {
    recordedFiles.observe(exec, result);
  });

  const changeContexts = new ChangeContextService({
    workspaceChanges: ctx.get('workspaceChanges'),
    config,
    recordedFiles,
  });

  let coordinator;
  const modelSettings = new SummaryModelSettings({
    table: domain.table('cache'),
    llm: ctx.llm,
    config,
    onChanged: () => coordinator?.policyChanged(),
  });

  coordinator = new ActivityCoordinator({
    table: domain.table('cache'),
    enabled: config.summaries,
    timeoutMs: config.summaryTimeoutMs,
    selectionFor: (session) =>
      modelSettings.resolve(session.requestHeader?.()?.config),
    summariesEnabled: () =>
      modelSettings.resolve({ provider: 'follow', model: 'follow' }) !== null,
    summarize: (selection, input, signal) =>
      generateSummary(ctx.llm, selection, input, signal),
    prepareContext: (session, card, signal) =>
      changeContexts.prepare(session, card, signal),
  });

  ctx.effect(() => async () => {
    await coordinator.close();
    await recordedFiles.close();
    await modelSettings.close();
    await domain.close();
  });

  ctx.inject(['tools'], (scope) =>
    scope.tools.register(modelToolDefinition(modelSettings)),
  );

  ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 2,
    stateSchema: z.json(),
    init: initState,
    apply: (state, event) => reduceEvent(state, event, config),
    wire: { viewSchema: z.json(), view: viewState },
  });

  const enrichedStates = new WeakMap();

  function update(session) {
    const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY);

    if (!state) return;

    const prior = enrichedStates.get(session);
    const ref = state.lastWorkspaceChange;
    const changes = ctx.get('workspaceChanges');
    const summary = ref && changes?.summary(session.id, ref.seq);

    if (prior?.source === state && prior.summary === summary) {
      coordinator.update(session, prior.value);
      return;
    }

    let value = summary
      ? withWorkspaceChanges(state, summary, ref, config.maxCards)
      : state;
    const previousCards =
      (prior?.value ?? coordinator.sessions.get(session.id)?.state)?.cards ??
      [];

    for (const card of previousCards.filter(
      (c) => c._workspace && c._workspaceRef,
    )) {
      if (value.cards.some((current) => current.id === card.id))
        value = withWorkspaceChanges(
          value,
          {
            turn: card._turn,
            files: card.files.map((path) => ({ path })),
            total: card._modifications,
          },
          card._workspaceRef,
          config.maxCards,
        );
      else
        value = {
          ...value,
          cards: [card, ...value.cards]
            .sort((a, b) => a.time - b.time)
            .slice(-config.maxCards),
        };
    }

    value = {
      ...value,
      cards: value.cards.map((card) =>
        card.category === 'outcome'
          ? { ...card, changeFiles: changeContexts.describe(session, card) }
          : card,
      ),
    };

    enrichedStates.set(session, { source: state, summary, value });
    coordinator.update(session, value);
  }

  ctx.sessionProjections.onChanged((session, key) => {
    if (key === PROJECTION_KEY) update(session);
  });

  // Materialize once on installation and session entry; incremental projection drive owns the rest.
  ctx.on('session/created', (session) => update(session));
  for (const session of ctx.sessions.list()) update(session);

  // Exact shared-channel Fetch routes are authenticated and owner-only by Connection.
  // Use its existing RPC envelope without competing for the gateway's sole interceptor.
  const disposeRoute = ctx.connection.fetch.register({
    path: '/api/agentActivityIntelligence.watch',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body;

      try {
        body = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      const envelope = z
        .object({
          type: z.literal('client-request'),
          rpcId: z.string().min(1).max(200),
          method: z.literal('agentActivityIntelligence.watch'),
          payload: z.unknown(),
        })
        .safeParse(body);
      if (!envelope.success)
        return new Response('Invalid request envelope', { status: 400 });

      const parsed = watchRequest.safeParse(envelope.data.payload);
      let result;

      if (!parsed.success)
        result = {
          ok: false,
          error: {
            code: 'invalid-input',
            message: 'Expected sessionId and optional afterRevision.',
            details: {},
          },
        };
      else {
        const { sessionId, afterRevision } = parsed.data;
        const session = ctx.sessions.get(sessionId);
        if (session) update(session);

        result = {
          ok: true,
          value: await coordinator.watch(
            sessionId,
            afterRevision,
            request.signal,
          ),
        };
      }

      return Response.json({
        type: 'server-response',
        rpcId: envelope.data.rpcId,
        result,
      });
    },
  });
  ctx.effect(() => disposeRoute);

  const disposeModelRoute = ctx.connection.fetch.register({
    path: '/api/agentActivityIntelligence.model',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body;

      try {
        body = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      const envelope = z
        .object({
          type: z.literal('client-request'),
          rpcId: z.string().min(1).max(200),
          method: z.literal('agentActivityIntelligence.model'),
          payload: z.unknown(),
        })
        .safeParse(body);
      if (!envelope.success)
        return new Response('Invalid request envelope', { status: 400 });

      let result;

      try {
        result = {
          ok: true,
          value: await modelSettings.execute(
            envelope.data.payload,
            request.signal,
          ),
        };
      } catch (error) {
        result = {
          ok: false,
          error: {
            code: 'model-selection-failed',
            message:
              error instanceof z.ZodError
                ? 'Invalid model selection request.'
                : String(error.message || 'Model selection failed').slice(
                    0,
                    200,
                  ),
            details: {},
          },
        };
      }

      return Response.json({
        type: 'server-response',
        rpcId: envelope.data.rpcId,
        result,
      });
    },
  });
  ctx.effect(() => disposeModelRoute);

  const diffRequest = z
    .object({
      sessionId: z.string().min(1).max(200),
      cardId: z.string().min(1).max(200),
      fileId: z.string().min(1).max(200),
    })
    .strict();

  const disposeDiffRoute = ctx.connection.fetch.register({
    path: '/api/agentActivityIntelligence.diff',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body;

      try {
        body = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      const envelope = z
        .object({
          type: z.literal('client-request'),
          rpcId: z.string().min(1).max(200),
          method: z.literal('agentActivityIntelligence.diff'),
          payload: diffRequest,
        })
        .safeParse(body);
      if (!envelope.success)
        return new Response('Invalid diff request', { status: 400 });

      const { sessionId, cardId, fileId } = envelope.data.payload;
      let value = {
        status: 'unavailable',
        file: '',
        kind: 'edit',
        lines: [],
        truncated: false,
        notice:
          'The recorded change is no longer available in this live session. Current files are not used as a substitute.',
      };

      try {
        const session = ctx.sessions.get(sessionId);
        if (session) {
          update(session);

          const card = coordinator.sessions
            .get(sessionId)
            ?.state.cards.find(
              (card) => card.id === cardId && card.category === 'outcome',
            );

          if (card)
            value = await changeContexts.diff(
              session,
              card,
              fileId,
              request.signal,
            );
        }
      } catch {
        value = {
          ...value,
          notice:
            'The recorded diff could not be loaded. No current filesystem contents were read.',
        };
      }

      return Response.json({
        type: 'server-response',
        rpcId: envelope.data.rpcId,
        result: { ok: true, value },
      });
    },
  });
  ctx.effect(() => disposeDiffRoute);

  const disposeSummaryRoute = ctx.connection.fetch.register({
    path: '/api/agentActivityIntelligence.summarize',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body;

      try {
        body = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      const envelope = z
        .object({
          type: z.literal('client-request'),
          rpcId: z.string().min(1).max(200),
          method: z.literal('agentActivityIntelligence.summarize'),
          payload: z
            .object({
              sessionId: z.string().min(1).max(200),
              cardId: z.string().min(1).max(200),
            })
            .strict(),
        })
        .safeParse(body);
      if (!envelope.success)
        return new Response('Invalid summary request', { status: 400 });

      const { sessionId, cardId } = envelope.data.payload;
      const session = ctx.sessions.get(sessionId);
      if (session) update(session);

      const value = session
        ? coordinator.requestSummary(session, cardId)
        : {
            status: 'unavailable',
            reason: 'The original live session is no longer available.',
          };

      return Response.json({
        type: 'server-response',
        rpcId: envelope.data.rpcId,
        result: { ok: true, value },
      });
    },
  });
  ctx.effect(() => disposeSummaryRoute);

  ctx.inject(['tools'], (scope) =>
    scope.tools.register({
      name: 'activity_outcomes',
      description:
        'Read activity outcomes and verification without raw code or tool logs. Optionally regenerate one outcome using the selected summary model (consumes provider usage).',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Root session ID; defaults to the requesting session.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Maximum cards; defaults to 10.',
          },
          waitMs: {
            type: 'integer',
            minimum: 0,
            maximum: 45000,
            description:
              'Optional bounded wait for pending summaries; defaults to 0.',
          },
          regenerateCardId: {
            type: 'string',
            description:
              'Explicitly regenerate this completed outcome with the selected summary model; consumes provider usage.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [
          { type: 'text', text: JSON.stringify(value) },
        ],
      },
      async execute(args, exec) {
        const parsed = z
          .object({
            sessionId: z.string().min(1).max(200).optional(),
            limit: z.number().int().min(1).max(20).default(10),
            waitMs: z.number().int().min(0).max(45000).default(0),
            regenerateCardId: z.string().min(1).max(200).optional(),
          })
          .strict()
          .parse(args);

        const sessionId = parsed.sessionId ?? exec?.agent?.id;
        if (!sessionId)
          throw new Error('A sessionId is required outside an agent session.');

        const { limit, waitMs } = parsed;
        const session = ctx.sessions.get(sessionId);
        if (session) update(session);

        const regeneration = parsed.regenerateCardId
          ? session
            ? coordinator.requestSummary(session, parsed.regenerateCardId)
            : {
                status: 'unavailable',
                reason: 'The original live session is no longer available.',
              }
          : null;

        let snapshot = coordinator.snapshot(sessionId);
        const deadline = Date.now() + waitMs;

        while (
          Date.now() < deadline &&
          !exec?.signal?.aborted &&
          snapshot.sessions.some((row) =>
            row.cards.some((card) =>
              ['queued', 'pending'].includes(card.summaryStatus),
            ),
          )
        ) {
          snapshot = await coordinator.watch(
            sessionId,
            snapshot.revision,
            exec?.signal,
            Math.min(25000, deadline - Date.now()),
          );
        }

        const cards = snapshot.sessions
          .flatMap((row) =>
            row.cards.map((card) => ({
              sessionId: row.sessionId,
              id: card.id,
              title: card.title,
              summary: card.summary,
              verification: card.verification,
              summaryStatus: card.summaryStatus ?? null,
              summarySource: card.summarySource ?? null,
              summaryIssue: card.summaryIssue ?? null,
              time: card.time ?? null,
              changeFiles: card.changeFiles || [],
            })),
          )
          .sort((a, b) => (b.time || 0) - (a.time || 0));

        return {
          sessionId,
          coverage: snapshot.coverage,
          cards: cards.slice(0, limit),
          hasMore: cards.length > limit,
          regeneration,
        };
      },
    }),
  );
}
