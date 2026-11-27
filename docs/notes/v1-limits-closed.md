# Three v1 limits closed: the stamp, `bbox()`, and end taps on cores

*2026-11-26. After the third acceptance run passed, three limits that [`design.md`](../design.md)
draft 2.3 named are closed in the build, each with failing tests written first. The design text
follows (marked *2.3*, listed in its changelog under "After acceptance run 3"). Labels:
**verified** (run, with how), **read** (from the code or a document), **inferred**.*

**Golden values.** Every golden file is unchanged: G1–G34, the cart's cut list, BOM, order and
machining sheet, the base frame's cut list and BOM (**verified**: the unit suite and the gate).
Where a test compares an output with a golden byte for byte, it compares the golden plus the
stamp's lines, as the order's test did since M3b (m3b-doc 40).

## 1. Every output states the stamp (§5.4, §9, §4.13)

**Before.** Only the order list and the costs stated the lock they were derived from
(m3b-doc 40); the cut list, the BOM, the machining sheet and `derive --json` did not, and only the
order stated its oldest price read date (**read**: `order/format.ts`, `cutlist/format.ts`).

| # | Decision | Why |
|---|---|---|
| 1 | The stamp is three top-level JSON fields, `price_basis`, `oldest_read` and `lock`, in that order, as the order list already had them. `lock` is `lockHash`: the sha256 of the lock's canonical text. The caller that read the lock hashes it and passes the hash in (`modelOutputs(derived, items, { lock })`, `derivedJson(d, { lock })`); an output built without one states no lock | One function for every output, as the brief asks; the output modules stay free of Node, and the hand goldens stay statements about values, not about one lock's bytes |
| 2 | An output **carries prices** when it states one or chooses by one: the cut list (its stock bars' prices, and the cheapest of several cut offers), the order list and the costs. The BOM, the machining sheet and the derived model carry none, so they state the lock alone | §5.4's "price basis and oldest read date" means something only where a price is used |
| 3 | The cut list's oldest read date is that of the offers it chose: each cut-to-length group's offer and each nested stock bar's offer. It can be older than the order's: a line a cost line covers is nested and priced in the cut list but not priced in the order (the cart's packers, covered by K3) | The date says how old the prices behind that output are |
| 4 | The costs state the order's oldest read date: their totals add the order lines' prices. A cost line's own `read` stays on its line | The costs are the order's cost lines and totals (§4.11) |
| 5 | Markdown: a line "Derived from the lock sha256:…" under the opening lines, as the order had; the cut list's and the costs' price line gains "the oldest was read …". CSV: the stamp is the first rows, `stamp` rows. The cut list and the BOM put `stamp` in `kind`, `lock` in `item` and the hash in `sources`, the column that says where a row comes from; the order and the costs keep the lock row in `name` and `details` and add `price_basis` and `oldest_read` rows after it. The cut list's CSV gives no price, so no basis row | Each CSV keeps its own columns; a reader skips `stamp` rows as it skips `stock` or `total` rows |
| 6 | `derive --json` states `lock` after `schema` and `variant`; `derive --select` keeps it, as it keeps those two. The view model's derived model, which the viewer draws from, carries none: it is not an output | A selection is still `alukit.derived/1`, with fewer members (§7.3) |
| 7 | One builder per output, shared by the CLI, the server and the revisions: `checkedCutList`, `checkedBom`, `checkedMachining`, `checkedOrder` and `derivedJson`. The server's `/api/derived`, `/api/cutlist` and `/api/bom` now answer the CLI's text byte for byte (before, compact JSON without derive's own diagnostics); its snapshot hashes the lock once per revision. The drawer's Cut list, BOM and Machining tabs show the lock as Order and Costs do | **Verified**: `server.test.ts`, each answer against the CLI's output, in a variant too |
| 8 | A revision stores each output with its stamp (stored outputs are the CLI's JSON, m5 10). `revision verify` compares a stamp field the stored output has; one it does not have is not drift. So a revision saved before this change (only the order and the costs stamped, only the order with an oldest read date) verifies with zero drift, and a stored stamp that no longer matches is drift. Nothing stored is migrated | The stamp says where the values came from; it is not one of them. The lock is already covered by the revision's own content hash (§4.13), and the oldest read date follows from offers the stored lines and the stored lock pin. **Verified**: `revision.test.ts`, a revision with the new stamp fields deleted, then one with a stamp changed |
| 9 | The tests compute the stamp without AluKit: the lock's hash as sha256 of the lock file (`lockStamp`), the cut list's oldest read date from the golden's chosen offers and the lock file's read dates (`oldestCutRead`), and the golden text plus those lines (`withStamp`, `src/core/testing.ts`) | The goldens stay the hand values; the stamp is checked by an independent route |
