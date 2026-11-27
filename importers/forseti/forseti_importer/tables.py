"""Reviewed tables: every judgement the importer makes, in one place, so a review reads them here
instead of in the code (design §11: "from a reviewed table in the importer").

Each table says what it maps and where the mapping comes from. A product the tables do not name
is classified, counted and reported, and not emitted: the families below are the ones whose
parsing is written and checked.
"""

from __future__ import annotations

import re

#: The PDF catalogue these tables were reviewed against ("CATÁLOGO TÉCNICO 2020", 96 pages,
#: created 2022-12-12). The page tables below hold for this file only, so the build refuses any
#: other: a new edition is re-reviewed, then its hash and read date go here.
PDF = "catalogo_forsetiA4.pdf"
PDF_SHA256 = "b40759b99c8ef31aa806d655adcaaa677244844d51c8657b0ca24fa76b32831d"
PDF_READ = "2026-11-26"

# --- Products --------------------------------------------------------------------------------

#: A profile product: PF<series>-<type>[letter][-pp]-c<n>[p<n>], simple. The `-c7` (or `-C9P1`)
#: tail is not a finish (survey §1); `-pp` is the black finish.
PROFILE_SKU = re.compile(r"^(PF\d\d-\d\d[A-Z]?)(-pp)?-c\d+(?:p\d+)?$", re.I)

#: Product families by the parent's (or simple product's) SKU, exactly as the shop lists it.
#: Value: (family, kind, subtype). Families not listed here are left for M2b.
FAMILY_BY_SKU: dict[str, tuple[str, str, str | None]] = {
    "HGXX-01R-c12p2": ("rail", "bar", None),
    "HGHXX-01CA": ("carriage", "carriage", None),
    "HGWXX-01CC": ("carriage", "carriage", None),
    "PCI3-XX-XX": ("socket-screw", "fastener", "screw"),
    "PCI4-XX-XX": ("socket-screw", "fastener", "screw"),
    "PCI5-XX-XX": ("socket-screw", "fastener", "screw"),
    "PCI6-XX-XX": ("socket-screw", "fastener", "screw"),
    "PCI6-XX-ZP-XX": ("socket-screw", "fastener", "screw"),
    "PCI8-XX-XX": ("socket-screw", "fastener", "screw"),
    "PSM-X-XX": ("hex-nut", "fastener", "nut"),
    "ALM-XX-XX": ("plain-washer", "fastener", "washer"),
    "APM-X-XXX": ("spring-washer", "fastener", "washer"),
    "PAM30X-XX-XX": ("hammer-screw", "fastener", "hammer-screw"),
    "PAM408-XX-XX": ("hammer-screw", "fastener", "hammer-screw"),
    "PAM408-XXI-XX": ("hammer-screw", "fastener", "hammer-screw"),
    "PAM458-XX-XXX": ("hammer-screw", "fastener", "hammer-screw"),
    "PRT20-XX-XXX": ("t-nut", "fastener", "t-nut"),
    "PRT30-XX-XXX": ("t-nut", "fastener", "t-nut"),
    "PRT45-XX-XXX": ("t-nut", "fastener", "t-nut"),
    "PRT50-0X-XX": ("t-nut", "fastener", "t-nut"),
    "BRX16-XX-XX": ("reducing-bush", "fastener", "insert"),
    "CT100-XXX": ("bracket", "connector", "bracket"),
    "CT100-XXXX": ("bracket", "connector", "bracket"),
    "PLUXX-01": ("union-plate", "connector", "plate"),
    "PLU40-01-PP": ("union-plate", "connector", "plate"),
    "CT100-286-K30": ("bracket-kit", "kit", None),
    "CT100-388-K4050": ("bracket-kit", "kit", None),
    "CT100-388-K45B": ("bracket-kit", "kit", None),
    "CT100-788-K4080": ("bracket-kit", "kit", None),
    "CT100-888-K4590": ("bracket-kit", "kit", None),
}

