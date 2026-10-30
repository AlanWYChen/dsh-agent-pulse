import test from 'node:test';
import assert from 'node:assert/strict';
import { initState } from './engine.js';
import { withWorkspaceChanges } from './workspace.js';

const ref = { seq: 8, turn: 1, time: 100 };

const summary = {
  turn: 1,
  total: 2,
  files: [{ path: 'src/payment.js' }, { path: 'src/checkout.js' }],
};

test('recorded comparison yields bounded evidence without attributing shell changes as proven implementation', () => {
  const state = {
    ...initState({ id: 'root' }),
    lastTurnEnd: { turn: 1, seq: 9 },
  };

  const enriched = withWorkspaceChanges(state, summary, ref);

  assert.equal(state.cards.length, 0);
  assert.equal(enriched.cards.length, 1);

  const card = enriched.cards[0];

  assert.equal(card._finalized, true);
  assert.match(card.summary, /uncertain/);
  assert.equal(card.verification.status, 'unknown');
  assert.deepEqual(card.files, ['payment.js', 'checkout.js']);
  assert.equal(withWorkspaceChanges(enriched, summary, ref), enriched);
});

test('comparison cannot certify extra changed files with earlier tests', () => {
  const state = {
    ...initState({ id: 'root' }),
    cards: [
      {
        id: 'outcome:1',
        files: ['payment.js'],
        verification: { status: 'passed', label: '29 passed' },
        evidence: [],
      },
    ],
  };

  const enriched = withWorkspaceChanges(state, summary, ref);

  assert.equal(enriched.cards[0].verification.status, 'partial');
  assert.equal(enriched.cards.length, 1);
});
