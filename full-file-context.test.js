import test from 'node:test';
import assert from 'node:assert/strict';
import { completeReadText, reconstructFullFile } from './full-file-context.js';
import { ChangeContextService } from './change-context.js';

function fixture() {
  const events = [],
    refs = [],
    cwd = '/project',
    file = 'src/a.js';

  const event = (type, data) => {
    const seq = events.length;
    events.push({ type, seq, data });

    return seq;
  };

  const invoke = (
    name,
    args,
    { turn = 1, text = 'Edited', meta, failed = false, target = true } = {},
  ) => {
    const callId = `c${events.length}`;
    const callSeq = event('tool/call', {
      name,
      arguments: JSON.stringify(args),
      callId,
      turn,
    });
    const resultSeq = event('tool/result', {
      turn,
      ...(meta ? { meta } : {}),
      message: {
        toolCallId: callId,
        isError: failed,
        content: [{ type: 'text', text }],
      },
    });
    const ref = { callSeq, resultSeq };
    if (target && name !== 'read') refs.push(ref);

    return ref;
  };

  const read = (lines, options = {}) => {
    const total = options.total ?? lines.length,
      offset = options.offset ?? 1;
    const rows = lines.map((text, i) => ({ number: offset + i, text }));
    const footer = options.footer || `(End of file - total ${total} lines)`;
    const text = `<path>/project/${file}</path>\n<type>file</type>\n<content>\n${rows.length ? rows.map((line) => `${line.number}: ${line.text}`).join('\n') + '\n\n' : ''}${footer}\n</content>`;

    return invoke(
      'read',
      { file_path: file, ...(offset !== 1 ? { offset } : {}) },
      {
        text,
        meta: {
          path: `/project/${file}`,
          offset,
          totalLines: total,
          lines: rows,
          ...options.meta,
        },
        target: false,
      },
    );
  };

  const reconstruct = (options = {}) =>
    reconstructFullFile(events, {
      path: file,
      cwd,
      changeRefs: refs,
      turn: 1,
      ...options,
    });

  return { events, refs, file, cwd, event, invoke, read, reconstruct };
}

test('complete read + edits reconstructs whole historical file, including unchanged lines', () => {
  const f = fixture();

  f.read(['top', 'old', 'bottom']);
  f.invoke('edit', {
    file_path: '/project/src/a.js',
    old_string: 'old',
    new_string: 'new',
  });

  const result = f.reconstruct();

  assert.equal(result.coverage, 'full-lines');
  assert.equal(result.before, 'top\nold\nbottom');
  assert.equal(result.after, 'top\nnew\nbottom');
  assert.match(result.notice, /not authoritative/);
  assert.match(result.notice, /unobserved or concurrent/);
});

test('read validation rejects windowed, capped, truncated, forged or inconsistent evidence', () => {
  for (const options of [
    { offset: 2, total: 3 },
    { total: 3, footer: '(Showing lines 1-2 of 3. Use offset=3 to continue.)' },
    { footer: '(Output capped. Showing lines 1-2. Use offset=3 to continue.)' },
    { meta: { offset: 2 } },
    { meta: { truncatedByBytes: true } },
    { meta: { path: '/project/other.js' } },
    { meta: { lines: [{ number: 2, text: 'old' }] } },
  ]) {
    const f = fixture();

    f.read(['top', 'old'], options);
    f.invoke('edit', {
      file_path: f.file,
      old_string: 'old',
      new_string: 'new',
    });

    assert.equal(
      f.reconstruct().coverage,
      'unavailable',
      JSON.stringify(options),
    );
  }

  const f = fixture();

  f.read(['old... (line truncated to 2000 chars)']);
  f.invoke('edit', { file_path: f.file, old_string: 'old', new_string: 'new' });

  assert.equal(f.reconstruct().coverage, 'unavailable');
});

test('a strict complete envelope can be used without optional presentation metadata', () => {
  const f = fixture();
  const ref = f.read(['old']);

  delete f.events[ref.resultSeq].data.meta;
  f.invoke('edit', { file_path: f.file, old_string: 'old', new_string: 'new' });

  assert.equal(f.reconstruct().coverage, 'full-lines');

  f.events[ref.resultSeq].data.message.content[0].text = f.events[
    ref.resultSeq
  ].data.message.content[0].text.replace('1: old', '2: old');

  assert.equal(f.reconstruct().coverage, 'unavailable');
});

