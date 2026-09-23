import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

SPORT = "americanfootball_nfl"
API_ROOT = "https://api.the-odds-api.com/v4"
OUT = Path("data/nfl-odds.json")
STATS = Path("data/nfl-stats.json")
BOOKMAKER = "fanduel"
TIMEOUT = 30

TEAM_ABBR = {
    "Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF",
    "Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE",
    "Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB",
    "Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC",
    "Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LAR","Miami Dolphins":"MIA",
    "Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG",
    "New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF",
    "Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WSH",
}

MARKET_LABELS = {
    "assists":"Assists",
    "defensive_interceptions":"Defensive Interceptions",
    "field_goals":"Field Goals",
    "kicking_points":"Kicking Points",
    "pass_attempts":"Pass Attempts",
    "pass_completions":"Pass Completions",
    "pass_interceptions":"Interceptions Thrown",
    "pass_longest_completion":"Longest Completion",
    "pass_rush_yds":"Pass + Rush Yards",
    "pass_rush_reception_tds":"Pass + Rush + Rec TDs",
    "pass_rush_reception_yds":"Pass + Rush + Rec Yards",
    "pass_tds":"Passing TDs",
    "pass_yds":"Passing Yards",
    "pass_yds_q1":"1Q Passing Yards",
    "pats":"PATs",
    "receptions":"Receptions",
    "reception_longest":"Longest Reception",
    "reception_tds":"Receiving TDs",
    "reception_yds":"Receiving Yards",
    "rush_attempts":"Rush Attempts",
    "rush_longest":"Longest Rush",
    "rush_reception_tds":"Rush + Rec TDs",
    "rush_reception_yds":"Rush + Rec Yards",
    "rush_tds":"Rushing TDs",
    "rush_yds":"Rushing Yards",
    "sacks":"Sacks",
    "solo_tackles":"Solo Tackles",
    "tackles_assists":"Tackles + Assists",
    "tds_over":"Touchdowns",
    "tds":"Touchdowns",
    "1st_td":"First Touchdown",
    "anytime_td":"Anytime Touchdown",
    "last_td":"Last Touchdown",
}

UA = {
    "User-Agent": "sports-tracker/1.0",
    "Accept": "application/json",
}

usage = {"used": None, "remaining": None, "last": None}


def request_json(path, params):
    url = f"{API_ROOT}{path}"
    response = requests.get(url, params=params, headers=UA, timeout=TIMEOUT)
    response.raise_for_status()
    for header, key in (
        ("x-requests-used", "used"),
        ("x-requests-remaining", "remaining"),
        ("x-requests-last", "last"),
    ):
        if response.headers.get(header) is not None:
            try:
                usage[key] = int(response.headers[header])
            except ValueError:
                usage[key] = response.headers[header]
    return response.json()


