"""Shared sandbox database helpers."""

import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.getenv("OPSAGENT_DATA_DIR", str(ROOT / "mock_company" / "data")))
DRIVE = ROOT / "mock_company" / "shared_drive"


def connect(app: str) -> sqlite3.Connection:
    """Open an app-specific database with row mappings and foreign keys."""
    DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATA / f"{app}.sqlite", timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def query(app: str, sql: str, args: tuple = ()) -> list[dict]:
    """Return mapped rows without exposing a database handle."""
    with connect(app) as db:
        return [dict(row) for row in db.execute(sql, args).fetchall()]