test('earlier complete write supplies baseline, multiple edits cover first through last', () => {
  const f = fixture();

  f.invoke(
    'write',
    { file_path: f.file, content: 'top\nfirst\nsecond\nend' },
    { turn: 0, target: false },
  );
  f.invoke('edit', {
    file_path: f.file,
    old_string: 'first',
    new_string: 'one',
  });
  f.invoke('edit', {
    file_path: f.file,
    old_string: 'second',
    new_string: 'two',
  });

  const result = f.reconstruct();

  assert.equal(result.coverage, 'full-lines');
  assert.equal(result.before, 'top\nfirst\nsecond\nend');
  assert.equal(result.after, 'top\none\ntwo\nend');
});

test('write without before evidence supplies complete after-only content; edits never imply full file', () => {
  const f = fixture();

  f.invoke('write', { file_path: f.file, content: 'whole\nnew\nfile\n' });
  f.invoke('edit', {
    file_path: f.file,
    old_string: 'new',
    new_string: 'updated',
  });

  const result = f.reconstruct();

  assert.equal(result.coverage, 'after-only');
  assert.ok(!('before' in result));
  assert.equal(result.after, 'whole\nupdated\nfile');

  const g = fixture();

  g.invoke('edit', {
    file_path: g.file,
    old_string: 'fragment',
    new_string: 'other',
  });

  assert.equal(g.reconstruct().coverage, 'unavailable');
});

test('exact replacement rejects ambiguous/missing matches, replace_all is explicit', () => {
  const f = fixture();

  f.read(['old old']);
  f.invoke('edit', { file_path: f.file, old_string: 'old', new_string: 'new' });

  assert.equal(f.reconstruct().coverage, 'unavailable');

  f.events[f.refs[0].callSeq].data.arguments = JSON.stringify({
    file_path: f.file,
    old_string: 'old',
    new_string: 'new',
    replace_all: true,
  });

  assert.equal(f.reconstruct().after, 'new new');

  f.events[f.refs[0].callSeq].data.arguments = JSON.stringify({
    file_path: f.file,
    old_string: 'MISSING',
    new_string: 'new',
  });

  assert.equal(f.reconstruct().coverage, 'unavailable');
});

test('failed or mismatched operations do not provide snapshots; explicit bad refs reject', () => {
  const f = fixture();

  f.read(['old']);

  const failed = f.invoke(
    'edit',
    { file_path: f.file, old_string: 'old', new_string: 'bad' },
    { failed: true, target: false },
  );

  f.invoke('edit', { file_path: f.file, old_string: 'old', new_string: 'new' });

  assert.equal(f.reconstruct().after, 'new');
  assert.equal(f.reconstruct({ changeRefs: [failed] }).coverage, 'unavailable');

  const ref = f.refs[0];

  f.events[ref.resultSeq].data.message.toolCallId = 'mismatch';

  assert.equal(f.reconstruct().coverage, 'unavailable');
});

test('limits reject oversized snapshots/line counts and do not scan beyond 1500 events', () => {
  const f = fixture();

  f.read(['old', 'end']);
  f.invoke('edit', { file_path: f.file, old_string: 'old', new_string: 'new' });

  assert.equal(f.reconstruct({ maxChars: 3 }).coverage, 'unavailable');
  assert.equal(f.reconstruct({ maxLines: 1 }).coverage, 'unavailable');

  for (let i = 0; i < 1501; i++) f.event('unrelated', {});

  assert.equal(f.reconstruct().coverage, 'unavailable');

  const g = fixture();

  g.invoke('write', { file_path: g.file, content: 'a'.repeat(200001) });

  assert.equal(g.reconstruct().coverage, 'unavailable');
});

test('read newline normalization permits exact EOF edit but retains full line context caveat', () => {
  const f = fixture();

  f.read(['top', 'old']);
  f.invoke('edit', {
    file_path: f.file,
    old_string: 'old\n',
    new_string: 'new\n',
  });

  const result = f.reconstruct();

  assert.equal(result.coverage, 'full-lines');
  assert.equal(result.before, 'top\nold');
  assert.equal(result.after, 'top\nnew');
  assert.match(result.notice, /Newline endings normalized/);

  const g = fixture();

  g.invoke(
    'write',
    { file_path: g.file, content: 'old\r\nend\r\n' },
    { turn: 0, target: false },
  );
  g.invoke('edit', {
    file_path: g.file,
    old_string: 'old\r\n',
    new_string: 'new\r\n',
  });

  assert.equal(g.reconstruct().after, 'new\nend');
});

