/**
 * The scanner behind tests/unit/core/core-purity.spec.ts (the Sprint 1 Gate's grep test over src/core; TECH-R1,
 * QA-R7, PI-6; Hard Rule 4), kept apart so the spec stays one page. It reads text only: no lint, no types, so a lint
 * regression cannot blind it.
 *
 * Each file is reduced to its code with the TypeScript scanner: comments, string literals (all but their quotes),
 * template text and regular-expression literals become spaces, so prose such as "never calls Date.now()" is not a
 * hit and a call hidden after a string is still found. A `/` after any property name (`o.type / 2`), a contextual
 * keyword used as a name, or a non-null `x!` divides; it does not start a regex literal (FR3-5). A member read with a
 * written key (`Date['now']`, Date[`now`]) is first rewritten as `Date.now`, `?.` as `.`, and a guarded global read
 * through a wrapper (`(Date)`, `(0, Date)`, `[Date][0]`, `(Reflect.get)`, `Date!`) as the global itself, so every
 * spelling of a member meets the same pattern. Banned patterns are matched over the whole file, not line by line, so
 * a call split across lines (`Date\n.now()`) is still found; a hit names the line it starts on. Text alone cannot
 * tell types: `String(date)`, a template of a Date and a key built from fragments are lint's and the runtime
 * guard's (docs/grading.md §14 lists what is left to review). The globals come from lint's own lists
 * (./core-scan-globals.ts, FS-1, R4-FENCE-1): every name attest/no-network bans, as a word anywhere, and every global
 * read that is not an ES2023 built-in on src/core's allowlist. A comment that switches the type check off
 * (`@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, a triple-slash reference) is a hit too.
 */
import ts from 'typescript';

import { globalReads, NETWORK_PATTERNS } from './core-scan-globals';

/**
 * Clock, randomness, timers, network, host and garbage-collector APIs, matched on code only, over the whole file. A
 * pattern named after a global is that name's text form, beside the read of it as the global (globalReads).
 */
