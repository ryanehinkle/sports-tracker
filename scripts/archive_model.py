import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ODDS = Path("data/nfl-odds.json")
HISTORY_DIR = Path("data/model-history")
INDEX = HISTORY_DIR / "index.json"
CENTRAL = ZoneInfo("America/Chicago")


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def due_date(odds, now):
    candidates = []
    for event in odds.get("events") or []:
        start = parse_dt(event.get("commenceTime"))
        if not start or start <= now:
            continue
        delta = start - now
        if timedelta(minutes=20) <= delta <= timedelta(minutes=75):
            candidates.append(start)
    if not candidates:
        return None
    first = min(candidates)
    return first.astimezone(CENTRAL).date().isoformat()


def rebuild_index():
    days = []
    for path in sorted(HISTORY_DIR.glob("*.json"), reverse=True):
        if path.name == "index.json":
            continue
        payload = load_json(path, {})
        if not payload.get("date"):
            continue
        days.append({
            "date": payload["date"],
            "label": payload.get("label") or payload["date"],
            "file": path.name,
            "sourceCommit": payload.get("sourceCommit"),
            "kind": payload.get("kind") or "pregame-model-freeze",
        })
    INDEX.write_text(json.dumps({
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "days": days,
    }, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--force-date")
    args = parser.parse_args()

    odds = load_json(ODDS, {})
    now = datetime.now(timezone.utc)
    date_key = args.force_date or due_date(odds, now)
    if not date_key:
        print("No model archive is due.")
        return

    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    target = HISTORY_DIR / f"{date_key}.json"
    if target.exists():
        print(f"Model archive already exists for {date_key}; leaving it immutable.")
        return

    date_obj = datetime.fromisoformat(date_key + "T12:00:00").replace(tzinfo=CENTRAL)
    label = date_obj.strftime("%a, %b %-d, %Y")
    payload = {
        "date": date_key,
        "label": label,
        "capturedAt": now.isoformat(),
        "sourceCommit": args.source_commit,
        "kind": "pregame-model-freeze",
        "note": "Immutable full-model input snapshot captured before the first kickoff window.",
        "files": {
            "stats": "data/nfl-stats.json",
            "teamStats": "data/nfl-team-stats.json",
            "odds": "data/nfl-odds.json",
            "calibration": "data/model-calibration.json",
            "ladder": "data/ladder-picks.json",
        },
    }
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    rebuild_index()
    print(f"Archived Model state for {date_key} at {args.source_commit}.")


if __name__ == "__main__":
    main()