function browser(f, options = {}) {
  let snapshots = 0;
  const session = {
    id: 'full-browser',
    header: { cwd: f.cwd },

    get seq() {
      return f.events.length;
    },

    eventAt(seq) {
      return f.events[seq];
    },

    snapshotEvents(from, to) {
      snapshots++;

      return f.events.slice(from, to);
    },
  };
  const card = {
    id: 'outcome:1',
    _turn: 1,
    _changes: f.refs,
    evidence: f.refs.map((ref) => ({ seq: ref.resultSeq })),
  };
  const service = new ChangeContextService(options);

  return {
    service,
    session,
    card,

    get snapshots() {
      return snapshots;
    },

    async result() {
      const prepared = await service.prepare(session, card);

      return {
        prepared,
        diff: await service.diff(session, card, prepared.files[0].id),
      };
    },
  };
}

test('browser shows whole reconstructed history, redacts complete texts, never expands model context', async () => {
  const f = fixture(),
    lines = Array.from(
      { length: 3000 },
      (_, i) => `const row${i} = "Label ${i}";`,
    );

  lines[2500] = 'const password = "HISTORICAL_FULL_SECRET";';
  f.read(lines);
  f.invoke('edit', {
    file_path: f.file,
    old_string: lines[1500],
    new_string: 'const row1500 = "Summary model";',
  });

  const view = browser(f),
    { prepared, diff } = await view.result();

  assert.equal(diff.coverage, 'full-lines');
  assert.equal(diff.status, 'available');
  assert.equal(
    diff.lines.filter((line) => line.kind === 'context').length,
    2999,
  );
  assert.ok(diff.lines.some((line) => line.text === lines[0]));
  assert.ok(diff.lines.some((line) => line.text === lines.at(-1)));
  assert.ok(!JSON.stringify(diff).includes('HISTORICAL_FULL_SECRET'));
  assert.match(diff.notice, /not authoritative/);
  assert.ok(
    prepared.input.changes[0].before.length +
      prepared.input.changes[0].after.length <=
      2000,
  );
  assert.ok(!JSON.stringify(prepared.input).includes('row2999'));

  await view.result();

  assert.equal(view.snapshots, 1);
});

test('browser prefers complete earlier write baseline; only windowed reads stay explicitly partial', async () => {
  const f = fixture();

  f.read(['old', 'end'], { offset: 2, total: 3 });
  f.invoke('edit', { file_path: f.file, old_string: 'old', new_string: 'new' });

  const partial = await browser(f).result();

  assert.equal(partial.diff.coverage, 'partial');
  assert.match(partial.diff.notice, /whole-file history is unavailable/);

  const g = fixture();

  g.invoke(
    'write',
    { file_path: g.file, content: 'top\nold\nend' },
    { turn: 0, target: false },
  );
  g.invoke('edit', { file_path: g.file, old_string: 'old', new_string: 'new' });

  const full = await browser(g).result();

  assert.equal(full.diff.coverage, 'full-lines');
  assert.ok(full.diff.lines.some((line) => line.text === 'end'));
});

test('browser complete logged write is after-only beyond model limits, including empty files', async () => {
  const f = fixture();

  f.invoke('write', {
    file_path: f.file,
    content: Array.from({ length: 800 }, (_, i) => `line ${i}`).join('\n'),
  });

  const { prepared, diff } = await browser(f).result();

  assert.equal(diff.coverage, 'after-only');
  assert.equal(diff.lines.length, 800);
  assert.equal(diff.lines.at(-1).text, 'line 799');
  assert.ok(
    diff.lines.every(
      (line) => line.oldLine === null && line.kind === 'context',
    ),
  );
  assert.ok(prepared.input.changes[0].after.length <= 2000);

  const g = fixture();

  g.invoke('write', { file_path: g.file, content: '' });

  const empty = await browser(g).result();

  assert.equal(empty.diff.status, 'available');
  assert.equal(empty.diff.coverage, 'after-only');
  assert.deepEqual(empty.diff.lines, []);
});

