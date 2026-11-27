/**
 * An item's options as the app offers them (U2, docs/ux/plan.md S2.3): the catalog card, the parts
 * bin and the start card choose an item's options here, so a bar is never drawn in an option no
 * offer sells while one that sells exists. Pure. Owner: S2.
 *
 * Why (U2's root cause, read in the old `Catalog.tsx`): the option list always began with "(the
 * project's default)", whatever `defaults` said, and preselected it. In a project with no default
 * the bar was drawn with no option, and the order blocked on `option-not-sold`. Here:
 *
 * - "(project default: X)" is offered only when the project's `defaults.bar.opt` gives X and X is
 *   one of the item's values: choosing it leaves the option out of the bar, and derive takes X
 *   (`barOptions` in src/core/derive/place.ts), so the bar follows the default if it changes;
 * - otherwise the first value some offer sells is preselected: an offer sells a value when it
 *   names that value or leaves the option open (`offerMatches` in src/core/cutlist/cutlist.ts);
 * - options are chosen in name order, each against the offers that sell the ones chosen before,
 *   so the set chosen is one an offer sells;
 * - a value no offer sells stays choosable, marked as not sold. An item with no offers at all
 *   (a project item, a catalog that sells nothing) has nothing to judge by: its default, or its
 *   first value.
 */

/** What an offer sells: the option values it names (an option it leaves out, it sells in any). */
export interface OfferOptions {
  options: Readonly<Record<string, string>>;
}

export interface OptionChoice {
  /** The value; `""` is the project's default, which leaves the option out of the bar. */
  value: string;
  /** In words: `anodised`, `project default: anodised`. */
  label: string;
  /** Some offer sells it (true when the item has no offers to judge by). */
  sold: boolean;
}

export interface OptionField {
  name: string;
  choices: OptionChoice[];
  /** The value preselected, one of the choices'. */
  chosen: string;
}

const sells = (o: OfferOptions, name: string, v: string) =>
  o.options[name] === undefined || o.options[name] === v;

/**
 * Each option of an item, its choices and the one preselected. `defaults` is the project's
 * `defaults.bar.opt` for a bar, and undefined for anything else (no default applies to parts).
 */
export function optionFields(
  options: Readonly<Record<string, readonly string[]>>,
  offers: readonly OfferOptions[],
  defaults: Readonly<Record<string, string>> | undefined,
): OptionField[] {
  const judged = offers.length > 0;
  let open = [...offers];
  const out: OptionField[] = [];
  for (const name of Object.keys(options).sort()) {
    const values = options[name] ?? [];
    if (values.length === 0) continue;
    const d = defaults?.[name];
    const hasDefault = d !== undefined && values.includes(d);
    const soldAtAll = (v: string) => !judged || offers.some((o) => sells(o, name, v));
    const soldNow = (v: string) => !judged || open.some((o) => sells(o, name, v));
    const choices: OptionChoice[] = [
      ...(hasDefault
        ? [{ value: "", label: `project default: ${d}`, sold: soldAtAll(d as string) }]
        : []),
      ...values.map((v) => ({ value: v, label: v, sold: soldAtAll(v) })),
    ];
    let chosen: string;
    if (hasDefault && soldNow(d as string)) chosen = "";
    else chosen = values.find(soldNow) ?? (hasDefault ? "" : (values[0] as string));
    const effective = chosen === "" ? (d as string) : chosen;
    if (judged) {
      const narrowed = open.filter((o) => sells(o, name, effective));
      if (narrowed.length > 0) open = narrowed;
    }
    out.push({ name, choices, chosen });
  }
  return out;
}

/** The options to write for the values picked: the project's default (`""`) is left out. */
export function pickedOptions(picked: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(picked).filter(([, v]) => v !== ""));
}

/**
 * A bar's options as used, less the values the project's default already gives: what arming it
 * from the parts bin writes, so the bars drawn with it keep following the default.
 */
export function beyondDefaults(
  opt: Readonly<Record<string, string>>,
  defaults: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return Object.fromEntries(Object.entries(opt).filter(([k, v]) => defaults?.[k] !== v));
}

/** An options record in words, by name: `finish anodised, length 3000`; empty for none. */
export function optionsText(opt: Readonly<Record<string, string>> | undefined): string {
  if (!opt) return "";
  return Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");
}
