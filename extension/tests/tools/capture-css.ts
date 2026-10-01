/**
 * CSS neutraliser for captured fixtures: the fixture must render standalone and make zero network requests.
 *
 *  - Comments are dropped (they can carry anything).
 *  - Every at-rule is dropped. @import and @font-face would fetch; the rest (@media, @supports, @keyframes, …)
 *    carry an '@' that would defeat the "grep '@' finds only fake domains" check, and the critical properties
 *    they decided at capture time are already inlined from the live computed style.
 *  - Every url(…) that is not a same-document fragment (#id) becomes `none`, as does every image-set(…) and every
 *    function whose name is spelled with an escape (`\75 rl(…)`, `u\rl(…)`), which Chromium decodes and fetches.
 *
 * The scanner is string-, escape- and comment-aware, so `content: "@media"` and `.md\@flex` survive.
 */

export interface CssSanitizeResult {
  readonly css: string;
  readonly atRulesRemoved: number;
  readonly urlsNeutralised: number;
}

/** Index just past the string literal that starts at `start` (an unterminated string ends at a newline). */
function stringEnd(css: string, start: number): number {
  const quote = css.charAt(start);
  let i = start + 1;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote || ch === '\n') return i + 1;
    i += 1;
  }
  return css.length;
}

function commentEnd(css: string, start: number): number {
  const close = css.indexOf('*/', start + 2);
  return close === -1 ? css.length : close + 2;
}

/** Index just past the `{…}` block that opens at `open`, nesting-aware. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (ch === '\\') i += 2;
    else if (ch === '"' || ch === "'") i = stringEnd(css, i);
    else if (ch === '/' && css.charAt(i + 1) === '*') i = commentEnd(css, i);
    else {
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
  }
  return css.length;
}

/** Index just past the at-rule that starts at `start`: through its `;`, or its whole `{…}` block. */
function atRuleEnd(css: string, start: number): number {
  let parens = 0;
  let i = start + 1;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (ch === '\\') i += 2;
    else if (ch === '"' || ch === "'") i = stringEnd(css, i);
    else if (ch === '/' && css.charAt(i + 1) === '*') i = commentEnd(css, i);
    else {
      if (ch === '(') parens += 1;
      if (ch === ')') parens = Math.max(0, parens - 1);
      if (ch === ';' && parens === 0) return i + 1;
      if (ch === '{') return blockEnd(css, i);
      // A statement cut short by the end of its enclosing block: stop before the `}`.
      if (ch === '}') return i;
      i += 1;
    }
  }
  return css.length;
}

/** Removes comments and every at-rule. Returns the CSS and how many at-rules went. */
export function stripCommentsAndAtRules(css: string): { css: string; removed: number } {
  const kept: string[] = [];
  let segmentStart = 0;
  let removed = 0;
  let i = 0;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (ch === '\\') {
      i += 2;
    } else if (ch === '"' || ch === "'") {
      i = stringEnd(css, i);
    } else if ((ch === '/' && css.charAt(i + 1) === '*') || ch === '@') {
      kept.push(css.slice(segmentStart, i));
      i = ch === '@' ? atRuleEnd(css, i) : commentEnd(css, i);
      if (ch === '@') removed += 1;
      segmentStart = i;
    } else {
      i += 1;
    }
  }
  kept.push(css.slice(segmentStart));
  return { css: kept.join(''), removed };
}

const URL_FUNCTION = /\burl\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^)\\]|\\.)*))\s*\)/gi;
const IMAGE_SET_START = /(?:-webkit-)?image-set\(/gi;
/** One CSS escape: `\` + 1–6 hex digits (+ one optional whitespace), or `\` + any other character. */
const CSS_ESCAPE = String.raw`\\(?:[0-9A-Fa-f]{1,6}[ \t\n\r\f]?|[^\n\r\f0-9A-Fa-f])`;
/**
 * A function whose name is spelled with an escape (`\75 rl(`, `u\rl(`): Chromium decodes the name and fetches it.
 * Real style sheets never escape a function name, so every such function is neutralised whatever it decodes to.
 */
const ESCAPED_FUNCTION_START = new RegExp(
  String.raw`(?:[A-Za-z0-9_-]|${CSS_ESCAPE})*${CSS_ESCAPE}(?:[A-Za-z0-9_-]|${CSS_ESCAPE})*\(`,
  'g',
);

/** Index just past the `)` that closes the function whose `(` is at `open`. */
function parenEnd(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (ch === '\\') i += 2;
    else if (ch === '"' || ch === "'") i = stringEnd(css, i);
    else {
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
  }
  return css.length;
}

/** Replaces every function `start` finds, from its name through its closing paren, with `none`. */
function neutraliseFunctions(css: string, start: RegExp): { css: string; count: number } {
  const kept: string[] = [];
  let last = 0;
  let count = 0;
  start.lastIndex = 0;
  for (let match = start.exec(css); match !== null; match = start.exec(css)) {
    const end = parenEnd(css, match.index + match[0].length - 1);
    kept.push(css.slice(last, match.index), 'none');
    last = end;
    count += 1;
    start.lastIndex = end;
  }
  kept.push(css.slice(last));
  return { css: kept.join(''), count };
}

/**
 * Neutralises every resource reference in CSS text and nothing else: functions with an escaped name, every
 * image-set(), and every url() that is not a same-document #fragment. Also used on SVG presentation attributes
 * (fill="url(…)", mask, clip-path, marker-*, cursor), which Chromium fetches exactly like CSS.
 */
export function neutraliseCssUrls(css: string): { css: string; count: number } {
  const escaped = neutraliseFunctions(css, ESCAPED_FUNCTION_START);
  const imageSets = neutraliseFunctions(escaped.css, IMAGE_SET_START);
  let count = escaped.count + imageSets.count;
  const result = imageSets.css.replace(
    URL_FUNCTION,
    (whole, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
      const target = (doubleQuoted ?? singleQuoted ?? bare ?? '').trim();
      if (target.startsWith('#')) return whole;
      count += 1;
      return 'none';
    },
  );
  return { css: result, count };
}

/** Neutralises every external resource reference in a style sheet or a style attribute. */
export function sanitizeCss(css: string): CssSanitizeResult {
  const stripped = stripCommentsAndAtRules(css);
  const urls = neutraliseCssUrls(stripped.css);
  return { css: urls.css, atRulesRemoved: stripped.removed, urlsNeutralised: urls.count };
}
