"""Parse Justia code index and section pages."""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .codes import format_citation

SECTION_RE = re.compile(r"/section-[^/]+/?$")
CODE_SLUG_RE = re.compile(r"^code-[a-z]+$")


def is_section_url(url: str) -> bool:
    return bool(SECTION_RE.search(urlparse(url).path))


def normalize_url(url: str) -> str:
    url = url.split("#")[0]
    return url if url.endswith("/") else f"{url}/"


def code_slug_from_url(url: str) -> str:
    parts = urlparse(url).path.strip("/").split("/")
    return next((p for p in parts if p.startswith("code-")), "")


def section_num_from_url(url: str) -> str:
    parts = urlparse(url).path.strip("/").split("/")
    sec_part = next((p for p in parts if p.startswith("section-")), "")
    return sec_part.replace("section-", "").replace("-", ".") if sec_part else ""


def hierarchy_from_url(url: str, year: str) -> list[str]:
    parts = urlparse(url).path.strip("/").split("/")
    return [
        p
        for p in parts
        if p not in ("codes", "california", year)
        and not p.startswith("section-")
        and not p.startswith("code-")
    ]


def child_links(url: str, soup: BeautifulSoup, base_url: str, codes_prefix: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = normalize_url(urljoin(url, anchor["href"]))
        if not href.startswith(base_url):
            continue
        path = urlparse(href).path
        if codes_prefix not in path:
            continue
        if href not in seen:
            seen.add(href)
            out.append(href)
    return out


def discover_code_slugs(soup: BeautifulSoup, base_url: str, year: str) -> list[str]:
    prefix = f"/codes/california/{year}/"
    slugs: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = urljoin(base_url, anchor["href"])
        path = urlparse(href).path
        if prefix not in path:
            continue
        for part in path.split("/"):
            if CODE_SLUG_RE.match(part):
                slugs.add(part)
    return sorted(slugs)


def parse_section(url: str, soup: BeautifulSoup, year: str) -> dict | None:
    h1 = soup.find("h1")
    heading = h1.get_text(" ", strip=True) if h1 else ""

    code_slug = code_slug_from_url(url)
    section_num = section_num_from_url(url)
    breadcrumb = hierarchy_from_url(url, year)

    container = (
        soup.find("div", id="codes-content")
        or soup.find("div", class_="codes-content")
        or soup.find("div", class_="text-block")
        or soup.find("article")
        or soup.find("main")
    )
    if container:
        for junk in container.select(
            "nav, .breadcrumbs, .related, .social, script, style, .notice"
        ):
            junk.decompose()
        text = container.get_text("\n", strip=True)
    else:
        text = ""

    if not text.strip():
        return None

    return {
        "jurisdiction": "CA",
        "code": code_slug,
        "section": section_num,
        "citation": format_citation(code_slug, section_num),
        "heading": heading,
        "hierarchy": breadcrumb,
        "text": text,
        "year": year,
        "source_url": url,
    }