export const BANNED: readonly (readonly [string, RegExp])[] = [
  ['Date.now', /\bDate\s*\.\s*now\b/g],
  ['Date member other than UTC', /\bDate\s*\.\s*(?!(?:UTC|now)\b)[\w$]/g],
  ['new Date() with no argument', /\bnew\s+Date\s*\(\s*\)/g],
  ['new Date with a spread argument', /\bnew\s+Date\s*\(\s*\.\.\./g],
  ['new Date from written text', /\bnew\s+Date\s*\(\s*['"`]/g],
  ['new Date without parentheses', /\bnew\s+Date\b(?!\s*\()/g],
  ['Date() called as a function', /(?<![\w$.]|\bnew\s+)\bDate\s*\(/g],
  ['Math.random', /\bMath\s*\.\s*random\b/g],
  ['computed member of Date, Math or crypto', /\b(?:Date|Math|crypto)\s*\[(?!\s*\])/g],
  ['getRandomValues', /\bgetRandomValues\b/g],
  ['randomUUID', /\brandomUUID\b/g],
  // attest/no-network's names (fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, …), from lint (FS-1).
  ...NETWORK_PATTERNS,
  ['performance', /\bperformance\b/g],
  ['setTimeout', /\bsetTimeout\b/g],
  ['setInterval', /\bsetInterval\b/g],
  ['setImmediate', /\bsetImmediate\b/g],
  ['process', /(?<![\w$.])process\s*\./g],
  ['Intl', /\bIntl\b/g],
  ['Temporal', /\bTemporal\b/g],
  ['WeakRef', /\bWeakRef\b/g],
  ['FinalizationRegistry', /\bFinalizationRegistry\b/g],
  ['crypto', /(?<![\w$.])crypto\s*\./g],
  ['chrome', /(?<![\w$.])chrome\s*\./g],
  ['globalThis', /(?<![\w$.])globalThis\b/g],
  ['self', /(?<![\w$.])self\b/g],
  [
    'Reflect on a global',
    /\bReflect\s*\.\s*\w+\s*\(\s*(?:globalThis|self|window|Date|Math|crypto|performance|Intl|Temporal)\b/g,
  ],
  ['.constructor', /\.\s*constructor\b/g],
  // `const { constructor } = /a/`, `{ constructor: C }` (UNI-R3-3); a class's `constructor(` is not a hit.
  ['constructor destructured', /(?<![\w$.])constructor\s*(?=[:,}=])/g],
  ['Symbol.toPrimitive', /\bSymbol\s*\.\s*toPrimitive\b/g],
  // Host time zone and locale, on any object (FR3-5): attest/core-determinism's names.
  [
    'local-time or locale method',
    /\.\s*(?:getTimezoneOffset|get(?:Full)?Year|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|set(?:Full)?Year|setMonth|setDate|setHours|setMinutes|setSeconds|setMilliseconds|toLocale\w*|localeCompare|toDateString|toTimeString)\b/g,
  ],
  ['reflection on a new Date', /\b(?:Object|Reflect)\s*\.\s*\w+\s*\(\s*new\s+Date\b/g],
  ['toString of a new Date', /\bnew\s+Date\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*\.\s*toString\b/g],
  // Error stacks and V8's stack API, and the module URL (FR3-3).
  ['error stack or stack API', /\.\s*(?:stack|captureStackTrace|prepareStackTrace|stackTraceLimit)\b/g],
  [
    'stack API destructured',
    /(?<=[{,]\s*)(?:stack|captureStackTrace|prepareStackTrace|stackTraceLimit)\s*(?=[:,}=])/g,
  ],
  ['import.meta', /\bimport\s*\.\s*meta\b/g],
  // Reflection and mutation of built-ins (FR3-2).
  ['Reflect other than get, has, isExtensible', /\bReflect\b(?!\s*\.\s*(?:get|has|isExtensible)\b)/g],
  [
    'Object reflection or mutation',
    /\bObject\s*\.\s*(?:getOwnPropertyNames|getOwnPropertyDescriptors|getOwnPropertySymbols|defineProperty|defineProperties|setPrototypeOf|assign|preventExtensions|seal)\b/g,
  ],
  ['.call / .apply / .bind', /\.\s*(?:call|apply|bind)\b/g],
  ['built-in .prototype or __proto__', /(?<!\bObject\s*)\.\s*prototype\b|\b__proto__\b/g],
  ['Atomics', /\bAtomics\b/g],
  ['SharedArrayBuffer', /\bSharedArrayBuffer\b/g],
  [
    'ambient declaration',
    /\bdeclare\s+(?:const|let|var|function|class|enum|global|namespace|module|abstract\s+class)\b/g,
  ],
];

/**
 * A comment that switches TypeScript's check off (`@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`; TypeScript reads a
 * pragma's name in any letter case) or loads another lib or file (`/// <reference lib="dom" />`): either lets a host
 * name (`Image`) typecheck under src/core's ES2023-only lib (R4-FENCE-1). Matched in comments, anywhere.
 */
const DIRECTIVE = /@ts-(?:expect-error|ignore|nocheck)\b|^\/\/\/\s*<reference\b/i;
const COMMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.SingleLineCommentTrivia,
  ts.SyntaxKind.MultiLineCommentTrivia,
]);

/** String values that are banned as code even when written as text: `Reflect.get(d, 'constructor')`. */
const BANNED_STRINGS: ReadonlySet<string> = new Set([
  'constructor',
  'stack',
  'captureStackTrace',
  'prepareStackTrace',
  'stackTraceLimit',
  'prototype',
  '__proto__',
  'call',
  'apply',
  'bind',
]);

const K = ts.SyntaxKind;

/** Tokens that become spaces: they hold text, not code. */
const TEXT_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
  K.SingleLineCommentTrivia,
  K.MultiLineCommentTrivia,
  K.ShebangTrivia,
  K.StringLiteral,
  K.NoSubstitutionTemplateLiteral,
  K.TemplateHead,
  K.TemplateMiddle,
  K.TemplateTail,
  K.RegularExpressionLiteral,
]);

/** Text tokens that keep their quotes, so `new Date('…')` still shows it was given text. */
const QUOTED: ReadonlySet<ts.SyntaxKind> = new Set([
  K.StringLiteral,
  K.NoSubstitutionTemplateLiteral,
  K.TemplateHead,
  K.TemplateTail,
]);

const TRIVIA: ReadonlySet<ts.SyntaxKind> = new Set([
  K.WhitespaceTrivia,
  K.NewLineTrivia,
  K.SingleLineCommentTrivia,
  K.MultiLineCommentTrivia,
  K.ShebangTrivia,
  K.ConflictMarkerTrivia,
]);

/** After these a `/` divides; after anything else it starts a regular expression literal. */
const ENDS_OPERAND: ReadonlySet<ts.SyntaxKind> = new Set([
  K.Identifier,
  K.PrivateIdentifier,
  K.NumericLiteral,
  K.BigIntLiteral,
  K.StringLiteral,
  K.NoSubstitutionTemplateLiteral,
  K.TemplateTail,
  K.RegularExpressionLiteral,
  K.CloseParenToken,
  K.CloseBracketToken,
  K.CloseBraceToken,
  K.PlusPlusToken,
  K.MinusMinusToken,
  K.ThisKeyword,
  K.SuperKeyword,
  K.TrueKeyword,
  K.FalseKeyword,
  K.NullKeyword,
]);

/** Contextual keywords after which an expression (so a regex literal) may start: `await /a/`, `for (x of /a/…)`. */
const STARTS_EXPRESSION: ReadonlySet<ts.SyntaxKind> = new Set([K.AwaitKeyword, K.OfKeyword]);

const isWord = (kind: ts.SyntaxKind): boolean =>
  kind === K.Identifier || (kind >= K.FirstKeyword && kind <= K.LastKeyword);

/**
 * Whether a token ends an operand, so a `/` after it divides (FR3-5). Any word after `.` or `?.` is a property name
 * (`o.type / 2`, `o.default / 2`); a contextual keyword is a plain name (`of`, `from`, `get`) unless an expression may
 * follow it; a `!` right after an operand is TypeScript's non-null assertion (`x! / 2`).
 */
function endsOperand(kind: ts.SyntaxKind, previous: ts.SyntaxKind, previousEnds: boolean): boolean {
  if ((previous === K.DotToken || previous === K.QuestionDotToken) && isWord(kind)) return true;
  if (kind === K.ExclamationToken) return previousEnds;
  const contextual = kind > K.LastFutureReservedWord && kind <= K.LastKeyword;
  return ENDS_OPERAND.has(kind) || (contextual && !STARTS_EXPRESSION.has(kind));
}

/** The next token, re-scanned where the scanner alone cannot tell (template continuations, regex literals). */
function nextToken(scanner: ts.Scanner, braces: string[], afterOperand: boolean): ts.SyntaxKind {
  let kind = scanner.scan();
  if (kind === K.CloseBraceToken && braces.at(-1) === '${') {
    braces.pop();
    kind = scanner.reScanTemplateToken(false);
    if (kind === K.TemplateMiddle) braces.push('${');
  } else if (kind === K.OpenBraceToken) braces.push('{');
  else if (kind === K.CloseBraceToken) braces.pop();
  else if (kind === K.TemplateHead) braces.push('${');
  else if ((kind === K.SlashToken || kind === K.SlashEqualsToken) && !afterOperand) {
    kind = scanner.reScanSlashToken();
  }
  return kind;
}

interface Token {
  readonly kind: ts.SyntaxKind;
  readonly start: number;
  readonly end: number;
  /** A string literal's value, escapes read. */
  readonly value: string;
  /** Whether the token ends an operand (endsOperand): a `(` or `[` after it calls or indexes. */
  readonly operand: boolean;
}

/** Every token of `source`, trivia included. */
function tokensOf(source: string): Token[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const braces: string[] = [];
  const tokens: Token[] = [];
  let [previous, operand] = [K.Unknown as ts.SyntaxKind, false];
  for (let kind = nextToken(scanner, braces, operand); kind !== K.EndOfFileToken;) {
    const value = scanner.getTokenValue();
    const trivia = TRIVIA.has(kind);
    if (!trivia) [previous, operand] = [kind, endsOperand(kind, previous, operand)];
    tokens.push({ kind, start: scanner.getTokenStart(), end: scanner.getTokenEnd(), value, operand });
    kind = nextToken(scanner, braces, operand);
  }
  return tokens;
}

/** Writes `text` over `out[from, to)`, then spaces; line breaks stay where they are. */
function overwrite(out: string[], from: number, to: number, text = ''): void {
  let next = 0;
  for (let i = from; i < to; i += 1) {
    if (out[i] === '\n' || out[i] === '\r') continue;
    out[i] = text[next] ?? ' ';
    next += 1;
  }
}

const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;
const STRING_KEY: ReadonlySet<ts.SyntaxKind> = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral]);

/** A member read with a written key, `X['name']` or X?.[`name`], rewritten as `X.name` (PI-6). */
function rewriteKeys(out: string[], code: readonly Token[]): void {
  code.forEach((open, i) => {
    const [before, key, close] = [code[i - 1], code[i + 1], code[i + 2]];
    if (open.kind !== K.OpenBracketToken || key === undefined || close?.kind !== K.CloseBracketToken) return;
    const member = before !== undefined && (before.operand || before.kind === K.QuestionDotToken);
    if (member && STRING_KEY.has(key.kind) && IDENTIFIER_NAME.test(key.value))
      overwrite(out, open.start, close.end, `.${key.value}`);
  });
}

/** The globals the scan names by their own patterns: a wrapper around one is read through (FR3-5). */
const UNWRAPPED: ReadonlySet<string> = new Set(['Date', 'Math', 'Reflect', 'globalThis', 'self']);

/** The kinds a single operand in `(0, X)` may be. */
const SIMPLE: ReadonlySet<ts.SyntaxKind> = new Set([
  K.NumericLiteral,
  K.Identifier,
  K.StringLiteral,
  K.NullKeyword,
  K.TrueKeyword,
  K.FalseKeyword,
  K.ThisKeyword,
]);

const isUnwrapped = (token: Token | undefined): boolean =>
  token?.kind === K.Identifier && UNWRAPPED.has(token.value);

/**
 * How many tokens from `at` make up `X` or `X.name.name…` with X one of UNWRAPPED, ending where `close` is; 0 if
 * they do not.
 */
function guardedChain(code: readonly Token[], at: number, close: ts.SyntaxKind): number {
  if (!isUnwrapped(code[at])) return 0;
  let length = 1;
  while (code[at + length]?.kind === K.DotToken && isWord(code[at + length + 1]?.kind ?? K.Unknown))
    length += 2;
  return code[at + length]?.kind === close ? length : 0;
}

/**
 * The wrapper tokens around a guarded global at `i` (a `(` or `[` that neither calls nor indexes), as indexes to
 * drop: `(X)`, `(X.get)`, `(0, X)`, `[X][0]`; and the `!` of `X!`. Empty when there is none.
 */
function wrapperAt(code: readonly Token[], i: number): number[] {
  const token = code[i];
  if (token === undefined) return [];
  if (token.kind === K.ExclamationToken && isUnwrapped(code[i - 1])) return [i];
  if (code[i - 1]?.operand === true) return [];
  if (token.kind === K.OpenParenToken) {
    const chain = guardedChain(code, i + 1, K.CloseParenToken);
    if (chain > 0) return [i, i + chain + 1];
    const comma = SIMPLE.has(code[i + 1]?.kind ?? K.Unknown) && code[i + 2]?.kind === K.CommaToken;
    if (comma && guardedChain(code, i + 3, K.CloseParenToken) === 1) return [i, i + 1, i + 2, i + 4];
  }
  const index = [K.CloseBracketToken, K.OpenBracketToken, K.NumericLiteral, K.CloseBracketToken];
  const element = index.every((kind, k) => code[i + 2 + k]?.kind === kind) && code[i + 4]?.value === '0';
  if (token.kind === K.OpenBracketToken && isUnwrapped(code[i + 1]) && element)
    return [i, i + 2, i + 3, i + 4, i + 5];
  return [];
}

/**
 * A guarded global read through a wrapper, rewritten as the global itself (FR3-5): `(Date).now()`, `(0, Date).now()`,
 * `[Date][0].now()`, `new (Date)()`, `(Reflect.get)(Date, 'now')` and `Date!.now()` meet the same patterns as
 * `Date.now()`. Repeats until nothing changes, so `((Date)).now()` is read through too.
 */
function unwrapGlobals(out: string[], tokens: readonly Token[]): void {
  const code = [...tokens];
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < code.length && !changed; i += 1) {
      const drop = wrapperAt(code, i);
      for (const at of drop) overwrite(out, code[at]?.start ?? 0, code[at]?.end ?? 0);
      for (const at of [...drop].reverse()) code.splice(at, 1);
      changed = drop.length > 0;
    }
  }
}

