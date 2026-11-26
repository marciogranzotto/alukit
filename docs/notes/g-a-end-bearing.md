# G-A: a strut bearing on a shoe mitred square to it

*2026-11-26. Settles gap G-A of the early acceptance slice
([session log](../sessions/2026-11-26-alukit-v1-build-session-log.md), 16:14): a strut whose end
bears on a shoe, the shoe mitred square to the strut, could not be derived, so the slice typed
the strut's trim as `extend_mm`. For the coordinator to fold into [`design.md`](../design.md) or
veto; the design is not edited here. Labels as in the design: **verified** (run or checked, with
how), **read**, **inferred**.*

**Verdict: (b), a rule change.** Draft 2.1's rules express the case only by typing one value by
hand. The implementation of a butt through another bar's end is correct and is unchanged. The
claim in §16 falls short: the construction it names leaves the strut's length typed. The smallest
change is one new form of an existing field: **a plane's `normal` may name a bar**, square to its
axis. With it, the shoe follows the strut's angle and the strut follows the shoe, with the two
sweeps and the no-chain rule as they are. Golden case G27.

## The case

A diagonal strut ends on a **shoe**: a short piece of profile standing on a beam (or a post),
whose far end is cut on a plane square to the strut's axis. The strut is cut square, and its end
lands flat on that face, perhaps with an end plate between them. The shoe's position on the beam
and its height are the design inputs. The strut's length and the shoe's cut follow from them.

## Why draft 2.1 falls short

There are two ways to write it with draft 2.1, and each types one value (**verified**: both
derived in-process against `G27/alukit.json`, with merge patches, before the change):

1. **§16's construction**: the shoe's end butts through the strut's end (`through: "b3.b"`), with
   the end plate as `spacer_mm`. The shoe follows the strut. But the strut's end is then its own
   placement provider, the default plane at its design point, so the strut's trim must be typed:
   `extend_mm: -100` gives G27's numbers. This is the stand-in the acceptance slice used.
   §16 says as much ("the strut's own length stays a design input"), but the slice needed it
   derived.
2. **The reverse**: the strut's end butts through the shoe's end (`through: "b2.b"`). This already
   works in draft 2.1 and its implementation: the shoe's `point`/`normal` plane is a placement
   provider, and the strut's butt is an end provider that reads it in sweep 2 (G17's rule; the
   through end may be at any angle). But the normal must be typed as a vector, `[3, 0, -4]`,
   restating the strut's direction. Expressions cannot read placement (`pos` and `dist` are
   refused in document values, m3a decision 8). So when the strut's ends are stations or nodes on
   other bars, its direction cannot be written without restating their geometry. When the strut is
   redrawn the typed normal goes stale. It is caught, but must be retyped: the strut meets the old
   plane off square, with no `cut` declared, which is an `angled-end` error (G27's last
   variation); or its centre line leaves the shoe, which is `butt-miss`.

The brief's candidate change, letting `through: "<bar>.<end>"` use that end's plane at any angle
when the plane depends only on placement, is already the rule (§4.5, G17) and the code
(`endPlane` in `src/core/derive/ends.ts`). The missing piece is on the shoe's side: a plane that
takes its normal from another bar.

## The rule change

`ends.<a|b>.plane: { "point": <point>, "normal": "<bar>" }`: the plane through the point, square
to that bar's axis (a → b). The sign does not matter, since an end's normal is always signed to
point away from its bar (§4.5).

- **It is a placement provider.** A bar's axis follows from its design points alone, which never
  read a cut (§4.3; a free end counted from the cut has its `dir`). So the plane resolves in
  sweep 1, and a butt through that end reads it in sweep 2. There is no new dependency in stage 3,
  no iteration, and no new chain: the shoe's plane reads the strut's *axis*, never its end.
- A `normal` naming no bar is a `ref` error on the end; one naming a bar that could not be placed
  is a `ref` error ("depends on …"). Either way the end falls back to its default.
- Naming the end's own bar is allowed: it is a square cut through the point.
- Pattern copies remap the named bar, like `face.bar`, when it is in the template.

**How to write the case:**

