import { z } from 'zod';

const routeName = z.string().trim().min(1).max(200);
const effortOptions = {
  reasoningEffort: routeName.optional(),
  effortPolicy: z.enum(['auto', 'default']).optional(),
};

const explicitSelection = z
  .object({
    mode: z.literal('model'),
    provider: routeName,
    model: routeName,
    ...effortOptions,
  })
  .strict()
  .refine((value) => !(value.reasoningEffort && value.effortPolicy), {
    message: 'Choose either an explicit effort or an effort policy',
  });

export const ModelActionSchema = z.union([
  z.object({ action: z.literal('get') }).strict(),
  z.object({ action: z.literal('list') }).strict(),
  z
    .object({ action: z.literal('set'), mode: z.enum(['follow', 'off']) })
    .strict(),
  explicitSelection.safeExtend({ action: z.literal('set') }),
]);

const SelectionSchema = z.union([
  z.object({ mode: z.enum(['follow', 'off']) }).strict(),
  explicitSelection,
]);

const SETTINGS_KEY = 'settings_summary_model';

function bounded(promise, signal, ms = 10000) {
  return new Promise((resolve, reject) => {
    let timer;

    const cancel = () => {
      cleanup();
      reject(new Error('Model catalog request cancelled'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    };

    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Model catalog request timed out'));
    }, ms);

    if (signal?.aborted) {
      cancel();
      return;
    }

    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** One operation implementation shared by owner UI requests and the agent tool. */
export class SummaryModelSettings {
  constructor({ table, llm, config, onChanged = () => {} }) {
    Object.assign(this, { table, llm, config, onChanged });

    const stored = SelectionSchema.safeParse(table.get(SETTINGS_KEY));
    this.selection = stored.success
      ? stored.data
      : config.summaryProvider && config.summaryModel
        ? {
            mode: 'model',
            provider: config.summaryProvider,
            model: config.summaryModel,
          }
        : { mode: 'follow' };

    this.tail = Promise.resolve();
    this.closed = false;
  }

  get() {
    return {
      selection: { ...this.selection },
      scope: 'profile',
      summariesEnabled: this.config.summaries !== false,
    };
  }

  resolve(follow) {
    if (this.config.summaries === false || this.selection.mode === 'off')
      return null;
    if (this.selection.mode === 'model') {
      const { mode: _, ...selection } = this.selection;
      return selection;
    }

    return follow?.provider && follow?.model
      ? { provider: follow.provider, model: follow.model }
      : null;
  }

  async capabilities(selection, signal) {
    if (
      selection.mode !== 'model' ||
      typeof this.llm.resolveModelInfo !== 'function'
    )
      return { reasoning: null };
    const info = await bounded(
      this.llm.resolveModelInfo(selection.provider, selection.model, signal),
      signal,
    );
    return {
      reasoning: info?.reasoning
        ? {
            efforts: info.reasoning.efforts.map(({ id, name }) => ({
              id,
              name,
            })),
            ...(info.reasoning.defaultEffort
              ? { defaultEffort: info.reasoning.defaultEffort }
              : {}),
          }
        : null,
    };
  }

  async list(signal) {
    const providers = this.llm.listProviders().slice(0, 30);
    const errors = [];

    const rows = await Promise.all(
      providers.map(async (provider) => {
        try {
          const models = await bounded(
            this.llm.listModels(provider.id),
            signal,
          );

          return {
            id: provider.id,
            name: provider.name || provider.id,
            models: models
              .slice(0, 500)
              .map((model) => ({ id: model.id, name: model.name || model.id })),
          };
        } catch {
          errors.push({
            provider: provider.id,
            message:
              'Model catalog unavailable; check provider configuration or sign-in.',
          });

          return {
            id: provider.id,
            name: provider.name || provider.id,
            models: [],
          };
        }
      }),
    );

    if (signal?.aborted) throw new Error('Model catalog request cancelled');

    let remaining = 500;
    const boundedRows = rows.map((row) => {
      const models = row.models.slice(0, remaining);
      remaining -= models.length;
      return { ...row, models };
    });

    const snapshot = this.get();
    let capabilities = { reasoning: null };
    try {
      capabilities = await this.capabilities(snapshot.selection, signal);
    } catch {
      errors.push({
        provider: snapshot.selection.provider || '',
        message: 'Model effort options unavailable.',
      });
    }
    if (signal?.aborted) throw new Error('Model catalog request cancelled');
    return { ...snapshot, ...capabilities, providers: boundedRows, errors };
  }

  async execute(request, signal) {
    const action = ModelActionSchema.parse(request);
    if (this.closed) throw new Error('Summary model settings are closing');
    if (action.action === 'get') return this.get();
    if (action.action === 'list') return this.list(signal);

    const save = async () => {
      if (this.closed || signal?.aborted)
        throw new Error('Model selection cancelled');

      const { action: _, ...selection } = action;
      if (selection.mode === 'model') {
        if (!this.llm.listProviders().some((p) => p.id === selection.provider))
          throw new Error('Selected provider is not configured');

        let models;
        try {
          models = await bounded(
            this.llm.listModels(selection.provider),
            signal,
          );
        } catch {
          throw new Error('Selected provider model catalog is unavailable');
        }

        if (!models.some((model) => model.id === selection.model))
          throw new Error('Selected model is not available from this provider');
      }

      let capabilities;
      try {
        capabilities = await this.capabilities(selection, signal);
      } catch {
        throw new Error('Model effort options unavailable');
      }
      if (
        selection.reasoningEffort &&
        !capabilities.reasoning?.efforts.some(
          (effort) => effort.id === selection.reasoningEffort,
        )
      )
        throw new Error(
          'Selected reasoning effort is not supported by this model',
        );

      if (this.closed || signal?.aborted)
        throw new Error('Model selection cancelled');

      // Commit memory only after persistence succeeds. Calls are serialized for concurrent tabs.
      await this.table.put(SETTINGS_KEY, selection);
      this.selection = selection;
      this.onChanged();

      return { ...this.get(), ...capabilities };
    };

    const result = this.tail.then(save);
    this.tail = result.catch(() => {});

    return result;
  }

  async close() {
    this.closed = true;
    await this.tail;
  }
}

export function modelToolDefinition(settings) {
  return {
    name: 'activity_summary_model',
    description:
      'Get, list, or set the activity-sidebar summary model for this DSH profile. Does not change the chat model; saved changes affect future summaries.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'list', 'set'],
          description:
            'get reads the selection; list includes configured provider models; set saves a selection.',
        },
        mode: {
          type: 'string',
          enum: ['follow', 'model', 'off'],
          description:
            'Required for set: follow uses each working agent model, model uses an explicit route, off keeps factual cards only.',
        },
        provider: {
          type: 'string',
          description:
            'Provider id from list; required only when setting mode=model.',
        },
        model: {
          type: 'string',
          description:
            'Model id from list; required only when setting mode=model.',
        },
        reasoningEffort: {
          type: 'string',
          description:
            'Explicit effort id from list reasoning.efforts; only for mode=model. Mutually exclusive with effortPolicy.',
        },
        effortPolicy: {
          type: 'string',
          enum: ['auto', 'default'],
          description:
            'Only for mode=model: auto uses the lowest supported effort (the summary default); default uses the provider default. Mutually exclusive with reasoningEffort.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => settings.execute(args, exec.signal),
  };
}
