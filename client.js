window.__ModuleLoader__.load({
  id: '@local/dsh-agent-activity-intelligence',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ID = '@local/dsh-agent-activity-intelligence';
    const KIND = 'agent-activity-intelligence';
    const NS = 'agentActivityIntelligence';
    const EMPTY = Object.freeze({});

    // Whale-tail outline: Copyright (c) 2026 DeepSeek, MIT; see THIRD-PARTY-NOTICES.md.
    const WHALE_TAIL =
      'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742';

    const runningCss = `.aai-working{display:inline-flex;align-items:center;gap:5px;min-height:20px;color:var(--dsw-alias-brand-primary)}.aai-whale-tail{width:18px;height:18px;overflow:visible;transform-origin:50% 85%;animation:aai-tail-wiggle 1.2s ease-in-out infinite}.aai-working-dots{display:inline-flex;align-items:baseline;gap:1px;font-size:18px;line-height:1}.aai-working-dot{animation:aai-dot-pulse 1.2s ease-in-out infinite}.aai-working-dot:nth-child(2){animation-delay:.15s}.aai-working-dot:nth-child(3){animation-delay:.3s}@keyframes aai-tail-wiggle{0%,100%{transform:rotate(-10deg) translateY(0)}50%{transform:rotate(12deg) translateY(-1px)}}@keyframes aai-dot-pulse{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-1px)}}@media(prefers-reduced-motion:reduce){.aai-whale-tail,.aai-working-dot{animation:none}.aai-working-dot{opacity:1}}`;

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
      summaryUsage: '使用所选摘要模型',
      summaryRequestError: '无法请求摘要',
      summaryBusy: '摘要服务繁忙，请稍后重试。',
      summaryDisabled: '摘要生成已禁用。',
      summaryReady: '摘要已就绪，等待动态更新。',
      truncated: '部分差异 — 其余行已省略。',
      noLines: '暂无可用的行级变更。',
    });

    const css = `.aai-root{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}.aai-root *{box-sizing:border-box}.aai-header{padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.aai-header h2{font-size:14px;margin:0 0 4px}.aai-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.aai-filters{display:flex;gap:5px;flex-wrap:wrap;margin-top:10px}.aai-button{font:inherit;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;cursor:pointer}.aai-button:hover,.aai-button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.aai-button:focus-visible,.aai-root summary:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.aai-scroll{padding:12px;overflow:auto;min-height:0;flex:1}.aai-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px;margin-bottom:10px;overflow-wrap:anywhere}.aai-card h3{font-size:13px;margin:5px 0}.aai-card p{margin:5px 0;white-space:pre-wrap}.aai-meta{display:flex;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px}.aai-card details{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}.aai-card summary{cursor:pointer}.aai-card ul{padding-left:20px;margin:6px 0}.aai-empty{padding:28px 12px;color:var(--dsw-alias-label-secondary);text-align:center}.aai-notice{padding:8px 0}.aai-trigger{white-space:nowrap;font-size:12px}.aai-code{font-family:monospace;font-size:12px}.aai-model{margin-top:10px}.aai-model label{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.aai-model-select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;max-width:100%;min-width:0}.aai-model-select:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}.aai-model-select:disabled{cursor:wait;opacity:.65}`;

    const diffCss = `.aai-source{border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px}.aai-changes li{margin:4px 0}.aai-native-diff{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}.aai-native-diff *{box-sizing:border-box}.aai-diff-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}.aai-diff-toolbar strong{flex:1;min-width:0;overflow-wrap:anywhere}.aai-diff-body{position:relative;flex:1;min-height:0;overflow:auto}.aai-diff-message{padding:8px 12px;margin:0}.aai-native-diff .aai-recorded-code{margin:0;padding:8px 0;font-family:monospace;font-size:12px;line-height:1.6}.aai-native-diff .aai-recorded-row{display:inline-block;min-width:100%}.aai-native-diff .aai-recorded-number{display:inline-block;min-width:5ch;padding:0 1ch;text-align:right;user-select:none;color:var(--dsw-alias-label-secondary)}.aai-native-diff .aai-recorded-sign{display:inline-block;width:2ch;user-select:none}.aai-native-diff .aai-recorded-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent)}.aai-native-diff .aai-recorded-remove{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent)}.aai-native-diff .aai-recorded-hunk{color:var(--dsw-alias-label-secondary)}`;
    const recordedCss =
      '.aai-native-diff .aai-recorded-token{color:var(--aai-token-light,inherit)}body[data-ds-dark-theme] .aai-native-diff .aai-recorded-token{color:var(--aai-token-dark,inherit)}';
    const DIFF_ID = ID + '/diff';
    const DIFF_KIND = 'agent-activity-diff';
    function diffAddress({ sourceSessionId, cardId, fileId, label }) {
      if (
        ![sourceSessionId, cardId, fileId, label].every(
          (value) =>
            typeof value === 'string' &&
            value.length > 0 &&
            !value.includes('\0'),
        )
      )
        return null;
      return `dsh-resource://activity-diff/${[sourceSessionId, cardId, fileId].map(encodeURIComponent).join('/')}?label=${encodeURIComponent(label)}`;
    }
    function parseDiffAddress(address) {
      try {
        const url = new URL(address);
        if (
          url.protocol !== 'dsh-resource:' ||
          url.hostname !== 'activity-diff' ||
          url.username ||
          url.password ||
          url.port ||
          url.hash
        )
          return null;
        const parts = url.pathname.slice(1).split('/');
        if (parts.length !== 3) return null;
        const [sourceSessionId, cardId, fileId] = parts.map(decodeURIComponent);
        const coords = {
          sourceSessionId,
          cardId,
          fileId,
          label: url.searchParams.get('label'),
        };
        return diffAddress(coords) ? coords : null;
      } catch (_) {
        return null;
      }
    }
    function sessionFileAddress(sessionId, path) {
      const encodedPath = String(path)
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .split('/')
        .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
        .join('/');
      return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encodedPath}`;
    }
    // Keep the custom renderer only for already-open legacy tabs. New change
    // clicks require the built-in recorded Review; never navigate to this view.
    // Server-supplied Shiki tokens are escaped React text, never executable HTML.
    function recordedTokens(line) {
      const tokens = line.tokens;
      if (
        !Array.isArray(tokens) ||
        tokens.some((token) => !token || typeof token.text !== 'string') ||
        tokens.map((token) => token.text).join('') !== line.text
      )
        return line.text;
      const hex = (value) =>
        typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value);
      return tokens.map((token, index) => {
        const flags =
          Number.isSafeInteger(token.fontStyle) && token.fontStyle >= 0
            ? token.fontStyle
            : 0;
        const style = {};
        if (hex(token.light) && hex(token.dark)) {
          style['--aai-token-light'] = token.light;
          style['--aai-token-dark'] = token.dark;
        }
        if (flags & 1) style.fontStyle = 'italic';
        if (flags & 2) style.fontWeight = 'bold';
        if (flags & 4) style.textDecoration = 'underline';
        return h(
          'span',
          { key: index, className: 'aai-recorded-token', style },
          token.text,
        );
      });
    }
    function recordedRow(line, index) {
      const number = (value) =>
        Number.isSafeInteger(value) && value > 0 ? String(value) : '';
      return h(
        'span',
        { key: index, className: `aai-recorded-row aai-recorded-${line.kind}` },
        h(
          'span',
          { className: 'aai-recorded-number', 'aria-hidden': true },
          number(line.oldLine),
        ),
        h(
          'span',
          { className: 'aai-recorded-number', 'aria-hidden': true },
          number(line.newLine),
        ),
        h(
          'span',
          { className: 'aai-recorded-sign' },
          line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ',
        ),
        h('span', { className: 'aai-recorded-text' }, recordedTokens(line)),
        '\n',
      );
    }
    Object.assign(dictionaries.en, {
      diffView: 'Diff',
      codeView: 'Open current file',
      historicalDiff: 'Recorded changes — historical fallback view',
      currentFile: 'Open the current file, not this historical snapshot',
      wrapCode: 'Wrap',
      reloadDiff: 'Reload',
    });
    Object.assign(dictionaries.zh, {
      diffView: '差异',
      codeView: '打开当前文件',
      historicalDiff: '已记录变更 — 历史回退视图',
      currentFile: '打开当前文件，而非此历史快照',
      wrapCode: '自动换行',
      reloadDiff: '重新加载',
    });
    function DiffTab({ useTabInfo, diffRpc, openResource, t }) {
      const { tab } = useTabInfo();
      const address = tab.contentId;
      const coords = parseDiffAddress(address);
      const [response, setResponse] = React.useState(null);
      const [reload, setReload] = React.useState(0);
      const [wrap, setWrap] = React.useState(false);
      React.useEffect(() => {
        if (!coords || !tab.visible || tab.signal?.aborted) return;
        const controller = new AbortController();
        const abort = () => controller.abort();
        tab.signal?.addEventListener('abort', abort, { once: true });
        setResponse({ address, status: 'loading' });
        (async () => {
          try {
            const result = await diffRpc(
              {
                sessionId: coords.sourceSessionId,
                cardId: coords.cardId,
                fileId: coords.fileId,
              },
              controller.signal,
            );
            if (controller.signal.aborted) return;
            if (!result?.ok)
              throw new Error(
                result?.error?.message || result?.error || t('diffError'),
              );
            const value = result.value;
            setResponse({
              address,
              status: ['available', 'unavailable', 'redacted'].includes(
                value?.status,
              )
                ? value.status
                : 'unavailable',
              value,
            });
          } catch (error) {
            if (!controller.signal.aborted)
              setResponse({
                address,
                status: 'error',
                error: String(error.message || error),
              });
          }
        })();
        return () => {
          controller.abort();
          tab.signal?.removeEventListener('abort', abort);
        };
      }, [address, tab.visible, tab.signal, diffRpc, reload]);
      const active = response?.address === address ? response : null;
      const status = !coords ? 'unavailable' : active?.status || 'loading';
      const value = active?.value;
      const wholeFile = ['recorded-full', 'full-lines', 'after-only'].includes(
        value?.coverage,
      );
      const lines =
        status === 'available' && Array.isArray(value?.lines)
          ? value.lines.filter(
              (line) =>
                line &&
                ['context', 'add', 'remove', 'hunk'].includes(line.kind) &&
                typeof line.text === 'string' &&
                !(wholeFile && line.kind === 'hunk'),
            )
          : [];
      const editorPath =
        typeof value?.editorPath === 'string' &&
        value.editorPath &&
        !value.editorPath.includes('\0')
          ? value.editorPath
          : null;
      return h(
        'section',
        { className: 'aai-native-diff', 'aria-label': t('unifiedDiff') },
        h('style', null, css + diffCss + recordedCss),
        h(
          'header',
          { className: 'aai-diff-toolbar' },
          h(
            'strong',
            { className: 'aai-code' },
            coords?.label || t('diffUnavailable'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'aai-button',
              'aria-pressed': true,
              title: t('historicalDiff'),
            },
            t('diffView'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'aai-button',
              disabled: !editorPath,
              title: t('currentFile'),
              onClick: () => {
                if (coords && editorPath)
                  openResource(
                    sessionFileAddress(coords.sourceSessionId, editorPath),
                  );
              },
            },
            t('codeView'),
          ),
          h(
            'label',
            { className: 'aai-muted' },
            h('input', {
              type: 'checkbox',
              checked: wrap,
              onChange: (event) => setWrap(event.target.checked),
            }),
            ' ',
            t('wrapCode'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'aai-button',
              disabled: !coords || !tab.visible,
              onClick: () => setReload((n) => n + 1),
            },
            t('reloadDiff'),
          ),
        ),
        h(
          'p',
          { className: 'aai-diff-message aai-muted' },
          t('historicalDiff'),
        ),
        status !== 'available' &&
          h(
            'p',
            {
              className: 'aai-diff-message aai-muted',
              role: status === 'error' ? 'alert' : 'status',
            },
            t(
              status === 'loading'
                ? 'diffLoading'
                : status === 'error'
                  ? 'diffError'
                  : status === 'redacted'
                    ? 'diffRedacted'
                    : 'diffUnavailable',
            ),
            active?.error && `: ${active.error}`,
          ),
        value?.notice &&
          h('p', { className: 'aai-diff-message aai-muted' }, value.notice),
        value?.truncated &&
          h('p', { className: 'aai-diff-message aai-muted' }, t('truncated')),
        status === 'available' &&
          (lines.length
            ? h(
                'div',
                { className: 'aai-diff-body' },
                h(
                  'pre',
                  {
                    className: 'aai-recorded-code',
                    style: { whiteSpace: wrap ? 'pre-wrap' : 'pre' },
                  },
                  lines.map(recordedRow),
                ),
              )
            : h(
                'p',
                { className: 'aai-diff-message aai-muted' },
                t('noLines'),
              )),
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
        .map((id) => ({ ...values[id], sessionId: id }));
    }

    function formatTime(value) {
      if (value == null) return null;

      const date = new Date(value);

      return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
    }

    function Card({
      card,
      sessionId,
      cached,
      openDiff,
      summaryRpc,
      debug = false,
      t,
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
      const select = async (file) => {
        if (openingRef.current?.fileId === file.id) return;
        openingRef.current?.controller.abort();
        const controller = new AbortController();
        openingRef.current = { controller, fileId: file.id };
        setOpening({
          identity: openingIdentity,
          fileId: file.id,
          status: 'loading',
        });
        try {
          if (typeof openDiff !== 'function' || !sessionId || !card.id)
            throw new Error(t('diffUnavailable'));
          await openDiff(
            {
              sourceSessionId: sessionId,
              cardId: card.id,
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
              status: 'error',
              error: String(error.message || error),
            });
        } finally {
          if (openingRef.current?.controller === controller)
            openingRef.current = null;
        }
      };

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
          ['changes', 'metadata'].includes(card.summarySource) &&
            h(
              'span',
              { className: 'aai-source' },
              t(
                card.summarySource === 'changes'
                  ? 'changeBased'
                  : 'metadataBased',
              ),
            ),
        ),
        h(
          'h3',
          null,
          card.summaryStatus === 'in_progress'
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
                  'span',
                  { className: 'aai-working-label' },
                  t('agentWorking'),
                ),
                h(
                  'span',
                  { className: 'aai-working-dots', 'aria-hidden': true },
                  [0, 1, 2].map((i) =>
                    h('span', { className: 'aai-working-dot', key: i }, '.'),
                  ),
                ),
              )
            : card.title,
        ),
        card.summary && h('p', null, card.summary),
        h(
          'div',
          { className: 'aai-meta' },
          h('span', null, `${t('agent')}: ${card.agentId || sessionId}`),
          formatTime(card.time) && h('time', null, formatTime(card.time)),
        ),
        h(
          'p',
          { className: 'aai-muted' },
          `${t('verification')}: ${verification.label || verification.status || 'unknown'}`,
        ),
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
                h(
                  'li',
                  { key: file.id },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'aai-button aai-code',
                      'aria-label': `${t('changes')}: ${file.label}`,
                      disabled:
                        activeOpening?.status === 'loading' &&
                        activeOpening.fileId === file.id,
                      onClick: () => select(file),
                    },
                    file.label,
                  ),
                ),
              ),
              files.map((label, i) =>
                h('li', { key: `fallback:${i}`, className: 'aai-code' }, label),
              ),
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

      const save = async (event) => {
        const controller = controllerRef.current;
        if (
          !settings ||
          pendingRef.current ||
          !controller ||
          controller.signal.aborted
        )
          return;

        const key = event.target.value;
        if (key === selectionKey(settings.selection)) return;

        let selection;
        if (key === 'follow' || key === 'off') selection = { mode: key };
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
          null,
          h('span', { className: 'aai-muted' }, t('summaryModel')),
          ' ',
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

    function Panel({
      sessionId,
      useProjection,
      useSessions,
      useTabInfo,
      watch,
      modelRpc,
      openDiff,
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
      const shown = rows.filter(
        ({ card }) =>
          filter === 'all' ||
          (filter === 'attention'
            ? card.category === 'attention' ||
              ['failed', 'stale'].includes(card.verification?.status)
            : card.category === filter),
      );

      return h(
        'section',
        { className: 'aai-root', 'aria-label': t('title') },
        h('style', null, css + diffCss + runningCss),
        h(
          'header',
          { className: 'aai-header' },
          h('h2', null, t('title')),
          h('div', { className: 'aai-muted' }, t('scope')),
          h('div', { className: 'aai-muted' }, t('inferred')),
          h(ModelPicker, { modelRpc, visible, t }),
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
            ? shown.map((row) =>
                h(Card, {
                  ...row,
                  openDiff,
                  summaryRpc,
                  debug,
                  t,
                  key: `${row.sessionId}:${row.card.id}`,
                }),
              )
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
            id: DIFF_ID,
            kind: DIFF_KIND,
            patterns: ['dsh-resource://activity-diff/**'],
            priority: 'builtin',
            canOpen: (address) => parseDiffAddress(address) !== null,
            title: (address) =>
              `${parseDiffAddress(address)?.label || t('changes')} · ${t('diffView')}`,
          }),
        );
        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: DIFF_ID,
                locale: NS,
                inject: () => ({ diffRpc, openResource }),
              },
              DiffTab,
            ),
          ),
        );
        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab.title',
                key: DIFF_ID,
                locale: NS,
              },
              ({ useTabInfo, t }) =>
                h(
                  'span',
                  null,
                  `${parseDiffAddress(useTabInfo().tab.contentId)?.label || t('changes')} · ${t('diffView')}`,
                ),
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
                  modelRpc,
                  diffRpc,
                  summaryRpc,
                  openDiff,
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
