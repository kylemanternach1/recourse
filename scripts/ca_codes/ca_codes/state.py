"""Persistent crawl state for resume support."""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class CrawlState:
    visited: set[str] = field(default_factory=set)
    pending: list[str] = field(default_factory=list)
    section_urls: set[str] = field(default_factory=set)
    sections_written: int = 0
    pages_fetched: int = 0
    failures: list[str] = field(default_factory=list)
    started_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)

    def touch(self) -> None:
        self.updated_at = _utc_now()


class StateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.state = CrawlState()

    def load(self) -> CrawlState:
        if not self.path.exists():
            return self.state
        with self.path.open(encoding="utf-8") as fh:
            raw = json.load(fh)
        self.state = CrawlState(
            visited=set(raw.get("visited", [])),
            pending=list(raw.get("pending", [])),
            section_urls=set(raw.get("section_urls", [])),
            sections_written=int(raw.get("sections_written", 0)),
            pages_fetched=int(raw.get("pages_fetched", 0)),
            failures=list(raw.get("failures", [])),
            started_at=raw.get("started_at", _utc_now()),
            updated_at=raw.get("updated_at", _utc_now()),
        )
        return self.state

    def save(self) -> None:
        with self._lock:
            self.state.touch()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            payload = asdict(self.state)
            payload["visited"] = sorted(self.state.visited)
            payload["pending"] = self.state.pending
            payload["section_urls"] = sorted(self.state.section_urls)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            tmp.replace(self.path)

    def mark_visited(self, url: str) -> None:
        self.state.visited.add(url)

    def is_visited(self, url: str) -> bool:
        return url in self.state.visited