test('browser captured canonical snapshots override reconstruction and remain secret-filtered/cache-only', async () => {
  const f = fixture();
  const ref = f.invoke('edit', {
    file_path: f.file,
    old_string: 'old',
    new_string: 'new',
  });
  let gets = 0;
  const view = browser(f, {
    recordedFiles: {
      get(sessionId, callId) {
        gets++;

        assert.equal(callId, f.events[ref.callSeq].data.callId);

        return {
          path: f.file,
          before: 'top\nold\nconst password = "CAPTURE_SECRET";\nend',
          after: 'top\nnew\nconst password = "CAPTURE_SECRET";\nend',
          coverage: 'recorded-full',
          notice: 'Captured result.',
        };
      },
    },
  });

  const { prepared, diff } = await view.result();

  assert.equal(diff.coverage, 'recorded-full');
  assert.ok(diff.lines.some((line) => line.text === 'end'));
  assert.ok(!JSON.stringify(diff).includes('CAPTURE_SECRET'));
  assert.equal(prepared.input.changes[0].before, 'old');
  assert.equal(prepared.input.changes[0].after, 'new');
  assert.ok(!JSON.stringify(prepared).includes('top'));

  await view.result();

  assert.equal(gets, 1);
  assert.equal(view.snapshots, 1);
});

test('browser capture chains use earliest/latest endpoints with gap notice and reject wrong paths', async () => {
  const f = fixture(),
    a = f.invoke('edit', {
      file_path: f.file,
      old_string: 'old',
      new_string: 'middle',
    }),
    b = f.invoke('edit', {
      file_path: f.file,
      old_string: 'middle',
      new_string: 'new',
    });
  const captures = new Map([
    [
      f.events[a.callSeq].data.callId,
      { path: f.file, before: 'top\nold\nend', after: 'top\nmiddle\nend' },
    ],
    [
      f.events[b.callSeq].data.callId,
      {
        path: f.file,
        before: 'top\nmiddle\nconcurrent\nend',
        after: 'top\nnew\nconcurrent\nend',
      },
    ],
  ]);

  const { diff } = await browser(f, {
    recordedFiles: {
      get(id, callId) {
        return captures.get(callId);
      },
    },
  }).result();

  assert.equal(diff.coverage, 'recorded-full');
  assert.match(diff.notice, /chain has gaps/);
  assert.ok(
    diff.lines.some((line) => line.kind === 'remove' && line.text === 'old'),
  );
  assert.ok(
    diff.lines.some((line) => line.kind === 'add' && line.text === 'new'),
  );

  const wrong = await browser(f, {
    recordedFiles: {
      get() {
        return {
          path: 'unrelated.js',
          before: 'WRONG_PRIVATE',
          after: 'WRONG_PRIVATE',
        };
      },
    },
  }).result();

  assert.equal(wrong.diff.coverage, 'partial');
  assert.ok(!JSON.stringify(wrong.diff).includes('WRONG_PRIVATE'));
});

test('browser known absent captured file is a complete creation; sensitive records bypass capture lookup', async () => {
  const f = fixture();

  f.invoke('write', { file_path: f.file, content: 'new file' });

  const { diff } = await browser(f, {
    recordedFiles: {
      get() {
        return { path: f.file, before: null, after: 'new file' };
      },
    },
  }).result();

  assert.equal(diff.coverage, 'recorded-full');
  assert.match(diff.notice, /recorded absent/);
  assert.equal(diff.lines[1].oldLine, null);

  const g = fixture();

  g.invoke('edit', {
    file_path: '.env',
    old_string: 'PRIVATE',
    new_string: 'PRIVATE',
  });

  const secret = await browser(g, {
    recordedFiles: {
      get() {
        assert.fail('sensitive capture queried');
      },
    },
  }).result();

  assert.equal(secret.diff.status, 'redacted');
  assert.deepEqual(secret.diff.lines, []);
});

test('browser enforces 5000-row / 200000-character output bounds with explicit partial coverage', async () => {
  const f = fixture();

  f.invoke('edit', { file_path: f.file, old_string: 'a', new_string: 'b' });

  const { diff } = await browser(f, {
    recordedFiles: {
      get() {
        return {
          path: f.file,
          before: Array(5000).fill('a').join('\n'),
          after: Array(5000).fill('b').join('\n'),
        };
      },
    },
  }).result();

  assert.equal(diff.coverage, 'partial');
  assert.ok(diff.truncated);
  assert.ok(diff.lines.length <= 5000);
  assert.ok(
    diff.lines.reduce((sum, line) => sum + line.text.length + 1, 0) <= 200000,
  );
  assert.match(diff.notice, /Viewer limited/);
});

