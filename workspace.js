// Workspace comparisons are process-local DSH evidence, not part of the durable event payload.
// Enrich only the async feed cache; never make the pure session projection depend on them.
export function withWorkspaceChanges(state, summary, ref, maxCards = 100) {
  if (!summary?.files?.length || !ref || summary.turn !== ref.turn)
    return state;

  const id = `outcome:${summary.turn}`;
  const existing = state.cards.find((c) => c.id === id);
  const names = [
    ...new Set(
      summary.files
        .map((file) =>
          String(file.path || file.display || '')
            .replaceAll('\\', '/')
            .split('/')
            .at(-1)
            .replace(/[^\p{L}\p{N}._@+ -]/gu, '')
            .slice(0, 120),
        )
        .filter(Boolean),
    ),
  ].slice(0, 100);

  const ended = state.lastTurnEnd?.turn === summary.turn;
  const evidence = {
    seq: ref.seq,
    label:
      'Recorded workspace comparison (concurrent-agent attribution may be uncertain)',
  };

  if (existing) {
    const files = [...new Set([...existing.files, ...names])];
    if (existing.evidence.some((e) => e.seq === ref.seq)) return state;

    // A comparison listing additional files is not proof that earlier tests covered those files.
    const verification =
      files.length > existing.files.length &&
      existing.verification.status === 'passed'
        ? {
            status: 'partial',
            label:
              'Tests passed for observed commands; comparison includes additional changes with uncertain coverage',
          }
        : existing.verification;

    return {
      ...state,
      cards: state.cards.map((c) =>
        c.id === id
          ? {
              ...c,
              files,
              verification,
              evidence: [...c.evidence, evidence].slice(-30),
              _workspace: true,
              _workspaceRef: ref,
              _modifications: Math.max(
                c._modifications || 0,
                summary.total || files.length,
              ),
            }
          : c,
      ),
    };
  }

  const card = {
    id,
    category: 'outcome',
    title: 'Workspace changes observed',
    summary:
      'A recorded workspace comparison found related file changes. Attribution may be uncertain when agents share this workspace.',
    status: ended ? 'observed' : 'in_progress',
    time: ref.time,
    agentId: state.agentId,
    files: names,
    evidence: [evidence],
    verification: {
      status: 'unknown',
      label: 'Workspace comparison alone does not establish test coverage',
    },
    _turn: summary.turn,
    _finalized: Boolean(ended),
    _editSeq: ref.seq,
    _modifications: summary.total || names.length,
    semanticHints: [],
    _workspace: true,
    _workspaceRef: ref,
  };

  return { ...state, cards: [...state.cards, card].slice(-maxCards) };
}
