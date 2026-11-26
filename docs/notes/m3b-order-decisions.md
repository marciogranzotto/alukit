# M3b decisions: offers, the order list, costs and totals

*2026-11-26. Calls made while building M3b part 3 (offer selection, the order list per supplier,
the order rules, cost lines and totals, `alukit order` and `alukit costs`) where
[`design.md`](../design.md) is silent or ambiguous. For the coordinator to fold into the design or
veto. Part 2 (commands, canonical form, lock file) is built elsewhere; nothing here depends on it.*

**No golden value was found wrong.** G26 passes to the minor unit with the design's numbers as
written, and was re-derived by hand: 1,234 mm billed in 10 mm steps is 1,240 mm, × R$ 126.50/m =
156.86; at −10 % 141.174 → 141.17, at +25 % 196.075 → 196.08 (19,607.5 minor units, half away from
zero). 10.05 at −10 % is 904.5 minor units → 9.05 (half-even would give 9.04); at +25 % 1,256.25 →
12.56. The quoted line is 2 × (45.00, 50.00, 60.00). The cart's order list and totals, worked by
`tests/fixtures/cart/hand/cart_by_hand.py` with no AluKit import, equal `alukit order --format
json` byte for byte; the only difference on the first run was the hand script's own (it put
supplier-less cost lines into the unsourced group).

## Fixtures