/** `source` with every comment, string, template text and regex literal replaced by spaces (lines kept). */
export function codeOnly(source: string): string {
  const out = source.split('');
  const tokens = tokensOf(source);
  for (const { kind, start, end } of tokens) {
    if (!TEXT_TOKENS.has(kind)) continue;
    const quoted = QUOTED.has(kind);
    const keep = (i: number) => quoted && (i === start || i === end - 1) && /['"`]/.test(source.charAt(i));
    for (let i = start; i < end; i += 1) if (out[i] !== '\n' && out[i] !== '\r' && !keep(i)) out[i] = ' ';
  }
  const code = tokens.filter(({ kind }) => !TRIVIA.has(kind));
  // `a?.b` reads as `a.b`; in `a?.[k]` and `f?.()` the dot goes too (a written key brings its own, below).
  code.forEach((token, i) => {
    if (token.kind !== K.QuestionDotToken) return;
    const next = code[i + 1]?.kind;
    overwrite(
      out,
      token.start,
      token.end,
      next === K.OpenBracketToken || next === K.OpenParenToken ? '' : ' .',
    );
  });
  rewriteKeys(out, code);
  unwrapGlobals(out, code);
  return out.join('');
}

/** The 1-based line of `index` in `text`. */
const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Each `new Date(…)` given more than one argument, by the index it starts at (strings already blanked). */
function multiFieldDates(code: string): number[] {
  return [...code.matchAll(/\bnew\s+Date\s*\(/g)].flatMap((match) => {
    let depth = 0;
    let commas = 0;
    for (let i = match.index + match[0].length; i < code.length && depth >= 0; i += 1) {
      const char = code.charAt(i);
      if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char)) depth -= 1;
      else if (char === ',' && depth === 0 && !/^\s*\)/.test(code.slice(i + 1))) commas += 1;
    }
    return commas > 0 ? [match.index] : [];
  });
}

/** Each banned pattern found in `source`'s code, as `line N: name` (one per line and pattern, in line order). */
export function bannedUses(source: string): string[] {
  const code = codeOnly(source);
  const hits: (readonly [number, number, string])[] = BANNED.flatMap(([name, pattern], order) =>
    [...code.matchAll(pattern)].map((match) => [lineOf(code, match.index), order, name] as const),
  );
  for (const index of multiFieldDates(code))
    hits.push([lineOf(code, index), BANNED.length, 'new Date with fields']);
  for (const [line, name] of globalReads(source)) hits.push([line, BANNED.length + 2, name]);
  for (const token of tokensOf(source)) {
    if (STRING_KEY.has(token.kind) && BANNED_STRINGS.has(token.value))
      hits.push([lineOf(source, token.start), BANNED.length + 1, `'${token.value}' as a string`]);
    if (COMMENTS.has(token.kind) && DIRECTIVE.test(source.slice(token.start, token.end)))
      hits.push([lineOf(source, token.start), BANNED.length + 3, 'type-check directive']);
  }
  hits.sort(([lineA, orderA], [lineB, orderB]) => lineA - lineB || orderA - orderB);
  return [...new Set(hits.map(([line, , name]) => `line ${String(line)}: ${name}`))];
}
