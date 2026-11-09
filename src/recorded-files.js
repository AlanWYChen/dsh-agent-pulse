import { createHash } from 'node:crypto';
import path from 'node:path';
import { isSensitivePath, redactText } from './change-context.js';
import { testCommand } from './engine.js';

const keyFor = (sessionId, callId) =>
  `fileSnapshot_${createHash('sha256')
    .update(JSON.stringify([sessionId, callId]))
    .digest('hex')}`;

const within = (text, maxChars, maxLines) =>
  typeof text === 'string' &&
  text.length <= maxChars &&
  text.split('\n').length <= maxLines;

/** Whole-file evidence from already-authorized successful filesystem tool results.
 * Never reads today's disk, replays a mutation, or captures sensitive paths. */
export class RecordedFiles {
  constructor({
    table,
    config = {},
    cwdOf = () => undefined,
    maxChars = 200000,
    maxLines = 5000,
    maxRecords = 100,
    maxTotalChars = 10000000,
  }) {
    Object.assign(this, {
      table,
      config,
      cwdOf,
      maxChars,
      maxLines,
      maxRecords,
      maxTotalChars,
    });

    this.records = new Map();
    this.pending = new Set();
    this.byKey = new Map();
    this.totalChars = 0;
    this.closed = false;

    for (const [key, record] of table.entries()) {
      if (
        !key.startsWith('fileSnapshot_') ||
        !this.valid(record) ||
        isSensitivePath(record.sourcePath || record.path, config)
      )
        continue;

      this.records.set(key, record);
      this.totalChars += this.size(record);
    }

    this.trim();
  }

  valid(record) {
    return (
      record?.version === 1 &&
      typeof record.sessionId === 'string' &&
      typeof record.callId === 'string' &&
      typeof record.path === 'string' &&
      (record.before === null ||
        within(record.before, this.maxChars, this.maxLines)) &&
      within(record.after, this.maxChars, this.maxLines)
    );
  }

  size(record) {
    return (record.before?.length || 0) + record.after.length;
  }

  track(key, work) {
    const safe = work.catch(() => {
      this.persistenceFailed = true;
    });

    this.pending.add(safe);
    this.byKey.set(key, safe);
    void safe.finally(() => {
      this.pending.delete(safe);
      if (this.byKey.get(key) === safe) this.byKey.delete(key);
    });
  }

  trim() {
    while (
      this.records.size > this.maxRecords ||
      this.totalChars > this.maxTotalChars
    ) {
      const [key, record] = this.records.entries().next().value;
      this.records.delete(key);
      this.totalChars -= this.size(record);

      const before = this.byKey.get(key) || Promise.resolve();
      this.track(
        key,
        before.then(() => this.table.delete(key)),
      );
    }
  }

  observe(exec, result) {
    if (
      this.closed ||
      result?.isError !== false ||
      !exec?.agent?.id ||
      typeof exec.callId !== 'string'
    )
      return;

    const name = String(exec.name || '')
      .split('.')
      .at(-1);
    const value = result.value;
    if (
      !['edit', 'write'].includes(name) ||
      !value ||
      typeof value.path !== 'string' ||
      isSensitivePath(value.path, this.config)
    )
      return;

    if (
      !(
        value.before === null ||
        within(value.before, this.maxChars, this.maxLines)
      ) ||
      !within(value.after, this.maxChars, this.maxLines)
    )
      return;

    const sessionId = exec.agent.id,
      key = keyFor(sessionId, exec.callId);
    if (this.records.has(key)) return;

    const cwd = this.cwdOf(sessionId),
      api = /^[A-Za-z]:[\\/]/.test(value.path) ? path.win32 : path.posix;
    const file =
      api.isAbsolute(value.path) && cwd
        ? api.relative(cwd, value.path)
        : value.path;

    const record = {
      version: 1,
      sessionId,
      callId: exec.callId,
      path: file.replaceAll('\\', '/'),
      sourcePath: value.path,
      before: value.before === null ? null : redactText(value.before),
      after: redactText(value.after),
      createdAt: Date.now(),
    };

    this.records.set(key, record);
    this.totalChars += this.size(record);

    this.track(key, this.table.put(key, record));
    this.trim();
  }

