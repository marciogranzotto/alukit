/**
 * Values typed into a tool or a form, as a command takes them. Owner: S5.
 */

/** A typed value as a command takes it: a number when it reads as one, else an expression. */
export function typedValue(text: string): number | string {
  const t = text.trim();
  return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : t;
}

/** A comma-separated list of numbers or expressions; undefined when a member is empty. */
export function valueList(text: string): (number | string)[] | undefined {
  if (text.trim() === "") return [];
  const parts = text.split(",").map((s) => s.trim());
  return parts.some((s) => s === "") ? undefined : parts.map(typedValue);
}
