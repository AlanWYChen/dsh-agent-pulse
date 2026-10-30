import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduceEvent } from './engine.js';

test('sensitive file contents containing error words do not falsify successful DSH read envelope', () => {
  let state = initState({ id: 'root' });

  state = reduceEvent(state, {
    type: 'tool/call',
    seq: 0,
    time: 1,
    data: {
      turn: 1,
      callId: 'a',
      name: 'read',
      arguments: '{"file_path":".env"}',
    },
  });
  state = reduceEvent(state, {
    type: 'tool/result',
    seq: 1,
    time: 2,
    data: {
      turn: 1,
      message: {
        toolCallId: 'a',
        content: [
          {
            type: 'text',
            text: '<path>/tmp/.env</path>\n<type>file</type>\n<content>\n1: ERROR: permission denied\n2: SECRET=must-not-store\n</content>',
          },
        ],
      },
    },
  });

  assert.equal(state.cards[0].status, 'observed');
  assert.equal(JSON.stringify(state).includes('must-not-store'), false);
});