def iso_dt(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def normalize_name(value):
    text = str(value or "").lower()
    text = re.sub(r"\b(jr|sr|ii|iii|iv)\.?\b", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def load_stats_players():
    if not STATS.exists():
        return {}
    try:
        payload = json.loads(STATS.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    result = {}
    for player in payload.get("players") or []:
        result[normalize_name(player.get("name"))] = {
            "name": player.get("name") or "",
            "team": player.get("team") or "",
            "position": player.get("position") or "",
            "headshot": player.get("headshot") or "",
        }
    return result


def load_previous():
    if not OUT.exists():
        return {}
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def market_label(key):
    clean = key.removeprefix("player_").removesuffix("_alternate")
    if clean in MARKET_LABELS:
        return MARKET_LABELS[clean]
    return " ".join(piece.upper() if piece in {"td", "tds", "pat", "pats", "q1"} else piece.title() for piece in clean.split("_"))


def display_point(value):
    if value is None:
        return ""
    try:
        number = float(value)
        return str(int(number)) if number.is_integer() else str(number)
    except (TypeError, ValueError):
        return str(value)


def proposition_text(market_key, outcome):
    label = market_label(market_key)
    selection = str(outcome.get("name") or "")
    point = display_point(outcome.get("point"))

    if selection in {"Over", "Under"}:
        return f"{selection} {point} {label}".strip()
    if selection in {"Yes", "No"}:
        return f"{label} — {selection}"
    return label


def player_from_outcome(outcome):
    description = str(outcome.get("description") or "").strip()
    if description:
        return description
    name = str(outcome.get("name") or "").strip()
    if name not in {"Over", "Under", "Yes", "No"}:
        return name
    return ""


def fetch_events(api_key):
    return request_json(
        f"/sports/{SPORT}/events",
        {"apiKey": api_key, "dateFormat": "iso"},
    )


def fetch_event_market_keys(api_key, event_id):
    payload = request_json(
        f"/sports/{SPORT}/events/{event_id}/markets",
        {"apiKey": api_key, "bookmakers": BOOKMAKER, "dateFormat": "iso"},
    )
    for bookmaker in payload.get("bookmakers") or []:
        if bookmaker.get("key") == BOOKMAKER:
            return sorted({
                market.get("key")
                for market in bookmaker.get("markets") or []
                if str(market.get("key") or "").startswith("player_")
            })
    return []


def fetch_event_odds(api_key, event, player_lookup):
    market_keys = fetch_event_market_keys(api_key, event["id"])
    if not market_keys:
        return None

    payload = request_json(
        f"/sports/{SPORT}/events/{event['id']}/odds",
        {
            "apiKey": api_key,
            "bookmakers": BOOKMAKER,
            "markets": ",".join(market_keys),
            "oddsFormat": "american",
            "dateFormat": "iso",
            "includeLinks": "true",
        },
    )

    props = []
    bookmaker_link = ""
    last_update = None

    for bookmaker in payload.get("bookmakers") or []:
        if bookmaker.get("key") != BOOKMAKER:
            continue
        bookmaker_link = bookmaker.get("link") or ""
        last_update = bookmaker.get("last_update")
        for market in bookmaker.get("markets") or []:
            market_key = str(market.get("key") or "")
            is_alt = market_key.endswith("_alternate")
            market_link = market.get("link") or bookmaker_link
            for outcome in market.get("outcomes") or []:
                player_name = player_from_outcome(outcome)
                if not player_name:
                    continue

                profile = player_lookup.get(normalize_name(player_name), {})
                props.append({
                    "player": player_name,
                    "team": profile.get("team") or "",
                    "position": profile.get("position") or "",
                    "headshot": profile.get("headshot") or "",
                    "marketKey": market_key,
                    "market": market_label(market_key),
                    "alternate": is_alt,
                    "selection": outcome.get("name") or "",
                    "line": outcome.get("point"),
                    "odds": outcome.get("price"),
                    "proposition": proposition_text(market_key, outcome),
                    "lastUpdate": market.get("last_update") or last_update,
                    "link": outcome.get("link") or market_link or "",
                })

    seen = set()
    unique = []
    for prop in props:
        key = (
            normalize_name(prop["player"]),
            prop["marketKey"],
            str(prop["selection"]),
            str(prop["line"]),
            str(prop["odds"]),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(prop)

    if not unique:
        return None

    return {
        "id": event["id"],
        "commenceTime": event.get("commence_time"),
        "homeTeam": event.get("home_team"),
        "awayTeam": event.get("away_team"),
        "homeAbbr": TEAM_ABBR.get(event.get("home_team"), ""),
        "awayAbbr": TEAM_ABBR.get(event.get("away_team"), ""),
        "bookmaker": "FanDuel",
        "lastUpdate": last_update,
        "props": unique,
    }


def compact_for_compare(payload):
    copy = dict(payload)
    copy.pop("updatedAt", None)
    copy.pop("usage", None)
    return copy


def main():
    api_key = os.getenv("ODDS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ODDS_API_KEY is not configured.")

    lookahead_hours = int(os.getenv("ODDS_LOOKAHEAD_HOURS", "36"))
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(hours=lookahead_hours)
    earliest = now - timedelta(hours=6)

    player_lookup = load_stats_players()
    previous = load_previous()
    previous_events = {
        str(event.get("id")): event
        for event in previous.get("events") or []
        if event.get("id")
    }

    all_events = fetch_events(api_key)
    selected = []
    for event in all_events:
        commence = iso_dt(event.get("commence_time"))
        if commence and earliest <= commence <= cutoff:
            selected.append(event)

    print(f"Found {len(selected)} NFL event(s) within {lookahead_hours} hours.")

    refreshed_ids = set()
    refreshed_events = []
    for index, event in enumerate(selected, start=1):
        print(f"[{index}/{len(selected)}] {event.get('away_team')} @ {event.get('home_team')}")
        try:
            parsed = fetch_event_odds(api_key, event, player_lookup)
            refreshed_ids.add(str(event["id"]))
            if parsed:
                refreshed_events.append(parsed)
                print(f"  {len(parsed['props'])} FanDuel player prop outcomes")
            else:
                print("  no FanDuel player props currently available")
        except requests.RequestException as exc:
            print(f"  WARNING: request failed: {exc}", file=sys.stderr)
        time.sleep(0.25)

    preserved = []
    for event_id, event in previous_events.items():
        if event_id in refreshed_ids:
            continue
        commence = iso_dt(event.get("commenceTime"))
        if commence and commence >= earliest:
            preserved.append(event)

    combined = preserved + refreshed_events
    combined.sort(key=lambda event: event.get("commenceTime") or "")

    payload = {
        "bookmaker": "FanDuel",
        "updatedAt": now.isoformat(),
        "lookaheadHours": lookahead_hours,
        "usage": usage,
        "events": combined,
    }

    if previous and compact_for_compare(previous) == compact_for_compare(payload):
        print("No odds changes; leaving data file untouched.")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    total_props = sum(len(event.get("props") or []) for event in combined)
    print(f"Wrote {len(combined)} event(s), {total_props} prop outcomes.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