| # | Decision | Why |
|---|---|---|
| 1 | `test-gen` gains a flat cut to length at R$ 126.50/m in 10 mm steps, a clip at 10.05 and a block quoted 45.00–60.00; `golden-gen/G26` orders them under one band of −10/+25 % | G26's three lines, from one supplier |
| 2 | The cart gains a chosen bracket kit (10 brackets, 20 screws, 20 T-nuts), 12 brackets, 77 screws, a power supply priced by phone (`est`), a carriage price with a quoted range, three bands, cost lines K1–K5 (one in dollars, one covering a supplier's machining, one covering another supplier's machining and an item), a dollar rate, an open item that blocks the order on `c35`, and a nut pack read 56 days before the order | Every class the brief lists: packs, a kit, a sale price (in `test`), a quoted range, an estimate; plus each kind of cover and a stale price |
| 3 | `expected-order.json` is written exactly as `JSON.stringify(x, null, 2)` prints it (integral numbers as integers, UTF-8 unescaped) and excluded from Biome | Compared byte for byte; Biome would reflow it |
| 4 | A small fixture for the rules, `tests/fixtures/order`, on two new catalogs: `test-order` (shop-a, BRL) and `test-order-eu` (shop-eu, EUR, selling `test-order`'s valve). Both suppliers are READY as written; each test patches one condition in | Each rule needs a case that blocks and one that does not, and the cart blocks for three reasons at once |
| 5 | The order takes a date, `as_of` (`--as-of YYYY-MM-DD`, default today, local). Tests use 2026-11-26 | `stale-price` needs a date; output must be reproducible |

## Offers (§5.4, §4.11)

| # | Decision | Why |
|---|---|---|
| 6 | Basis `sale` takes an offer's sale price when it has one, else regular; `lowest` takes sale only when strictly lower. A line priced on sale says `on_sale` | Call 12: sale only when the project opts in |
| 7 | The cheapest cover is an exact dynamic programme over (offer, units still needed, offer already bought): (m + 1) × (N + 1) × 2 states, O(m·N) time and memory, no time limit. Ties: cost, surplus, number of SKUs, then SKU order read as "more of the earlier SKU". 10,000 units of five offers take well under a second | §5.4 "an exact search bounded by the quantity" |
| 8 | Order of purchase: chosen kits first, then items sold only in kits (cheapest cover of kits by their main quantity), then packs and units. A kit's contents are credited against other needs of the same item and options; what is left over is the line's `surplus` | So a kit's screws count before the screws' own cover is chosen (the cart: 77 − 40 = 37 → 4 × 10) |
| 9 | An `order` choice naming no offer of the item in those options is an error `order` on the item (it blocks that item's supplier through `check-error`); a choice nothing uses is a warning | A typo must not silently fall back to the cheapest cover |
| 10 | Out-of-stock offers are **not** avoided by the cover: the cheapest wins, and `out-of-stock` blocks its supplier until the project chooses another offer or switches the rule | "As read" stock is a snapshot; switching silently would hide a dearer order |
| 11 | The cut list now picks the cheapest of several cut offers for an item and options (ties: SKU order), where M3a took the first | Pricing reads offers through the same source; M3a #31 deferred this |
| 12 | A supplier-cut bar gives one order line per cut-list line (identical pieces with a count), unit `piece`, priced per metre on the billed length, the piece price rounded once and multiplied by the count. `bill: "line"` applies the offer's minimum to the order line (`line_billed_mm`). Whole stock bars give one line per stock SKU, unit `bar` | A supplier invoices unit price × quantity |

## Services and covers (§4.11, §5.4)

| # | Decision | Why |
|---|---|---|
| 13 | `services.json` is not built: the design names it but gives no schema, and the lock would need to pin it. Services are priced only by a covering cost line | Kept to what the design specifies; noted for the design |
| 14 | A service the supplier does on its own cut pieces (taps, holes, angled cuts) and no cost line covers is a `missing-price` on that supplier, one reason per offer ("no price for N machining services; cover them with a cost line") | §5.4: services are priced, or the line is not |
| 15 | Machining on whole stock bars is listed `by: "buyer"` (you or a shop do it) and does not block; a `services_on` cover names who does it | Nobody sells it on that order |
| 16 | Services are named by what they are, not where: "tap M8 in an end, 20.00 deep", "hole Ø11.00, 4.00 deep", "angled cut" per non-square end; counted per line. A rail's factory holes are not services | The cut list says where; the order counts what to pay for |
| 17 | A covered item line moves to the cost line's supplier (unsourced when it names none), keeps its quantity and pieces, and shows `covered_by` instead of a price | §4.11: covered lines "show the cost line instead of a price" |
| 18 | Two cost lines covering one line or service: an error `covers` on the first id, naming both and the covered item, so it holds the supplier of that item | §4.11, §5.5: "a line covered twice" is an error |

## Prices, bands, currency

| # | Decision | Why |
|---|---|---|
| 19 | A band applies to a line's likely total, rounded once: `low = round(likely × (100 + low_pct) / 100)` | G26 |
| 20 | Specificity: a band naming an item beats one naming supplier and kind, which beats supplier or kind alone. A tie is an error `price-band` on the item; the line keeps low = likely = high. A band that selects no line warns | §5.5 lists "two equally specific price bands" as an error |
| 21 | An offer's quoted range (`low`/`high` on its price field) wins over any band (`range: "quote"`), times the quantity | §5.4: "from the offer's own range, else from a price band" |
| 22 | The project's currency is `currency`; with none, the one currency every price uses; with several and none named, the first by name and an error `currency` | Totals need one currency |
| 23 | Conversion is per line and per bound: `round(minor × rate)` for low, likely and high. Offers in different currencies are compared for the cover in the project's currency; one with no rate only when nothing else sells the item, and then it is a `missing-price` | §4.11 "converted per line" |
| 24 | The cut list's nesting compares lengths, not currencies: mixed-currency cut offers of one item are not converted when choosing one | A limitation; no fixture has them |

## Costs and totals (§4.11)

| # | Decision | Why |
|---|---|---|
| 25 | A cost line's provenance defaults to `est` | An amount nobody sourced is an estimate |
| 26 | `pct` contingency applies to each of the low, likely and high subtotals, each rounded once, in the project's currency. A contingency given as amounts goes to the contingency bucket too | §4.11 |
| 27 | Totals: order lines + cost lines = subtotal; + contingency = total. `by_currency` keeps amounts as quoted (the contingency in the project's currency); `share` is each provenance's part of the likely total, to 0.01 %, rounded half away from zero; `unpriced` counts lines left out | §4.11 "provenance share" |
| 28 | A supplier's total is its priced lines plus the cost lines that name it, in the project's currency. Cost lines with no supplier are in no supplier's order | One currency for comparison; a labour estimate is nobody's order |

## Order rules (§5.5)

| # | Decision | Why |
|---|---|---|
| 29 | Rule names and defaults are the design's table: `check-error`, `open-item`, `placeholder`, `missing-price`, `est-price`, `out-of-stock`, `option-not-sold` (block) and `stale-price` (warn, more than 30 days before `as_of`; exactly 30 is fine) | §5.5 |
| 30 | `check-error` takes every error diagnostic: derive's, the cut list's, the BOM's, the order's own, and project checks once part 2 evaluates them (the order takes diagnostics as input) | Project checks are part 2's |
| 31 | What a name reaches: a bar end its bar; a stock piece `c23.f1` its connection; a connection what it buys, else (a butt with no hardware) the bars it decides; a run its bars; a pattern its template and copies; an item id the lines that buy it; a cost line its supplier; `supplier:<id>` that supplier. Names that reach no supplier reach all | §5.5 "all suppliers for a check that names none"; a scope that misses must not let an order through |
| 32 | A cost line with `blocks: "order"` is reported under `open-item`, on its supplier or all | §4.11 lists `blocks` among a cost line's fields; it is an open question priced as a cost |
| 33 | A placeholder blocks its own line under "unsourced"; a project item is priced from its `price_minor` (a valued field with an optional range). Derive places project items in M6, so the test adds the BOM line by hand | §4.8 |
| 34 | Reasons are kept once per (rule, message) per supplier, ordered by rule then message | Readable and deterministic |
| 35 | `alukit order` exits 1 when any supplier is BLOCKED (warnings alone exit 0) and prints `BLOCKED <supplier>: <rule>: <message>` on stderr; `alukit costs` exits 1 only on an error diagnostic. The command is named `costs` | §5.5 |

## Not built

- **The lock hash in every output** (§5.4): the lock is part 2's. The order states the basis, the
  date and the oldest read date.
- **`services.json`** (decision 13).
- **G-A** from the build session log (a strut end bearing on a square-mitred shoe) was queued for
  "M3b part 3's review"; it is a derive question outside this part's brief and is untouched here.
