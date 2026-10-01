"""Structural interface consumed by tools; runtime state remains explicit and testable."""

from pathlib import Path
from typing import Protocol

from agent.browser import BrowserSession
from agent.store import Store


class ToolContext(Protocol):
    """Capabilities available to decorated tool implementations."""

    browser: BrowserSession
    workspace: Path
    memory: dict[str, str]
    evidence: dict
    plan: dict
    spec: dict
    store: Store
    run_id: str
    finish_request: dict | None

    async def human_question(self, question: str) -> dict:
        """Ask through the runtime's persisted human-question boundary."""
        ...
