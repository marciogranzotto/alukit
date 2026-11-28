# AluKit: the editing review's last items

*2026-11-28. The [editing review](review-editing.md) left three items for the core: m2 (a
duplicate copies the label and tags), n2 (undo names repeat the verb) and n3 (Move writes
`H - 300 - 100`), re-listed at §9.3. The app rounds handed them over
([review fixes, app](review-fixes-app-decisions.md), "Left for the core" and 18). This round
closes them in the core, so the CLI and the app agree. Decisions are cited as "rl n"; the design's
calls are 141–143. Labels as in the stream notes: **measured** (a test or a run says so),
**read** (from the code or page cited), **inferred**.*

*No schema field, command, argument or diagnostic is added. `array` and `mirror` answer one more
field, `tagged`. Step words change for copies (they say the tags carried) and for several
`set…` changes of the same fields (said once). Expressions a command composes are written with
their constants folded. No golden value moves, and no output of any of the 59 fixture projects
moves (see [Tests and what moved](#tests-and-what-moved)).*

## Done

| Item | What changed | Where | Test | Failed first |
|---|---|---|---|---|
| m2 | A copy that stands as an entity of its own (`array`, so Duplicate and Paste; `mirror`; `explodePattern`) numbers its label, "top rail, front (2)", and keeps its tags; `array` and `mirror` answer `tagged`, and their words, the app's previews and the CLI's line say "tagged top" | `core/commands/copies.ts` (new), `patterns.ts` (`makeCopies`, `array`), `mirror.ts`, `cli/do.ts` (`resultLine`), `ui/tools/moves.ts` (`copyWords`), `ui/tools/wire/mirror.ts` (`mirrorWords`) | `review-last.test.ts` (A7; several copies, a copy of a copy, a name ending in a number, no label or tags; mirror; a live pattern exploded); `cli/edit.test.ts`; `batches.test.ts`; `editing.spec` A7 | yes: b17 was "top rail, front" with nothing said |
| n2 | Consecutive `set…` changes of the same fields are one phrase: "change the roll and anchor of b1, b2, b3 and b4", bounded "… b1, b2, b3 and 3 more" | `core/commands/words.ts` (`Change`, `changed`, `merged`) | `review-last.test.ts` (four, six, one, two different changes); `edit.spec` (the four posts' finish) | yes: "change b1's roll and anchor, change b2's roll and anchor and 2 more" |
| n3 | An expression a command composes has its constants folded, exactly: `H - 300` moved 100 down is `H - 400` | `core/expr.ts` (`foldConstants`, `formatExpr`), `core/commands/numbers.ts` (every composer) | `expr-fold.test.ts` (cases; the composers; a property test over 4000 random sums; the printer over 2000); `review-last.test.ts` (A7 then Move, the document derived the same); `cli/edit.test.ts` (`alukit move`); `ends.spec` | yes: `foldConstants` did not exist; Move wrote `H - 300 - 100` |

## m2: what a copy carries

### 1. A copy of its own numbers its label

*Measured* (the review, A7 and A11; this round's `review-last.test.ts` before the fix): the rail
Duplicate made 300 below the top read "top rail, front" and was tagged `top`, so **Select tagged
top** and `H` took it, and the outline listed two rails of one name.

- **The rule:** a copy's label is its original's name and the lowest number from 2 that no label
  in the document has with that name, written " (n)": "top rail, front (2)", then "(3)". The
  original counts as the first. A label that already ends in " (n)" is that name's copy, so a copy
  of "top rail, front (2)" is "top rail, front (3)" or the next free number. Any other trailing
  number belongs to the name: "rail 4040" copies as "rail 4040 (2)". An entity with no label
  gets none. Numbers are taken across every kind, since the outline and its search list every
  kind together.
- **Precedent** (each **read**): Fusion distinguishes the two kinds of copy. Paste makes linked
  copies, which "share the same name, except for the designations :1 and :2 at the end", and
  Paste New makes an independent copy, which is "unique"; where its name already exists in the
  design, "the pasted name is incremented with a number"
  ([Copy and reuse components](https://help.autodesk.com/cloudhelp/ENU/Fusion-Assemble/files/GUID-9EDE876B-6A97-47E9-AB87-F27ADFFDCEE9.htm);
  users report the form as "(1)",
  [Autodesk forum](https://forums.autodesk.com/t5/fusion-360-ideastation-archived/copy-past-new-problem-with-uniquely-identifying-joints-between/idi-p/8672851)).
  SolidWorks numbers the instances of a component in ascending order, `<n>` after the name, and
  does not renumber them when one is deleted
  ([Component Instance Numbering](https://help.solidworks.com/2017/English/SolidWorks/sldworks/c_component_instance_numbers.htm)).
  Blender keeps names unique per kind and gives a duplicate the next free suffix, "Cube.001"
  ([Blender issue #119955](https://projects.blender.org/blender/blender/issues/119955)). Revit
  treats an instance's Mark as an identifier: two alike raise "Elements have duplicate Mark
  values" ([The Building Coder](https://raw.githubusercontent.com/jeremytammik/tbc/gh-pages/a/0323_duplicate_mark_values.htm)),
  and users report that a copy made in the same document does not carry it
  ([Revit API forum](https://forums.autodesk.com/t5/revit-api-forum/copying-elements-types-and-parameters/m-p/9542634);
  reported, not in Autodesk's help, so only corroborating).
- **Why parentheses**, not the reviewer's "top rail, front 2": a bare trailing number cannot be
  told from a name's own ("rail 4040", "M8 bolt 2"), so a copy of a copy could not find its
  number, and a rename could not be told from a copy. " (n)" is the form Fusion's users and
  Windows' file copies read as a copy's number (**inferred** for Windows; no source taken).
- **Not chosen:** keeping the label (two things of one name, the review's finding); dropping it
  (it loses what the person wrote, and the outline falls back to the item).
- **What the number does not do** (**inferred**): "top rail, front (2)" 300 below the top is
  still not a top rail. The core cannot know what a label's words mean; the number marks the bar
  as a copy, and the person renames it in its label field, one step.

### 2. Tags are kept, and the copy says them

Tags have no kind (**read**: the schema's `tags` is a list of strings). The frame command writes
`top`, `base` and `shelf` for the ring a rail belongs to, which is where it is, and `post` for
what it is (**read**, `commands/frame.ts`); a person's `leg`, `knee`, `brace` or `slat` says what
a thing is, which checks count (`count(tag:leg)`, design §4.9) and **Select tagged** gathers.

- **Options weighed:**
  - *Drop every tag.* A copied leg would leave `count(tag:leg) == 4` and the legs' selections,
    and `array` would differ from `explodePattern` and from a live pattern's copies, which take
    every field of the template (§4.7), though `array` is "explode at once" (**read**,
    `patterns.ts`).
  - *Drop the tags that place the original.* Without a kind, that means guessing from words:
    "top" may be a ring or what a thing is (a top plate), "front" a side or a part's name. A
    heuristic over words would misfire silently, in a public tool whose users choose their own.
  - *A kind for tags* (where, against what): a schema change every tag-writing path would fill,
    beyond this round. Recorded as open in call 141.
  - *Keep them, and say so.* **Chosen.** `array` and `mirror` answer `tagged`, each copy's tags by
    its id; the step's words say "tagged top" after what it made ("copy b13, making b17, tagged top, joined at 2
    ends"); the app's Duplicate, Paste and Mirror previews say it before Enter ("makes b17 ·
    tagged top · joins b1 (c15) · …"); `alukit do` says it on the command's line ("array:
    created b35, …; tagged slat"). A person who copies a top rail down sees it and drops the tag
    in one step: the inspector's tags field, or `alukit do '{"cmd":"tag","args":{"ids":["b17"],"remove":["top"]}}'`.
- So a positional tag still follows a copy, and Select tagged top still takes it until the
  person drops it. That is the honest limit of tags without a kind; the preview makes it visible
  where it used to be silent.

### 3. Which commands

- **`array`** (Duplicate, Paste) and **`mirror`**: their copies and images are entities of their
  own, so §1 and §2 apply, through one module (`commands/copies.ts`).
- **`explodePattern`** turns a live pattern's copies into entities of their own, so they are
  numbered too ("top rail, front (2)", "(3)"), by the same `makeCopies` as `array`. Its words and
  answer say nothing of tags: as live copies they carried them already.
- **A live pattern** (`addPattern`, the app's Pattern) is unchanged. Its copies are instances, not
  entities: the document holds none to label, they are named by their ids (`b13@1`, `b13@2`), and
  they take the template's label and tags, as SolidWorks' instances share the component's name
  with an instance number and Fusion's linked copies share theirs. Select tagged taking every slat
  of a pattern is what tagging the template means.
- **`splitBar`** is unchanged: its two pieces are one member cut in two, not a copy and its
  original, so both keep the label and tags, and a run names them as one line (**inferred**).

## n2: one change of many entities, said once

### 4. Changes of the same fields merge

*Measured* (the review, §9.3): "change b1's roll and anchor, change b2's roll and anchor and 2
more".

- **The rule:** a `set…` command's phrase is a change of some fields (`Change`); consecutive
  changes of the same fields are one phrase, as consecutive "add bar" phrases already were ("add
  bars b1, b2 and b3", [s1](s1-decisions.md) 7). One entity reads as before, "change b1's roll and
  anchor"; several read "change the roll and anchor of b1, b2, b3 and b4". An id repeated in the
  run is said once.
- **The bound:** `idList`'s, every list of ids in words: four ids, else the first three "and n
  more" ("… of b1, b2, b3 and 3 more"). A step still says at most three phrases, then "and n
  more".
- **Only consecutive changes**, and only of the same fields: words follow the step's order and
  never reorder it, so "change the roll and anchor of b1 and b2, change the roll of b3 and b4".
  A bar and a part changed alike merge, since the words are true of both.
- **Source:** this is what natural-language generation calls aggregation: messages that share a
  predicate are combined into one sentence with a conjoined subject (Reiter and Dale, *Building
  Natural Language Generation Systems*, Cambridge University Press, 2000, the microplanning
  chapter).

## n3: constants folded

### 5. A simplifier in `expr.ts`: `foldConstants`

*Measured* (the review, §9.3): "writes b17.a z: H - 300 - 100". `H - 300` was the duplicate's
coordinate, and Move appended `- 100` (**read**, `numbers.ts` `plus`).

- **The rule:** a sum whose terms are one symbol term and two or more numbers has its numbers
  folded into one: `H - 300 - 100` is `H - 400`, `1200 - (H - 300)` is `1500 - H`,
  `-(H - 300) - 100` is `200 - H`, and `H - 300 + 300` is `H`. The sum is read through `+`, `-`,
  signs and parentheses into signed terms (compilers call this reassociation), the numbers added,
  and the text written `term ± c`, or `c - term` for a term that was subtracted.
- **Exact decimal arithmetic:** each number is read as the shortest decimal that names its double
  (ECMAScript's `Number::toString`, which is the literal as written for any literal of up to 15
  significant digits), and the numbers are added as scaled integers. So `H + 0.1 + 0.2` folds to
  `H + 0.3`, not to the `0.30000000000000004` a double sum gives.
- **What is never folded:** anything inside the symbol term (a function's argument, a product's
  factor, a power), so a fold never crosses a function: `round(H - 300) - 100` and
  `round(H - 300 - 100)` stay as written. A comparison or a condition is not a number to add to. A
  sum with no symbol term (`300 + 50 + 100`, a person's written constants) and one with two
  (`W + D - 100 - 50`) stay as written, as the brief scopes it: folding the second would reorder a
  person's terms. Units never reach the core: the app converts `5 cm` to `50` before writing
  (**read**, `ui/tools/typed.ts` `withoutUnits`), and the language has none.
- **The bound:** the numbers' magnitudes must add up to at most 2^53. Below it, no partial sum of a
  finite term and these numbers overflows, before the fold or after, so a fold never turns "the
  sum is not finite" into a value or back.
- **Where:** every composer in `commands/numbers.ts` (`plus`, `offsetBy`, `negate`, `reflect`,
  `minus`) passes its text through it. So Move, Rotate, Mirror, Split, a length from the other
  end, Draw's offsets and the app's hole reference switch fold alike, in the CLI and the app. Text
  a person types is never folded: no step composed it.
- **Source:** constant folding, evaluating at compile time what is known then
  ([Wikipedia, Constant folding](https://en.wikipedia.org/wiki/Constant_folding)), with
  reassociation so that `(x + 1) + 2` exposes `1 + 2`. For floating point that reassociation is not
  value-safe; see §6.

### 6. What "evaluates identically" means

- **The real value is identical**, exactly: the property test evaluates every sum before and
  after in exact rational arithmetic and finds them equal (**measured**, 4000 random sums).
- **The double may differ in its last bits.** IEEE addition is not associative (D. Goldberg,
  ["What every computer scientist should know about floating-point arithmetic"](https://dl.acm.org/doi/10.1145/103162.103163),
  *ACM Computing Surveys* 23, 1991). It is why GCC folds this way only under
  `-fassociative-math`, off by default, which "violates the ISO C and C++ language standard by
  possibly changing computation result"
  ([GCC, Optimize Options](https://gcc.gnu.org/onlinedocs/gcc/Optimize-Options.html)). Of the 4000
  random sums, 1884 fold; 1307 of those give the very same double, and the other 577 differ by
  less than n·ε·Σ|xᵢ|, the rounding of a sum of their n terms (**measured**; the test also passed
  under three other seeds, run once by hand).
- **No output changes.** Every output is quantised to 0.01 mm after snapping to the nearest half
  within `tol.snap` (10⁻⁹, relative), and checks compare within `tol.snap` (design §5.2), so a
  difference near 10⁻¹⁶ relative cannot cross a quantum or a comparison. The property test holds
  every folded sum equal at the output quantum (**measured**); A7's moved rail derives the same,
  bit for bit, written folded or not; and no fixture's output moves (below).
- **Not chosen:** folding at evaluation time, so both forms would give one double by construction:
  it changes how every existing expression evaluates, which the brief rules out. Folding only
  where provably bit-exact: that depends on the params' values, which change after the fold.
- An expression that cannot be evaluated still cannot be; the operator its message names may be
  the other sign's ("`-` needs a number" for "`+` needs a number"), the term being the same.

### 7. The text it writes: `formatExpr`

The term is printed from its tree with the parentheses the grammar needs and no others, spaced as
commands write (`W / 2 - 15`), numbers as `Number::toString`: `H*2-100+50` folds to `H * 2 - 50`.
The precedence levels are the parser's, so `parseExpr(formatExpr(ast))` is the same tree
(**measured**: 2000 random sums and 17 hand cases: signs and powers, `not`, comparisons, a member
of a number).

## CLI parity

The three changes are the core's, so the CLI and the app read them from one place: `alukit do`'s
array and mirror lines say the tags carried; `alukit log`, Undo and the history read the same
step words; `alukit move` writes folded expressions (`cli/edit.test.ts`, **measured**), and
`rotate`, `transform`'s other half, composes through the same `numbers.ts` (**read**).
No command schema changed, so `pnpm skill` regenerates the skill unchanged (**measured**).

## Tests and what moved

Every unit and CLI test in the table was written first and failed for the reason given
(**measured**: 14 failures against the code before the change); the e2e expectations were changed
with them, before the fix, and run in the gate. Comparing every fixture's `check`, `cutlist`,
`bom`, `order`, `machining` and `derive` (59 projects, `--frozen`) and `problems` (which reads no
`--frozen`), all as of 2026-11-28, on main and on this branch, byte for byte with their exit codes
(**measured**):

- **Nothing moves**: 472 outputs compared, none differs. No golden value, diagnostic, problem,
  cut list, BOM line, order or derived number. The commands change only what a step writes, and
  no fixture is made by one; the composers' folding and the copies' labels show in the tests
  above, which run the commands.

Existing tests changed because their words changed, each kept exact:

- `batches.test.ts`: Duplicate's preview of the brace's top rail gains "tagged top".
- `edit.spec`: the four posts' finish reads "change the options of b1, b2, b3 and b4".
- `copy.spec`: the brace's top rails duplicated read "copy b9, making b13, tagged top, joined at
  2 ends" and "copy b10, making b14, b15 and b16, tagged top, joined at 6 ends"; the cut lists it
  compares with the CLI's stay byte for byte the same.
- `editing.spec` A7: the step reads "copy b13, making b17, tagged top, joined at 2 ends", and the
  test now also holds the preview's "tagged top" and the copy's label "top rail, front (2)".
- `ends.spec`: a cut typed as `=L - 40` on the length label writes b3's end `640 - L`, which was
  `600 - (L - 40)`; its cut, 360, and the CLI's change of L after it are unchanged.

The guarded tests (`draw.spec`, `live.spec`, `view.spec`) are unchanged.
