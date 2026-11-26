/**
 * JSON for hand- and agent-written catalog files. `JSON.parse` keeps the last of two equal keys
 * in an object and drops the first without a word, so a family file that names one item twice
 * would lose half of it. This parser reports every duplicate key, with its line and column.
 */

export interface JsonProblem {
  message: string;
  line: number;
  col: number;
}

export type JsonResult = { ok: true; value: unknown } | { ok: false; problems: JsonProblem[] };

function position(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      start = i + 1;
    }
  }
  return { line, col: offset - start + 1 };
}

/** The end of the string literal that starts at `i` (a `"`), just past its closing quote. */
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") j += 2;
    else if (c === '"') return j + 1;
    else j++;
  }
  return j;
}

interface Frame {
  object: boolean;
  keys: Set<string>;
  path: string;
  /** Objects: the next string is a key. */
  wantKey: boolean;
  /** Arrays: the index of the current element. */
  index: number;
  /** The key or index the next nested value sits under. */
  at: string;
}

/** Scans text that JSON.parse accepted, and reports duplicate keys. */
function duplicateKeys(text: string): JsonProblem[] {
  const problems: JsonProblem[] = [];
  const stack: Frame[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    const top = stack[stack.length - 1];
    if (c === "{" || c === "[") {
      const path = top ? `${top.path}/${top.at}` : "";
      stack.push({
        object: c === "{",
        keys: new Set(),
        path,
        wantKey: c === "{",
        index: 0,
        at: "0",
      });
      i++;
    } else if (c === "}" || c === "]") {
      stack.pop();
      i++;
    } else if (c === ",") {
      if (top?.object) top.wantKey = true;
      else if (top) top.at = String(++top.index);
      i++;
    } else if (c === '"') {
      const end = stringEnd(text, i);
      if (top?.object && top.wantKey) {
        const key = JSON.parse(text.slice(i, end)) as string;
        if (top.keys.has(key)) {
          const { line, col } = position(text, i);
          problems.push({ message: `duplicate key "${key}" in ${top.path || "/"}`, line, col });
        }
        top.keys.add(key);
        top.at = key;
        top.wantKey = false;
      }
      i = end;
    } else {
      i++;
    }
  }
  return problems;
}

/** Parses JSON, refusing duplicate keys. A leading byte-order mark is ignored. */
export function parseJson(text: string): JsonResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (e) {
    return {
      ok: false,
      problems: [{ message: e instanceof Error ? e.message : String(e), line: 0, col: 0 }],
    };
  }
  const problems = duplicateKeys(body);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value };
}
