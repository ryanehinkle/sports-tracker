import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from curl_cffi import requests

LOBBY_URL = "https://sbapi.nj.sportsbook.fanduel.com/api/content-managed-page"
EVENT_URL = "https://sbapi.nj.sportsbook.fanduel.com/api/event-page"
PUBLIC_WEB_KEY = "FhMFpcPWXMeyZxOx"
OUT = Path("data/nfl-odds.json")
STATS = Path("data/nfl-stats.json")
TEAM_STATS = Path("data/nfl-team-stats.json")
HISTORY_DIR = Path("data/odds-history")
HISTORY_INDEX = HISTORY_DIR / "index.json"
CENTRAL = ZoneInfo("America/Chicago")
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
    "kicker-props",
    "kicking",
    "player-kicking-props",
    "passing-rushing-props",
    "passing-rushing",
    "qb-props",
    "player-combos",
    "player-combo-props",
    "touchdown-scorers",
    "touchdowns",
    "player-props",
}

TEAM_MARKET_TABS = {
    "popular",
    "game-lines",
    "game-props",
    "alternate-lines",
    "alternate-spreads",
    "alternate-totals",
    "team-totals",
    "team-props",
    "spreads",
    "totals",
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
        return {}, [], {}
    try:
        payload = json.loads(STATS.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}, [], {}

    by_norm = {}
    profiles = []
    for player in payload.get("players") or []:
        profile = {
            "name": player.get("name") or "",
            "team": player.get("team") or "",
            "position": player.get("position") or "",
            "headshot": player.get("headshot") or "",
            "gameLogsBySeason": player.get("gameLogsBySeason") or {},
            "gameLog": player.get("gameLog") or [],
        }
        norm = normalize_name(profile["name"])
        if norm:
            by_norm[norm] = profile
            profiles.append(profile)

    profiles.sort(key=lambda p: len(p["name"]), reverse=True)
    return by_norm, profiles, payload


def load_team_stats():
    if not TEAM_STATS.exists():
        return {}, {}, {}
    try:
        payload = json.loads(TEAM_STATS.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}, {}, {}

    by_abbr = {}
    by_name = {}
    for team in payload.get("teams") or []:
        abbr = str(team.get("abbreviation") or "").upper()
        name = str(team.get("name") or "")
        if abbr:
            by_abbr[abbr] = team
        if name:
            by_name[normalize_name(name)] = team
            by_name[normalize_name(team.get("shortName") or "")] = team
    return by_abbr, by_name, payload


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
            or "spread" in tab
            or "total" in tab
            or "line" in tab
            or "game" in tab
            or "team" in tab
            or tab in {"passing", "receiving", "rushing", "defense", "kicking"}
        )
    }
    return useful | CORE_PROP_TABS | TEAM_MARKET_TABS


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


def decimal_odds(runner):
    odds = runner.get("winRunnerOdds") or {}

    raw = (odds.get("trueOdds") or {}).get("decimalOdds")
    if isinstance(raw, dict):
        raw = raw.get("decimalOdds")

    if raw is None:
        raw = (odds.get("decimalDisplayOdds") or {}).get("decimalOdds")

    try:
        value = float(raw)
        if value > 1:
            return value
    except (TypeError, ValueError):
        pass

    # Fallback for snapshots that only expose rounded American display odds.
    american = american_odds(runner)
    if american is None or american == 0:
        return None
    return 1 + american / 100 if american > 0 else 1 + 100 / abs(american)


