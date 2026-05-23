"""Configuration loading from defaults, YAML, and CLI."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .codes import PRESETS


@dataclass
class ScraperConfig:
    base_url: str = "https://law.justia.com"
    year: str = "2025"
    code_slugs: list[str] = field(default_factory=lambda: ["code-civ"])
    preset: str | None = None
    output: Path = field(default_factory=lambda: Path("data/ca_codes.jsonl"))
    output_format: str = "jsonl"  # jsonl | json
    rate_limit: float = 1.0
    workers: int = 4
    timeout: float = 30.0
    retries: int = 3
    retry_backoff: float = 1.5
    max_pages: int | None = 5
    max_sections: int | None = None
    resume: bool = True
    state_file: Path = field(default_factory=lambda: Path("data/.ca_codes_state.json"))
    cache_dir: Path | None = None
    fetch_backend: str = "auto"  # auto | requests | curl_cffi | playwright
    cookie_file: Path | None = None
    user_agent: str = (
        "Recourse-CA-Codes-Scraper/1.0 (+local research; contact: you@example.com)"
    )
    verbose: bool = False
    discover_only: bool = False
    discover_codes: bool = False

    @property
    def codes_prefix(self) -> str:
        return f"/codes/california/{self.year}/"

    def resolve_code_slugs(self) -> list[str]:
        if self.preset and self.preset != "all":
            slugs = PRESETS.get(self.preset)
            if slugs is None:
                raise ValueError(f"Unknown preset: {self.preset!r}. Choose from: {', '.join(PRESETS)}")
            return slugs
        return self.code_slugs

    def validate(self) -> None:
        if self.output_format not in ("jsonl", "json"):
            raise ValueError("output_format must be 'jsonl' or 'json'")
        if self.workers < 1:
            raise ValueError("workers must be >= 1")
        if self.rate_limit <= 0:
            raise ValueError("rate_limit must be > 0")
        if self.fetch_backend not in ("auto", "requests", "curl_cffi", "playwright"):
            raise ValueError("fetch_backend must be auto, requests, curl_cffi, or playwright")


def _merge_dict(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if value is None:
            continue
        out[key] = value
    return out


def load_yaml_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config file must be a YAML mapping: {path}")
    return data


def config_from_dict(data: dict[str, Any]) -> ScraperConfig:
    path_fields = ("output", "state_file", "cache_dir", "cookie_file")
    normalized: dict[str, Any] = {}
    for key, value in data.items():
        if key in path_fields and value is not None:
            normalized[key] = Path(value)
        else:
            normalized[key] = value
    known = set(ScraperConfig.__dataclass_fields__)
    return ScraperConfig(**{k: v for k, v in normalized.items() if k in known})


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scrape California statutory codes from Justia into JSON/JSONL.",
    )
    parser.add_argument("--config", type=Path, help="YAML config file")
    parser.add_argument("--year", help="Statutory year in Justia URLs (e.g. 2025)")
    parser.add_argument(
        "--codes",
        nargs="+",
        metavar="SLUG",
        help="Code slugs (e.g. code-civ code-ccp)",
    )
    parser.add_argument(
        "--preset",
        choices=sorted(PRESETS.keys()),
        help="Predefined code bundle (housing, small-claims, landlord-tenant, all)",
    )
    parser.add_argument("-o", "--output", type=Path, help="Output file path")
    parser.add_argument(
        "--format",
        dest="output_format",
        choices=("jsonl", "json"),
        help="Output format",
    )
    parser.add_argument(
        "--workers",
        type=int,
        help="Concurrent fetch workers (default: 4)",
    )
    parser.add_argument(
        "--rate-limit",
        type=float,
        dest="rate_limit",
        help="Max requests per second across all workers (default: 1.0)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        dest="max_pages",
        help="Stop after N pages (test mode). Omit for full crawl.",
    )
    parser.add_argument(
        "--max-sections",
        type=int,
        dest="max_sections",
        help="Stop after N sections extracted",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore saved state and start fresh",
    )
    parser.add_argument(
        "--fetch-backend",
        choices=("auto", "requests", "curl_cffi", "playwright"),
        help="HTTP backend (playwright if Cloudflare blocks you)",
    )
    parser.add_argument("--cookie-file", type=Path, help="Netscape cookie file from browser")
    parser.add_argument(
        "--discover-codes",
        action="store_true",
        help="List available code slugs for the configured year and exit",
    )
    parser.add_argument(
        "--discover-only",
        action="store_true",
        help="Discover section URLs only; do not fetch section text",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser


def load_config(argv: list[str] | None = None) -> ScraperConfig:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    data: dict[str, Any] = {}
    if args.config:
        data = load_yaml_config(args.config)

    cli_overrides = {
        "year": args.year,
        "code_slugs": args.codes,
        "preset": args.preset,
        "output": args.output,
        "output_format": args.output_format,
        "workers": args.workers,
        "rate_limit": args.rate_limit,
        "max_pages": args.max_pages,
        "max_sections": args.max_sections,
        "fetch_backend": args.fetch_backend,
        "cookie_file": args.cookie_file,
        "verbose": args.verbose if args.verbose else None,
        "discover_only": args.discover_only if args.discover_only else None,
        "discover_codes": args.discover_codes if args.discover_codes else None,
    }
    if args.no_resume:
        cli_overrides["resume"] = False

    merged = _merge_dict(data, {k: v for k, v in cli_overrides.items() if v is not None})
    config = config_from_dict(merged)
    config.validate()
    return config


def config_summary(config: ScraperConfig) -> str:
    d = asdict(config)
    d["code_slugs"] = config.resolve_code_slugs()
    lines = ["Configuration:"]
    for key in (
        "year",
        "code_slugs",
        "preset",
        "output",
        "output_format",
        "workers",
        "rate_limit",
        "max_pages",
        "max_sections",
        "resume",
        "fetch_backend",
        "state_file",
    ):
        lines.append(f"  {key}: {d.get(key)}")
    return "\n".join(lines)