```json
"nodes": { "n1": [540, 0, 80] },
"bars": {
  "b2": {
    "a": { "on": { "bar": "b1", "at_mm": 540, "face": "+y" } },
    "b": "n1",
    "label": "shoe",
    "ends": { "b": { "plane": { "point": "n1", "normal": "b3" }, "cut": "angle" } }
  },
  "b3": { "a": [0, 0, 800], "b": [600, 0, 0], "label": "strut" }
},
"connections": {
  "c1": { "type": "butt", "through": "b1", "ends": ["b2.a"] },
  "c2": { "type": "butt", "through": "b2.b", "ends": ["b3.b"], "spacer_mm": 8 }
}
```

The shoe's top design point and its plane's point share a node, so the shoe's height is one
number. The strut needs no `cut`, since it lands square. An end plate is the butt's `spacer_mm`,
or its connector's. Use §16's direction, the shoe through the strut's end, only when the strut's
length is the input and the shoe is cut to suit.

## G27, worked by hand

Every section is a TS40 (40 × 40) on its centre line, and the case lies in the world XZ plane.
`tests/fixtures/golden-ends/G27/by_hand.py` recomputes each number with plain arithmetic, imports
nothing from AluKit, and checks `expected.json` (**verified**: it agrees; a tampered copy of
`expected.json` makes it exit 1).

- **Beam** b1 (0,0,0)→(1000,0,0): along +X, local y is +Z, so its `+y` face is z = 20. 1000.00.
- **Shoe** b2 from (540,0,20) to n1 (540,0,80), vertical: local x is +X. End a butts through the
  beam onto z = 20 (move 0). The strut's axis is t = (600, 0, −800)/1000 = (0.6, 0, −0.8), so end
  b's plane is z = 80 + 0.75 (x − 540). It meets the shoe's x = 520 and x = 560 edges at z = 65 and
  95: **long point 75.00, centre line 60.00, short point 45.00**. The angle is acos 0.8 =
  **36.87°**.
- **Strut** b3 (0,0,800)→(600,0,0), 1000 long, its centre line through n1 at s = 900. The crossing
  is the centre of the shoe's face, well inside its prism. The plane's normal reversed is t, so
  the cut is square: **900.00**, end b moved **−100.00**.
- `spacer_mm: 8`: the plane moves 8 along the face's normal, here the strut's axis: **892.00**.
- n1 at z = 100 (a taller shoe): **95.00 / 80.00 / 65.00**. The strut meets the plane where
  −0.6 (0.6 s − 540) + 0.8 (700 − 0.8 s) = 0, at s = 884: **884.00**. The crossing (530.4, 92.8)
  is 10.4 inside the shoe's −x face.
- The strut redrawn (140,0,380)→(620,0,20), 600 long, t = (0.8, 0, −0.6), still through n1. The
  shoe's plane follows: z = 80 + (4/3)(x − 540), edges at 53.33 and 106.67, giving
  **86.67 / 60.00 / 33.33**, and acos 0.6 = **53.13°**. The strut: **500.00**, square, moved −100.00.
- The same redraw with the normal typed as `[3, 0, -4]`: the old plane still passes n1, so the
  strut crosses it inside the shoe, but cos θ = 0.6·0.8 + 0.8·0.6 = 0.96, θ = **16.26°**. With no
  `cut` declared that is an **`angled-end` error on b3.b** (refs `c2`), and the strut stays at its
  design point: **600.00**.

## Wording for the design

*Suggested; the coordinator may fold it into 2.1 rather than open a 2.2.*

**§4.5, the provider table**, the `point`/`normal` row becomes:

> | `ends.<a\|b>.plane`: `{ "point": <point>, "normal": [x, y, z] }`, or `"normal": "<bar>"` (*2.2*) | as given; with a bar, square to that bar's axis: a shoe mitred square to a strut (G27) |

**§4.5, "Placement and end providers"**, the first bullet becomes:

> - **Placement providers** depend only on placed sections and points: the default,
>   `ends.<x>.plane` as `point` and `normal` or as `face`, a `butt` through a bar's side faces or
>   through a body, `miter`, `splice`, `pivot`, and a through bar's own end (`cover`, `node`). A
>   `normal` that names a bar reads only that bar's axis, which its design points fix (§4.3), so
>   it stays a placement provider (*2.2*).