def numeric_line(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None



def infer_line(market_name, runner):
    text = f"{market_name} {runner.get('runnerName') or ''}"

    match = re.search(r"(?<!\d)(\d+(?:\.\d+)?)\+", text)
    if match:
        return float(match.group(1)) - 0.5

    match = re.search(r"\b(?:over|under)\s+(\d+(?:\.\d+)?)", text, re.I)
    if match:
        return float(match.group(1))

    for key in ("handicap", "line", "points"):
        line = numeric_line(runner.get(key))
        if line is not None and abs(line) < 10000 and line != 0:
            return line

    lowered = text.lower()
    if "any time touchdown" in lowered or "anytime touchdown" in lowered:
        return 0.5
    if "first touchdown scorer" in lowered or "last touchdown scorer" in lowered:
        return 0.5

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


def clean_player_candidate(value):
    text = str(value or "").strip()
    text = re.sub(r"\s+-\s+Alt\b.*$", "", text, flags=re.I)
    text = re.sub(r"\s+\d+(?:\.\d+)?\+\s*(?:Yards?|Yds?|Receptions?|TDs?|Touchdowns?)?\s*$", "", text, flags=re.I)
    text = re.sub(r"\s+(?:Over|Under)\s+\d+(?:\.\d+)?\s*.*$", "", text, flags=re.I)
    text = re.sub(r"\s{2,}", " ", text).strip(" -:")
    return text


def resolve_player_name(market_name, runner_name, profile):
    if profile:
        return profile["name"]

    market = str(market_name or "")
    if " - " in market:
        left = clean_player_candidate(market.split(" - ", 1)[0])
        if 1 < len(left.split()) <= 5 and not left.lower().startswith(("player ", "team ")):
            return left

    candidate = clean_player_candidate(runner_name)
    if candidate.lower() not in GENERIC_SELECTIONS and 1 < len(candidate.split()) <= 5:
        return candidate

    return ""


def clean_market_label(market_name, player_name):
    label = str(market_name or "").strip()
    if player_name:
        label = re.sub(re.escape(player_name), "", label, flags=re.I).strip(" -:")

    label = re.sub(r"^alt\s+", "", label, flags=re.I)
    label = re.sub(r"\s+-\s+alt\s+", " ", label, flags=re.I)
    label = re.sub(r"\byds\b", "Yards", label, flags=re.I)
    label = re.sub(r"\brec\s+yards\b", "Receiving Yards", label, flags=re.I)
    label = re.sub(r"\brush\s+yards\b", "Rushing Yards", label, flags=re.I)
    label = re.sub(r"\bpass\s+yards\b", "Passing Yards", label, flags=re.I)
    label = re.sub(r"\bpass(?:ing)?\s*(?:\+|plus)\s*rush(?:ing)?\s+yards\b", "Passing + Rushing Yards", label, flags=re.I)
    label = re.sub(r"\bpass\s+tds\b", "Passing TDs", label, flags=re.I)
    label = re.sub(r"\bkicking\s+points\b", "Kicking Points", label, flags=re.I)
    label = re.sub(r"\bfield\s+goals?(?:\s+made)?\b", "Field Goals", label, flags=re.I)
    label = re.sub(r"\s{2,}", " ", label).strip(" -:")
    return label or str(market_name or "Player Prop")

def selection_from_runner(runner_name, market_name):
    text = str(runner_name or "").strip()
    combined = f"{runner_name or ''} {market_name or ''}"
    lower = text.lower()
    if re.search(r"\bover\b", lower):
        return "Over"
    if re.search(r"\bunder\b", lower):
        return "Under"
    if lower in {"yes", "no"}:
        return lower.title()

    if re.search(r"\d+(?:\.\d+)?\+", combined):
        return "Over"
    return "Yes"


def proposition_text(label, selection, line, market_name):
    lowered = str(label or "").lower()
    milestone = bool(
        re.search(r"\d+(?:\.\d+)?\+", label or "")
        or "player to record" in lowered
        or "first touchdown scorer" in lowered
        or "last touchdown scorer" in lowered
        or "any time touchdown scorer" in lowered
        or "anytime touchdown scorer" in lowered
        or "quarter td scorer" in lowered
    )

    if milestone:
        return label

    if selection in {"Over", "Under"} and line is not None:
        pretty_line = str(int(line)) if float(line).is_integer() else str(line)
        return f"{selection} {pretty_line} {label}".strip()

    if selection in {"Yes", "No"}:
        return label if selection == "Yes" else f"{label} — No"

    market = str(market_name or "").strip()
    return label or market or "Player Prop"

def is_player_market(market, player_profiles):
    runners = market.get("runners") or []
    if any(r.get("isPlayerSelection") for r in runners):
        return True

    market_name = str(market.get("marketName") or "")
    runner_text = []
    for runner in runners:
        runner_text.extend([
            runner.get("runnerName"),
            runner.get("name"),
            runner.get("selectionName"),
        ])

    # Some FanDuel combo/kicker markets use a generic market title and place
    # the athlete name only on the runner. Treat those as player markets too.
    if find_profile([market_name, *runner_text], {}, player_profiles):
        return True

    market_type = str(market.get("marketType") or market.get("marketTypeId") or "").upper()
    return "PLAYER" in market_type


def _team_from_text(text, away_team, home_team):
    lowered = str(text or "").lower()
    candidates = [
        (away_team, TEAM_ABBR.get(away_team, "")),
        (home_team, TEAM_ABBR.get(home_team, "")),
    ]
    for full_name, abbr in candidates:
        nickname = full_name.split()[-1].lower()
        if full_name.lower() in lowered or (abbr and re.search(rf"\b{re.escape(abbr.lower())}\b", lowered)):
            return full_name, abbr
        # Nicknames are safe enough for NFL event-local matching.
        if len(nickname) >= 4 and re.search(rf"\b{re.escape(nickname)}\b", lowered):
            return full_name, abbr
    return "", ""


def _full_game_team_market(market_name, market_type):
    text = f"{market_name} {market_type}".lower()
    if re.search(r"\b(?:1q|2q|3q|4q|1h|2h)\b|quarter|half|drive|race to|first to", text):
        return None
    if "team total" in text or "team points" in text:
        return "teamTotal"
    if "moneyline" in text or "money line" in text or "match winner" in text or "money_line" in text:
        return "moneyline"
    if "spread" in text or "handicap" in text:
        return "spread"
    if "total" in text or "over/under" in text or "over under" in text:
        return "gameTotal"
    return None


def _signed_handicap(runner, fallback=None):
    for key in ("handicap", "line", "points"):
        raw = runner.get(key)
        try:
            value = float(raw)
            if abs(value) < 1000:
                return value
        except (TypeError, ValueError):
            pass
    text = str(runner.get("runnerName") or "")
    match = re.search(r"(?<!\d)([+-]\d+(?:\.\d+)?)\b", text)
    if match:
        return float(match.group(1))
    return fallback


def _team_prop_record(event, market, market_id, runner, tab, away_team, home_team):
    market_name = str(market.get("marketName") or "Game Market").strip()
    market_type = str(market.get("marketType") or market.get("marketTypeId") or "")
    kind = _full_game_team_market(market_name, market_type)
    if not kind:
        return None

    odds = american_odds(runner)
    decimal = decimal_odds(runner)
    if odds is None:
        return None

    runner_name = str(runner.get("runnerName") or runner.get("name") or runner.get("selectionName") or "").strip()
    team_name, team_abbr = _team_from_text(f"{market_name} {runner_name}", away_team, home_team)
    selection = selection_from_runner(runner_name, market_name)
    alternate = bool("ALT" in market_type.upper() or "alt" in market_name.lower() or "alternate" in market_name.lower())

    if kind == "moneyline":
        if not team_abbr:
            return None
        selection = "Win"
        line = None
        label = "Moneyline"
        proposition = f"{team_abbr} Moneyline"
        scope = "team"
    elif kind == "spread":
        if not team_abbr:
            return None
        line = _signed_handicap(runner, infer_line(market_name, runner))
        if line is None:
            return None
        selection = "Cover"
        label = "Alt Spread" if alternate else "Spread"
        pretty = f"{line:+g}"
        proposition = f"{team_abbr} {pretty} {label}"
        scope = "team"
    elif kind == "teamTotal":
        if not team_abbr:
            return None
        line = infer_line(market_name, runner)
        if line is None:
            return None
        if selection not in {"Over", "Under"}:
            selection = "Over" if "over" in runner_name.lower() else "Under" if "under" in runner_name.lower() else selection
        label = "Alt Team Total" if alternate else "Team Total"
        proposition = f"{selection} {line:g} {team_abbr} {label}"
        scope = "team"
    else:
        line = infer_line(market_name, runner)
        if line is None:
            return None
        if selection not in {"Over", "Under"}:
            selection = "Over" if "over" in runner_name.lower() else "Under" if "under" in runner_name.lower() else selection
        label = "Alt Game Total" if alternate else "Game Total"
        proposition = f"{selection} {line:g} {label}"
        scope = "game"
        team_name = ""
        team_abbr = ""

    return {
        "scope": scope,
        "player": "",
        "team": team_abbr,
        "teamName": team_name,
        "position": "TEAM" if scope == "team" else "GAME",
        "headshot": "",
        "marketKey": market_type or market_name,
        "market": label,
        "teamMarketType": kind,
        "alternate": alternate,
        "selection": selection,
        "line": line,
        "odds": odds,
        "decimalOdds": decimal,
        "proposition": proposition,
        "lastUpdate": datetime.now(timezone.utc).isoformat(),
        "link": "",
        "sourceTab": tab,
        "marketId": str(market.get("marketId") or market_id),
        "selectionId": str(runner.get("selectionId") or ""),
    }


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
            market_name = str(market.get("marketName") or "Player Prop").strip()
            market_type = str(market.get("marketType") or market.get("marketTypeId") or "")
            market_status = str(market.get("marketStatus") or market.get("status") or "").upper()
            if market_status and market_status not in {"OPEN", "ACTIVE"}:
                continue

            player_market = is_player_market(market, profiles)

            for runner in market.get("runners") or []:
                runner_status = str(runner.get("runnerStatus") or runner.get("status") or "").upper()
                if runner_status and runner_status not in {"ACTIVE", "OPEN"}:
                    continue

                if not player_market:
                    team_prop = _team_prop_record(event, market, market_id, runner, tab, away_team, home_team)
                    if not team_prop:
                        continue
                    key = (
                        team_prop["scope"],
                        team_prop.get("team") or "",
                        team_prop["market"].lower(),
                        team_prop["selection"],
                        str(team_prop.get("line")),
                    )
                    prop_map[key] = team_prop
                    continue

                odds = american_odds(runner)
                decimal = decimal_odds(runner)
                if odds is None:
                    continue

                runner_name = str(runner.get("runnerName") or "").strip()
                profile = find_profile(
                    [market_name, runner_name, runner.get("name"), runner.get("selectionName")],
                    by_norm,
                    profiles,
                )

                player_name = resolve_player_name(market_name, runner_name, profile)
                if not player_name:
                    continue
                if not profile:
                    profile = by_norm.get(normalize_name(player_name), {})

                selection = selection_from_runner(runner_name, market_name)
                line = infer_line(market_name, runner)
                label = clean_market_label(market_name, player_name)

                combined_text = f"{market_name} {runner_name}"
                alternate = bool(
                    "ALT" in market_type.upper()
                    or "alt" in market_name.lower()
                    or "alternate" in market_name.lower()
                    or re.search(r"\d+(?:\.\d+)?\+", combined_text)
                )

                proposition = proposition_text(label, selection, line, market_name)

                key = (
                    "player",
                    normalize_name(player_name),
                    label.lower(),
                    selection,
                    str(line),
                )

                prop_map[key] = {
                    "scope": "player",
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
                    "decimalOdds": decimal,
                    "proposition": proposition,
                    "lastUpdate": datetime.now(timezone.utc).isoformat(),
                    "link": "",
                    "sourceTab": tab,
                    "marketId": str(market.get("marketId") or market_id),
                    "selectionId": str(runner.get("selectionId") or ""),
                }

    props = list(prop_map.values())
    props.sort(key=lambda p: (
        p.get("scope") or "player",
        p.get("player") or p.get("team") or "",
        p["market"],
        p["line"] if p["line"] is not None else -9999,
        p["selection"],
    ))

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



def _safe_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _metric_spec(prop):
    market = str(prop.get("market") or "").lower()
    proposition = str(prop.get("proposition") or "").lower()
    text = re.sub(r"\s+", " ", f"{market} {proposition}")

    # ESPN game logs are full-game totals. Period/drive markets must never be
    # compared with full-game stats; they require play-by-play/drive-level data.
    if re.search(r"first touchdown scorer|last touchdown scorer|quarter td scorer|\b(?:1q|2q|3q|4q|1h|2h)\b|\bquarter\b|\bhalf\b|\bdrive\b|\bmost\s+(?:rushing|receiving|passing)\s+yards\b", text):
        return None

    match = re.search(r"(?:player\s+)?to record a (\d+(?:\.\d+)?)\+ yard reception", text)
    if match:
        return {"metric": "receivingLongest", "threshold": float(match.group(1)), "comparison": "gte"}

    match = re.search(r"(?:score\s+)?(\d+(?:\.\d+)?)\+ touchdowns?", text)
    if match:
        return {"metric": "touchdowns", "threshold": float(match.group(1)), "comparison": "gte"}

    if "any time touchdown scorer" in text or "anytime touchdown scorer" in text:
        return {"metric": "touchdowns", "threshold": 1.0, "comparison": "gte"}
    if re.search(r"pass\s*\+\s*rush\s*\+\s*rec.*yards|pass.*rush.*reception.*yards", text):
        return {"metric": "passRushRecYards"}
    if re.search(r"pass(?:ing)?\s*(?:\+|plus)\s*rush(?:ing)?.*yards", text):
        return {"metric": "passRushYards"}
    if re.search(r"rush(?:ing)?\s*\+\s*receiv.*yards|rush.*receiv.*yards", text):
        return {"metric": "allPurposeYards"}
    if "passing yards" in text:
        return {"metric": "passingYards"}
    if "receiving yards" in text:
        return {"metric": "receivingYards"}
    if "rushing yards" in text:
        return {"metric": "rushingYards"}
    if "receptions" in text and "longest" not in text:
        return {"metric": "receptions"}
    if "passing tds" in text or "passing touchdowns" in text:
        return {"metric": "passingTouchdowns"}
    if "receiving tds" in text or "receiving touchdowns" in text:
        return {"metric": "receivingTouchdowns"}
    if "rushing tds" in text or "rushing touchdowns" in text:
        return {"metric": "rushingTouchdowns"}
    if "rushing attempts" in text or "rush attempts" in text:
        return {"metric": "rushingAttempts"}
    if "pass attempts" in text or "passing attempts" in text:
        return {"metric": "passingAttempts"}
    if "pass completions" in text or "passing completions" in text:
        return {"metric": "passingCompletions"}
    if "interceptions thrown" in text or "pass interceptions" in text:
        return {"metric": "passingInterceptions"}
    if "longest completion" in text or "longest pass" in text:
        return {"metric": "passingLongest"}
    if "longest reception" in text:
        return {"metric": "receivingLongest"}
    if "longest rush" in text:
        return {"metric": "rushingLongest"}
    if "solo tackles" in text:
        return {"metric": "soloTackles"}
    if "tackles + assists" in text:
        return {"metric": "totalTackles"}
    if re.search(r"(?:player\s+)?to record a sack|\brecord a sack\b", text):
        return {"metric": "sacks", "threshold": 1.0, "comparison": "gte"}
    if re.search(r"\bsacks\b", text):
        return {"metric": "sacks"}
    if "defensive interceptions" in text:
        return {"metric": "defensiveInterceptions"}
    if "field goals" in text:
        return {"metric": "fieldGoalsMade"}
    if "kicking points" in text:
        return {"metric": "kickingPoints"}
    if market.strip() in {"touchdown", "touchdowns"} or " total touchdowns" in text:
        return {"metric": "touchdowns"}
    return None


def _metric_value(game, spec):
    if not game or not spec:
        return None
    metric = spec.get("metric")
    if metric == "passRushYards":
        return _safe_number(game.get("passingYards")) + _safe_number(game.get("rushingYards"))
    if metric == "passRushRecYards":
        return (
            _safe_number(game.get("passingYards"))
            + _safe_number(game.get("rushingYards"))
            + _safe_number(game.get("receivingYards"))
        )
    if metric == "allPurposeYards":
        return _safe_number(game.get("rushingYards")) + _safe_number(game.get("receivingYards"))
    if metric == "touchdowns":
        return _safe_number(game.get("rushingTouchdowns")) + _safe_number(game.get("receivingTouchdowns"))
    value = game.get(metric)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _prop_hit(prop, game):
    spec = _metric_spec(prop)
    if not spec:
        return None
    value = _metric_value(game, spec)
    if value is None:
        return None

    if spec.get("comparison") == "gte":
        return value >= float(spec["threshold"])

    line = prop.get("line")
    try:
        line = float(line)
    except (TypeError, ValueError):
        return None

    selection = str(prop.get("selection") or "")
    if selection == "Under":
        return value < line
    if selection == "Over":
        return value > line
    if selection == "Yes":
        return value > line
    if selection == "No":
        return value <= line
    return None


def _rate_for_games(prop, games):
    hits = 0
    total = 0
    for game in games:
        result = _prop_hit(prop, game)
        if result is None:
            continue
        total += 1
        if result:
            hits += 1
    if not total:
        return None
    return {
        "pct": round(hits / total * 100),
        "hits": hits,
        "total": total,
    }


def _season_logs(profile, season, current_season):
    by_season = profile.get("gameLogsBySeason") or {}
    logs = by_season.get(str(season))
    if isinstance(logs, list):
        return [game for game in logs if game.get("played")]
    if season == current_season:
        return [game for game in (profile.get("gameLog") or []) if game.get("played")]
    return []


def _all_logs_newest_first(profile, current_season):
    by_season = profile.get("gameLogsBySeason") or {}
    years = sorted(
        [int(year) for year in by_season.keys() if str(year).isdigit()],
        reverse=True,
    )
    if not years and profile.get("gameLog"):
        years = [current_season]

    result = []
    for year in years:
        logs = _season_logs(profile, year, current_season)
        logs = sorted(logs, key=lambda game: int(game.get("week") or 0), reverse=True)
        for game in logs:
            copy = dict(game)
            copy["_season"] = year
            result.append(copy)
    return result


def _opponent_for_prop(event, prop, profile):
    profile = profile or {}
    team = str(prop.get("team") or profile.get("team") or "").upper()
    home = str(event.get("homeAbbr") or "").upper()
    away = str(event.get("awayAbbr") or "").upper()
    if team and team == home:
        return away
    if team and team == away:
        return home
    return ""


def _hit_rates_for_prop(event, prop, profile, current_season):
    if not profile or not _metric_spec(prop):
        return {"l5": None, "l10": None, "h2h": None, "current": None, "previous": None}

    all_logs = _all_logs_newest_first(profile, current_season)
    opponent = _opponent_for_prop(event, prop, profile)
    h2h = [
        game for game in all_logs
        if str((game.get("opponent") or {}).get("abbreviation") or "").upper() == opponent
    ] if opponent else []

    current_logs = _season_logs(profile, current_season, current_season)
    previous_logs = _season_logs(profile, current_season - 1, current_season)

    return {
        "l5": _rate_for_games(prop, all_logs[:5]),
        "l10": _rate_for_games(prop, all_logs[:10]),
        "h2h": _rate_for_games(prop, h2h),
        "current": _rate_for_games(prop, current_logs),
        "previous": _rate_for_games(prop, previous_logs),
    }


def _team_logs(team, season, current_season):
    if not team:
        return []
    by = team.get("gameLogsBySeason") or {}
    rows = by.get(str(season))
    if isinstance(rows, list):
        return [dict(game, _season=season) for game in rows if game]
    if season == current_season:
        return [dict(game, _season=season) for game in (team.get("gameLog") or []) if game]
    return []


def _team_prop_outcome(prop, game):
    if not game:
        return None
    kind = prop.get("teamMarketType")
    selection = str(prop.get("selection") or "")
    line = prop.get("line")
    try:
        line = float(line) if line is not None else None
    except (TypeError, ValueError):
        line = None

    stats = game.get("stats") or {}
    points_for = _safe_number(stats.get("derived.pointsFor"))
    points_against = _safe_number(stats.get("derived.pointsAgainst"))
    diff = points_for - points_against

    if kind == "moneyline":
        if diff == 0:
            return None
        return diff > 0
    if kind == "spread" and line is not None:
        margin = diff + line
        if abs(margin) < 1e-9:
            return None
        return margin > 0
    if kind == "teamTotal" and line is not None:
        value = points_for
    elif kind == "gameTotal" and line is not None:
        value = points_for + points_against
    else:
        return None

    if abs(value - line) < 1e-9:
        return None
    return value < line if selection == "Under" else value > line


def _rate_for_team_games(prop, games):
    outcomes = [_team_prop_outcome(prop, game) for game in games]
    outcomes = [value for value in outcomes if value is not None]
    if not outcomes:
        return None
    hits = sum(1 for value in outcomes if value)
    return {"hits": hits, "total": len(outcomes), "pct": round(hits / len(outcomes) * 100, 1)}


def _hit_rates_for_team_prop(event, prop, team_by_abbr, team_payload):
    current_season = int(team_payload.get("season") or datetime.now(timezone.utc).year)
    team_abbr = str(prop.get("team") or event.get("homeAbbr") or "").upper()
    team = team_by_abbr.get(team_abbr)
    if not team:
        return {"l5": None, "l10": None, "h2h": None, "current": None, "previous": None}

    current_logs = _team_logs(team, current_season, current_season)
    previous_logs = _team_logs(team, current_season - 1, current_season)
    all_logs = sorted(current_logs + previous_logs, key=lambda g: (int(g.get("_season") or 0), int(g.get("week") or 0)), reverse=True)

    opponent = event.get("awayAbbr") if team_abbr == event.get("homeAbbr") else event.get("homeAbbr")
    h2h = [
        game for game in (current_logs + previous_logs)
        if str((game.get("opponent") or {}).get("abbreviation") or "").upper() == str(opponent or "").upper()
    ]

    return {
        "l5": _rate_for_team_games(prop, all_logs[:5]),
        "l10": _rate_for_team_games(prop, all_logs[:10]),
        "h2h": _rate_for_team_games(prop, h2h),
        "current": _rate_for_team_games(prop, current_logs),
        "previous": _rate_for_team_games(prop, previous_logs),
    }


def enrich_hit_rates(payload, by_norm, stats_payload, team_by_abbr=None, team_payload=None):
    current_season = int(stats_payload.get("season") or datetime.now(timezone.utc).year)
    team_by_abbr = team_by_abbr or {}
    team_payload = team_payload or {}
    enriched = 0
    for event in payload.get("events") or []:
        for prop in event.get("props") or []:
            if prop.get("scope") in {"team", "game"}:
                prop["hitRates"] = _hit_rates_for_team_prop(event, prop, team_by_abbr, team_payload)
            else:
                profile = by_norm.get(normalize_name(prop.get("player")))
                prop["hitRates"] = _hit_rates_for_prop(event, prop, profile, current_season)
            enriched += 1
    return enriched


def history_only():
    previous = load_previous()
    if not previous:
        print("No odds file exists yet; skipping history enrichment.")
        return

    by_norm, _, stats_payload = load_stats_players()
    team_by_abbr, _, team_payload = load_team_stats()
    if not by_norm and not team_by_abbr:
        print("No player/team stats available; skipping history enrichment.")
        return

    original = json.loads(json.dumps(previous))
    enriched = enrich_hit_rates(previous, by_norm, stats_payload, team_by_abbr, team_payload)
    graded = grade_history(by_norm, stats_payload, team_by_abbr, team_payload)

    if compact_for_compare(original) == compact_for_compare(previous):
        print(f"Historical hit rates already current for {enriched} live prop outcomes.")
    else:
        OUT.write_text(json.dumps(previous, indent=2) + "\n", encoding="utf-8")
        print(f"Updated historical hit rates for {enriched} live prop outcomes.")
    if graded:
        print(f"Graded {graded} archived prop outcome(s).")


def _event_local_date(event):
    commence = iso_dt(event.get("commenceTime"))
    return commence.astimezone(CENTRAL).date().isoformat() if commence else None


def _history_file(date_key):
    return HISTORY_DIR / f"{date_key}.json"


def _load_history_day(date_key):
    path = _history_file(date_key)
    if not path.exists():
        return {"date": date_key, "createdAt": datetime.now(timezone.utc).isoformat(), "events": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"date": date_key, "createdAt": datetime.now(timezone.utc).isoformat(), "events": []}


def _write_history_day(payload):
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    payload["updatedAt"] = datetime.now(timezone.utc).isoformat()
    _history_file(payload["date"]).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _event_snapshot_candidate(event, previous_events, now):
    commence = iso_dt(event.get("commenceTime"))
    if not commence:
        return None
    # Freeze the board when a refresh lands roughly one hour before kickoff.
    # If this run is just after kickoff, use the previous refresh if it was pregame.
    if commence - timedelta(minutes=75) <= now < commence:
        return event
    if commence <= now <= commence + timedelta(hours=3):
        previous = previous_events.get(str(event.get("id") or ""))
        prev_update = iso_dt(previous.get("lastUpdate")) if previous else None
        if previous and prev_update and prev_update < commence:
            return previous
    return None


def archive_due_events(payload, previous_events, now):
    changed = 0
    by_date = {}
    for event in payload.get("events") or []:
        candidate = _event_snapshot_candidate(event, previous_events, now)
        if not candidate:
            continue
        date_key = _event_local_date(candidate)
        if not date_key:
            continue
        day = by_date.setdefault(date_key, _load_history_day(date_key))
        frozen_ids = {str(item.get("id") or "") for item in day.get("events") or []}
        event_id = str(candidate.get("id") or "")
        if event_id in frozen_ids:
            continue
        frozen = json.loads(json.dumps(candidate))
        frozen["snapshotAt"] = now.isoformat()
        frozen["snapshotKind"] = "last-pregame"
        for prop in frozen.get("props") or []:
            prop["result"] = {"status": "pending"}
        day.setdefault("events", []).append(frozen)
        day["events"].sort(key=lambda item: item.get("commenceTime") or "")
        changed += 1

    for day in by_date.values():
        _write_history_day(day)
    if changed:
        _rebuild_history_index()
    return changed


def _all_profile_logs(profile, current_season):
    rows = []
    if not profile:
        return rows
    by = profile.get("gameLogsBySeason") or {}
    for season, games in by.items():
        try:
            season_num = int(season)
        except (TypeError, ValueError):
            continue
        for game in games or []:
            if game.get("played"):
                rows.append(dict(game, _season=season_num))
    if not by:
        for game in profile.get("gameLog") or []:
            if game.get("played"):
                rows.append(dict(game, _season=current_season))
    return rows


def _date_distance_hours(game_date, event_time):
    game_dt = iso_dt(game_date)
    event_dt = iso_dt(event_time)
    if not game_dt or not event_dt:
        return 99999
    return abs((game_dt - event_dt).total_seconds()) / 3600


def _match_player_game(event, prop, profile, current_season):
    opponent = _opponent_for_prop(event, prop, profile)
    candidates = []
    for game in _all_profile_logs(profile, current_season):
        game_opp = str((game.get("opponent") or {}).get("abbreviation") or "").upper()
        if opponent and game_opp != opponent:
            continue
        distance = _date_distance_hours(game.get("date"), event.get("commenceTime"))
        if distance <= 48:
            candidates.append((distance, game))
    if candidates:
        candidates.sort(key=lambda item: item[0])
        return candidates[0][1]
    return None


def _match_team_game(event, prop, team_by_abbr, team_payload):
    current_season = int(team_payload.get("season") or datetime.now(timezone.utc).year)
    team_abbr = str(prop.get("team") or event.get("homeAbbr") or "").upper()
    team = team_by_abbr.get(team_abbr)
    if not team:
        return None
    opponent = event.get("awayAbbr") if team_abbr == event.get("homeAbbr") else event.get("homeAbbr")
    candidates = []
    by = team.get("gameLogsBySeason") or {}
    seasons = [current_season - 1, current_season]
    for season in seasons:
        games = by.get(str(season)) or (team.get("gameLog") or [] if season == current_season else [])
        for game in games:
            game_opp = str((game.get("opponent") or {}).get("abbreviation") or "").upper()
            if opponent and game_opp != str(opponent or "").upper():
                continue
            distance = _date_distance_hours(game.get("date"), event.get("commenceTime"))
            if distance <= 48:
                candidates.append((distance, game))
    if candidates:
        candidates.sort(key=lambda item: item[0])
        return candidates[0][1]
    return None


def _grade_player_prop(event, prop, profile, current_season):
    game = _match_player_game(event, prop, profile, current_season)
    spec = _metric_spec(prop)
    if not game or not spec:
        return None
    value = _metric_value(game, spec)
    if value is None:
        return None

    if spec.get("comparison") == "gte":
        hit = value >= float(spec["threshold"])
        return {"status": "hit" if hit else "miss", "actual": value}

    try:
        line = float(prop.get("line"))
    except (TypeError, ValueError):
        return None
    selection = str(prop.get("selection") or "")
    if selection in {"Over", "Under"} and abs(value - line) < 1e-9:
        return {"status": "push", "actual": value}
    if selection == "Under":
        hit = value < line
    elif selection == "No":
        hit = value <= line
    else:
        hit = value > line
    return {"status": "hit" if hit else "miss", "actual": value}


def _grade_team_prop(event, prop, team_by_abbr, team_payload):
    game = _match_team_game(event, prop, team_by_abbr, team_payload)
    if not game:
        return None
    kind = prop.get("teamMarketType")
    stats = game.get("stats") or {}
    points_for = _safe_number(stats.get("derived.pointsFor"))
    points_against = _safe_number(stats.get("derived.pointsAgainst"))
    diff = points_for - points_against
    actual = None

    if kind == "moneyline":
        if diff == 0:
            return {"status": "push", "actual": diff}
        return {"status": "hit" if diff > 0 else "miss", "actual": diff}
    try:
        line = float(prop.get("line"))
    except (TypeError, ValueError):
        return None
    if kind == "spread":
        actual = diff + line
        if abs(actual) < 1e-9:
            return {"status": "push", "actual": diff}
        return {"status": "hit" if actual > 0 else "miss", "actual": diff}
    if kind == "teamTotal":
        actual = points_for
    elif kind == "gameTotal":
        actual = points_for + points_against
    else:
        return None
    if abs(actual - line) < 1e-9:
        return {"status": "push", "actual": actual}
    hit = actual < line if str(prop.get("selection") or "") == "Under" else actual > line
    return {"status": "hit" if hit else "miss", "actual": actual}


def grade_history(by_norm, stats_payload, team_by_abbr, team_payload):
    if not HISTORY_DIR.exists():
        return 0
    current_season = int(stats_payload.get("season") or datetime.now(timezone.utc).year)
    changed = 0
    for path in sorted(HISTORY_DIR.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            day = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        day_changed = False
        for event in day.get("events") or []:
            commence = iso_dt(event.get("commenceTime"))
            if commence and commence > datetime.now(timezone.utc):
                continue
            for prop in event.get("props") or []:
                current = (prop.get("result") or {}).get("status")
                if current in {"hit", "miss", "push"}:
                    continue
                if prop.get("scope") in {"team", "game"}:
                    result = _grade_team_prop(event, prop, team_by_abbr, team_payload)
                else:
                    profile = by_norm.get(normalize_name(prop.get("player")))
                    result = _grade_player_prop(event, prop, profile, current_season)
                if result:
                    result["gradedAt"] = datetime.now(timezone.utc).isoformat()
                    prop["result"] = result
                    day_changed = True
                    changed += 1
        if day_changed:
            _write_history_day(day)
    if changed:
        _rebuild_history_index()
    return changed


def _rebuild_history_index():
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    days = []
    for path in sorted(HISTORY_DIR.glob("*.json"), reverse=True):
        if path.name == "index.json":
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        props = [prop for event in payload.get("events") or [] for prop in (event.get("props") or [])]
        statuses = [(prop.get("result") or {}).get("status") for prop in props]
        complete = bool(props) and all(status in {"hit", "miss", "push"} for status in statuses)
        days.append({
            "date": payload.get("date") or path.stem,
            "file": path.name,
            "events": len(payload.get("events") or []),
            "props": len(props),
            "status": "complete" if complete else "pending",
        })
    HISTORY_INDEX.write_text(json.dumps({
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "days": days,
    }, indent=2) + "\n", encoding="utf-8")


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

    by_norm, profiles, stats_payload = load_stats_players()
    team_by_abbr, _, team_payload = load_team_stats()
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
                player_count = sum(1 for prop in parsed["props"] if prop.get("scope") == "player")
                team_count = len(parsed["props"]) - player_count
                print(f"  {len(pages)} tab(s), {player_count} player + {team_count} team/game outcomes")
            else:
                print(f"  {len(pages)} tab(s), no supported full-game markets currently available")
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

    enriched = enrich_hit_rates(payload, by_norm, stats_payload, team_by_abbr, team_payload)
    print(f"Enriched {enriched} prop outcomes with historical hit rates.")

    archived = archive_due_events(payload, previous_events, now)
    graded = grade_history(by_norm, stats_payload, team_by_abbr, team_payload)
    if archived:
        print(f"Frozen {archived} event board(s) into pregame history.")
    if graded:
        print(f"Graded {graded} historical prop outcome(s).")

    odds_changed = not (previous and compact_for_compare(previous) == compact_for_compare(payload))
    if not odds_changed:
        print("No live odds changes; leaving live data file untouched.")
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    total_props = sum(len(event.get("props") or []) for event in combined)
    all_props = [prop for event in combined for prop in (event.get("props") or [])]
    pass_rush = sum(
        1 for prop in all_props
        if re.search(r"pass(?:ing)?\s*\+\s*rush(?:ing)?.*yards", f"{prop.get('market') or ''} {prop.get('proposition') or ''}", re.I)
    )
    kicking_points = sum(
        1 for prop in all_props
        if "kicking points" in f"{prop.get('market') or ''} {prop.get('proposition') or ''}".lower()
    )
    field_goals = sum(
        1 for prop in all_props
        if "field goals" in f"{prop.get('market') or ''} {prop.get('proposition') or ''}".lower()
    )
    print(f"Wrote {len(combined)} event(s), {total_props} FanDuel prop outcomes.")
    print(
        "Supported combo/kicker outcomes: "
        f"passing+rushing={pass_rush}, kicking points={kicking_points}, field goals={field_goals}"
    )


if __name__ == "__main__":
    try:
        if "--history-only" in sys.argv:
            history_only()
        else:
            main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
