/**
 * The scanner behind tests/unit/core/core-purity.spec.ts (the Sprint 1 Gate's grep test over src/core; TECH-R1,
 * QA-R7, PI-6; Hard Rule 4), kept apart so the spec stays one page. It reads text only: no lint, no types, so a lint
 * regression cannot blind it.
 *
 * Each file is reduced to its code with the TypeScript scanner: comments, string literals (all but their quotes),
 * template text and regular-expression literals become spaces, so prose such as "never calls Date.now()" is not a
 * hit and a call hidden after a string is still found. A member read with a written key (`Date['now']`,
 * Date[`now`]) is first rewritten as `Date.now`, and `?.` as `.`, so every spelling of a member meets the same
 * pattern. Banned patterns are matched over the whole file, not line by line, so a call split across lines
 * (`Date\n.now()`) is still found; a hit names the line it starts on.
 */
import ts from 'typescript';

/** Clock, randomness, timers, network, host and garbage-collector APIs, matched on code only, over the whole file. */
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
  ['fetch', /\bfetch\b/g],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/g],
  ['WebSocket', /\bWebSocket\b/g],
  ['performance', /\bperformance\b/g],
  ['setTimeout / setInterval / setImmediate', /\bset(?:Timeout|Interval|Immediate)\b/g],
  ['process.', /(?<![\w$.])process\s*\./g],
  ['Intl', /\bIntl\b/g],
  ['Temporal', /\bTemporal\b/g],
  ['WeakRef', /\bWeakRef\b/g],
  ['FinalizationRegistry', /\bFinalizationRegistry\b/g],
  ['crypto', /(?<![\w$.])crypto\s*\./g],
  ['chrome', /(?<![\w$.])chrome\s*\./g],
  ['globalThis / self', /(?<![\w$.])(?:globalThis|self)\b/g],
  [
    'Reflect on a global',
    /\bReflect\s*\.\s*\w+\s*\(\s*(?:globalThis|self|window|Date|Math|crypto|performance|Intl|Temporal)\b/g,
  ],
  ['.constructor', /\.\s*constructor\b/g],
  ['Symbol.toPrimitive', /\bSymbol\s*\.\s*toPrimitive\b/g],
  [
    'ambient declaration',
    /\bdeclare\s+(?:const|let|var|function|class|enum|global|namespace|module|abstract\s+class)\b/g,
  ],
];

/** String values that are banned as code even when written as text: `Reflect.get(d, 'constructor')`. */
const BANNED_STRINGS: ReadonlySet<string> = new Set(['constructor']);

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

/** The next token, re-scanned where the scanner alone cannot tell (template continuations, regex literals). */
function nextToken(scanner: ts.Scanner, braces: string[], previous: ts.SyntaxKind): ts.SyntaxKind {
  let kind = scanner.scan();
  if (kind === K.CloseBraceToken && braces.at(-1) === '${') {
    braces.pop();
    kind = scanner.reScanTemplateToken(false);
    if (kind === K.TemplateMiddle) braces.push('${');
  } else if (kind === K.OpenBraceToken) braces.push('{');
  else if (kind === K.CloseBraceToken) braces.pop();
  else if (kind === K.TemplateHead) braces.push('${');
  else if ((kind === K.SlashToken || kind === K.SlashEqualsToken) && !ENDS_OPERAND.has(previous)) {
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
}

/** Every token of `source`, trivia included. */
function tokensOf(source: string): Token[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const braces: string[] = [];
  const tokens: Token[] = [];
  let previous: ts.SyntaxKind = K.Unknown;
  for (let kind = nextToken(scanner, braces, previous); kind !== K.EndOfFileToken;) {
    const value = scanner.getTokenValue();
    tokens.push({ kind, start: scanner.getTokenStart(), end: scanner.getTokenEnd(), value });
    if (!TRIVIA.has(kind)) previous = kind;
    kind = nextToken(scanner, braces, previous);
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
    const member =
      before !== undefined && (ENDS_OPERAND.has(before.kind) || before.kind === K.QuestionDotToken);
    if (member && STRING_KEY.has(key.kind) && IDENTIFIER_NAME.test(key.value))
      overwrite(out, open.start, close.end, `.${key.value}`);
  });
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
  for (const token of tokensOf(source)) {
    if (STRING_KEY.has(token.kind) && BANNED_STRINGS.has(token.value))
      hits.push([lineOf(source, token.start), BANNED.length + 1, `'${token.value}' as a string`]);
  }
  hits.sort(([lineA, orderA], [lineB, orderB]) => lineA - lineB || orderA - orderB);
  return [...new Set(hits.map(([line, , name]) => `line ${String(line)}: ${name}`))];
}
