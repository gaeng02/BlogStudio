"""Consistent SQLite backup including drafts, images and sessions (even in WAL mode)."""
import argparse
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
parser.add_argument("--source", type=Path, default=Path("/data/studio.sqlite3"))
args = parser.parse_args()
if args.destination.exists():
    parser.error("destination already exists")
args.destination.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(f"file:{args.source}?mode=ro", uri=True) as source:
    with sqlite3.connect(args.destination) as destination:
        source.backup(destination)
print(f"Backup created: {args.destination}")