  get(sessionId, callId) {
    const record = this.records.get(keyFor(sessionId, callId));
    if (
      !record ||
      isSensitivePath(record.sourcePath || record.path, this.config)
    )
      return undefined;

    return structuredClone({
      path: record.path,
      before: record.before,
      after: record.after,
      coverage: 'recorded-full',
      notice:
        'Complete before/after file contents captured from the successful tool result; sensitive values redacted. A turn spanning concurrent edits may include changes by other actors.',
    });
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.pending]);
  }
}

/** Bounded, redacted test artifacts; never reads spill paths or consumes model output. */
export class RecordedTestOutputs {
  constructor({
    table,
    jobs,
    config = {},
    onChanged = () => {},
    maxChars = 500000,
    maxRecords = 200,
    maxTotalChars = 10000000,
  }) {
    Object.assign(this, {
      table,
      jobs,
      config,
      onChanged,
      maxChars,
      maxRecords,
      maxTotalChars,
    });
    this.records = new Map();
    this.running = new Map();
    this.pending = Promise.resolve();
    this.dirty = new Set();
    this.persisted = new Set();
    this.writing = false;
    this.closed = false;
    for (const [key, value] of table.entries()) {
      if (
        key.startsWith('testOutput_') &&
        value?.version === 1 &&
        typeof value.sessionId === 'string' &&
        typeof value.callId === 'string' &&
        typeof value.stdout === 'string' &&
        typeof value.stderr === 'string'
      ) {
        const record = structuredClone(value);
        record.command = redactText(record.command || '');
        record.stdout = redactText(record.stdout);
        record.stderr = redactText(record.stderr);
        if (['running', 'stopping'].includes(record.status)) {
          record.status = 'interrupted';
          record.complete = false;
          record.exitCode = null;
          record.notice =
            'Live capture could not reconnect after restoration; terminal result is unknown.';
        }
        this.bound(record);
        this.records.set(key, record);
        this.persisted.add(key);
        this.queue(key);
      }
    }
    this.trim();
    this.dispose = jobs?.events?.subscribe({ owners: 'scope' }, (event) => {
      const id = event.id ?? event.job?.id;
      const tracked = this.running.get(id);
      if (!tracked || (event.owner ?? event.job?.owner) !== tracked.owner)
        return;
      if (['output', 'settled'].includes(event.type))
        this.collect(id, event.job);
    });
  }
  key(owner, callId) {
    return `testOutput_${createHash('sha256')
      .update(JSON.stringify([owner, callId]))
      .digest('hex')}`;
  }
  queue(key) {
    // One in-flight snapshot plus one dirty identity per retained/persisted record.
    // Never retain a full output snapshot for every stream notification.
    if (
      !this.records.has(key) &&
      !this.persisted.has(key) &&
      this.inFlight !== key
    ) {
      this.dirty.delete(key);
      return;
    }
    this.dirty.add(key);
    if (this.writing) return;
    this.writing = true;
    this.pending = Promise.resolve().then(async () => {
      while (this.dirty.size) {
        const next = this.dirty.values().next().value;
        this.dirty.delete(next);
        this.inFlight = next;
        try {
          const record = this.records.get(next);
          if (record) {
            await this.table.put(next, structuredClone(record));
            this.persisted.add(next);
            if (!this.records.has(next)) this.dirty.add(next);
          } else {
            await this.table.delete(next);
            this.persisted.delete(next);
          }
        } catch {
          this.persistenceFailed = true;
        }
        this.inFlight = null;
      }
      // Reset in the same continuation as the final empty check: a separate
      // finally microtask leaves a window where new dirty work gets stranded.
      this.writing = false;
    });
  }
  bound(record) {
    const total = record.stdout.length + record.stderr.length;
    if (total > this.maxChars) {
      record.stdout = record.stdout.slice(0, this.maxChars);
      record.stderr = record.stderr.slice(
        0,
        Math.max(0, this.maxChars - record.stdout.length),
      );
      record.truncated = true;
    }
    if (record.truncated) record.complete = false;
  }
  save(key, record) {
    this.bound(record);
    this.records.set(key, record);
    this.queue(key);
    this.trim();
    this.onChanged(record.sessionId, record.callId);
  }
  trim() {
    const sizeOf = (key, record) => {
      const raw = [...this.running.values()].find(
        (job) => job.key === key,
      )?.raw;
      return Math.max(
        record.stdout.length + record.stderr.length,
        raw ? raw.stdout.length + raw.stderr.length : 0,
      );
    };
    let size = [...this.records].reduce(
      (n, [key, record]) => n + sizeOf(key, record),
      0,
    );
    while (this.records.size > this.maxRecords || size > this.maxTotalChars) {
      const [key, record] = this.records.entries().next().value;
      size -= sizeOf(key, record);
      this.records.delete(key);
      for (const [id, tracked] of this.running)
        if (tracked.key === key) this.running.delete(id);
      this.queue(key);
    }
  }
  observe(exec, result) {
    if (
      this.closed ||
      result?.isError !== false ||
      String(exec?.name).split('.').at(-1) !== 'bash' ||
      !exec?.agent?.id ||
      typeof exec.callId !== 'string'
    )
      return;
    let args = exec.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        return;
      }
    }
    if (!testCommand(args?.command, args)) return;
    const value = result.value;
    if (!value || typeof value !== 'object') return;
    const owner = exec.agent.id,
      key = this.key(owner, exec.callId);
    if (this.records.has(key)) return;
    const background = ['background', 'promoted'].includes(value.kind);
    if (!background && (!value.stdout || !value.stderr)) return;
    const record = {
      version: 1,
      sessionId: owner,
      callId: exec.callId,
      name: `test-${Date.now()}-${key.slice(-12)}.out`,
      command: redactText(args.command),
      stdout: '',
      stderr: '',
      status: background ? 'running' : 'completed',
      exitCode: background ? null : (value.exitCode ?? null),
      complete:
        !background &&
        !value.aborted &&
        !value.timedOut &&
        !value.signal &&
        Number.isInteger(value.exitCode),
      truncated: false,
      createdAt: Date.now(),
    };
    if (!background) {
      record.stdout = redactText(value.stdout.text || '');
      record.stderr = redactText(value.stderr.text || '');
      record.truncated = Boolean(
        value.stdout.truncated || value.stderr.truncated,
      );
      this.save(key, record);
    } else {
      this.save(key, record);
      if (typeof value.jobId === 'string' && this.jobs) {
        this.running.set(value.jobId, {
          key,
          owner,
          offset: 0,
          raw: { stdout: '', stderr: '' },
        });
        this.collect(value.jobId);
      }
    }
  }
  collect(id, supplied) {
    const tracked = this.running.get(id);
    if (!tracked || this.closed) return;
    const record = this.records.get(tracked.key);
    if (!record) return;
    try {
      const read = this.jobs.readAt(id, tracked.offset, tracked.owner);
      for (const chunk of read.chunks) {
        if (chunk.gapBefore) record.truncated = true;
        if (!['stdout', 'stderr'].includes(chunk.channel)) continue;
        // Keep a bounded execution-local source until settlement, never persisted.
        // Re-redacting an already-redacted prefix would expose split secret suffixes.
        const remaining = Math.max(
          0,
          this.maxChars - tracked.raw.stdout.length - tracked.raw.stderr.length,
        );
        if (chunk.text.length > remaining) record.truncated = true;
        tracked.raw[chunk.channel] += chunk.text.slice(0, remaining);
        record[chunk.channel] = redactText(tracked.raw[chunk.channel]);
      }
      tracked.offset = read.next;
      if (read.lossy) record.truncated = true;
      const job = supplied ?? this.jobs.get(id, tracked.owner);
      record.status = job.status;
      const exit = job.detail?.match(/(?:^|\b)exit code: (-?\d+)/);
      record.exitCode = exit ? Number(exit[1]) : null;
      record.complete =
        job.status === 'completed' &&
        record.exitCode !== null &&
        !record.truncated;
      this.save(tracked.key, record);
      if (!['running', 'stopping'].includes(job.status))
        this.running.delete(id);
    } catch {
      record.complete = false;
      record.truncated = true;
      this.save(tracked.key, record);
    }
  }
  get(owner, callId) {
    const value = this.records.get(this.key(owner, callId));
    return value ? structuredClone(value) : undefined;
  }
  async close() {
    this.closed = true;
    this.dispose?.();
    this.running.clear();
    do {
      await this.pending;
    } while (this.writing || this.dirty.size);
  }
}

