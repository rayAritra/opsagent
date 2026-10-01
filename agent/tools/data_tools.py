"""Read-only sandbox filesystem, PDF extraction, BM25 retrieval and scratchpad tools."""

import re
from pathlib import Path

import pdfplumber
from rank_bm25 import BM25Okapi

from agent.config import DRIVE
from agent.tool_registry import tool


def safe_path(ctx, path: str) -> Path:
    """Resolve within shared drive or the current run, denying symlink escapes."""
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = (DRIVE if path.startswith("sops") or path == "." else ctx.workspace) / candidate
    candidate = candidate.resolve()
    if candidate.name == "browser-state.json":
        raise PermissionError("Browser session credentials are not readable by tools.")
    if not any(
        candidate == root.resolve() or root.resolve() in candidate.parents for root in (DRIVE, ctx.workspace)
    ):
        raise PermissionError("Files are restricted to shared drive and the current run workspace.")
    return candidate


@tool()
def files_list(ctx, path: str = "."):
    """List a sandbox directory. '.' is the shared drive; 'sops' contains company procedures."""
    return [
        {"name": p.name, "path": str(p), "directory": p.is_dir()}
        for p in sorted(safe_path(ctx, path).iterdir())
    ]


@tool()
def files_read(ctx, path: str):
    """Read a UTF-8 text file from the shared drive or current run workspace."""
    file = safe_path(ctx, path)
    if file.stat().st_size > 100000:
        raise ValueError("Text file too large; use PDF extraction for documents.")
    return {"path": str(file), "text": file.read_text(encoding="utf-8-sig")}


@tool()
def pdf_extract(ctx, path: str):
    """Extract text and tables from a real PDF, retaining its path as source evidence."""
    file = safe_path(ctx, path)
    with pdfplumber.open(file) as pdf:
        data = {
            "path": str(file),
            "text": "\n".join(p.extract_text() or "" for p in pdf.pages),
            "tables": [t for p in pdf.pages for t in p.extract_tables()],
        }
    ctx.evidence.setdefault("pdfs", {})[str(file)] = data
    return data


@tool()
def knowledge_search(ctx, query: str):
    """Retrieve top relevant SOP passages using BM25, including document filenames."""
    docs = sorted((DRIVE / "sops").glob("*.md"))
    texts = [p.read_text(encoding="utf-8-sig") for p in docs]

    def tokenize(text):
        return re.findall(r"\w+", text.lower())

    index = BM25Okapi([tokenize(p.stem.replace("_", " ") + " " + text) for p, text in zip(docs, texts)])
    scores = index.get_scores(tokenize(query))
    ranked = sorted(range(len(docs)), key=lambda i: scores[i], reverse=True)[:3]
    return [
        {
            "file": docs[i].relative_to(DRIVE).as_posix(),
            "passage": texts[i],
            "score": round(float(scores[i]), 3),
        }
        for i in ranked
    ]


@tool()
def memory_note(ctx, key: str, value: str):
    """Keep a discovered fact in the persisted run scratchpad."""
    ctx.memory[key] = value
    return {"stored": key}


@tool()
def memory_get(ctx):
    """Read all persisted scratchpad facts."""
    return dict(ctx.memory)


@tool()
async def ask_human(ctx, question: str):
    """Pause durably for missing information. Never guess a missing due date."""
    return await ctx.human_question(question)


@tool()
def finish(ctx, summary: str, claimed_outcome: dict):
    """Request independent verification. Supply criterion bindings and source paths; claims are not evidence."""
    ctx.finish_request = {"summary": summary, "claimed_outcome": claimed_outcome}
    return {"verification_requested": True}
