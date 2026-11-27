import { splitNumber } from "../format.ts";

/**
 * A written number as a table figure: tabular digits, its trailing `.00` dimmed so the precision
 * stays and the figure reads first (docs/ux/visual-design.md §4.4). Its text is the number as
 * `format.ts` wrote it, so reading it back after removing U+202F gives the CLI's. Owner: S4.
 */
export function Num({ text, class: cls }: { text: string; class?: string }) {
  const { main, dim } = splitNumber(text);
  return (
    <span class={cls ? `num ${cls}` : "num"}>
      {main}
      {dim && <span class="dim">{dim}</span>}
    </span>
  );
}