#: Variation attributes (design §11): a size makes separate items, an option an item option, a
#: pack (`Unidades`) a pack, a length a stock offer. `fixings` selects the bare part ("Sem
#: Fixadores"); the "Com Fixadores" variant is a kit whose contents the shop does not state.
ATTRIBUTE_CLASS = {
    "Unidades": "pack",
    "Comprimento": "length",
    "Tamanho Guia Linear": "size",
    "Comprimento do Parafuso": "size",
    "Rosca": "size",
    "Para Parafuso": "size",
    "Rosca Interna": "size",
    "Largura da Cantoneira": "size",
    "Para Perfil": "size",
    "Opção de Fixação": "fixings",
    "Variação": "label",
}

#: Variants the shop lists that name nothing the build can model, with the reason. Each still gets
#: an offer on the item it varies (every orderable SKU maps to an offer), with no contents, and the
#: build reports it.
NOTE_SKU = {
    "PLU40-01-K": "the 'with fixings' variant; the shop does not state what the fixings are",
    "PLU40-01-PP-K": "the 'with fixings' variant, listed at a price of 0; the shop does not state what the fixings are",
}

#: Products that sell one item in different finishes, by SKU: (item, finish, describes the item).
#: The item's fields come from the product marked True; the others add their finish and offer.
FINISH_BY_SKU = {
    "PLU40-01": ("PLU40-01", "galvanised", True),
    "PLU40-01-K": ("PLU40-01", "galvanised", False),
    "PLU40-01-PP": ("PLU40-01", "black", False),
    "PLU40-01-PP-K": ("PLU40-01", "black", False),
}

#: Kit lines that name no code: the item they mean, and why. (A line's code is a pack SKU,
#: <item>-<units>, resolved by the rule that gives item ids.)
KIT_LINE_FIXES = {
    ("CT100-788-K4080", "Arruela de Pressão M8"): (
        "APM-8",
        "the line names no code; its sibling kits list APM-8-10 for the same line",
    ),
}

# --- Profiles ----------------------------------------------------------------------------------

#: Profile pages that give the length range and tolerance but not the price step ("Cada 10mm de
#: corte consome 1 unidade"): the step, and why.
CUT_STEP_FIX = {
    "PF45-11-C6": (10, "the page states no price step; every other cut-to-length profile page says 10 mm"),
}

#: Series and slot class (from the name's "Canal <n>") → the system and groove type ids, and the
#: system's name.
SYSTEMS = {
    (20, 6): ("s20-c6", "c6-20", "Base 20, canal 6"),
    (30, 8): ("s30-c8", "c8-30", "Base 30, canal 8"),
    (40, 8): ("s40-c8", "c8-40", "Base 40, canal 8"),
    (45, 10): ("s45-c10", "c10-45", "Base 45, canal 10"),
    (45, 8): ("s45-c8", "c8-45", "Base 45, canal sextavado M8"),
    # The 50x50 (p. 20) draws no section the build can read. The shop says it uses canal 8 fixings
    # and mixes with bases 40 and 45, so it takes base 40's measured canal-8 groove: an assumption,
    # said in the system's name and in the section's note.
    (50, 8): ("s50-c8", "c8-40", "Base 50, canal 8 (groove of base 40 assumed)"),
}

#: Slot classes the name does not give as "Canal <n>": the 45x90 econômico is "Canal Sextavado
#: M8", a slot for M8 hex heads and nuts, printed 8.3 mm wide (p. 19).
SLOT_BY_STEM = {"PF45-12": 8, "PF30-01C": 8, "PF30-01F": 8}

#: Where each groove type is measured: on the exact outline of one profile, at one groove.
#: (face, centre along the face). The opening is cross-checked against the printed value.
GROOVE_SOURCE = {
    "c6-20": {"profile": "PF20-14", "face": "+y", "at_mm": 0, "printed_opening_mm": 6, "page": 11},
    "c8-30": {"profile": "PF30-02", "face": "+x", "at_mm": 15, "printed_opening_mm": 8.2, "page": 15},
    "c8-40": {"profile": "PF40-01", "face": "+y", "at_mm": 0, "printed_opening_mm": 8.19, "page": 16},
    "c10-45": {"profile": "PF45-02", "face": "+x", "at_mm": 22.5, "printed_opening_mm": 10.2, "page": 18},
    "c8-45": {"profile": "PF45-12", "face": "+x", "at_mm": 22.5, "printed_opening_mm": 8.3, "page": 19},
}

