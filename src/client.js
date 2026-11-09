window.__ModuleLoader__.load({
  id: '@local/dsh-agent-activity-intelligence',
  factory(require) {
    const React = require('react');
    // Native DeepSeek text activity animation; see THIRD-PARTY-NOTICES.md.
    const { TextShimmer } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;

    const ID = '@local/dsh-agent-activity-intelligence';
    const KIND = 'agent-activity-intelligence';
    const NS = 'agentActivityIntelligence';
    const EMPTY = Object.freeze({});

    // Whale-tail outline: Copyright (c) 2026 DeepSeek, MIT; see THIRD-PARTY-NOTICES.md.
    const WHALE_TAIL =
      'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742';

    const runningCss = `.aai-working{display:inline-flex;align-items:center;gap:5px;min-height:20px;color:var(--dsw-alias-brand-primary)}.aai-whale-tail{width:18px;height:18px;overflow:visible;transform-origin:50% 85%;animation:aai-tail-wiggle 1.2s ease-in-out infinite}@keyframes aai-tail-wiggle{0%,100%{transform:rotate(-10deg) translateY(0)}50%{transform:rotate(12deg) translateY(-1px)}}@media(prefers-reduced-motion:reduce){.aai-whale-tail{animation:none}}`;

    const dictionaries = {
      en: {
        title: 'What changed',
        description:
          'Evidence-backed sensitive actions, attention items and outcomes.',
        empty: 'No notable activity yet.',
        waiting: 'Activity projection is not available yet.',
        all: 'All',
        sensitive: 'Sensitive',
        attention: 'Needs attention',
        outcome: 'Outcomes',
        evidence: 'Evidence',
        files: 'Files',
        verification: 'Verification',
        agent: 'Agent',
        scope: 'Current session and observed child sessions',
        fallback:
          'Showing available projections. Live summaries are unavailable.',
        retry: 'Retry live updates',
        cached: 'Cached',
        storage: 'Summary cache could not be saved.',
        inferred: 'Summaries are inferred; evidence is authoritative.',
        status: 'Status',
        source: 'Source event',
        pending: 'Summary pending',
        unavailable: 'Summary unavailable',
      },
      zh: {
        title: '变更与关注',
        description: '查看有证据支持的敏感操作、待关注事项和结果。',
        empty: '暂无值得关注的动态。',
        waiting: '动态投影暂不可用。',
        all: '全部',
        sensitive: '敏感操作',
        attention: '需要关注',
        outcome: '结果',
        evidence: '证据',
        files: '文件',
        verification: '验证',
        agent: '智能体',
        scope: '当前会话和已观测到的子会话',
        fallback: '正在显示可用投影，实时摘要暂不可用。',
        retry: '重试实时更新',
        cached: '缓存',
        storage: '摘要缓存保存失败。',
        inferred: '摘要属于推断，请以证据为准。',
        status: '状态',
        source: '来源事件',
        pending: '摘要生成中',
        unavailable: '摘要不可用',
      },
    };

    Object.assign(dictionaries.en, {
      agentWorking: 'Agent is still working',
      summaryModel: 'Summary model',
      effort: 'Effort',
      summarySettings: 'Activity summaries',
      summarySettingsNav: 'Summaries',
      summarySettingsIntro: 'Choose how activity summaries are generated.',
      summaryGeneration: 'Generation',
      summaryModelHint:
        'Used for activity summaries, independently of your chat model.',
      effortHint:
        'Defaults to the lowest effort supported by the selected model.',
      effortAuto: 'Auto (lowest)',
      effortDefault: 'Model default',
      effortUnavailable: 'Effort options unavailable for this model',
      effortFollow:
        'Follows the chat model, but uses its lowest supported effort unless overridden by an explicit summary model.',
      follow: 'Follow chat model (may be expensive)',
      off: 'Off — factual only',
      modelScope:
        'Profile-wide · Does not change the main chat model. Applies to future summaries only.',
      modelLoading: 'Loading models…',
      modelSaving: 'Saving…',
      modelSaved: 'Saved',
      modelError: 'Summary model settings failed',
      modelUnavailable: 'Unavailable selected model',
      modelDisabled: 'Summaries are disabled by configuration.',
    });

    Object.assign(dictionaries.zh, {
      agentWorking: '智能体正在工作',
      summaryModel: '摘要模型',
      effort: '推理强度',
      summarySettings: '动态摘要',
      summarySettingsNav: '摘要',
      summarySettingsIntro: '选择动态摘要的生成方式。',
      summaryGeneration: '生成设置',
      summaryModelHint: '仅用于动态摘要，独立于聊天模型。',
      effortHint: '默认使用所选模型支持的最低推理强度。',
      effortAuto: '自动（最低）',
      effortDefault: '模型默认',
      effortUnavailable: '此模型暂无可用推理强度选项',
      effortFollow:
        '跟随聊天模型，但使用其最低可用推理强度；指定摘要模型后可覆盖强度。',
      follow: '跟随聊天模型（可能费用较高）',
      off: '关闭 — 仅显示事实',
      modelScope: '整个配置档案生效 · 不会更改主聊天模型，仅影响之后的摘要。',
      modelLoading: '正在加载模型…',
      modelSaving: '正在保存…',
      modelSaved: '已保存',
      modelError: '摘要模型设置失败',
      modelUnavailable: '当前所选模型不可用',
      modelDisabled: '配置已禁用摘要。',
    });

    Object.assign(dictionaries.en, {
      changes: 'Changes',
      technicalTrace: 'Technical trace',
      changeBased: 'AI summary · recorded changes',
      metadataBased: 'AI summary · metadata',
      agentReport: 'Native task / agent report · unverified',
      insufficient: 'Not enough change context for a behavioral summary.',
      summaryFailed: 'Summary failed',
      diffLoading: 'Loading changes…',
      diffError: 'Could not load changes',
      diffUnavailable: 'Changes are unavailable for this file.',
      reviewUnavailable: 'No recorded Review is available for this change',
      diffRedacted: 'Changes are redacted for this file.',
      before: 'Before',
      after: 'After',
      context: 'Context',
      closeDiff: 'Close diff',
      unifiedDiff: 'Unified diff',
      debugDetails: 'Debug details',
      generateSummary: 'Generate summary',
      refreshSummary: 'Refresh summary',
      shared: 'Shared attribution',
      legacyUnattributed: 'Legacy / Unattributed',
      summaryUsage: 'Uses the selected summary model',
      summaryRequestError: 'Could not request summary',
      summaryBusy: 'Summary service is busy. Try again later.',
      summaryDisabled: 'Summary generation is disabled.',
      summaryReady: 'Summary ready. Waiting for activity update.',
      truncated: 'Partial diff — additional lines were omitted.',
      noLines: 'No line changes are available.',
    });

    Object.assign(dictionaries.zh, {
      changes: '变更',
      technicalTrace: '技术追踪',
      changeBased: 'AI 摘要 · 已记录变更',
      metadataBased: 'AI 摘要 · 元数据',
      agentReport: '原生任务 / Agent 自述 · 未验证',
      insufficient: '变更上下文不足，无法生成行为级摘要。',
      summaryFailed: '摘要生成失败',
      diffLoading: '正在加载变更…',
      diffError: '无法加载变更',
      diffUnavailable: '此文件的变更不可用。',
      reviewUnavailable: '此变更没有可用的已记录 Review',
      diffRedacted: '此文件的变更已隐去。',
      before: '变更前',
      after: '变更后',
      context: '上下文',
      closeDiff: '关闭差异',
      unifiedDiff: '统一差异',
      debugDetails: '调试详情',
      generateSummary: '生成摘要',
      refreshSummary: '刷新摘要',
      shared: '共享归属',
      legacyUnattributed: '历史 / 未归属',
      summaryUsage: '使用所选摘要模型',
      summaryRequestError: '无法请求摘要',
      summaryBusy: '摘要服务繁忙，请稍后重试。',
      summaryDisabled: '摘要生成已禁用。',
      summaryReady: '摘要已就绪，等待动态更新。',
      truncated: '部分差异 — 其余行已省略。',
      noLines: '暂无可用的行级变更。',
    });

    const css = `.aai-root{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}.aai-root *{box-sizing:border-box}.aai-header{padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.aai-header h2{font-size:14px;margin:0 0 4px}.aai-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.aai-filters{display:flex;gap:5px;flex-wrap:wrap;margin-top:10px}.aai-button{font:inherit;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;cursor:pointer}.aai-button:hover,.aai-button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.aai-button:focus-visible,.aai-root summary:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.aai-scroll{padding:12px;overflow:auto;min-height:0;flex:1}.aai-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px;margin-bottom:10px;overflow-wrap:anywhere}.aai-card h3{font-size:13px;margin:5px 0}.aai-card p{margin:5px 0;white-space:pre-wrap}.aai-meta{display:flex;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px}.aai-card details{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}.aai-card summary{cursor:pointer}.aai-card ul{padding-left:20px;margin:6px 0}.aai-empty{padding:28px 12px;color:var(--dsw-alias-label-secondary);text-align:center}.aai-notice{padding:8px 0}.aai-trigger{white-space:nowrap;font-size:12px}.aai-code{font-family:monospace;font-size:12px}.aai-model{margin-top:10px}.aai-model label{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.aai-model-select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;max-width:100%;min-width:0}.aai-model-select:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.aai-model-select:disabled{cursor:wait;opacity:.65}.aai-subtasks>.aai-subtask{padding-left:8px}.aai-card details.aai-subtask{border-top:0;padding-top:0;margin-top:0}.aai-subtask>summary{display:none}`;

    const OUTPUT_ID = ID + '/test-output';
    function outputAddress(sessionId, callId) {
      if (
        ![sessionId, callId].every(
          (value) =>
            typeof value === 'string' &&
            value.length > 0 &&
            !value.includes('\0'),
        )
      )
        return null;
      return `dsh-resource://activity-test-output/${encodeURIComponent(sessionId)}/${encodeURIComponent(callId)}`;
    }
    function parseOutputAddress(address) {
      try {
        if (typeof address !== 'string') return null;
        const url = new URL(address);
        if (
          url.protocol !== 'dsh-resource:' ||
          url.hostname !== 'activity-test-output' ||
          url.username ||
          url.password ||
          url.port ||
          url.search ||
          url.hash
        )
          return null;
        const parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
        if (parts.length !== 2 || !outputAddress(...parts)) return null;
        return { sessionId: parts[0], callId: parts[1] };
      } catch (_) {
        return null;
      }
    }
    function OutputTab({ useTabInfo, outputRpc, t }) {
      const { tab } = useTabInfo();
      const address = tab.contentId;
      const coords = parseOutputAddress(address);
      const [response, setResponse] = React.useState(null);
      React.useEffect(() => {
        if (!coords || !tab.visible || tab.signal?.aborted) return;
        const controller = new AbortController();
        const abort = () => controller.abort();
        tab.signal?.addEventListener('abort', abort, { once: true });
        setResponse({ address, status: 'loading' });
        (async () => {
          try {
            const result = await outputRpc(coords, controller.signal);
            if (controller.signal.aborted) return;
            const value = result?.value;
            const artifact = value?.artifact;
            if (!result?.ok) throw new Error(t('outputFailed'));
            const valid =
              value?.status === 'available' &&
              artifact &&
              artifact.sessionId === coords.sessionId &&
              artifact.callId === coords.callId &&
              typeof artifact.stdout === 'string' &&
              typeof artifact.stderr === 'string';
            setResponse({
              address,
              status: valid ? 'available' : 'unavailable',
              artifact: valid ? artifact : null,
            });
          } catch (_) {
            if (!controller.signal.aborted)
              setResponse({ address, status: 'error' });
          }
        })();
        return () => {
          controller.abort();
          tab.signal?.removeEventListener('abort', abort);
        };
      }, [address, tab.visible, tab.signal, outputRpc]);
      const active = response?.address === address ? response : null;
      const status = !coords ? 'unavailable' : active?.status || 'loading';
      const artifact = active?.artifact;
      return h(
        'section',
        { className: 'aai-native-diff', 'aria-label': t('viewOutput') },
        h('style', null, css),
        h(
          'header',
          { className: 'aai-diff-toolbar' },
          artifact?.name || t('viewOutput'),
        ),
        status !== 'available'
          ? h(
              'p',
              { role: status === 'error' ? 'alert' : 'status' },
              t(
                status === 'loading'
                  ? 'outputLoading'
                  : status === 'error'
                    ? 'outputFailed'
                    : 'outputUnavailable',
              ),
            )
          : h(
              'div',
              { className: 'aai-diff-body' },
              h(
                'p',
                null,
                `${t('sourceSession')}: ${coords.sessionId} · ${coords.callId}`,
              ),
              h('p', null, artifact.command),
              h(
                'p',
                null,
                artifact.status,
                artifact.exitCode != null &&
                  ` · ${t('exitCode')}: ${artifact.exitCode}`,
              ),
              (!artifact.complete || artifact.truncated) &&
                h('p', { role: 'status' }, t('outputIncomplete')),
              h('h3', null, 'stdout'),
              h('pre', null, artifact.stdout),
              h('h3', null, 'stderr'),
              h('pre', null, artifact.stderr),
            ),
      );
    }

    function Icon(props) {
      return h(
        'svg',
        {
          width: props.size || 16,
          height: props.size || 16,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          'aria-hidden': true,
        },
        h('path', { d: 'M2 10h4l2-6 4 12 2-6h4' }),
      );
    }

    function parentOf(value) {
      return typeof value === 'string' ? value : value?.sessionId;
    }

    // Fold catalog relationships, never session events. No sessions are retained or opened.
    function availableSessions(sessionId, current, catalog) {
      const snapshots = catalog.projectionsBySession || EMPTY;
      const summaries = catalog.byId || EMPTY;
      const values = Object.fromEntries(
        Object.entries(snapshots).map(([id, snapshot]) => [
          id,
          snapshot.values?.[NS],
        ]),
      );

      if (current) values[sessionId] = current;
      const included = new Set([sessionId]);
      let changed = true;

      while (changed) {
        changed = false;
        for (const id of new Set([
          ...Object.keys(values),
          ...Object.keys(summaries),
        ])) {
          const parent =
            values[id] && Object.hasOwn(values[id], 'parentSession')
              ? parentOf(values[id].parentSession)
              : summaries[id]?.parentId;

          if (!included.has(id) && included.has(parent)) {
            included.add(id);
            changed = true;
          }
        }
      }

      return [...included]
        .filter((id) => values[id])
        .map((id) => ({
          ...values[id],
          sessionId: id,
          parentSession: Object.hasOwn(values[id], 'parentSession')
            ? values[id].parentSession
            : summaries[id]?.parentId,
        }));
    }

    function shortAgentId(value) {
      const agent = String(value || '');
      return agent.length > 24 ? `${agent.slice(0, 8)}…` : agent;
    }

    function formatTime(value) {
      if (value == null) return null;

      const date = new Date(value);

      return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
    }

    Object.assign(dictionaries.en, {
      noTestRun: 'No test run observed',
      changeCoverageUnknown: 'Change coverage not established',
      testHistory: 'Test runs',
      testRun: 'Test run',
      checks: 'Checks',
      checkRun: 'Check run',
      pipedResult: 'Completed (piped)',
      outcomes: 'outcomes',
      outcome: 'outcome',
      subtask: 'Subtask',
      subtasks: 'Subtasks',
      unlinkedDelegations: 'Unlinked delegated follow-ups',
      unlinkedDelegationsHint:
        'These historical delegations have no exact child evidence identity. Their child outcomes remain available under Legacy / Unattributed.',
      delegatedWork: 'Delegated work',
      inferredAttribution: 'inferred attribution',
      unavailableAttribution: 'Unavailable',
      pendingAttribution: 'Awaiting child evidence',
      legacyInference: 'legacy inference',
      sourceSession: 'Source session',
      testRunning: 'Running',
      testIncomplete: 'Incomplete',
      testCommandFailed: 'Command failed',
      testUnparsed: 'Unparsed result',
      passed: 'passed',
      failed: 'failed',
      skipped: 'skipped',
      exitCode: 'Exit code',
    });
    Object.assign(dictionaries.zh, {
      noTestRun: '未观测到测试运行',
      changeCoverageUnknown: '尚未确定变更覆盖情况',
      testHistory: '测试运行记录',
      testRun: '测试运行',
      checks: '检查',
      checkRun: '检查运行',
      pipedResult: '已完成（管道）',
      outcomes: '个结果',
      outcome: '个结果',
      subtask: '子任务',
      subtasks: '子任务',
      unlinkedDelegations: '未关联的委派后续',
      unlinkedDelegationsHint:
        '这些历史委派没有精确的子任务证据标识。其子任务结果仍保留在“历史 / 未归属”中。',
      delegatedWork: '委派工作',
      inferredAttribution: '推断归属',
      unavailableAttribution: '不可用',
      pendingAttribution: '等待子任务证据',
      legacyInference: '历史推断',
      sourceSession: '来源会话',
      testRunning: '运行中',
      testIncomplete: '未完成',
      testCommandFailed: '命令失败',
      testUnparsed: '未解析结果',
      passed: '通过',
      failed: '失败',
      skipped: '跳过',
      exitCode: '退出码',
    });

    Object.assign(dictionaries.en, {
      viewOutput: 'View output',
      outputLoading: 'Loading test output…',
      outputFailed: 'Test output request failed',
      outputUnavailable: 'Test output unavailable',
      outputIncomplete: 'Incomplete / truncated output',
    });
    Object.assign(dictionaries.zh, {
      viewOutput: '查看输出',
      outputLoading: '正在加载测试输出…',
      outputFailed: '测试输出请求失败',
      outputUnavailable: '测试输出不可用',
      outputIncomplete: '输出不完整或已截断',
    });
    function TestHistory({
      runs,
      sessionId,
      openResource,
      t,
      showEmpty = false,
    }) {
      if (!Array.isArray(runs) || !runs.length) {
        if (!showEmpty) return null;
        return h(
          'details',
          {
            className: 'aai-test-history',
            'aria-label': t('testHistory'),
            open: false,
          },
          h('summary', null, `${t('testHistory')} (0)`),
          h('p', { className: 'aai-muted' }, t('noTestRun')),
        );
      }
      const timestamp = (value) => {
        if (value == null) return null;
        const time = typeof value === 'number' ? value : Date.parse(value);
        return Number.isFinite(time) ? time : null;
      };
      const ordered = [...runs].sort((a, b) => {
        const left = timestamp(a.startedAt),
          right = timestamp(b.startedAt);
        if (left != null && right != null && left !== right)
          return right - left;
        return (a.sessionId || sessionId) === (b.sessionId || sessionId)
          ? (b.callSeq || 0) - (a.callSeq || 0)
          : 0;
      });
      return h(
        'details',
        {
          className: 'aai-test-history',
          'aria-label': t('testHistory'),
          open: false,
        },
        h('summary', null, `${t('testHistory')} (${ordered.length})`),
        h(
          'ol',
          null,
          ordered.map((run, index) => {
            const label =
              run.executionStatus === 'running'
                ? t('testRunning')
                : run.executionStatus === 'command-failed'
                  ? t('testCommandFailed')
                  : run.executionStatus !== 'completed'
                    ? t('testIncomplete')
                    : run.piped && run.resultStatus === 'unknown'
                      ? t('pipedResult')
                      : ['passed', 'failed'].includes(run.resultStatus)
                        ? t(run.resultStatus)
                        : t('testUnparsed');
            return h(
              'li',
              { key: run.id || index },
              h('div', { className: 'aai-code' }, run.label || t('testRun')),
              typeof run.id === 'string' &&
                run.id.length <= 40 &&
                !run.id.includes('|') &&
                h('div', { className: 'aai-muted aai-code' }, run.id),
              run.output &&
                typeof openResource === 'function' &&
                outputAddress(run.sessionId || sessionId, run.id) &&
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'aai-button',
                    onClick: () =>
                      openResource(
                        outputAddress(run.sessionId || sessionId, run.id),
                      ),
                  },
                  t('viewOutput'),
                ),
              h(
                'div',
                null,
                label,
                run.exitCode != null && ` · ${t('exitCode')}: ${run.exitCode}`,
              ),
              h(
                'div',
                { className: 'aai-muted' },
                `${t('sourceSession')}: ${run.sessionId || sessionId}`,
              ),
              run.counts &&
                h(
                  'div',
                  null,
                  ['passed', 'failed', 'skipped']
                    .filter((key) => Number.isFinite(run.counts[key]))
                    .map((key) =>
                      h('span', { key }, `${run.counts[key]} ${t(key)} `),
                    ),
                ),
            );
          }),
        ),
      );
    }

    function CheckHistory({ runs, sessionId, openResource, t }) {
      if (!Array.isArray(runs) || !runs.length) return null;
      return h(
        'details',
        {
          className: 'aai-check-history',
          'aria-label': t('checks'),
          open: false,
        },
        h('summary', null, `${t('checks')} (${runs.length})`),
        h(
          'ol',
          null,
          runs.map((run, index) => {
            const status = run.piped
              ? t('pipedResult')
              : run.executionStatus === 'running'
                ? t('testRunning')
                : run.executionStatus === 'command-failed'
                  ? t('testCommandFailed')
                  : run.executionStatus === 'incomplete'
                    ? t('testIncomplete')
                    : run.exitCode === 0
                      ? t('passed')
                      : t('testIncomplete');
            const address =
              typeof openResource === 'function'
                ? outputAddress(run.sessionId || sessionId, run.id)
                : null;
            return h(
              'li',
              { key: run.id || index },
              h('div', { className: 'aai-code' }, run.label || t('checkRun')),
              h(
                'div',
                { className: 'aai-muted' },
                `${status} · ${t('sourceSession')}: ${run.sessionId || sessionId}`,
                run.exitCode != null
                  ? ` · ${t('exitCode')}: ${run.exitCode}`
                  : '',
              ),
              run.output &&
                address &&
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'aai-button',
                    onClick: () => openResource(address),
                  },
                  t('viewOutput'),
                ),
            );
          }),
        ),
      );
    }

    // Only the first assignment adds an inset. Deeper cards retain borders above
    // and below, but do not accumulate card padding as logical depth increases.
    const assignmentCss =
      '.aai-assignment .aai-card{padding-left:0;padding-right:0;border-left:0;border-right:0}';

    function Card({
      card,
      sessionId,
      cached,
      openDiff,
      openResource,
      summaryRpc,
      debug = false,
      t,
      taskPath = [],
      inferredByCard,
    }) {
      const evidence =
        debug && Array.isArray(card.evidence) ? card.evidence : [];
      const changeFiles = Array.isArray(card.changeFiles)
        ? card.changeFiles
        : [];
      const changes = changeFiles.filter(
        (file) =>
          file &&
          typeof file.id === 'string' &&
          file.id &&
          typeof file.label === 'string' &&
          file.label,
      );
      const files = [
        ...new Set(
          [
            ...(Array.isArray(card.files) ? card.files : []),
            ...changeFiles.filter((file) => !changes.includes(file)),
          ]
            .map((file) =>
              typeof file === 'string'
                ? file
                : file?.path || file?.name || file?.label || '',
            )
            .filter(
              (label) =>
                typeof label === 'string' &&
                label &&
                !changes.some((file) => file.label === label),
            ),
        ),
      ];

      const verification = card.verification || EMPTY;
      const tasks = Array.isArray(card.subtasks) ? card.subtasks : [];
      const inferredGroups =
        inferredByCard instanceof Map
          ? inferredByCard.get(JSON.stringify([sessionId, card.id])) || []
          : [];
      const coveredSessions = new Set(
        inferredGroups.map((group) => group.sessionId),
      );
      for (const task of tasks)
        if (Array.isArray(task.cards) && task.cards.length > 0)
          coveredSessions.add(task.sessionId);
      const emptyTask = (task) =>
        !Array.isArray(task.cards) || task.cards.length === 0;
      const actionableEmpty = (task) =>
        emptyTask(task) &&
        ['running', 'in_progress', 'failed', 'error'].includes(task.status);
      const coveredEmpty = (task) =>
        emptyTask(task) && coveredSessions.has(task.sessionId);
      const linkedTasks = tasks.filter(
        (task) =>
          (!emptyTask(task) || actionableEmpty(task)) && !coveredEmpty(task),
      );
      const unlinkedTasks = tasks.filter(
        (task) =>
          emptyTask(task) && !actionableEmpty(task) && !coveredEmpty(task),
      );

      // Parent fallback labels resolve through exact or inferred child evidence.
      const delegatedChanges = new Map();
      const collectDelegatedChanges = (
        sourceSessionId,
        sourceCardId,
        entries,
      ) => {
        for (const file of Array.isArray(entries) ? entries : []) {
          if (
            !file ||
            typeof file.id !== 'string' ||
            !file.id ||
            typeof file.label !== 'string' ||
            !file.label ||
            delegatedChanges.has(file.label)
          )
            continue;
          delegatedChanges.set(file.label, {
            id: file.id,
            label: file.label,
            sourceSessionId,
            sourceCardId,
          });
        }
      };
      for (const task of linkedTasks)
        for (const child of Array.isArray(task.cards) ? task.cards : [])
          collectDelegatedChanges(
            child.sourceSessionId || task.sessionId,
            child.id,
            child.changeFiles,
          );
      for (const group of inferredGroups)
        for (const row of group.rows)
          collectDelegatedChanges(
            row.sessionId,
            row.card.id,
            row.card.changeFiles,
          );
      const subtaskCount =
        linkedTasks.length + inferredGroups.length + unlinkedTasks.length;

      const [summaryRequest, setSummaryRequest] = React.useState(null);
      const summaryRef = React.useRef(null);

      const summaryIdentity = JSON.stringify([sessionId, card.id]);
      const summarySnapshot = JSON.stringify([
        card.summaryStatus,
        card.summary,
      ]);

      React.useEffect(
        () => () => {
          summaryRef.current?.abort();
          summaryRef.current = null;
        },
        [summaryIdentity, summaryRpc],
      );

      const requestSummary = async () => {
        if (
          summaryPending ||
          summaryRef.current ||
          typeof summaryRpc !== 'function'
        )
          return;

        const controller = new AbortController();
        summaryRef.current = controller;
        const base = { identity: summaryIdentity, snapshot: summarySnapshot };
        setSummaryRequest({ ...base, status: 'requesting' });

        try {
          const result = await summaryRpc(
            { sessionId, cardId: card.id },
            controller.signal,
          );

          if (controller.signal.aborted || summaryRef.current !== controller)
            return;
          if (!result?.ok)
            throw new Error(
              result?.error?.message ||
                result?.error ||
                t('summaryRequestError'),
            );

          const value = result.value;
          if (
            ![
              'queued',
              'pending',
              'ready',
              'disabled',
              'in_progress',
              'busy',
              'unavailable',
            ].includes(value?.status)
          )
            throw new Error(t('summaryRequestError'));

          setSummaryRequest({
            ...base,
            status: value.status,
            reason: typeof value.reason === 'string' ? value.reason : '',
          });
        } catch (error) {
          if (!controller.signal.aborted && summaryRef.current === controller)
            setSummaryRequest({
              ...base,
              status: 'error',
              reason: String(error.message || error),
            });
        } finally {
          if (summaryRef.current === controller) summaryRef.current = null;
        }
      };

      const summaryAction =
        summaryRequest?.identity === summaryIdentity &&
        summaryRequest.snapshot === summarySnapshot
          ? summaryRequest
          : null;
      const summaryPending =
        ['queued', 'pending', 'running', 'in_progress'].includes(
          card.summaryStatus,
        ) ||
        ['requesting', 'queued', 'pending', 'in_progress'].includes(
          summaryAction?.status,
        );

      const [opening, setOpening] = React.useState(null);
      const openingRef = React.useRef(null);
      const openingIdentity = JSON.stringify([
        sessionId,
        card.id,
        changes.map((file) => [file.id, file.label]),
        [...delegatedChanges.values()].map((file) => [
          file.sourceSessionId,
          file.sourceCardId,
          file.id,
          file.label,
        ]),
      ]);
      React.useEffect(
        () => () => {
          openingRef.current?.controller.abort();
          openingRef.current = null;
        },
        [openingIdentity, openDiff],
      );
      const activeOpening =
        opening?.identity === openingIdentity ? opening : null;
      const select = async (
        file,
        sourceSessionId = sessionId,
        sourceCardId = card.id,
      ) => {
        const key = JSON.stringify([sourceSessionId, sourceCardId, file.id]);
        if (openingRef.current?.key === key) return;
        openingRef.current?.controller.abort();
        const controller = new AbortController();
        openingRef.current = { controller, key };
        setOpening({
          identity: openingIdentity,
          fileId: file.id,
          key,
          status: 'loading',
        });
        try {
          if (
            typeof openDiff !== 'function' ||
            !sourceSessionId ||
            !sourceCardId
          )
            throw new Error(t('diffUnavailable'));
          await openDiff(
            {
              sourceSessionId,
              cardId: sourceCardId,
              fileId: file.id,
              label: file.label,
            },
            controller.signal,
          );
          if (!controller.signal.aborted) setOpening(null);
        } catch (error) {
          if (!controller.signal.aborted)
            setOpening({
              identity: openingIdentity,
              fileId: file.id,
              key,
              status: 'error',
              error: String(error.message || error),
            });
        } finally {
          if (openingRef.current?.controller === controller)
            openingRef.current = null;
        }
      };
      const changeButton = (
        file,
        sourceSessionId = sessionId,
        sourceCardId = card.id,
      ) =>
        h(
          'button',
          {
            type: 'button',
            className: 'aai-button aai-code',
            'aria-label': `${t('changes')}: ${file.label}`,
            disabled:
              activeOpening?.status === 'loading' &&
              activeOpening.key ===
                JSON.stringify([sourceSessionId, sourceCardId, file.id]),
            onClick: () => select(file, sourceSessionId, sourceCardId),
          },
          file.label,
        );

      return h(
        'article',
        { className: 'aai-card' },
        h(
          'div',
          { className: 'aai-meta' },
          h(
            'span',
            null,
            t(
              card.category === 'sensitive'
                ? 'sensitive'
                : card.category === 'attention'
                  ? 'attention'
                  : 'outcome',
            ),
          ),
          card.status && h('span', null, `${t('status')}: ${card.status}`),
          cached && h('span', null, t('cached')),
          ['changes', 'metadata', 'agent-report'].includes(
            card.summarySource,
          ) &&
            h(
              'span',
              { className: 'aai-source' },
              t(
                card.summarySource === 'changes'
                  ? 'changeBased'
                  : card.summarySource === 'agent-report'
                    ? 'agentReport'
                    : 'metadataBased',
              ),
            ),
        ),
        h(
          'h3',
          null,
          card.summaryStatus === 'in_progress' &&
            card.summarySource !== 'agent-report'
            ? h(
                'span',
                {
                  className: 'aai-working',
                  role: 'status',
                  'aria-label': t('agentWorking'),
                  title: t('agentWorking'),
                },
                h(
                  'svg',
                  {
                    className: 'aai-whale-tail',
                    viewBox: '0 0 16 16',
                    fill: 'none',
                    'aria-hidden': true,
                    focusable: false,
                  },
                  h('path', {
                    d: WHALE_TAIL,
                    stroke: 'currentColor',
                    strokeWidth: 1,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }),
                ),
                h(
                  TextShimmer,
                  { className: 'aai-working-label', active: true },
                  `${t('agentWorking')}...`,
                ),
              )
            : card.title,
        ),
        card.summary && h('p', null, card.summary),
        h(
          'div',
          { className: 'aai-meta' },
          h('span', null, `${t('agent')}: ${card.agentId || sessionId}`),
          h('span', null, `${t('sourceSession')}: ${sessionId}`),
          formatTime(card.time) && h('time', null, formatTime(card.time)),
        ),
        h(
          'p',
          { className: 'aai-muted' },
          `${t('verification')}: ${verification.status === 'not-run' ? t(Array.isArray(card.testRuns) && card.testRuns.length ? 'changeCoverageUnknown' : 'noTestRun') : verification.label || verification.status || 'unknown'}`,
        ),
        card.category === 'outcome' &&
          typeof summaryRpc === 'function' &&
          h(
            'div',
            { className: 'aai-summary-action' },
            h(
              'button',
              {
                type: 'button',
                className: 'aai-button',
                title: t('summaryUsage'),
                disabled: summaryPending || !card.id || !sessionId,
                onClick: requestSummary,
              },
              t(
                card.summaryStatus === 'ready'
                  ? 'refreshSummary'
                  : 'generateSummary',
              ),
            ),
            summaryAction &&
              h(
                'p',
                {
                  className: 'aai-muted',
                  role: summaryAction.status === 'error' ? 'alert' : 'status',
                },
                summaryAction.status === 'error'
                  ? t('summaryRequestError')
                  : ['requesting', 'queued', 'pending', 'in_progress'].includes(
                        summaryAction.status,
                      )
                    ? t('pending')
                    : summaryAction.status === 'disabled'
                      ? t('summaryDisabled')
                      : summaryAction.status === 'busy'
                        ? t('summaryBusy')
                        : summaryAction.status === 'unavailable'
                          ? t('unavailable')
                          : summaryAction.status === 'ready'
                            ? t('summaryReady')
                            : '',
                summaryAction.reason && ` ${summaryAction.reason}`,
              ),
          ),
        h(TestHistory, {
          runs: card.testRuns,
          sessionId,
          openResource,
          t,
          showEmpty: changes.length > 0 || files.length > 0,
        }),
        h(CheckHistory, {
          runs: card.checkRuns,
          sessionId,
          openResource,
          t,
        }),
        ['queued', 'pending', 'running'].includes(card.summaryStatus) &&
          h('p', { className: 'aai-muted', role: 'status' }, t('pending')),
        ['unavailable', 'rejected', 'disabled'].includes(card.summaryStatus) &&
          h('p', { className: 'aai-muted', role: 'status' }, t('unavailable')),
        card.summaryStatus === 'insufficient' &&
          h('p', { className: 'aai-muted', role: 'status' }, t('insufficient')),
        ['failed', 'error'].includes(card.summaryStatus) &&
          h(
            'p',
            { className: 'aai-muted', role: 'status' },
            t('summaryFailed'),
          ),
        subtaskCount > 0 &&
          h(
            'details',
            {
              className: 'aai-subtasks',
              'aria-label': t(subtaskCount === 1 ? 'subtask' : 'subtasks'),
              open: false,
            },
            h(
              'summary',
              null,
              `${t(subtaskCount === 1 ? 'subtask' : 'subtasks')} (${subtaskCount})`,
            ),
            linkedTasks.map((task) => {
              const path = [...taskPath, task.label || t('unavailable')];
              return h(
                'details',
                {
                  key: task.id,
                  className: 'aai-assignment aai-subtask',
                  'data-visual-depth': 1,
                  open: true,
                },
                h(
                  'summary',
                  null,
                  path.join(' › '),
                  ` · ${t('agent')}: ${shortAgentId(task.sessionId)}`,
                  ` · ${task.status}`,
                  ['shared', 'unavailable', 'legacy', 'pending'].includes(
                    task.attribution,
                  ) &&
                    ` · ${t(
                      task.attribution === 'legacy'
                        ? 'legacyInference'
                        : task.attribution === 'unavailable'
                          ? 'unavailableAttribution'
                          : task.attribution === 'pending'
                            ? 'pendingAttribution'
                            : 'shared',
                    )}`,
                ),
                h(
                  'div',
                  {
                    style: taskPath.length ? undefined : { marginLeft: '12px' },
                  },
                  (!Array.isArray(task.cards) || task.cards.length === 0) &&
                    h(
                      'p',
                      { className: 'aai-muted' },
                      task.reason || t('unlinkedDelegationsHint'),
                    ),
                  (task.cards || []).map((child) =>
                    h(Card, {
                      key: `${task.id}:${child.id}`,
                      card: child,
                      sessionId: child.sourceSessionId || task.sessionId,
                      cached,
                      openDiff,
                      openResource,
                      summaryRpc,
                      debug,
                      t,
                      taskPath: path,
                      inferredByCard,
                    }),
                  ),
                ),
              );
            }),
            inferredGroups.length > 0 &&
              inferredGroups.map((group) =>
                h(
                  'details',
                  {
                    key: `inferred:${group.sessionId}`,
                    className:
                      'aai-assignment aai-session-group aai-inferred aai-subtask',
                    'data-visual-depth': 1,
                    open: true,
                  },
                  h(
                    'summary',
                    null,
                    `${group.label || t('delegatedWork')} · ${t('agent')}: ${shortAgentId(group.sessionId)} · ${group.status}`,
                    group.status !== 'completed' &&
                      ` · ${t('inferredAttribution')} · ${group.rows.length} ${t(group.rows.length === 1 ? 'outcome' : 'outcomes')}`,
                  ),
                  h(
                    'div',
                    {
                      style: taskPath.length
                        ? undefined
                        : { marginLeft: '12px' },
                    },
                    group.rows.map((row) =>
                      h(Card, {
                        key: `inferred:${group.sessionId}:${row.card.id}`,
                        card: row.card,
                        sessionId: row.sessionId,
                        cached: row.cached,
                        openDiff,
                        openResource,
                        summaryRpc,
                        debug,
                        t,
                        taskPath: [...taskPath, group.label || group.sessionId],
                        inferredByCard,
                      }),
                    ),
                  ),
                ),
              ),
            unlinkedTasks.length > 0 &&
              h(
                'details',
                {
                  className: 'aai-assignment aai-unlinked aai-subtask',
                  open: true,
                },
                h(
                  'summary',
                  null,
                  `${t('unlinkedDelegations')} (${unlinkedTasks.length})`,
                ),
                h(
                  'p',
                  { className: 'aai-muted' },
                  t('unlinkedDelegationsHint'),
                ),
                h(
                  'ul',
                  null,
                  (() => {
                    const groups = new Map();
                    for (const task of unlinkedTasks) {
                      const label = task.label || t('unavailable');
                      groups.set(label, (groups.get(label) || 0) + 1);
                    }
                    return [...groups].map(([label, count]) =>
                      h(
                        'li',
                        { key: label },
                        count > 1 ? `${label} × ${count}` : label,
                      ),
                    );
                  })(),
                ),
              ),
          ),
        card.changesReady !== false &&
          (changes.length > 0 || files.length > 0) &&
          h(
            'details',
            { className: 'aai-changes' },
            h(
              'summary',
              null,
              `${t('changes')} (${changes.length + files.length})`,
            ),
            h(
              'ul',
              null,
              changes.map((file) =>
                h('li', { key: file.id }, changeButton(file)),
              ),
              files.map((label, i) => {
                const delegated = delegatedChanges.get(label);
                return h(
                  'li',
                  { key: `fallback:${i}`, className: 'aai-code' },
                  delegated
                    ? changeButton(
                        delegated,
                        delegated.sourceSessionId,
                        delegated.sourceCardId,
                      )
                    : label,
                );
              }),
            ),
            activeOpening &&
              h(
                'p',
                {
                  className: 'aai-muted',
                  role: activeOpening.status === 'error' ? 'alert' : 'status',
                },
                activeOpening.status === 'error'
                  ? activeOpening.error
                  : t('diffLoading'),
              ),
          ),
        evidence.length > 0 &&
          h(
            'details',
            { className: 'aai-trace' },
            h('summary', null, `${t('technicalTrace')} (${evidence.length})`),
            h(
              'ul',
              null,
              evidence.map((item, i) =>
                h(
                  'li',
                  { key: `${item.seq}:${i}` },
                  h('span', { className: 'aai-code' }, `#${item.seq}`),
                  ' ',
                  item.label || t('source'),
                ),
              ),
            ),
          ),
      );
    }

    const selectionKey = (selection) =>
      selection.mode === 'model'
        ? JSON.stringify([selection.provider, selection.model])
        : selection.mode;

    function ModelPicker({ modelRpc, visible, t }) {
      const [settings, setSettings] = React.useState(null);
      const [providers, setProviders] = React.useState([]);
      const [status, setStatus] = React.useState('loading');
      const [failure, setFailure] = React.useState('');
      const controllerRef = React.useRef(null);
      const pendingRef = React.useRef(false);

      React.useEffect(() => {
        if (!visible) return;

        const controller = new AbortController();
        controllerRef.current = controller;
        pendingRef.current = true;
        setStatus('loading');
        setFailure('');

        const request = async (action) => {
          const result = await modelRpc({ action }, controller.signal);
          if (!result.ok || !result.value?.selection)
            throw new Error(
              result.error?.message || result.error || t('modelError'),
            );

          return result.value;
        };

        (async () => {
          try {
            // Get the saved choice independently of catalog availability.
            try {
              const value = await request('get');
              if (!controller.signal.aborted) setSettings(value);
            } catch (_) {
              /* A successful list can still recover settings. */
            }

            if (controller.signal.aborted) return;

            const value = await request('list');

            if (controller.signal.aborted) return;

            setSettings(value);
            setProviders(value.providers || []);
            setFailure(
              (value.errors || [])
                .map((error) => `${error.provider}: ${error.message}`)
                .join('; '),
            );
            setStatus('');
          } catch (error) {
            if (!controller.signal.aborted) {
              setFailure(String(error.message || error));
              setStatus('error');
            }
          } finally {
            if (!controller.signal.aborted) pendingRef.current = false;
          }
        })();

        return () => {
          controller.abort();
          controllerRef.current = null;
        };
      }, [modelRpc, visible]);

      const save = async (event, effortChange = false) => {
        const controller = controllerRef.current;
        if (
          !settings ||
          pendingRef.current ||
          !controller ||
          controller.signal.aborted
        )
          return;

        const key = event.target.value;
        if (!effortChange && key === selectionKey(settings.selection)) return;

        let selection;
        if (effortChange) {
          if (settings.selection.mode !== 'model') return;
          const {
            reasoningEffort: _,
            effortPolicy: __,
            ...route
          } = settings.selection;
          selection = { ...route, ...JSON.parse(key) };
        } else if (key === 'follow' || key === 'off') selection = { mode: key };
        else {
          const [provider, model] = JSON.parse(key);
          selection = { mode: 'model', provider, model };
        }

        pendingRef.current = true;
        setStatus('saving');
        setFailure('');

        try {
          const result = await modelRpc(
            { action: 'set', ...selection },
            controller.signal,
          );

          if (controller.signal.aborted) return;
          if (!result.ok || !result.value?.selection)
            throw new Error(
              result.error?.message || result.error || t('modelError'),
            );

          setSettings(result.value);
          setStatus('saved');
        } catch (error) {
          // Keep the last acknowledged selection on failure; never silently follow chat.
          if (!controller.signal.aborted) {
            setFailure(String(error.message || error));
            setStatus('error');
          }
        } finally {
          if (!controller.signal.aborted) pendingRef.current = false;
        }
      };

      const selection = settings?.selection;
      const key = selection ? selectionKey(selection) : '';
      const available =
        selection?.mode !== 'model' ||
        providers.some(
          (provider) =>
            provider.id === selection.provider &&
            provider.models?.some((model) => model.id === selection.model),
        );

      return h(
        'div',
        { className: 'aai-model' },
        h(
          'label',
          { className: 'aai-setting-row' },
          h(
            'span',
            { className: 'aai-setting-copy' },
            h('span', { className: 'aai-setting-title' }, t('summaryModel')),
            h(
              'span',
              { className: 'aai-setting-description' },
              t('summaryModelHint'),
            ),
          ),
          h(
            'select',
            {
              className: 'aai-model-select',
              'aria-label': t('summaryModel'),
              value: key,
              disabled:
                !settings || status === 'loading' || status === 'saving',
              onChange: save,
            },
            !selection &&
              h('option', { value: '', disabled: true }, t('modelLoading')),
            h('option', { value: 'follow' }, t('follow')),
            h('option', { value: 'off' }, t('off')),
            !available &&
              h(
                'option',
                { value: key, disabled: true },
                `${t('modelUnavailable')}: ${selection.provider} / ${selection.model}`,
              ),
            providers.map((provider) =>
              h(
                'optgroup',
                { key: provider.id, label: provider.name || provider.id },
                (provider.models || []).map((model) =>
                  h(
                    'option',
                    {
                      key: model.id,
                      value: selectionKey({
                        mode: 'model',
                        provider: provider.id,
                        model: model.id,
                      }),
                    },
                    model.name || model.id,
                  ),
                ),
              ),
            ),
          ),
        ),
        selection?.mode === 'model' &&
          h(
            'label',
            { className: 'aai-setting-row' },
            h(
              'span',
              { className: 'aai-setting-copy' },
              h('span', { className: 'aai-setting-title' }, t('effort')),
              h(
                'span',
                { className: 'aai-setting-description' },
                t('effortHint'),
              ),
            ),
            h(
              'select',
              {
                className: 'aai-model-select',
                'aria-label': t('effort'),
                value: JSON.stringify(
                  selection.reasoningEffort
                    ? { reasoningEffort: selection.reasoningEffort }
                    : { effortPolicy: selection.effortPolicy || 'auto' },
                ),
                disabled:
                  status === 'loading' ||
                  status === 'saving' ||
                  !settings.reasoning?.efforts?.length,
                onChange: (event) => save(event, true),
              },
              h(
                'option',
                { value: JSON.stringify({ effortPolicy: 'auto' }) },
                t('effortAuto'),
              ),
              h(
                'option',
                { value: JSON.stringify({ effortPolicy: 'default' }) },
                t('effortDefault'),
              ),
              selection.reasoningEffort &&
                !settings.reasoning?.efforts?.some(
                  (effort) => effort.id === selection.reasoningEffort,
                ) &&
                h(
                  'option',
                  {
                    value: JSON.stringify({
                      reasoningEffort: selection.reasoningEffort,
                    }),
                    disabled: true,
                  },
                  `${t('modelUnavailable')}: ${selection.reasoningEffort}`,
                ),
              (settings.reasoning?.efforts || []).map((effort) =>
                h(
                  'option',
                  {
                    key: effort.id,
                    value: JSON.stringify({ reasoningEffort: effort.id }),
                  },
                  effort.name || effort.id,
                ),
              ),
            ),
            !settings.reasoning?.efforts?.length &&
              h('div', { className: 'aai-muted' }, t('effortUnavailable')),
          ),
        selection?.mode === 'follow' &&
          h('div', { className: 'aai-muted' }, t('effortFollow')),
        h('div', { className: 'aai-muted' }, t('modelScope')),
        settings?.summariesEnabled === false &&
          h('div', { className: 'aai-muted' }, t('modelDisabled')),
        h(
          'div',
          { className: 'aai-muted', role: 'status', 'aria-live': 'polite' },
          ['loading', 'saving', 'saved'].includes(status)
            ? t(`model${status[0].toUpperCase()}${status.slice(1)}`)
            : '',
        ),
        failure &&
          h(
            'div',
            { className: 'aai-muted', role: 'alert' },
            `${t('modelError')}: ${failure}`,
          ),
      );
    }

    // Keep these styles local: the Settings shell owns page padding and layout.
    const settingsCss = `
.aai-settings{width:100%;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px}
.aai-settings *{box-sizing:border-box}
.aai-settings h2{margin:0;font-size:16px;font-weight:500;line-height:24px}
.aai-settings-intro{margin:8px 0 24px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.aai-settings-card{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);padding:0 16px}
.aai-settings-card h3{margin:0;padding:16px 0;font-size:14px;font-weight:500;line-height:22px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.aai-settings .aai-model{margin:0}
.aai-settings .aai-setting-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,270px);align-items:center;gap:12px 24px;margin:0;padding:20px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.aai-setting-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
.aai-setting-title{font-size:14px;line-height:20px}
.aai-setting-description,.aai-settings .aai-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.aai-settings .aai-model-select{appearance:none;display:block;width:100%;min-width:0;max-width:100%;height:36px;padding:0 34px 0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-2);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;text-overflow:ellipsis;cursor:pointer}
.aai-settings .aai-model-select:hover:not(:disabled){border-color:var(--dsw-alias-label-tertiary)}
.aai-settings .aai-model-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.aai-settings .aai-model-select:disabled{opacity:.5;cursor:not-allowed}
.aai-settings .aai-model>.aai-muted{margin:12px 0}
.aai-setting-row>.aai-muted{grid-column:1/-1}
.aai-settings [role=alert]{color:var(--dsw-alias-state-error-primary)}
.aai-settings [role=status]:empty{display:none}
@media(max-width:640px){.aai-settings .aai-setting-row{grid-template-columns:minmax(0,1fr);gap:12px}.aai-settings .aai-model-select{width:100%}}
`;

    function SummarySettings({ modelRpc, t }) {
      return h(
        'section',
        { className: 'aai-settings', 'aria-label': t('summarySettings') },
        h('style', null, settingsCss),
        h('h2', null, t('summarySettings')),
        h('p', { className: 'aai-settings-intro' }, t('summarySettingsIntro')),
        h(
          'div',
          { className: 'aai-settings-card' },
          h('h3', null, t('summaryGeneration')),
          h(ModelPicker, { modelRpc, visible: true, t }),
        ),
      );
    }

    function Panel({
      sessionId,
      useProjection,
      useSessions,
      useTabInfo,
      watch,
      openDiff,
      openResource,
      summaryRpc,
      t,
    }) {
      const current = useProjection(NS);
      const projections = useSessions((state) => state.projectionsBySession);
      const byId = useSessions((state) => state.byId);
      const tab = useTabInfo();
      const visible = tab.tab.visible;

      const [live, setLive] = React.useState(null);
      const [error, setError] = React.useState(false);
      const [attempt, retry] = React.useState(0);
      const [filter, setFilter] = React.useState('all');
      const [debug, setDebug] = React.useState(false);

      React.useEffect(() => {
        if (!visible) return;

        const controller = new AbortController();
        let revision;
        setLive(null);
        setError(false);

        (async () => {
          try {
            while (!controller.signal.aborted) {
              const result = await watch(
                {
                  sessionId,
                  ...(revision === undefined
                    ? {}
                    : { afterRevision: revision }),
                },
                controller.signal,
              );

              if (controller.signal.aborted) return;
              if (!result.ok || !Array.isArray(result.value?.sessions))
                throw new Error('Activity watch unavailable');

              revision = result.value.revision;
              setLive({ sessionId, ...result.value });
            }
          } catch (_) {
            if (!controller.signal.aborted) setError(true);
          }
        })();

        return () => controller.abort();
      }, [sessionId, visible, watch, attempt]);

      const sessions =
        live?.sessionId === sessionId
          ? live.sessions
          : availableSessions(sessionId, current, {
              projectionsBySession: projections,
              byId,
            });
      const rows = sessions
        .flatMap((session) =>
          (Array.isArray(session.cards) ? session.cards : []).map((card) => ({
            card,
            sessionId: session.sessionId,
            cached: session.cached,
          })),
        )
        .sort((a, b) => (b.card.time || 0) - (a.card.time || 0));
      const eligible = rows.filter(
        ({ card }) =>
          filter === 'all' ||
          (filter === 'attention'
            ? card.category === 'attention' ||
              ['failed', 'stale'].includes(card.verification?.status)
            : card.category === filter),
      );

      // Consume only evidence actually nested beneath a visible owner. A filtered
      // owner or an empty/unavailable assignment must never erase source outcomes.
      const consumed = new Set();
      const sourceKey = (sourceSessionId, cardId) =>
        JSON.stringify([sourceSessionId, cardId]);
      const collectAssignments = (card) => {
        for (const task of Array.isArray(card.subtasks) ? card.subtasks : []) {
          for (const child of Array.isArray(task.cards) ? task.cards : []) {
            consumed.add(
              sourceKey(child.sourceSessionId || task.sessionId, child.id),
            );
            collectAssignments(child);
          }
        }
      };
      for (const row of eligible) collectAssignments(row.card);
      const shown = eligible.filter(
        (row) => !consumed.has(sourceKey(row.sessionId, row.card.id)),
      );

      // Unlinked child evidence nests inside the nearest visible parent outcome
      // card by start time. Impossible placements stay in the legacy fallback.
      const cardNeedsAttention = (card) =>
        ['running', 'in_progress'].includes(card.summaryStatus) ||
        ['failed', 'running'].includes(card.status) ||
        (card.testRuns || []).some(
          (run) =>
            ['running', 'command-failed'].includes(run.executionStatus) ||
            run.resultStatus === 'failed',
        );
      const inferredGroupStatus = (rows) => {
        const cards = rows.map((row) => row.card);
        if (cards.some((card) => ['failed', 'error'].includes(card.status)))
          return 'failed';
        if (
          cards.some(
            (card) =>
              ['running', 'in_progress'].includes(card.status) ||
              ['running', 'in_progress'].includes(card.summaryStatus) ||
              (card.testRuns || []).some(
                (run) =>
                  ['running', 'command-failed'].includes(run.executionStatus) ||
                  run.resultStatus === 'failed',
              ),
          )
        )
          return 'running';
        if (cards.some((card) => card.status === 'interrupted'))
          return 'interrupted';
        return 'completed';
      };
      const shownBySession = new Map();
      for (const row of shown) {
        const list = shownBySession.get(row.sessionId) || [];
        list.push(row);
        shownBySession.set(row.sessionId, list);
      }
      const eligibleBySession = new Map();
      const visibleOutcomes = new Map();
      for (const row of eligible) {
        if (!Number.isFinite(row.card?.time)) continue;
        const list = eligibleBySession.get(row.sessionId) || [];
        list.push(row);
        eligibleBySession.set(row.sessionId, list);
        if (row.card.category !== 'outcome') continue;
        const outcomes = visibleOutcomes.get(row.sessionId) || [];
        outcomes.push(row);
        visibleOutcomes.set(row.sessionId, outcomes);
      }
      const inferredByCard = new Map();
      const inferredSessions = new Set();
      const sessionById = new Map(
        sessions.map((session) => [session.sessionId, session]),
      );
      for (const child of sessions) {
        if (child.sessionId === sessionId) continue;
        const remaining = shownBySession.get(child.sessionId) || [];
        if (!remaining.length) continue;
        const childRows = eligibleBySession.get(child.sessionId) || [];
        if (!childRows.length) continue;
        const childStart = childRows.reduce(
          (earliest, row) => Math.min(earliest, row.card.time),
          Infinity,
        );
        const parentId =
          parentOf(child.parentSession) || byId?.[child.sessionId]?.parentId;
        const parentSession = sessionById.get(parentId);
        const assignments = Array.isArray(parentSession?.assignments)
          ? parentSession.assignments
          : [];
        const candidates =
          parentId && parentId !== child.sessionId
            ? visibleOutcomes.get(parentId) || []
            : [];
        if (!candidates.length) continue;
        // Smaller gap wins, then the earlier parent time, then card order.
        const closest = (rows, time) => {
          let best = rows[0];
          let bestGap = Math.abs(best.card.time - time);
          for (const candidate of rows.slice(1)) {
            const gap = Math.abs(candidate.card.time - time);
            if (
              gap < bestGap ||
              (gap === bestGap && candidate.card.time < best.card.time)
            ) {
              best = candidate;
              bestGap = gap;
            }
          }
          return best;
        };
        const specificLabel = (value) =>
          typeof value === 'string' &&
          value &&
          value !== 'Delegated follow-up' &&
          value !== 'Delegated task'
            ? value
            : '';
        const childAssignments = assignments.filter(
          (value) => value && value.childSessionId === child.sessionId,
        );
        const spawnLabel = childAssignments.find(
          (value) => value.kind === 'spawn' && specificLabel(value.label),
        );
        const specificLabels = new Set(
          childAssignments
            .map((value) => specificLabel(value.label))
            .filter(Boolean),
        );
        const sessionLabel =
          specificLabel(spawnLabel?.label) ||
          (specificLabels.size === 1 ? [...specificLabels][0] : '');
        const assignedParents = new Set(
          assignments
            .filter(
              (value) =>
                value &&
                value.childSessionId === child.sessionId &&
                value.parentCardId,
            )
            .map((value) => value.parentCardId),
        );
        const assignedCandidates = candidates.filter((candidate) =>
          assignedParents.has(candidate.card.id),
        );
        const placed = new Map();
        const anchored =
          assignedParents.size > 1 && assignedCandidates.length > 0;
        if (anchored) {
          // A reused child moves with each follow-up assignment instead of
          // staying anchored to the session's first parent card.
          for (const row of remaining) {
            const owner = closest(
              assignedCandidates,
              Number.isFinite(row.card.time) ? row.card.time : childStart,
            );
            const key = sourceKey(owner.sessionId, owner.card.id);
            const group = placed.get(key);
            if (group) group.rows.push(row);
            else placed.set(key, { owner, rows: [row] });
          }
        } else {
          const owner = closest(candidates, childStart);
          placed.set(sourceKey(owner.sessionId, owner.card.id), {
            owner,
            rows: remaining,
          });
        }
        for (const { owner, rows } of placed.values()) {
          const assignment = assignments.find(
            (value) =>
              value &&
              value.parentCardId === owner.card.id &&
              value.childSessionId === child.sessionId &&
              specificLabel(value.label),
          );
          const tasks = Array.isArray(owner.card.subtasks)
            ? owner.card.subtasks
            : [];
          const task = tasks.find(
            (value) =>
              value &&
              value.sessionId === child.sessionId &&
              specificLabel(value.label),
          );
          const label =
            specificLabel(assignment?.label) ||
            specificLabel(task?.label) ||
            sessionLabel;
          const groups =
            inferredByCard.get(sourceKey(owner.sessionId, owner.card.id)) || [];
          groups.push({
            sessionId: child.sessionId,
            rows,
            label,
            status: inferredGroupStatus(rows),
            open: rows.some((row) => cardNeedsAttention(row.card)),
          });
          inferredByCard.set(sourceKey(owner.sessionId, owner.card.id), groups);
          inferredSessions.add(child.sessionId);
        }
      }

      const nodes = new Map(
        sessions.map((session) => [
          session.sessionId,
          {
            session,
            children: [],
            rows: shown.filter((row) => row.sessionId === session.sessionId),
          },
        ]),
      );
      const root = nodes.get(sessionId) || {
        session: { sessionId },
        children: [],
        rows: [],
      };
      nodes.set(sessionId, root);
      // Inferred rows already render inside their owner card; their sessions
      // must not also surface as bottom legacy groups.
      for (const id of inferredSessions) {
        const node = nodes.get(id);
        if (node) node.rows = [];
      }
      for (const [id, node] of nodes) {
        if (id === sessionId) continue;
        const parentId =
          parentOf(node.session.parentSession) || byId?.[id]?.parentId;
        // Catalog omissions must not hide available evidence; guard malformed cycles.
        let ancestor = parentId;
        const seen = new Set([id]);
        while (ancestor && !seen.has(ancestor)) {
          seen.add(ancestor);
          ancestor =
            parentOf(nodes.get(ancestor)?.session.parentSession) ||
            byId?.[ancestor]?.parentId;
        }
        const parent = ancestor ? root : nodes.get(parentId) || root;
        parent.children.push(node);
      }
      const needsAttention = (node) =>
        node.rows.some((row) => cardNeedsAttention(row.card)) ||
        node.children.some(needsAttention);
      const renderNode = (node, isRoot = false) => {
        const children = node.children
          .map((child) => renderNode(child))
          .filter(Boolean);
        if (!node.rows.length && !children.length) return null;
        const contents = [
          node.rows.map((row) =>
            h(Card, {
              ...row,
              openDiff,
              openResource,
              summaryRpc,
              debug,
              t,
              key: `${row.sessionId}:${row.card.id}`,
              inferredByCard,
            }),
          ),
          children,
        ];
        if (isRoot || !node.rows.length) return contents;
        const sessionCards = node.rows.map((row) => row.card);
        const failedCount = sessionCards.filter((card) =>
          ['failed', 'error'].includes(card.status),
        ).length;
        const runningCount = sessionCards.filter(
          (card) =>
            ['running', 'in_progress'].includes(card.status) ||
            card.summaryStatus === 'in_progress',
        ).length;
        const allRuns = sessionCards.flatMap((card) => card.testRuns || []);
        const totals = { passed: 0, failed: 0, skipped: 0 };
        for (const run of allRuns)
          for (const key of ['passed', 'failed', 'skipped'])
            if (Number.isFinite(run.counts?.[key]))
              totals[key] += run.counts[key];
        const agent = node.session.sessionId;
        const shortAgent = shortAgentId(agent);
        return h(
          'details',
          {
            key: node.session.sessionId,
            className: 'aai-session-group',
            open: needsAttention(node),
          },
          h(
            'summary',
            null,
            `${t('legacyUnattributed')} · ${t('agent')}: ${shortAgent}`,
            ` · ${sessionCards.length} ${t(
              sessionCards.length === 1 ? 'outcome' : 'outcomes',
            )}`,
            failedCount > 0 && ` · ${failedCount} ${t('failed')}`,
            runningCount > 0 && ` · ${runningCount} ${t('testRunning')}`,
            allRuns.length > 0 && ` · ${allRuns.length} ${t('testHistory')}`,
            totals.passed > 0 && ` · ${totals.passed} ${t('passed')}`,
            totals.failed > 0 && ` · ${totals.failed} ${t('failed')}`,
          ),
          h(
            'div',
            { style: { marginLeft: '12px', marginTop: '8px' } },
            ...contents,
          ),
        );
      };

      return h(
        'section',
        { className: 'aai-root', 'aria-label': t('title') },
        h('style', null, css + runningCss + assignmentCss),
        h(
          'header',
          { className: 'aai-header' },
          h('h2', null, t('title')),
          h('div', { className: 'aai-muted' }, t('scope')),
          h('div', { className: 'aai-muted' }, t('inferred')),
          h(
            'label',
            { className: 'aai-muted' },
            h('input', {
              type: 'checkbox',
              checked: debug,
              onChange: (event) => setDebug(event.target.checked),
            }),
            ' ',
            t('debugDetails'),
          ),
          h(
            'div',
            {
              className: 'aai-filters',
              role: 'group',
              'aria-label': t('title'),
            },
            ['all', 'sensitive', 'attention', 'outcome'].map((key) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: 'aai-button',
                  'aria-pressed': filter === key,
                  onClick: () => setFilter(key),
                },
                t(key),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'aai-scroll' },
          error &&
            h(
              'div',
              { className: 'aai-notice aai-muted', role: 'status' },
              t('fallback'),
              ' ',
              h(
                'button',
                {
                  type: 'button',
                  className: 'aai-button',
                  onClick: () => retry((n) => n + 1),
                },
                t('retry'),
              ),
            ),
          live?.persistenceFailed &&
            h('p', { className: 'aai-muted', role: 'status' }, t('storage')),
          shown.length
            ? renderNode(root, true)
            : h(
                'p',
                { className: 'aai-empty' },
                current == null && !live && !sessions.length
                  ? t('waiting')
                  : t('empty'),
              ),
        ),
      );
    }

    function Trigger({ open, t }) {
      return h(
        React.Fragment,
        null,
        h('style', null, css),
        h(
          'button',
          {
            type: 'button',
            className: 'aai-button aai-trigger',
            onClick: open,
            title: t('description'),
            'aria-label': t('title'),
          },
          h(Icon, {}),
          ' ',
          t('title'),
        ),
      );
    }

    return {
      inject: [
        'slots',
        'locale',
        'sidebarRightTabs',
        'sidebarRight',
        'connection',
      ],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries));
        const t = ctx.locale.bind(NS);

        const watch = (payload, signal) =>
          ctx.connection.rpc.call(
            '/api',
            'agentActivityIntelligence.watch',
            payload,
            signal,
          );

        const modelRpc = (payload, signal) =>
          ctx.connection.rpc.call(
            '/api',
            'agentActivityIntelligence.model',
            payload,
            signal,
          );

        const diffRpc = (payload, signal) =>
          ctx.connection.rpc.call(
            '/api',
            'agentActivityIntelligence.diff',
            payload,
            signal,
          );

        const summaryRpc = (payload, signal) =>
          ctx.connection.rpc.call(
            '/api',
            'agentActivityIntelligence.summarize',
            payload,
            signal,
          );
        const outputRpc = (payload, signal) =>
          ctx.connection.rpc.call(
            '/api',
            'agentActivityIntelligence.testOutput',
            payload,
            signal,
          );
        const openResource = (address, options) =>
          ctx.sidebarRight.openResource(address, options);
        const openDiff = async (coords, signal) => {
          if (signal?.aborted) return;
          if (
            ![coords?.sourceSessionId, coords?.cardId, coords?.fileId].every(
              (value) =>
                typeof value === 'string' &&
                value.length > 0 &&
                !value.includes('\0'),
            )
          )
            throw new Error(t('reviewUnavailable'));
          const result = await diffRpc(
            {
              sessionId: coords.sourceSessionId,
              cardId: coords.cardId,
              fileId: coords.fileId,
            },
            signal,
          );
          if (signal?.aborted) return;
          if (!result?.ok)
            throw new Error(
              result?.error?.message || result?.error || t('diffError'),
            );
          const native = result.value?.nativeReview;
          if (
            native &&
            native.sessionId === coords.sourceSessionId &&
            [native.seq, native.turn, native.index].every(
              (value) => Number.isSafeInteger(value) && value >= 0,
            )
          ) {
            return openResource(
              `dsh-resource://changes-review/session/${encodeURIComponent(native.sessionId)}/${native.seq}/${native.turn}`,
              { params: { index: native.index } },
            );
          }
          throw new Error(t('reviewUnavailable'));
        };

        ctx.effect(() =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: ID,
                order: 45,
                label: () => t('summarySettingsNav'),
                locale: NS,
                inject: () => ({ modelRpc }),
              },
              SummarySettings,
            ),
          ),
        );

        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: ID,
            kind: KIND,
            title: () => t('title'),
            guide: [
              {
                id: 'activity',
                order: 45,
                title: () => t('title'),
                description: () => t('description'),
                icon: Icon,
              },
            ],
          }),
        );

        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: OUTPUT_ID,
            kind: 'agent-activity-test-output',
            patterns: ['dsh-resource://activity-test-output/**'],
            priority: 'builtin',
            canOpen: (address) => parseOutputAddress(address) !== null,
            title: () => t('viewOutput'),
          }),
        );
        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: OUTPUT_ID,
                locale: NS,
                inject: () => ({ outputRpc }),
              },
              OutputTab,
            ),
          ),
        );
        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab.title',
                key: OUTPUT_ID,
                locale: NS,
              },
              ({ t }) => h('span', null, t('viewOutput')),
            ),
          ),
        );

        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: ID,
                locale: NS,
                inject: () => ({
                  watch,
                  diffRpc,
                  summaryRpc,
                  openDiff,
                  openResource,
                }),
              },
              Panel,
            ),
          ),
        );

        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: ID, locale: NS },
              ({ t }) => h('span', null, t('title')),
            ),
          ),
        );

        ctx.effect(() =>
          ctx.slots.inject('conversation.session.header.actions', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.actions',
                id: ID,
                order: 45,
                locale: NS,
                inject: () => ({ open: () => ctx.sidebarRight.openTab(KIND) }),
              },
              Trigger,
            ),
          ),
        );
      },
    };
  },
});
