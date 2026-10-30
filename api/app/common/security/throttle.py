"""
In-memory sliding-window limiter for password guessing.

Generalises the per-website failed-attempt counter that `websites/editor.py`
already used for the /admin editor so the staff login (`POST /auth/login`)
gets the same protection: a caller that fails too many times in the window
is answered with 429 until the window slides.

State lives in the process. That is enough for a single-instance deployment
(and every instance still limits independently); move it to Redis if the API
is ever scaled horizontally behind a load balancer.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque


class FailureThrottle:
    def __init__(self, *, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._fails: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque[float]:
        fails = self._fails[key]
        while fails and now - fails[0] > self.window:
            fails.popleft()
        if not fails:
            self._fails.pop(key, None)
            return deque()
        return fails

    def is_blocked(self, key: str) -> bool:
        return len(self._prune(key, time.monotonic())) >= self.limit

    def retry_after(self, key: str) -> int:
        fails = self._prune(key, time.monotonic())
        if len(fails) < self.limit:
            return 0
        return max(1, int(self.window - (time.monotonic() - fails[0])) + 1)

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        self._prune(key, now)
        self._fails[key].append(now)

    def reset(self, key: str) -> None:
        self._fails.pop(key, None)


# Staff sign-in: 10 wrong passwords per (client IP, email) in 10 minutes.
# Keyed on both so one attacker cannot lock a colleague out from elsewhere
# and one address cannot spray many accounts.
login_throttle = FailureThrottle(limit=10, window_seconds=600)