#: Profile stems this import emits, with what the shop's name does not say.
#:
#: - `w`, `h`: the section's width (x) and height (y). A name "AxB" is A wide and B tall, so
#:   sections stand tall.
#: - `drawn`: the catalogue drawing's width and height. When they are swapped against (w, h), the
#:   vector outline is turned 90° into the section frame.
#: - `outline`: the half of the page holding the vector outline, when the page has one
#:   (survey §4); otherwise `bores` makes a parametric T-slot envelope.
#: - `bore`: the core bore's diameter as printed on the drawing; `bores`: their centres in the
#:   section frame, for the parametric envelope.
#: - `cores` (exact outlines): every bore diameter the drawing prints, with how many holes have it.
#:   The build finds them among the outline's holes by their inscribed circle (CORE_MATCH_MM) and
#:   fails unless each count is met: geometry alone cannot tell a core from a pocket, so the
#:   printed diameter says which holes are cores (docs/notes/section-cores.md).
#: - `corners` (parametric): the profile has the base-40 corner holes (CORNER_HOLES), as its page
#:   draws them.
#:
#: The printed IX and IY do not follow the drawing: for every rectangular profile the catalogue
#: gives IX about the axis along the long side (the weak axis) and IY about the other. Checked
#: against the five rectangular vector outlines: the 20x60 is drawn standing and the 30x60, 45x90
#: and 45x90 econômico lying, and in each IX is the weak axis (p. 11, 15, 18, 19). Sections here
#: stand tall, so IX goes to Iy_mm4 and IY to Ix_mm4. Square profiles print one value for both.
PROFILES: dict[str, dict] = {
    # Each `cores` is what the page prints: "Ø4,6 (M5)" on p. 11, "Ø12,1 (M14)" on p. 15,
    # "Ø12,10" on p. 14 (its four 3.5 mm corner cells are square, with no diameter), "Ø13,70" on
    # p. 16 (the 40x40 leve's four corner cells are square too), "Ø13,70" and "Ø5" on p. 16,
    # "Ø13,7" and "Ø5" on p. 21, "Ø13,7 (M16)" on p. 18. The 45x90 econômico's drawing prints no
    # diameter: Ø6,50 is the 45x45 econômico's above it on p. 19, the same series' core.
    "PF20-14": {
        "page": 11, "w": 20, "h": 60, "drawn": (20, 60), "outline": "bottom", "bore": 4.6,
        "cores": {4.6: 3},
    },
    "PF30-02": {
        "page": 15, "w": 30, "h": 60, "drawn": (60, 30), "outline": "bottom", "bore": 12.1,
        "cores": {12.1: 2},
    },
    "PF30-04": {
        "page": 14, "w": 30, "h": 30, "drawn": (30, 30), "outline": "bottom", "bore": 12.1,
        "cores": {12.1: 1},
    },
    "PF40-00": {
        "page": 16, "w": 40, "h": 40, "drawn": (40, 40), "outline": "top", "bore": 13.7,
        "cores": {13.7: 1},
    },
    "PF40-01": {
        "page": 16, "w": 40, "h": 40, "drawn": (40, 40), "outline": "bottom", "bore": 13.7,
        "cores": {13.7: 1, 5: 4},
    },
    "PF40-02": {
        "page": 17, "w": 40, "h": 80, "drawn": (80, 40), "bore": 13.7,
        "bores": [(0, -20), (0, 20)], "corners": True,
    },
    "PF40-03": {
        "page": 21, "w": 80, "h": 80, "drawn": (80, 80), "outline": "top", "bore": 13.7,
        "cores": {13.7: 4, 5: 4},
    },
    "PF40-03B": {
        "page": 20, "w": 80, "h": 80, "drawn": (80, 80), "bore": 13.7,
        "bores": [(-20, -20), (20, -20), (-20, 20), (20, 20)], "corners": True,
    },
    "PF40-04": {
        "page": 17, "w": 40, "h": 40, "drawn": (40, 40), "bore": 13.7, "bores": [(0, 0)],
        "corners": True,
    },
    "PF45-02": {
        "page": 18, "w": 45, "h": 90, "drawn": (90, 45), "outline": "bottom", "bore": 13.7,
        "cores": {13.7: 2},
    },
    "PF45-12": {
        "page": 19, "w": 45, "h": 90, "drawn": (90, 45), "outline": "bottom", "bore": 6.5,
        "cores": {6.5: 2},
    },
    # M2b: the other stems. Their pages draw raster images (or none), so the sections are T-slot
    # envelopes from the printed size and core bore. Extra keys:
    # - `printed`: the catalogue code whose table gives A, IX, IY and mass (default the stem);
    #   None when no table is usable.
    # - `page`: the catalogue page that draws the profile, or None.
    # - `bore`: None when the core is not known. `bores` defaults to one bore at the centre.
    # - `approx`: what the envelope leaves out; it goes into the section's note.
    "PF20-11": {
        "page": 10, "w": 20, "h": 20, "bore": 5,
        "approx": "p. 10 prints the core Ø5 (M6); the shop's description gives a 4,6 mm centre for M5",
    },
    "PF20-11C": {
        "page": None, "w": 20, "h": 20, "bore": 4.6, "printed": None,
        "approx": "the catalogue has no drawing or table of the corner (de canto) variant; modelled as the plain 20x20 V-slot",
    },
    "PF20-11F": {
        "page": None, "w": 20, "h": 20, "bore": 4.6, "printed": None,
        "approx": "the catalogue has no drawing or table of the face (de face) variant; modelled as the plain 20x20 V-slot",
    },
    "PF20-12": {
        "page": 11, "w": 20, "h": 40, "bore": 5, "bores": [(0, -10), (0, 10)],
        "approx": "p. 11 prints the cores Ø5 (M6), as p. 10 does the 20x20 V-slot's; the shop's description says M5",
    },
    "PF20-13": {
        "page": 12, "w": 40, "h": 80, "bore": 4.6,
        # Drawn lying 80 x 40, with four bores along the bottom and one in each ear; turned 90°
        # counter-clockwise into the section frame, as the 20x60's outline is.
        "bores": [(10, -30), (10, -10), (10, 10), (10, 30), (-10, -30), (-10, 30)],
        "approx": "one V-slot groove per 20 mm cell on every face; the open channel between the ears is not modelled",
    },
    "PF20-15": {
        "page": None, "w": 40, "h": 40, "bore": 4.6, "printed": None,
        "approx": "the catalogue does not list this 40x40 V-slot; the shop gives the 4.6 mm centre bore, and the hollow centre is not modelled",
    },
    "PF20-21": {"page": 10, "w": 20, "h": 20, "bore": 6, "printed": "PF20-01"},
    "PF30-01": {"page": 13, "w": 30, "h": 30, "bore": 12.1},
    "PF30-01C": {
        "page": 14, "w": 30, "h": 30, "bore": 12.1,
        "approx": "the closed faces of the corner (de canto) variant are not modelled",
    },
    "PF30-01F": {
        "page": 13, "w": 30, "h": 30, "bore": 12.1,
        "approx": "the closed face of the face (de face) variant is not modelled",
    },
    "PF30-01R": {
        "page": 15, "w": 30, "h": 30, "bore": 12.1,
        "approx": "the rounded (abaulado) corners are not modelled",
    },
    "PF30-11": {"page": 12, "w": 30, "h": 30, "bore": 6.8},
    "PF40-11": {
        "page": None, "w": 40, "h": 40, "bore": 6.8, "printed": None,
        "approx": "the catalogue does not list this profile; the 6.8 mm bore is the M8 centre of the 30x30 economy profile (p. 12)",
    },
    "PF45-01": {"page": 18, "w": 45, "h": 45, "bore": 13.7},
    "PF45-11": {"page": 19, "w": 45, "h": 45, "bore": 6.5},
    "PF50-01": {
        "page": 20, "w": 50, "h": 50, "bore": 13.7, "printed": None,
        "approx": "p. 20 prints this profile's table with the 45x90 economy's values, so none is taken; it draws the centre core Ø13,70 (M16)",
    },
}