/** Exact assignment receipts only: never retains execution arguments or output. */
export class RecordedAssignmentBindings {
  constructor({ table, onChanged = () => {}, maxRecords = 200 }) {
    this.table = table;
    this.onChanged = onChanged;
    this.maxRecords =
      Number.isSafeInteger(maxRecords) && maxRecords >= 0 ? maxRecords : 200;
    this.records = new Map();
    this.persisted = new Set();
    this.dirty = new Set();
    this.pending = Promise.resolve();
    this.writing = false;
    this.closed = false;
    for (const [key, value] of table.entries()) {
      if (!key.startsWith('assignmentBinding_')) continue;
      this.persisted.add(key);
      const record = this.receipt(value);
      if (
        record &&
        key === this.key(record.parentSessionId, record.parentCallId)
      )
        this.records.set(key, record);
      // Rewrite only the allowlisted receipt fields, or remove invalid records.
      this.queue(key);
    }
    this.trim();
  }

  key(parentSessionId, parentCallId) {
    return `assignmentBinding_${createHash('sha256')
      .update(JSON.stringify([parentSessionId, parentCallId]))
      .digest('hex')}`;
  }

  receipt(value) {
    const nonempty = (value) => typeof value === 'string' && value.length > 0;
    if (
      !value ||
      !nonempty(value.parentSessionId) ||
      !nonempty(value.parentCallId) ||
      !nonempty(value.childSessionId) ||
      !(
        (value.kind === 'spawn' && value.messageId === null) ||
        (value.kind === 'message' && nonempty(value.messageId))
      )
    )
      return undefined;
    return {
      parentSessionId: value.parentSessionId,
      parentCallId: value.parentCallId,
      childSessionId: value.childSessionId,
      kind: value.kind,
      messageId: value.messageId,
    };
  }

