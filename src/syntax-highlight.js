import { createHighlighterCore } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import dark from '@shikijs/themes/dark-plus';
import light from '@shikijs/themes/light-plus';

const loaders = {
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  jsx: () => import('@shikijs/langs/jsx'),
  tsx: () => import('@shikijs/langs/tsx'),
  json: () => import('@shikijs/langs/json'),
  markdown: () => import('@shikijs/langs/markdown'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  python: () => import('@shikijs/langs/python'),
  bash: () => import('@shikijs/langs/bash'),
  yaml: () => import('@shikijs/langs/yaml'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  sql: () => import('@shikijs/langs/sql'),
};
const aliases = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  sql: 'sql',
};
let highlighter;
const loaded = new Map();
const hex = (value) =>
  typeof value === 'string' && /^#[a-fA-F0-9]{3,8}$/.test(value);
async function instance(lang) {
  highlighter ??= createHighlighterCore({
    themes: [light, dark],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  const hl = await highlighter;
  if (!loaded.has(lang))
    loaded.set(
      lang,
      loaders[lang]()
        .then((module) => hl.loadLanguage(module.default))
        .catch((error) => {
          loaded.delete(lang);
          throw error;
        }),
    );
  await loaded.get(lang);
  return hl;
}

/** Local-only TextMate tokens; never HTML, never disk reads or provider calls.
 * Tokenize old/new streams separately so removals cannot corrupt added-side
 * multiline comment/string state. All input must already be redacted. */
export async function highlightDiff(file, lines, signal) {
  const extension = String(file).split('.').at(-1).toLowerCase();
  const lang = aliases[extension];
  if (
    !lang ||
    !Array.isArray(lines) ||
    lines.length > 5000 ||
    lines.reduce((count, line) => count + String(line.text || '').length, 0) >
      200000
  )
    return lines;
  signal?.throwIfAborted();
  try {
    const hl = await instance(lang);
    signal?.throwIfAborted();
    const options = {
      lang,
      themes: { light: 'light-plus', dark: 'dark-plus' },
      tokenizeMaxLineLength: 10000,
      tokenizeTimeLimit: 50,
    };
    const old = hl.codeToTokensWithThemes(
      lines
        .filter((line) => ['context', 'remove'].includes(line.kind))
        .map((line) => line.text)
        .join('\n'),
      options,
    );
    const current = hl.codeToTokensWithThemes(
      lines
        .filter((line) => ['context', 'add'].includes(line.kind))
        .map((line) => line.text)
        .join('\n'),
      options,
    );
    let beforeIndex = 0,
      afterIndex = 0,
      budget = 50000;
    const result = lines.map((line) => {
      if (line.kind === 'hunk') return line;
      const before = line.kind !== 'add' ? old[beforeIndex++] : null;
      const after = line.kind !== 'remove' ? current[afterIndex++] : null;
      const source = line.kind === 'remove' ? before : after;
      if (
        !source ||
        source.length > budget ||
        source.map((token) => token.content).join('') !== line.text
      )
        return line;
      budget -= source.length;
      const tokens = source.map((token) => ({
        text: token.content,
        light: hex(token.variants?.light?.color)
          ? token.variants.light.color
          : '#000000',
        dark: hex(token.variants?.dark?.color)
          ? token.variants.dark.color
          : '#D4D4D4',
        fontStyle: Number.isInteger(token.variants?.dark?.fontStyle)
          ? token.variants.dark.fontStyle & 7
          : 0,
      }));
      return { ...line, tokens };
    });
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    return lines; // A grammar failure must never hide recorded changes.
  }
}