#: The base-40 corner holes: a Ø5 (M6) bore near each outer corner, centred `inset` mm in from
#: both faces. Printed: "Ø5" on pp. 16, 17, 20 and 21, "(M6)" on p. 20, the 4,5 inset on pp. 17
#: and 20, and 31 between the 40x40 básico's on p. 16 (40 − 2 × 4.5). The build measures them on
#: the exact outlines `measured_on` and fails unless they are there; the profiles marked `corners`
#: take them.
CORNER_HOLES = {"d": 5, "inset": 4.5, "measured_on": ["PF40-01", "PF40-03"], "threads": ["M6"]}

#: The threads the vendor labels each profile's module cores with (design §5.5: a labelled thread
#: fits its core), and where it says so: a page whose drawing prints the label ("Ø13,7 (M16)"),
#: else "shop", the product description ("Centro permite rosca: M16"; the build checks each such
#: label is in it). A drawing's label wins over the shop's: PF20-11's and PF20-12's drawings print
#: Ø5 (M6) where the shop says M5, and the 20x20's description gives a 4,6 mm centre, not the
#: drawing's core. PF20-21's description names two, "M5 / M6"; its drawing (PF20-01's, p. 10)
#: prints Ø6 and no thread. The base-40 corner holes take CORNER_HOLES' "(M6)", printed on p. 20.
#: Every profile with a bore has an entry.
CORE_THREADS: dict[str, tuple[list[str], str]] = {
    "PF20-11": (["M6"], "p. 10"),
    "PF20-11C": (["M5"], "shop"),
    "PF20-11F": (["M5"], "shop"),
    "PF20-12": (["M6"], "p. 11"),
    "PF20-13": (["M5"], "shop"),
    "PF20-14": (["M5"], "p. 11"),
    "PF20-15": (["M5"], "shop"),
    "PF20-21": (["M5", "M6"], "shop"),
    "PF30-01": (["M14"], "p. 13"),
    "PF30-01C": (["M14"], "shop"),
    "PF30-01F": (["M14"], "shop"),
    "PF30-01R": (["M14"], "p. 15"),
    "PF30-02": (["M14"], "p. 15"),
    "PF30-04": (["M16"], "shop"),
    "PF30-11": (["M8"], "p. 12"),
    "PF40-00": (["M16"], "shop"),
    "PF40-01": (["M16"], "shop"),
    "PF40-02": (["M16"], "shop"),
    "PF40-03": (["M16"], "shop"),
    "PF40-03B": (["M16"], "p. 20"),
    "PF40-04": (["M16"], "shop"),
    "PF40-11": (["M8"], "shop"),
    "PF45-01": (["M16"], "shop"),
    "PF45-02": (["M16"], "p. 18"),
    "PF45-11": (["M8"], "shop"),
    "PF45-12": (["M8"], "shop"),
    "PF50-01": (["M16"], "p. 20"),
}

