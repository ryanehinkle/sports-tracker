import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from curl_cffi import requests

LOBBY_URL = "https://sbapi.nj.sportsbook.fanduel.com/api/content-managed-page"
EVENT_URL = "https://sbapi.nj.sportsbook.fanduel.com/api/event-page"
PUBLIC_WEB_KEY = "FhMFpcPWXMeyZxOx"
OUT = Path("data/nfl-odds.json")
STATS = Path("data/nfl-stats.json")
TIMEOUT = 25

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

CORE_PROP_TABS = {
    "popular",
    "passing-props",
    "receiving-props",
    "rushing-props",
    "defensive-props",
    "kicking-props",
    "touchdown-scorers",
    "touchdowns",
    "player-props",
}

GENERIC_SELECTIONS = {
    "over","under","yes","no","home","away","draw",
}


def fetch_json(url, params):
    last_error = None
    for attempt in range(3):
        try:
            response = requests.get(
                url,
                params=params,
                headers={"Accept": "application/json"},
                impersonate="chrome120",
                timeout=TIMEOUT,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.25 * (attempt + 1))
    raise last_error


def iso_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def normalize_name(value):
    text = str(value or "").lower()
    text = re.sub(r"\b(jr|sr|ii|iii|iv)\.?\b", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def load_stats_players():
    if not STATS.exists():
        return {}, []
    try:
        payload = json.loads(STATS.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}, []

    by_norm = {}
    profiles = []
    for player in payload.get("players") or []:
        profile = {
            "name": player.get("name") or "",
            "team": player.get("team") or "",
            "position": player.get("position") or "",
            "headshot": player.get("headshot") or "",
        }
        norm = normalize_name(profile["name"])
        if norm:
            by_norm[norm] = profile
            profiles.append(profile)

    profiles.sort(key=lambda p: len(p["name"]), reverse=True)
    return by_norm, profiles


def load_previous():
    if not OUT.exists():
        return {}
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def fetch_lobby():
    return fetch_json(
        LOBBY_URL,
        {"page": "CUSTOM", "customPageId": "nfl", "_ak": PUBLIC_WEB_KEY},
    )


def fetch_event_page(event_id, tab):
    return fetch_json(
        EVENT_URL,
        {"eventId": event_id, "tab": tab, "_ak": PUBLIC_WEB_KEY},
    )


def parse_teams(event):
    name = str(event.get("name") or "")
    if " @ " not in name:
        return None
    away, home = name.split(" @ ", 1)
    away = away.strip().split(" (")[0].strip()
    home = home.strip().split(" (")[0].strip()
    return away, home


def discover_tabs(payload):
    found = set()

    def walk(value, key_hint=""):
        if isinstance(value, dict):
            for key, item in value.items():
                lower_key = str(key).lower()
                if isinstance(item, str):
                    text = item.strip().lower()
                    for match in re.findall(r"[?&]tab=([a-z0-9-]+)", text):
                        found.add(match)
                    if (
                        ("tab" in lower_key or lower_key in {"slug", "id"})
                        and re.fullmatch(r"[a-z0-9][a-z0-9-]{1,50}", text)
                    ):
                        found.add(text)
                walk(item, lower_key)
        elif isinstance(value, list):
            for item in value:
                walk(item, key_hint)

    walk(payload)

    useful = {
        tab for tab in found
        if (
            tab == "popular"
            or "prop" in tab
            or "touchdown" in tab
            or tab in {"passing", "receiving", "rushing", "defense", "kicking"}
        )
    }
    return useful | CORE_PROP_TABS


def american_odds(runner):
    raw = (
        (runner.get("winRunnerOdds") or {})
        .get("americanDisplayOdds", {})
        .get("americanOdds")
    )
    if raw is None:
        return None
    try:
        return int(str(raw).replace("−", "-").replace("+", ""))
    except (TypeError, ValueError):
        return None


def numeric_line(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def infer_line(market_name, runner):
    for key in ("handicap", "line", "points"):
        line = numeric_line(runner.get(key))
        if line is not None and abs(line) < 10000:
            return line

    text = f"{market_name} {runner.get('runnerName') or ''}"
    match = re.search(r"(?<!\d)(\d+(?:\.\d+)?)\+", text)
    if match:
        return float(match.group(1)) - 0.5

    match = re.search(r"\b(?:over|under)\s+(\d+(?:\.\d+)?)", text, re.I)
    if match:
        return float(match.group(1))

    return None


def find_profile(texts, by_norm, profiles):
    joined = " | ".join(str(x or "") for x in texts)
    joined_lower = joined.lower()
    joined_norm = normalize_name(joined)

    for profile in profiles:
        name = profile["name"]
        if name and name.lower() in joined_lower:
            return profile

    for norm, profile in by_norm.items():
        if len(norm) >= 6 and norm in joined_norm:
            return profile

    return None


def clean_market_label(market_name, player_name):
    label = str(market_name or "").strip()
    if player_name:
        label = re.sub(re.escape(player_name), "", label, flags=re.I).strip(" -:")
    label = re.sub(r"\b(over\s*/?\s*under|over under)\b", "", label, flags=re.I)
    label = re.sub(r"\bto record\s+\d+(?:\.\d+)?\+?\b", "", label, flags=re.I)
    label = re.sub(r"\bto have\s+\d+(?:\.\d+)?\+?\b", "", label, flags=re.I)
    label = re.sub(r"\s{2,}", " ", label).strip(" -:")
    return label or str(market_name or "Player Prop")


def selection_from_runner(runner_name, market_name):
    text = str(runner_name or "").strip()
    lower = text.lower()
    if re.search(r"\bover\b", lower):
        return "Over"
    if re.search(r"\bunder\b", lower):
        return "Under"
    if lower in {"yes", "no"}:
        return lower.title()

    market_lower = str(market_name or "").lower()
    if "+" in market_lower or "anytime" in market_lower or "to score" in market_lower:
        return "Over"
    return "Yes"


def proposition_text(label, selection, line, market_name):
    if selection in {"Over", "Under"} and line is not None:
        pretty_line = str(int(line)) if float(line).is_integer() else str(line)
        return f"{selection} {pretty_line} {label}".strip()
    if selection in {"Yes", "No"}:
        return f"{label} — {selection}"

    market = str(market_name or "").strip()
    return market or label


def is_player_market(market, player_profiles):
    runners = market.get("runners") or []
    if any(r.get("isPlayerSelection") for r in runners):
        return True

    market_name = str(market.get("marketName") or "")
    if find_profile([market_name], {}, player_profiles):
        return True

    market_type = str(market.get("marketType") or market.get("marketTypeId") or "").upper()
    return "PLAYER" in market_type


def parse_event_props(event, pages, by_norm, profiles):
    teams = parse_teams(event)
    if not teams:
        return None

    away_team, home_team = teams
    event_id = str(event.get("eventId") or event.get("id") or "")
    prop_map = {}

    for tab, page in pages.items():
        markets = (page.get("attachments") or {}).get("markets") or {}
        for market_id, market in markets.items():
            if not is_player_market(market, profiles):
                continue

            market_name = str(market.get("marketName") or "Player Prop").strip()
            market_type = str(market.get("marketType") or market.get("marketTypeId") or "")
            market_status = str(market.get("marketStatus") or market.get("status") or "").upper()
            if market_status and market_status not in {"OPEN", "ACTIVE"}:
                continue

            for runner in market.get("runners") or []:
                runner_status = str(runner.get("runnerStatus") or runner.get("status") or "").upper()
                if runner_status and runner_status not in {"ACTIVE", "OPEN"}:
                    continue

                odds = american_odds(runner)
                if odds is None:
                    continue

                runner_name = str(runner.get("runnerName") or "").strip()
                profile = find_profile(
                    [market_name, runner_name, runner.get("name"), runner.get("selectionName")],
                    by_norm,
                    profiles,
                )

                if profile:
                    player_name = profile["name"]
                elif runner.get("isPlayerSelection") and runner_name.lower() not in GENERIC_SELECTIONS:
                    player_name = runner_name
                    profile = by_norm.get(normalize_name(player_name), {})
                else:
                    continue

                selection = selection_from_runner(runner_name, market_name)
                line = infer_line(market_name, runner)
                label = clean_market_label(market_name, player_name)

                alternate = bool(
                    "ALT" in market_type.upper()
                    or "alternate" in market_name.lower()
                    or "+" in market_name
                    or (line is not None and selection in {"Over", "Yes"} and "over/under" not in market_name.lower())
                )

                proposition = proposition_text(label, selection, line, market_name)

                key = (
                    normalize_name(player_name),
                    label.lower(),
                    selection,
                    str(line),
                )

                prop_map[key] = {
                    "player": player_name,
                    "team": profile.get("team") or "",
                    "position": profile.get("position") or "",
                    "headshot": profile.get("headshot") or "",
                    "marketKey": market_type or market_name,
                    "market": label,
                    "alternate": alternate,
                    "selection": selection,
                    "line": line,
                    "odds": odds,
                    "proposition": proposition,
                    "lastUpdate": datetime.now(timezone.utc).isoformat(),
                    "link": "",
                    "sourceTab": tab,
                    "marketId": str(market.get("marketId") or market_id),
                    "selectionId": str(runner.get("selectionId") or ""),
                }

    props = list(prop_map.values())
    props.sort(key=lambda p: (p["player"], p["market"], p["line"] if p["line"] is not None else -9999, p["selection"]))

    if not props:
        return None

    return {
        "id": event_id,
        "commenceTime": event.get("openDate"),
        "homeTeam": home_team,
        "awayTeam": away_team,
        "homeAbbr": TEAM_ABBR.get(home_team, ""),
        "awayAbbr": TEAM_ABBR.get(away_team, ""),
        "bookmaker": "FanDuel",
        "lastUpdate": datetime.now(timezone.utc).isoformat(),
        "props": props,
    }


def compact_for_compare(payload):
    copy = json.loads(json.dumps(payload))
    copy.pop("updatedAt", None)
    for event in copy.get("events") or []:
        event.pop("lastUpdate", None)
        for prop in event.get("props") or []:
            prop.pop("lastUpdate", None)
    return copy


def main():
    lookahead_hours = int(os.getenv("ODDS_LOOKAHEAD_HOURS", "36"))
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(hours=lookahead_hours)
    earliest = now - timedelta(hours=6)

    by_norm, profiles = load_stats_players()
    previous = load_previous()
    previous_events = {
        str(event.get("id")): event
        for event in previous.get("events") or []
        if event.get("id")
    }

    lobby = fetch_lobby()
    raw_events = (lobby.get("attachments") or {}).get("events") or {}
    selected = []

    for event_id, event in raw_events.items():
        event = dict(event)
        event["eventId"] = str(event.get("eventId") or event_id)
        if not parse_teams(event):
            continue
        commence = iso_dt(event.get("openDate"))
        if commence and earliest <= commence <= cutoff:
            selected.append(event)

    selected.sort(key=lambda e: e.get("openDate") or "")
    print(f"Found {len(selected)} FanDuel NFL event(s) within {lookahead_hours} hours.")

    refreshed_ids = set()
    refreshed_events = []

    for index, event in enumerate(selected, start=1):
        event_id = str(event["eventId"])
        teams = parse_teams(event)
        print(f"[{index}/{len(selected)}] {teams[0]} @ {teams[1]}")

        try:
            popular = fetch_event_page(event_id, "popular")
            tabs = discover_tabs(popular)
            pages = {"popular": popular}

            for tab in sorted(tabs - {"popular"}):
                try:
                    page = fetch_event_page(event_id, tab)
                    markets = (page.get("attachments") or {}).get("markets") or {}
                    if markets:
                        pages[tab] = page
                except Exception:
                    continue
                time.sleep(0.08)

            parsed = parse_event_props(event, pages, by_norm, profiles)
            refreshed_ids.add(event_id)

            if parsed:
                refreshed_events.append(parsed)
                print(f"  {len(pages)} tab(s), {len(parsed['props'])} player-prop outcomes")
            else:
                print(f"  {len(pages)} tab(s), no player props currently available")
        except Exception as exc:
            print(f"  WARNING: FanDuel fetch failed: {exc}", file=sys.stderr)

        time.sleep(0.15)

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
        "source": "FanDuel public sportsbook web feed",
        "updatedAt": now.isoformat(),
        "lookaheadHours": lookahead_hours,
        "freeFeed": True,
        "events": combined,
    }

    if previous and compact_for_compare(previous) == compact_for_compare(payload):
        print("No odds changes; leaving data file untouched.")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    total_props = sum(len(event.get("props") or []) for event in combined)
    print(f"Wrote {len(combined)} event(s), {total_props} FanDuel prop outcomes.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