**§4.5, "Bearing on an end"**, the paragraph becomes:

> **Bearing on an end** (*2.1*). A strut that bears at an angle on a block's end face names that end
> as `through` (G17). A **shoe mitred square to a strut** (*2.2*) is cut on
> `ends.<x>.plane: { "point": <point>, "normal": "<strut>" }` with `cut: "angle"`, and the strut's
> end butts through the shoe's end, with an end plate as `spacer_mm`: the shoe's cut follows the
> strut's angle and the strut's length follows the shoe (G27). The reverse, the shoe's end
> butting through the strut's end, suits a strut whose length is the input. A flat bar whose ends
> are flush with a beam's cut ends takes `ends.<x>.plane: { "of": … }` (G18), so it follows when
> the beam's cut changes.

**§4.6**, a row after G21 (and "G27 for draft 2.2 by `golden-ends/G27/by_hand.py`" beside the
note on how G17–G26 were checked):

> | G27 | beam b1 (0,0,0)→(1000,0,0); shoe b2 from `{on: {bar: b1, at_mm: 540, face: "+y"}}` to n1 = (540,0,80), `butt` through b1, end b `plane: {point: n1, normal: "b3"}`, `cut: "angle"`; strut b3 (0,0,800)→(600,0,0), `butt` through `b2.b` | a strut bearing on a shoe mitred square to it (*2.2*) | shoe long point 75.00, centre line 60.00, short point 45.00; 36.87°. Strut 900.00, square. With `spacer_mm: 8`: 892.00. With n1 at z = 100: shoe 95.00, 80.00, 65.00; strut 884.00. Strut redrawn (140,0,380)→(620,0,20): shoe 86.67, 60.00, 33.33; 53.13°; strut 500.00. With the normal typed as (3, 0, −4), that redraw is an `angled-end` error on b3.b (16.26°) and the strut is 600.00 |

**§16, row P1**: from "One improvement:" to the end of the cell becomes:

> The findings left a shoe mitred square to a strut as a v1 exclusion. Draft 2.1 wrote it as the
> shoe's end butting through the strut's end, which leaves the strut's length typed
> (`extend_mm`); the early acceptance slice had to type it (gap G-A). *2.2*: a plane's `normal`
> may name a bar, so the shoe is cut square to the strut's axis and the strut's end butts through
> the shoe's end. Both derive, in the same two sweeps (§4.5, G27;
> [`notes/g-a-end-bearing.md`](notes/g-a-end-bearing.md))

**Changelog** (the top of the design):

> - **A shoe mitred square to a strut (gap G-A; §4.5, §16).** A plane's `normal` may name a bar:
>   square to its axis, still a placement provider. The strut's end butts through the shoe's
>   end, so both derive. Draft 2.1's construction, the shoe through the strut's end, left the
>   strut's length typed. Golden case G27.

## For other branches

- **Commands and canonical form** (M3b part 2): a string `ends.<x>.plane.normal` is now a
  reference to a bar. Renaming or deleting a bar, and any reference walk, must include it, as
  they include `face.bar` and `of`. This branch did not touch commands.
- **The acceptance slice** (internal): replacing the typed `extend_mm` with this construction
  should reproduce the record's drawn length if the record's shoe is square to its strut
  (**inferred**; not run here, since the reference frame is not in this repository).

## What changed

- `src/core/project/schema.ts`: `normal` is a vector or a `BarId`.
- `src/core/derive/ends.ts`: `axisOf`, the named bar's axis, used by the `point`/`normal` provider.
- `src/core/derive/patterns.ts`: copies remap a named normal.
- `src/core/derive/derive.test.ts`: a plane square to another bar and to its own bar, and a
  normal naming no bar.
- `tests/fixtures/golden-ends/G27/` and `src/core/golden.test.ts`: G27 joins G1–G21.

`pnpm lint`, `pnpm typecheck`, `pnpm test` (246 passed, 1 skipped) and `pnpm build` pass on
Node 26.13.1 (**verified**). G1–G25 are unchanged and pass; G26 (price bands) has no fixture on
this branch, since it is M3b part 3's.
