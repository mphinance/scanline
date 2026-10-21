"""Tiny in-memory TTL cache keyed by a hash of the request payload.

Thread-safe enough for uvicorn's default worker. No time or random calls
happen at import time, only inside methods.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from typing import Any


def make_key(payload: Any) -> str:
    """Stable hash key for any JSON-serializable payload."""
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


class TTLCache:
    """A small dict cache where entries expire after ttl_seconds."""

    def __init__(self, ttl_seconds: int = 20) -> None:
        self.ttl = ttl_seconds
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        """Return the cached value, or None if missing or expired."""
        now = time.time()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if now >= expires_at:
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        """Store a value with the configured TTL."""
        expires_at = time.time() + self.ttl
        with self._lock:
            self._store[key] = (expires_at, value)

    def clear(self) -> None:
        """Drop all entries."""
        with self._lock:
            self._store.clear()