#: A hole of an exact outline is a printed core when its inscribed circle (about its centroid) is
#: within this of the printed diameter, in mm. The outlines are their strokes' centre lines and
#: draw round bores as polygons: PF45-12's 19-sided Ø6.5 cores measure 6.378, the farthest.
CORE_MATCH_MM = 0.15

#: A core's centre is written to this grid (mm), the drawings' own: they dimension positions to
#: 0.1 mm at best (4,5; 22,10). The build fails if a measured centre is farther than
#: CORE_GRID_SLACK_MM from it; the farthest is 0.015 (PF40-03's corner holes).
CORE_GRID_MM = 0.1
CORE_GRID_SLACK_MM = 0.03

#: Grooves: one centred on each series cell along each face (a 40x80 has two on each long face
#: and one on each short face), as every profile drawn on pp. 11–21 shows.

# --- Hardware text --------------------------------------------------------------------------------

#: Description phrases that say how a T-nut or hammer screw goes into the groove.
INSERTION = {
    "Montagem pela ponta do perfil": "slide-in",
    "Montagem pela face do perfil": "drop-in",
}

#: Dimension letters in the descriptions' per-code tables ("cod: ALM-8 Parafuso: M8 A: 8,4 B: 17
#: Espessura: 1,6"), by family: the description's label → the dims key (ISO letters).
DIMS = {
    "plain-washer": {"A": "d1_mm", "B": "d2_mm", "Espessura": "h_mm"},
    "spring-washer": {"A": "d1_mm", "B": "d2_mm", "Espessura": "h_mm"},
    "hex-nut": {"B": "s_mm", "C": "m_mm", "PASSO (mm)": "pitch_mm"},
}