  queue(key) {
    if (
      !this.records.has(key) &&
      !this.persisted.has(key) &&
      this.inFlight !== key
    ) {
      this.dirty.delete(key);
      return;
    }
    this.dirty.add(key);
    if (this.writing) return;
    this.writing = true;
    // Coalesce queued identities; serialize writes and eviction tombstones so a
    // slow put cannot resurrect a record already evicted from memory.
    this.pending = Promise.resolve().then(async () => {
      while (this.dirty.size) {
        const next = this.dirty.values().next().value;
        this.dirty.delete(next);
        this.inFlight = next;
        try {
          const record = this.records.get(next);
          if (record) {
            await this.table.put(next, structuredClone(record));
            this.persisted.add(next);
            if (this.records.get(next) !== record) this.dirty.add(next);
          } else {
            await this.table.delete(next);
            this.persisted.delete(next);
          }
        } catch {
          this.persistenceFailed = true;
        }
        this.inFlight = null;
      }
      this.writing = false;
    });
  }

  trim() {
    while (this.records.size > this.maxRecords) {
      const [key, record] = this.records.entries().next().value;
      this.records.delete(key);
      this.queue(key);
      this.onChanged(record.parentSessionId, record.parentCallId);
    }
  }

  observe(exec, result) {
    if (this.closed || result?.isError !== false) return;
    const name =
      typeof exec?.name === 'string' ? exec.name.split('.').at(-1) : '';
    if (!['send_message', 'subagent', 'subagent_fork'].includes(name)) return;
    const value = result.value;
    if (!value || typeof value !== 'object') return;
    let args = exec.arguments;
    if (name === 'send_message' && typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        return;
      }
    }
    if (name !== 'send_message' && value.kind !== 'activation') return;
    const record = this.receipt({
      parentSessionId: exec.agent?.id,
      parentCallId: exec.callId,
      childSessionId:
        name === 'send_message' ? args?.agent_id : value.subagentId,
      kind: name === 'send_message' ? 'message' : 'spawn',
      messageId: name === 'send_message' ? value.messageId : null,
    });
    if (!record) return;
    const key = this.key(record.parentSessionId, record.parentCallId);
    if (this.records.has(key)) return;
    this.records.set(key, record);
    this.queue(key);
    this.trim();
    this.onChanged(record.parentSessionId, record.parentCallId);
  }

  get(parentSessionId, parentCallId) {
    const record = this.records.get(this.key(parentSessionId, parentCallId));
    return record ? structuredClone(record) : undefined;
  }

  async close() {
    this.closed = true;
    do {
      await this.pending;
    } while (this.writing || this.dirty.size);
  }
}