test('actual data.meta and legacy message.meta both validate complete reads', () => {
  const f = fixture(),
    ref = f.read(['old']);

  f.events[ref.resultSeq].data.message.meta = f.events[ref.resultSeq].data.meta;
  delete f.events[ref.resultSeq].data.meta;
  f.invoke('edit', { file_path: f.file, old_string: 'old', new_string: 'new' });

  assert.equal(f.reconstruct().coverage, 'full-lines');

  f.events[ref.resultSeq].data.meta = {
    ...f.events[ref.resultSeq].data.message.meta,
    offset: 2,
  };

  assert.equal(f.reconstruct().coverage, 'unavailable');
});

test('old validated write refs outside current tail still show whole after-only content', async () => {
  const f = fixture();

  f.invoke('write', {
    file_path: f.file,
    content: Array.from({ length: 800 }, (_, i) => `historical ${i}`).join(
      '\n',
    ),
  });
  for (let i = 0; i < 1600; i++) f.event('unrelated', { turn: 2 });

  const view = browser(f),
    { prepared, diff } = await view.result();

  assert.equal(diff.coverage, 'after-only');
  assert.equal(diff.lines.length, 800);
  assert.equal(diff.lines.at(-1).text, 'historical 799');
  assert.ok(
    diff.lines.every(
      (line) => line.kind === 'context' && line.oldLine === null,
    ),
  );
  assert.match(diff.notice, /do not attribute additions or removals/);
  assert.ok(!prepared.input.task);
  assert.equal(view.snapshots, 1);
});

test('future complete reads and later-turn writes cannot reconstruct or overwrite an earlier card', async () => {
  const f = fixture();

  f.invoke('edit', { file_path: f.file, old_string: 'old', new_string: 'new' });
  f.read(['FUTURE_PRIVATE', 'new']);
  f.invoke(
    'write',
    { file_path: f.file, content: 'FUTURE_PRIVATE' },
    { turn: 2, target: false },
  );

  const partial = await browser(f).result();

  assert.equal(partial.diff.coverage, 'partial');
  assert.ok(!JSON.stringify(partial.diff).includes('FUTURE_PRIVATE'));

  const g = fixture();

  g.read(['top', 'old', 'end']);
  g.invoke('edit', { file_path: g.file, old_string: 'old', new_string: 'new' });
  g.read(['FUTURE_PRIVATE', 'new']);
  g.invoke(
    'write',
    { file_path: g.file, content: 'FUTURE_PRIVATE' },
    { turn: 2, target: false },
  );

  const full = await browser(g).result();

  assert.equal(full.diff.coverage, 'full-lines');
  assert.ok(!JSON.stringify(full.diff).includes('FUTURE_PRIVATE'));
  assert.ok(full.diff.lines.some((line) => line.text === 'end'));
});

test('overlapping successful mutations reject ambiguous reconstructed ordering', () => {
  const f = fixture();

  f.read(['old']);

  const a = f.event('tool/call', {
    turn: 1,
    name: 'edit',
    callId: 'a',
    arguments: JSON.stringify({
      file_path: f.file,
      old_string: 'old',
      new_string: 'middle',
    }),
  });
  const b = f.event('tool/call', {
    turn: 1,
    name: 'edit',
    callId: 'b',
    arguments: JSON.stringify({
      file_path: f.file,
      old_string: 'middle',
      new_string: 'new',
    }),
  });
  const ar = f.event('tool/result', {
    turn: 1,
    message: { toolCallId: 'a', content: [{ type: 'text', text: 'Edited' }] },
  });
  const br = f.event('tool/result', {
    turn: 1,
    message: { toolCallId: 'b', content: [{ type: 'text', text: 'Edited' }] },
  });

  f.refs.push({ callSeq: a, resultSeq: ar }, { callSeq: b, resultSeq: br });

  assert.equal(f.reconstruct().coverage, 'unavailable');
  assert.match(f.reconstruct().notice, /overlapping/);
});

test('complete empty file read is valid and unrelated files never supply baselines', () => {
  const f = fixture();
  const ref = f.read([]);

  assert.equal(
    completeReadText(f.events[ref.callSeq], f.events[ref.resultSeq], {
      path: f.file,
      cwd: f.cwd,
    }),
    '',
  );

  f.invoke('write', { file_path: f.file, content: 'new' });

  assert.equal(f.reconstruct().coverage, 'full-lines');
  assert.equal(f.reconstruct().before, '');

  const g = fixture();

  g.invoke(
    'write',
    { file_path: 'other.js', content: 'old' },
    { turn: 0, target: false },
  );
  g.invoke('edit', { file_path: g.file, old_string: 'old', new_string: 'new' });

  assert.equal(g.reconstruct().coverage, 'unavailable');
});
