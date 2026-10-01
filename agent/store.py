"""Durable SQLite checkpoints, human decisions and append-only JSONL traces."""

import json
import sqlite3
import time
import uuid
from pathlib import Path

from agent.config import RUNS


class Store:
    def __init__(self, root: Path = RUNS) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / "state.sqlite"
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, task TEXT, status TEXT, created REAL, updated REAL, state TEXT, report TEXT);
            CREATE TABLE IF NOT EXISTS steps(id INTEGER PRIMARY KEY, run_id TEXT, payload TEXT);
            CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, run_id TEXT, fingerprint TEXT, payload TEXT, decision TEXT, comment TEXT);
            CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, run_id TEXT, question TEXT, answer TEXT);
            CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY, task_type TEXT, lesson TEXT, outcome TEXT);
            """)

    def connect(self) -> sqlite3.Connection:
        """Open one short-lived connection for cross-process access."""
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def create(self, task: str) -> str:
        """Allocate a run and artifact workspace."""
        run_id = uuid.uuid4().hex[:12]
        (self.root / run_id).mkdir()
        with self.connect() as db:
            db.execute(
                "INSERT INTO runs VALUES (?,?,?,?,?,?,?)",
                (run_id, task, "QUEUED", time.time(), time.time(), "{}", None),
            )
        return run_id

    def save(self, run_id: str, state: dict, status: str = "RUNNING") -> None:
        """Atomically checkpoint state and lifecycle status."""
        with self.connect() as db:
            db.execute(
                "UPDATE runs SET state=?,status=?,updated=? WHERE id=?",
                (json.dumps(state), status, time.time(), run_id),
            )

    def run(self, run_id: str) -> dict:
        """Read a run with decoded state, report, human cards and events."""
        with self.connect() as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise KeyError(run_id)
            result = dict(row)
            result["state"] = json.loads(result["state"])
            result["report"] = json.loads(result["report"]) if result["report"] else None
            result["approvals"] = [
                dict(r) | {"payload": json.loads(r["payload"])}
                for r in db.execute("SELECT * FROM approvals WHERE run_id=?", (run_id,))
            ]
            result["questions"] = [
                dict(r) for r in db.execute("SELECT * FROM questions WHERE run_id=?", (run_id,))
            ]
            result["events"] = [
                json.loads(r["payload"])
                for r in db.execute("SELECT payload FROM steps WHERE run_id=? ORDER BY id", (run_id,))
            ]
        return result

    def history(self) -> list[dict]:
        """Return newest-first run summaries."""
        with self.connect() as db:
            return [
                dict(r)
                for r in db.execute("SELECT id,task,status,created,updated FROM runs ORDER BY created DESC")
            ]

    def event(self, run_id: str, kind: str, **payload) -> None:
        """Persist one audit event in SQLite and an exportable JSONL trace."""
        event = {"time": time.time(), "kind": kind, **payload}
        text = json.dumps(event, ensure_ascii=False, default=str)
        with self.connect() as db:
            db.execute("INSERT INTO steps(run_id,payload) VALUES (?,?)", (run_id, text))
        with (self.root / run_id / "trace.jsonl").open("a", encoding="utf-8") as file:
            file.write(text + "\n")

    def approval(self, run_id: str, fingerprint: str, payload: dict) -> dict:
        """Reuse an exact-values approval, including durable rejection."""
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM approvals WHERE run_id=? AND fingerprint=?", (run_id, fingerprint)
            ).fetchone()
            if not row:
                identifier = uuid.uuid4().hex
                db.execute(
                    "INSERT INTO approvals VALUES (?,?,?,?,?,?)",
                    (identifier, run_id, fingerprint, json.dumps(payload), None, ""),
                )
                row = db.execute("SELECT * FROM approvals WHERE id=?", (identifier,)).fetchone()
            return dict(row)

    def question(self, run_id: str, question: str) -> dict:
        """Create or recover an unanswered human question."""
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM questions WHERE run_id=? AND question=?", (run_id, question)
            ).fetchone()
            if not row:
                identifier = uuid.uuid4().hex
                db.execute("INSERT INTO questions VALUES (?,?,?,?)", (identifier, run_id, question, None))
                row = db.execute("SELECT * FROM questions WHERE id=?", (identifier,)).fetchone()
            return dict(row)

    def decide(
        self, run_id: str, identifier: str, decision: str, comment: str = "", question: bool = False
    ) -> None:
        """Resolve a pending card once, scoped to its run."""
        if not question and decision not in ("approve", "reject"):
            raise ValueError("Decision must be approve or reject")
        if question and not decision.strip():
            raise ValueError("An answer is required")
        with self.connect() as db:
            if question:
                cursor = db.execute(
                    "UPDATE questions SET answer=? WHERE id=? AND run_id=? AND answer IS NULL",
                    (decision, identifier, run_id),
                )
            else:
                cursor = db.execute(
                    "UPDATE approvals SET decision=?,comment=? WHERE id=? AND run_id=? AND decision IS NULL",
                    (decision, comment, identifier, run_id),
                )
            if cursor.rowcount != 1:
                raise ValueError("Card does not exist or is already resolved")
        self.event(run_id, "human_decision", card_id=identifier, decision=decision, comment=comment)

    def complete(self, run_id: str, report: dict) -> None:
        """Publish reports and mark terminal lifecycle status."""
        workspace = self.root / run_id
        (workspace / "report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        lines = [
            f"# OpsAgent run {run_id}",
            f"Outcome: **{report['outcome']}**",
            "",
            report["summary"],
            "",
            "## Verification",
        ]
        lines += [
            f"- {c.get('id', 'check')}: {c.get('status')} — {c.get('evidence')}"
            for c in report.get("criteria", [])
        ]
        lines += [
            "",
            "## Audit",
            f"Approvals: {len(report.get('approvals', []))}",
            f"Recoveries: {report.get('recoveries', 0)}",
            f"Input / output tokens: {report.get('input_tokens', 0)} / {report.get('output_tokens', 0)}",
            "",
            "## Screenshots",
        ]
        lines += [f"- [{name}]({name})" for name in report.get("screenshots", [])]
        (workspace / "report.md").write_text("\n".join(lines), encoding="utf-8")
        with self.connect() as db:
            db.execute(
                "UPDATE runs SET report=?,status=?,updated=? WHERE id=?",
                (json.dumps(report), report["outcome"], time.time(), run_id),
            )
        self.event(run_id, "complete", outcome=report["outcome"])
