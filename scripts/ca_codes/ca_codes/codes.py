"""California code slug metadata."""

from __future__ import annotations

# Slug -> short citation abbreviation (Bluebook-style, best effort).
CODE_ABBREV: dict[str, str] = {
    "code-bpc": "Bus. & Prof.",
    "code-civ": "Civ.",
    "code-com": "Com.",
    "code-corp": "Corp.",
    "code-edc": "Educ.",
    "code-elec": "Elec.",
    "code-evid": "Evid.",
    "code-fam": "Fam.",
    "code-fgc": "Fish & Game",
    "code-fac": "Food & Agric.",
    "code-gov": "Gov.",
    "code-hnc": "Harb. & Nav.",
    "code-hsc": "Health & Safety",
    "code-ins": "Ins.",
    "code-lab": "Lab.",
    "code-mvc": "Mil. & Vet.",
    "code-pcc": "Pub. Cont.",
    "code-pen": "Pen.",
    "code-prob": "Prob.",
    "code-prc": "Pub. Res.",
    "code-puc": "Pub. Util.",
    "code-rtc": "Rev. & Tax.",
    "code-shc": "Streets & Highways",
    "code-uic": "Unemp. Ins.",
    "code-veh": "Veh.",
    "code-wat": "Water",
    "code-wic": "Welf. & Inst.",
    "code-ccp": "C.C.P.",
    "code-cc": "Const.",
    "code-cp": "C.P.",
}

# Common housing / small-claims presets.
PRESETS: dict[str, list[str]] = {
    "housing": ["code-civ", "code-hsc"],
    "small-claims": ["code-civ", "code-ccp"],
    "landlord-tenant": ["code-civ"],
    "all": [],  # discovered at runtime
}


def format_citation(code_slug: str, section_num: str) -> str:
    abbrev = CODE_ABBREV.get(code_slug, code_slug.replace("code-", "").upper())
    return f"Cal. {abbrev} Code § {section_num}"
