"""Bounded downtown facade recipes; dimensions are architectural estimates.

No random IDs or colours participate in the choice. Known buildings select a
material recipe; remaining towers use available use, era, height and plan data.
These are shared infill recipes, not a claim to have surveyed every window.
Authored landmark geometry supplies their individual crowns and major reveals.
"""
import re

# metres, opening height/width. Eight shared grids keep atlas work bounded.
# `base` also chooses the existing renderer's glazing share and night occupancy.
GRIDS = {
    "office_fine": dict(base="tg", pitch=3.9, bay=1.55, aspect=2.05),
    "office_wide": dict(base="tg", pitch=4.2, bay=2.65, aspect=1.10),
    "office_ribbon": dict(base="tg", pitch=3.65, bay=3.8, aspect=0.63),
    "residential_glass": dict(base="tg", pitch=3.15, bay=3.25, aspect=0.90),
    "residential_punched": dict(base="tr", pitch=3.05, bay=3.15, aspect=1.70),
    "hotel": dict(base="tr", pitch=3.35, bay=3.75, aspect=1.75),
    "stone_vertical": dict(base="mh", pitch=3.8, bay=2.15, aspect=2.65),
    "historic": dict(base="mh", pitch=3.7, bay=3.0, aspect=1.85),
}

# Palette values are tuning inputs for the shared facade painter, not sampled
# photographs. Preserve the distinct cool/silver/green/bronze/stone character.
_RECIPES = [
    ("office_blue", "office_fine", "#7597ad"),
    ("office_silver", "office_wide", "#a1b0b7"),
    ("office_teal", "office_fine", "#658f92"),
    ("office_dark", "office_fine", "#405867"),
    ("office_bronze", "office_ribbon", "#8e8070"),
    ("office_ribbon", "office_ribbon", "#829da2"),
    ("residential_blue", "residential_glass", "#85a7b3"),
    ("residential_silver", "residential_glass", "#adb9bc"),
    ("residential_teal", "residential_glass", "#789f9c"),
    ("residential_white", "residential_punched", "#d0cbc1"),
    ("residential_warm", "residential_punched", "#b8a28d"),
    ("hotel_light", "hotel", "#c4bcac"),
    ("hotel_dark", "hotel", "#7a8287"),
    ("stone_sand", "stone_vertical", "#b8a28a"),
    ("stone_pale", "stone_vertical", "#c6c4b9"),
    ("historic_brick", "historic", "#a78b76"),
    ("parking_deck", "parking_deck", "#aaa69e"),
]


def _scale(colour, factors):
    rgb = [int(colour[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{max(0, min(255, round(v * f))):02x}"
                         for v, f in zip(rgb, factors))


PROFILES = {
    key: dict(grid=grid, base="dk" if grid == "parking_deck" else GRIDS[grid]["base"], wd=colour,
              wg=_scale(colour, (1.035, 1.015, 0.97)),
              wn=_scale(colour, (0.28, 0.31, 0.36)))
    for key, grid, colour in _RECIPES
}

# Public building names only. A name selects material/use, never position.
# Exact geometry and individual mullion details belong to downtown_landmarks.
LANDMARK_PROFILES = {
    "the independent": "residential_blue", "the austonian": "residential_teal",
    "frost bank tower": "office_blue", "360 condominiums": "residential_silver",
    "360 condominium": "residential_silver", "360 condos": "residential_silver",
    "block 185": "office_teal", "sixth and guadalupe": "office_silver",
    "waterline": "office_teal", "modern austin residences": "residential_silver",
    "the modern": "residential_silver", "natiivo": "residential_white",
    "70 rainey": "residential_teal", "northshore": "residential_blue",
    "seaholm": "residential_silver", "colorado tower": "office_dark",
    "one american center": "stone_sand", "100 congress": "office_bronze",
    "jw marriott": "hotel_light", "fairmont": "office_blue",
    "w hotel": "hotel_dark", "w austin": "hotel_dark", "block 21": "hotel_dark",
    "the republic": "office_blue", "atx tower": "residential_silver",
    "415 colorado": "residential_silver", "44 east": "residential_teal",
    "paseo": "residential_blue", "the travis": "residential_blue",
    "indeed tower": "office_silver",
    "austin proper": "residential_warm", "the bowie": "residential_blue",
    "four seasons": "residential_warm", "hilton": "hotel_light",
    "westin": "hotel_dark", "austin centre": "stone_pale",
    "300 west sixth": "office_ribbon", "301 congress": "office_ribbon",
    "littlefield": "historic_brick", "stephen f austin": "historic_brick",
}


def profile_for(name, cls, h, area, era=None, levels=None, width=None):
    """Return a PROFILES key, with explicit metadata ahead of morphology.

    Missing era stays unknown; the fallback does not invent a construction
    year. Height and footprint only provide a plausible architectural family.
    """
    name = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower())
    name = " ".join(name.split())
    for landmark, profile in LANDMARK_PROFILES.items():
        if landmark in name:
            return profile
    use = ((cls or "") + " " + name).lower()
    try:
        year = int(str(era)[:4]) if era else None
    except (TypeError, ValueError):
        year = None
    h, area = float(h or 0), float(area or 0)
    wall = float(width or area ** 0.5)
    if re.search(r"parking|garage|carport", use):
        return "parking_deck"
    if year and year < 1945:
        return "historic_brick"
    if re.search(r"hotel|motel|marriott|hyatt|suites", use):
        return "hotel_light" if h < 110 else "hotel_dark"
    if re.search(r"apartment|condo|residen|dorm|student", use):
        if year and year < 1990:
            return "residential_warm"
        if h < 85:
            return "residential_white"
        return "residential_silver" if wall < 35 else "residential_blue"
    if year and year < 1985:
        return "stone_sand" if wall < 45 else "office_bronze"
    if re.search(r"government|civic|public|hospital|university|courthouse", use):
        return "stone_pale"
    if h < 35 and re.search(r"retail|shop|store|restaurant|bar", use):
        # A masonry storefront recipe; this does not assert a historic date.
        return "historic_brick"
    if re.search(r"office|commercial|bank|financial", use):
        if h < 45:
            return "stone_pale"
        return "office_blue" if wall < 48 else "office_ribbon"
    if levels and h / max(1, float(levels)) < 3.5 and h > 90:
        return "residential_blue"
    if h > 140 and wall < 38:
        return "residential_silver"
    if h > 105:
        return "office_teal" if wall < 50 else "office_silver"
    if h < 18 and area < 600:
        return "historic_brick"
    return "stone_pale" if h < 70 and area < 1100 else "office_ribbon"
