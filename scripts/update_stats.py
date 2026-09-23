import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

BASE = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete"
SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
OUT = Path("data/nfl-stats.json")
CT = ZoneInfo("America/Chicago")
TIMEOUT = 30
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36", "Accept": "application/json,text/plain,*/*", "Referer": "https://www.espn.com/"}

FEEDS = {
    "rushing": {
        "category": "offense:rushing",
        "sort": "rushing.rushingYards:desc",
        "fallback": {"rushingYards": 1, "rushingTouchdowns": 5},
    },
    "receiving": {
        "category": "offense:receiving",
        "sort": "receiving.receivingYards:desc",
        "fallback": {"receptions": 0, "receivingYards": 2, "receivingTouchdowns": 4},
    },
    "passing": {
        "category": "offense:passing",
        "sort": "passing.passingYards:desc",
        "fallback": {"passingYards": 3, "passingTouchdowns": 7},
    },
}


def get_json(url, params=None):
    r = requests.get(url, params=params, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def current_season():
    # NFL seasons begin in the second half of the calendar year.
    now = datetime.now(timezone.utc)
    return now.year if now.month >= 7 else now.year - 1


def number(value):
    try:
        if value in (None, "", "--"):
            return 0
        return int(round(float(str(value).replace(",", ""))))
    except (TypeError, ValueError):
        return 0


def pick_stat_category(entry, wanted):
    categories = entry.get("categories") or []
    wanted = wanted.lower()
    for cat in categories:
        text = " ".join(str(cat.get(k, "")) for k in ("name", "displayName", "shortDisplayName")).lower()
        if wanted in text:
            return cat
    # ESPN's leaderboard historically puts the selected stat table toward the end.
    candidates = [c for c in categories if c.get("totals")]
    return max(candidates, key=lambda c: len(c.get("totals", [])), default={})


def stat_map(category, fallback):
    totals = category.get("totals") or []
    result = {}

    # Some ESPN responses expose field names beside totals.
    names = category.get("names") or category.get("statNames") or []
    if names:
        for i, name in enumerate(names):
            if i < len(totals):
                result[str(name)] = number(totals[i])

    # Other responses expose fully structured stats.
    for stat in category.get("stats") or []:
        if stat.get("name"):
            result[stat["name"]] = number(stat.get("value", stat.get("displayValue")))

    # Stable fallback to ESPN's standard table ordering.
    for key, idx in fallback.items():
        if key not in result and idx < len(totals):
            result[key] = number(totals[idx])

    return result


def athlete_info(entry):
    a = entry.get("athlete") or {}
    aid = str(a.get("id") or "")
    team = (
        a.get("teamShortName")
        or a.get("teamAbbreviation")
        or (a.get("team") or {}).get("abbreviation")
        or ""
    )
    position = a.get("position") or {}
    if isinstance(position, dict):
        position = position.get("abbreviation") or position.get("name") or ""

    headshot = a.get("headshot")
    if isinstance(headshot, dict):
        headshot = headshot.get("href")
    if not headshot and aid:
        headshot = f"https://a.espncdn.com/i/headshots/nfl/players/full/{aid}.png"

    return {
        "id": aid,
        "name": a.get("displayName") or a.get("fullName") or "Unknown Player",
        "team": team,
        "position": position,
        "headshot": headshot or "",
    }


def fetch_feed(season, feed_name, cfg):
    players = {}
    page = 1
    while True:
        params = {
            "region": "us",
            "lang": "en",
            "contentorigin": "espn",
            "isqualified": "false",
            "limit": 100,
            "category": cfg["category"],
            "sort": cfg["sort"],
            "season": season,
            "seasontype": 2,
            "page": page,
        }
        data = get_json(BASE, params)
        rows = data.get("athletes") or []
        if not rows:
            break

        for entry in rows:
            info = athlete_info(entry)
            if not info["id"]:
                continue
            category = pick_stat_category(entry, feed_name)
            players[info["id"]] = {**info, **stat_map(category, cfg["fallback"])}

        page += 1
        page_count = (
            data.get("pageCount")
            or data.get("pagination", {}).get("pageCount")
            or data.get("count", 0) // 100 + 1
        )
        if len(rows) < 100 or page > max(int(page_count or 1), 1):
            break
        if page > 20:
            break

    return players


def merge_players(season):
    merged = {}
    for feed_name, cfg in FEEDS.items():
        feed = fetch_feed(season, feed_name, cfg)
        print(f"{feed_name}: {len(feed)} athletes")
        for aid, row in feed.items():
            p = merged.setdefault(
                aid,
                {
                    "id": aid,
                    "name": row["name"],
                    "team": row["team"],
                    "position": row["position"],
                    "headshot": row["headshot"],
                    "touchdowns": 0,
                    "allPurposeYards": 0,
                    "receivingYards": 0,
                    "rushingYards": 0,
                    "receptions": 0,
                    "passingTouchdowns": 0,
                    "passingYards": 0,
                },
            )
            for k in ("name", "team", "position", "headshot"):
                if row.get(k):
                    p[k] = row[k]
            for k in (
                "receivingYards",
                "rushingYards",
                "receptions",
                "passingTouchdowns",
                "passingYards",
                "receivingTouchdowns",
                "rushingTouchdowns",
            ):
                if k in row:
                    p[k] = number(row[k])

    for p in merged.values():
        # This dashboard treats "all-purpose" as rushing + receiving yards
        # (yards from scrimmage), matching the requested offensive columns.
        p["allPurposeYards"] = p["rushingYards"] + p["receivingYards"]
        p["touchdowns"] = p.get("rushingTouchdowns", 0) + p.get("receivingTouchdowns", 0)
        p.pop("rushingTouchdowns", None)
        p.pop("receivingTouchdowns", None)

    # Keep players with at least one tracked offensive stat.
    rows = [
        p for p in merged.values()
        if any(p[k] for k in ("allPurposeYards", "receptions", "passingYards", "passingTouchdowns", "touchdowns"))
    ]
    rows.sort(key=lambda p: (p["allPurposeYards"], p["passingYards"], p["name"]), reverse=True)
    return rows


def main():
    season = current_season()
    players = merge_players(season)
    if len(players) < 25:
        raise RuntimeError(f"Only {len(players)} players parsed; refusing to overwrite good data.")

    payload = {
        "season": season,
        "seasonType": "Regular Season",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESPN",
        "definition": {"allPurposeYards": "rushing + receiving yards"},
        "players": players,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(players)} players to {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