#: Catalogue pages of the hardware families, for `docs`: the page whose "COD:" heading names the
#: family (CT100-XXX "base simples" on p. 34 and "base dupla" on p. 35; PRTXX-XX "bloco corrediço
#: - porca T" on p. 56; PAMXXX-XX "parafuso martelo - canal 8" on p. 58; PCIX-XX on p. 62).
FAMILY_PAGES = {
    "union-plate": [29],
    "plain-washer": [53],
    "spring-washer": [53],
    "hex-nut": [53],
    "t-nut": [56],
    "hammer-screw": [58],
    "socket-screw": [62],
    "reducing-bush": [41],
}
ITEM_PAGES = {
    "CT100-286": [34],
    "CT100-388": [34],
    "CT100-788": [35],
    "CT100-888": [35],
}

# --- Material ----------------------------------------------------------------------------------

#: Catalogue p. 6: "LIGA: 6063 (DIN AlMgSi 0,5)", "TRATAMENTO TÉRMICO: T5", density, modulus.
MATERIAL_PAGE = 6

# --- The rest of the catalogue (M2b) -------------------------------------------------------------

#: Every product the tables above do not name (profiles, the M2a hardware families and kits) is
#: classified by the first rule that matches it: (field, pattern, kind, subtype). `field` is the
#: parent's `name`, `sku` or a shop `category`, matched from the start, case-insensitively. A kind
#: the data cannot support falls back to `generic` (a connector with no system it fits, a panel
#: with no thickness). Everything no rule names is `generic`: electronics, tools, ball screws,
#: bearings, pulleys, belts, cable chains and so on (design §3.4).
KIND_RULES: list[tuple[str, str, str, str | None]] = [
    # Kits of several parts: the contents the shop lists are not all items of this catalog, so a
    # kit not in FAMILY_BY_SKU is one generic item with its price and no contents.
    ("name", r"kit\b", "generic", None),
    ("name", r"tela\b", "generic", None),
    ("sku", r"TDN35", "generic", None),
    # Panels: sheets, their sizes are offers.
    ("category", r"Chapas e Telas", "panel", None),
    # Fasteners.
    ("name", r"parafuso martelo", "fastener", "hammer-screw"),
    ("name", r"parafuso (franc[eê]s|.*sextavada)", "fastener", "bolt"),
    ("name", r"parafuso", "fastener", "screw"),
    ("name", r"porca (martelo|de encaixe|t |corredi[cç]a|retangular|meia cana)", "fastener", "t-nut"),
    ("name", r"porca", "fastener", "nut"),
    ("name", r"arruela", "fastener", "washer"),
    ("name", r"rebite roscado", "fastener", "rivet-nut"),
    ("name", r"chumbador", "fastener", "anchor"),
    ("name", r"bucha de redu[cç][aã]o", "fastener", "insert"),
    # Connectors.
    ("name", r"(cantoneira|conector cantoneira)", "connector", "bracket"),
    ("name", r"conex[aã]o interna", "connector", "end-connector"),
    ("name", r"(conex[aã]o de topo|cubo de conex)", "connector", "cube"),
    ("name", r"conector", "connector", "end-connector"),
    ("sku", r"(PL|PLT|PLQ|CA40|SFX|CFF20)[-0-9A-Z]*", "connector", "plate"),
    ("sku", r"PMV0\d-0\d-XX", "connector", "plate"),
    ("sku", r"JAXX-XX-XX", "connector", "hinge"),
    # Accessories.
    ("name", r"rod[ií]zio", "accessory", "caster"),
    ("name", r"p[eé] (nivelador|articulado)", "accessory", "foot"),
    ("name", r"sapata", "accessory", "shoe"),
    ("name", r"dobradi[cç]a", "accessory", "hinge"),
    ("name", r"(man[ií]pulo|perfil man[ií]pulo)", "accessory", "handle"),
    ("name", r"capa de fechamento", "accessory", "cap"),
    ("name", r"tira pl[aá]stica", "accessory", "strip"),
    ("name", r"borracha", "accessory", "gasket"),
    ("name", r"bucha pl[aá]stica", "accessory", "bush"),
    ("name", r"placa (roscada|retangular|para fixa)", "accessory", "threaded-plate"),
    ("name", r"bloco pl[aá]stico", "accessory", "block"),
    ("name", r"fecho", "accessory", "latch"),
    ("name", r"batente de borracha", "accessory", "bumper"),
]

