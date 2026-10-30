import { createHash } from 'node:crypto';
import path from 'node:path';
import { isSensitivePath, redactText } from './change-context.js';

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
