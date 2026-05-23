"""Concurrent crawl orchestration."""

from __future__ import annotations

import json
import logging
import sys
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

from .config import ScraperConfig
from .fetch import FetchResult, RateLimiter, RequestsFetcher
from .parse import (
    child_links,
    discover_code_slugs,
    is_section_url,
    normalize_url,
    parse_section,
)
from .state import StateStore

log = logging.getLogger(__name__)


class SectionWriter:
    def __init__(self, output: Path, output_format: str) -> None:
        self.output = output
        self.output_format = output_format
        self._lock = threading.Lock()
        self._written_urls: set[str] = set()
        self.output.parent.mkdir(parents=True, exist_ok=True)
        if output_format == "jsonl" and output.exists():
            self._load_existing_urls()

    def _load_existing_urls(self) -> None:
        with self.output.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    url = rec.get("source_url")
                    if url:
                        self._written_urls.add(normalize_url(url))
                except json.JSONDecodeError:
                    continue

    @property
    def count(self) -> int:
        return len(self._written_urls)

    def write(self, record: dict) -> bool:
        url = normalize_url(record["source_url"])
        with self._lock:
            if url in self._written_urls:
                return False
            if self.output_format == "jsonl":
                with self.output.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            self._written_urls.add(url)
            return True

    def finalize_json_array(self, target: Path) -> None:
        records: list[dict] = []
        with self.output.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        target.write_text(
            json.dumps(records, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


class CodeCrawler:
    def __init__(self, config: ScraperConfig) -> None:
        self.config = config
        self.limiter = RateLimiter(config.rate_limit)
        self.fetcher = RequestsFetcher(config, self.limiter)
        self.state_store = StateStore(config.state_file)
        self.writer = SectionWriter(config.output, config.output_format)
        self._stop = threading.Event()
        self._pages = 0
        self._pages_lock = threading.Lock()

    def close(self) -> None:
        self.fetcher.close()

    def _inc_pages(self) -> bool:
        with self._pages_lock:
            if self.config.max_pages is not None and self._pages >= self.config.max_pages:
                return False
            self._pages += 1
            self.state_store.state.pages_fetched = self._pages
            return True

    def _should_stop(self) -> bool:
        if self._stop.is_set():
            return True
        if self.config.max_sections is not None and self.writer.count >= self.config.max_sections:
            return True
        return False

    def discover_codes(self) -> list[str]:
        url = f"{self.config.base_url}/codes/california/{self.config.year}/"
        result = self.fetcher.get(url)
        if not result:
            raise RuntimeError(f"Could not fetch code index: {url}")
        return discover_code_slugs(result.soup, self.config.base_url, self.config.year)

    def crawl(self, code_slugs: list[str]) -> None:
        if not self.config.resume:
            if self.config.state_file.exists():
                self.config.state_file.unlink()
            out = self.config.output
            if self.config.output_format == "json":
                out = out.with_suffix(".jsonl")
            if out.exists():
                out.unlink()

        if self.config.resume:
            self.state_store.load()
            self._pages = self.state_store.state.pages_fetched

        json_target = self.config.output
        if self.config.output_format == "json":
            # Stream to .jsonl sidecar during crawl, merge to .json at end.
            jsonl_path = self.config.output.with_suffix(".jsonl")
            self.writer = SectionWriter(jsonl_path, "jsonl")

        try:
            for slug in code_slugs:
                if self._should_stop():
                    break
                log.info("Crawling %s", slug)
                self._crawl_code(slug)
                self.state_store.save()
        finally:
            self.state_store.save()
            if self.config.output_format == "json":
                self.writer.finalize_json_array(json_target)

    def _crawl_code(self, code_slug: str) -> None:
        root = normalize_url(
            f"{self.config.base_url}/codes/california/{self.config.year}/{code_slug}/"
        )
        prefix = f"/codes/california/{self.config.year}/{code_slug}/"

        index_queue: deque[str] = deque()
        section_urls: set[str] = set()

        if self.state_store.state.pending:
            index_queue.extend(self.state_store.state.pending)
        else:
            index_queue.append(root)

        section_urls.update(self.state_store.state.section_urls)

        # Phase 1 — discover structure and section URLs.
        while index_queue and not self._should_stop():
            if self.config.max_pages is not None and self._pages >= self.config.max_pages:
                self.state_store.state.pending = list(index_queue)
                log.info("Reached max_pages=%s", self.config.max_pages)
                break

            batch: list[str] = []
            while index_queue and len(batch) < self.config.workers:
                url = index_queue.popleft()
                if self.state_store.is_visited(url):
                    continue
                batch.append(url)

            if not batch:
                break

            with ThreadPoolExecutor(max_workers=min(len(batch), self.config.workers)) as pool:
                futures = {
                    pool.submit(self._process_index_page, url, prefix): url for url in batch
                }
                for fut in as_completed(futures):
                    url = futures[fut]
                    try:
                        links, sections = fut.result()
                        for link in links:
                            if not self.state_store.is_visited(link):
                                index_queue.append(link)
                        section_urls.update(sections)
                    except Exception as exc:  # noqa: BLE001
                        log.error("index page failed %s: %s", url, exc)
                        self.state_store.state.failures.append(url)
                    if self._pages % 10 == 0:
                        self.state_store.save()

        self.state_store.state.section_urls.update(section_urls)
        self.state_store.state.pending = list(index_queue)

        if self.config.discover_only:
            log.info("Discovered %d section URLs for %s", len(section_urls), code_slug)
            return

        # Phase 2 — fetch section text in parallel.
        todo = [
            url
            for url in sorted(section_urls)
            if normalize_url(url) not in self.writer._written_urls
        ]
        if not todo:
            return

        with ThreadPoolExecutor(max_workers=self.config.workers) as pool:
            futures = {pool.submit(self._process_section_page, url): url for url in todo}
            for fut in as_completed(futures):
                url = futures[fut]
                try:
                    fut.result()
                except Exception as exc:  # noqa: BLE001
                    log.error("section failed %s: %s", url, exc)
                    self.state_store.state.failures.append(url)
                if self._should_stop():
                    break

        self.state_store.state.sections_written = self.writer.count

    def _process_index_page(self, url: str, prefix: str) -> tuple[list[str], list[str]]:
        if not self._inc_pages():
            return [], []

        self.state_store.mark_visited(url)
        result = self.fetcher.get(url)
        if not result:
            return [], []

        path = urlparse(url).path
        if prefix not in path:
            return [], []

        if is_section_url(url):
            return [], [url]

        links = child_links(
            url, result.soup, self.config.base_url, self.config.codes_prefix
        )
        # Keep only URLs under this code slug.
        scoped = [link for link in links if prefix in urlparse(link).path]
        sections = [link for link in scoped if is_section_url(link)]
        indexes = [link for link in scoped if not is_section_url(link)]
        return indexes, sections

    def _process_section_page(self, url: str) -> None:
        if self._should_stop():
            return
        if not self._inc_pages():
            return

        url = normalize_url(url)
        if self.state_store.is_visited(url):
            return
        self.state_store.mark_visited(url)

        result = self.fetcher.get(url)
        if not result:
            self.state_store.state.failures.append(url)
            return

        record = parse_section(url, result.soup, self.config.year)
        if not record:
            log.warning("empty section text: %s", url)
            return

        if self.writer.write(record):
            self.state_store.state.sections_written = self.writer.count
            print(f"  [{self.writer.count}] {record['citation']}", file=sys.stderr)


def run_crawl(config: ScraperConfig) -> None:
    slugs = config.resolve_code_slugs()
    if config.preset == "all":
        crawler = CodeCrawler(config)
        try:
            slugs = crawler.discover_codes()
        finally:
            crawler.close()

    if not slugs:
        raise SystemExit("No code slugs configured. Use --codes or --preset.")

    print(config_summary_line(config, slugs), file=sys.stderr)

    crawler = CodeCrawler(config)
    try:
        crawler.crawl(slugs)
    finally:
        crawler.close()

    print(
        f"\nDone. {crawler.writer.count} sections -> {config.output.resolve()}",
        file=sys.stderr,
    )


def config_summary_line(config: ScraperConfig, slugs: list[str]) -> str:
    limits = []
    if config.max_pages is not None:
        limits.append(f"max_pages={config.max_pages}")
    if config.max_sections is not None:
        limits.append(f"max_sections={config.max_sections}")
    limit_str = f" ({', '.join(limits)})" if limits else ""
    return (
        f"Scraping {', '.join(slugs)} [{config.year}] "
        f"@ {config.rate_limit} req/s, {config.workers} workers{limit_str}"
    )
