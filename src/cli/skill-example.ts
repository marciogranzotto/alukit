/**
 * The skill's worked example (design §7.5) as a test runs it: the commands of the fenced block
 * between its markers, split into words as a shell would. The unit suite runs them all but
 * `snapshot`, which draws the built app in Chromium; the end-to-end suite runs them whole
 * (tests/e2e/snapshot.spec.ts). No imports, so both test runners load it.
 */

/** The shell commands of the worked example: the fenced block between its markers. */
export function workedExample(text: string): string {
  const start = text.indexOf("<!-- worked example");
  const end = text.indexOf("<!-- end of the worked example -->");
  const block = /```sh\n([\s\S]*?)```/.exec(text.slice(start, end));
  if (start < 0 || end < start || !block) throw new Error("no worked example in the skill");
  return block[1] as string;
}

/**
 * Splits shell text into commands of words: single and double quotes (which may span lines),
 * backslash-newline continuations, and `#` comments. Enough for the example; anything else (a
 * pipe, a redirect, a variable) is refused, so the example stays runnable as written.
 */
export function exampleCommands(sh: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  const endWord = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) out.push(words);
    words = [];
  };
  for (let i = 0; i < sh.length; i++) {
    const c = sh[i] as string;
    if (c === "'") {
      const j = sh.indexOf("'", i + 1);
      word = (word ?? "") + sh.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      let s = "";
      i++;
      while (sh[i] !== '"') {
        if (sh[i] === "\\") i++;
        s += sh[i];
        i++;
      }
      word = (word ?? "") + s;
    } else if (c === "\\" && sh[i + 1] === "\n") {
      i++;
      endWord();
    } else if (c === "\n") endCommand();
    else if (c === " " || c === "\t") endWord();
    else if (c === "#" && word === undefined) {
      while (i < sh.length && sh[i] !== "\n") i++;
      endCommand();
    } else if ("|<>;&$`".includes(c))
      throw new Error(`the example uses "${c}", which a test cannot run as written`);
    else word = (word ?? "") + c;
  }
  endCommand();
  return out;
}
