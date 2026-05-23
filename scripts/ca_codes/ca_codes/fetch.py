"""HTTP fetch with retries, rate limiting, and optional Cloudflare workarounds."""

from __future__ import annotations

import http.cookiejar
import logging
import threading
import time
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from .config import ScraperConfig

log = logging.getLogger(__name__)


class RateLimiter:
    """Global minimum interval between requests (shared across workers)."""

    def __init__(self, requests_per_second: float) -> None:
        self._interval = 1.0 / requests_per_second
        self._lock = threading.Lock()
        self._last_at = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self._interval - (now - self._last_at)
            if delay > 0:
                time.sleep(delay)
            self._last_at = time.monotonic()


class FetchResult:
    __slots__ = ("url", "html", "soup", "status_code", "from_cache")

    def __init__(
        self,
        url: str,
        html: str,
        status_code: int = 200,
        from_cache: bool = False,
    ) -> None:
        self.url = url
        self.html = html
        self.soup = BeautifulSoup(html, "lxml")
        self.status_code = status_code
        self.from_cache = from_cache


class Fetcher(Protocol):
    def get(self, url: str) -> FetchResult | None: ...
    def close(self) -> None: ...


def _is_cloudflare_challenge(html: str) -> bool:
    lower = html.lower()
    return "just a moment" in lower or "cf-chl" in lower or "challenge-platform" in lower


def _load_cookies(session: requests.Session, cookie_file: Path | None) -> None:
    if not cookie_file:
        return
    jar = http.cookiejar.MozillaCookieJar(str(cookie_file))
    jar.load(ignore_discard=True, ignore_expires=True)
    session.cookies.update(jar)


class RequestsFetcher:
    def __init__(self, config: ScraperConfig, limiter: RateLimiter) -> None:
        self.config = config
        self.limiter = limiter
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": config.user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }
        )
        _load_cookies(self.session, config.cookie_file)
        self._playwright = None
        self._browser = None
        self._page = None
        self._backend = self._resolve_backend()

    def _resolve_backend(self) -> str:
        backend = self.config.fetch_backend
        if backend != "auto":
            return backend
        try:
            import curl_cffi  # noqa: F401

            return "curl_cffi"
        except ImportError:
            return "requests"

    def close(self) -> None:
        if self._browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()

    def get(self, url: str) -> FetchResult | None:
        cached = self._read_cache(url)
        if cached is not None:
            return FetchResult(url, cached, from_cache=True)

        for attempt in range(1, self.config.retries + 1):
            self.limiter.wait()
            try:
                html, status = self._fetch_once(url)
            except Exception as exc:  # noqa: BLE001
                log.warning("fetch error %s (attempt %d/%d): %s", url, attempt, self.config.retries, exc)
                html, status = None, 0

            if html and not _is_cloudflare_challenge(html):
                self._write_cache(url, html)
                return FetchResult(url, html, status_code=status)

            if html and _is_cloudflare_challenge(html):
                log.warning("Cloudflare challenge on %s (attempt %d/%d)", url, attempt, self.config.retries)
                if self._backend == "requests" and self.config.fetch_backend == "auto":
                    log.info("Retrying with curl_cffi backend...")
                    self._backend = "curl_cffi"
                elif self._backend != "playwright":
                    log.info("Retrying with playwright backend...")
                    self._backend = "playwright"

            if attempt < self.config.retries:
                backoff = self.config.retry_backoff ** (attempt - 1)
                time.sleep(backoff)

        log.error("giving up on %s after %d attempts", url, self.config.retries)
        return None

    def _fetch_once(self, url: str) -> tuple[str, int]:
        if self._backend == "curl_cffi":
            return self._fetch_curl_cffi(url)
        if self._backend == "playwright":
            return self._fetch_playwright(url)
        return self._fetch_requests(url)

    def _fetch_requests(self, url: str) -> tuple[str, int]:
        resp = self.session.get(url, timeout=self.config.timeout)
        resp.raise_for_status()
        return resp.text, resp.status_code

    def _fetch_curl_cffi(self, url: str) -> tuple[str, int]:
        from curl_cffi import requests as cffi_requests

        resp = cffi_requests.get(
            url,
            impersonate="chrome",
            timeout=self.config.timeout,
            headers={"User-Agent": self.config.user_agent},
            cookies=self._cookie_dict(),
        )
        return resp.text, resp.status_code

    def _fetch_playwright(self, url: str) -> tuple[str, int]:
        if self._page is None:
            from playwright.sync_api import sync_playwright

            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.launch(headless=True)
            context = self._browser.new_context(user_agent=self.config.user_agent)
            if self.config.cookie_file:
                # Best-effort: load cookies into playwright context.
                self._load_playwright_cookies(context)
            self._page = context.new_page()

        self._page.goto(url, wait_until="domcontentloaded", timeout=int(self.config.timeout * 1000))
        # Allow Cloudflare challenge JS to finish.
        for _ in range(20):
            html = self._page.content()
            if not _is_cloudflare_challenge(html):
                break
            time.sleep(0.5)
        return self._page.content(), 200

    def _load_playwright_cookies(self, context) -> None:
        jar = http.cookiejar.MozillaCookieJar(str(self.config.cookie_file))
        jar.load(ignore_discard=True, ignore_expires=True)
        cookies = []
        for cookie in jar:
            cookies.append(
                {
                    "name": cookie.name,
                    "value": cookie.value,
                    "domain": cookie.domain,
                    "path": cookie.path,
                }
            )
        if cookies:
            context.add_cookies(cookies)

    def _cookie_dict(self) -> dict[str, str]:
        return {c.name: c.value for c in self.session.cookies}

    def _cache_path(self, url: str) -> Path | None:
        if not self.config.cache_dir:
            return None
        self.config.cache_dir.mkdir(parents=True, exist_ok=True)
        slug = urlparse(url).path.strip("/").replace("/", "__")
        return self.config.cache_dir / f"{slug}.html"

    def _read_cache(self, url: str) -> str | None:
        path = self._cache_path(url)
        if path and path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def _write_cache(self, url: str, html: str) -> None:
        path = self._cache_path(url)
        if path:
            path.write_text(html, encoding="utf-8")