#: A `generic` item's `category`, by the first rule that matches: (field, pattern, category).
#: The Tecmaf line is split by what each part is; promotions and finish tags are not categories of
#: a part.
CATEGORY_RULES: list[tuple[str, str, str]] = [
    ("name", r"(kit|trilho guia linear)\b", "kit"),
    ("name", r".*(inversor|m[oó]dulo|driver|shield|arduino|fonte|cabo wire|cartucho|mesa aquecida|rfid|"
             r"chave fim|motor de passo|damper|placa de desenvolvimento)", "electronics"),
    ("category", r"Eletrônicos", "electronics"),
    ("category", r"Ferramentas", "tools"),
    ("category", r"Esteiras Porta Cabos", "cable-chain"),
    ("category", r"Roldanas", "roller"),
    ("category", r"Polias", "pulley"),
    ("category", r"Atuadores", "actuator"),
    ("category", r"Deslizantes", "slider"),
    ("category", r"Trilhos Flow Rack", "flow-rack"),
    ("category", r"Projetos Especiais", "special-project"),
    ("name", r".*(fuso|castanha)", "screw-drive"),
    ("name", r".*(correia|polia|grampo para correia|fixador emenda)", "belt-drive"),
    ("name", r".*(engrenagem|pinh[aã]o|cremalheira|redutor|acoplamento)", "drivetrain"),
    ("name", r".*(rolamento|mancal|bucha deslizante|bucha de bronze|pillow|suporte s|eixo linear|"
             r"guia linear|trilho guia|patins|bloco deslizante|espa[cç]ador)", "linear-bearing"),
    ("name", r".*(painel solar|vigamento)", "solar-and-fixings"),
    ("name", r"tela\b", "mesh"),
    ("name", r"(perfil t-track|perfil trilho)", "profile-stock"),
    ("name", r"chapa\b", "plate"),
    ("category", r"Movimentação Linear", "linear-motion"),
    ("category", r"Tecmaf", "linear-motion"),
    ("category", r"Cantoneiras|Conectores|Chapas de fixação", "connector"),
]

#: A pack the shop writes in words: "Par" is two units; "<n>un" is n.
PACK_WORDS = {"Par": 2, "1 Kit": 1}

#: Attributes that give a numeric published dimension, in mm, of the item: the attribute → the
#: dims key. Only values that start with a number of mm are taken.
DIM_ATTRIBUTES = {
    "Diâmetro": "d_mm",
    "Comprimento": "length_mm",
    "Comprimento do Fuso": "length_mm",
    "Passo": "pitch_mm",
    "Furo Central": "bore_mm",
    "Para Eixos": "shaft_d_mm",
    "Perímetro Total": "perimeter_mm",
    "Largura da Cantoneira": "width_mm",
    "Tamanho Guia Linear": "rail_width_mm",
}

#: Systems a part fits when its name does not say but a sibling product does, by parent SKU.
FITS_BY_PARENT = {
    "CBF40-01": (["s40-c8"], "the name says 'Fixação 40' and the sibling kit CBF40-XX-K40 says base 40"),
}

#: Profile bases in a name or attribute → the T-slot systems they fit; a "Canal <n>" alone names
#: every system of that slot class. 45 is the básico (canal 10) unless the text says parafuso or
#: econômico; 80x80 profiles are base 40.
BASE_SYSTEMS = {
    20: ["s20-c6"],
    30: ["s30-c8"],
    40: ["s40-c8"],
    45: ["s45-c10"],
    50: ["s50-c8"],
    80: ["s40-c8"],
}
CHANNEL_SYSTEMS = {
    6: ["s20-c6"],
    8: ["s30-c8", "s40-c8", "s45-c8", "s50-c8"],
    10: ["s45-c10"],
}
