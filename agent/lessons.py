"""Simple visible cross-run lessons; never persist company record values."""

from agent.store import Store


def retrieve(store: Store, task_type: str) -> list[str]:
    """Return recent lessons for an inferred task category."""
    with store.connect() as db:
        return [
            r["lesson"]
            for r in db.execute(
                "SELECT lesson FROM lessons WHERE task_type=? ORDER BY id DESC LIMIT 5", (task_type,)
            )
        ]


def remember(store: Store, task_type: str, lesson: str, outcome: str) -> None:
    """Store a short operational observation and its verified outcome."""
    with store.connect() as db:
        db.execute(
            "INSERT INTO lessons(task_type,lesson,outcome) VALUES (?,?,?)", (task_type, lesson[:500], outcome)
        )
