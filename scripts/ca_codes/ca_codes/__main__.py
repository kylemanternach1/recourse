"""CLI entry point."""

from __future__ import annotations

import logging
import sys

from .config import config_summary, load_config
from .crawl import run_crawl


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )


def main(argv: list[str] | None = None) -> None:
    config = load_config(argv)
    _setup_logging(config.verbose)

    if config.discover_codes:
        from .crawl import CodeCrawler

        crawler = CodeCrawler(config)
        try:
            slugs = crawler.discover_codes()
        finally:
            crawler.close()
        print(f"Available codes for {config.year}:")
        for slug in slugs:
            print(f"  {slug}")
        return

    if config.verbose:
        print(config_summary(config), file=sys.stderr)

    run_crawl(config)


if __name__ == "__main__":
    main()
