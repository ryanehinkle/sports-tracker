import json
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests

CORE_STATS = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{season}/types/2/teams/{team_id}/statistics"
WEEK_EVENTS = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{season}/types/2/weeks/{week}/events"
CDN_GAME = "https://cdn.espn.com/core/nfl/game"
PLAYER_STATS = Path("data/nfl-stats.json")
OUT = Path("data/nfl-team-stats.json")
SCHEMA_VERSION = 1
TIMEOUT = 30

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Origin": "https://www.espn.com",
    "Referer": "https://www.espn.com/",
}

CURATED = {
    "overview": [
        ("derived.gamesPlayed", "GP", "Games Played", "derived.gamesPlayed"),
        ("derived.wins", "W", "Wins", "derived.win"),
        ("derived.losses", "L", "Losses", "derived.loss"),
        ("derived.pointsFor", "PF", "Points For", "derived.pointsFor"),
        ("derived.pointsPerGame", "PPG", "Points / Game", "derived.pointsFor"),
        ("derived.pointsAgainst", "PA", "Points Against", "derived.pointsAgainst"),
        ("derived.pointsAllowedPerGame", "PA/G", "Points Allowed / Game", "derived.pointsAgainst"),
        ("derived.pointDifferential", "DIFF", "Point Differential", "derived.pointDifferential"),
        ("derived.totalYards", "YDS", "Total Yards", "totalYards"),
        ("derived.yardsPerGame", "Y/G", "Yards / Game", "totalYards"),
        ("derived.totalYardsAllowed", "YDS A", "Total Yards Allowed", "derived.totalYardsAllowed"),
        ("derived.yardsAllowedPerGame", "YA/G", "Yards Allowed / Game", "derived.totalYardsAllowed"),
        ("derived.turnoverDifferential", "TO +/-", "Turnover Differential", "derived.turnoverDifferential"),
    ],
    "offense": [
        ("derived.pointsFor", "PTS", "Points", "derived.pointsFor"),
        ("derived.pointsPerGame", "PPG", "Points / Game", "derived.pointsFor"),
        ("derived.totalYards", "YDS", "Total Yards", "totalYards"),
        ("derived.yardsPerGame", "Y/G", "Yards / Game", "totalYards"),
        ("derived.firstDowns", "1ST", "First Downs", "firstDowns"),
        ("derived.firstDownsPerGame", "1ST/G", "First Downs / Game", "firstDowns"),
        ("derived.passingYards", "PASS", "Passing Yards", "passingYards"),
        ("derived.passingYardsPerGame", "P Y/G", "Passing Yards / Game", "passingYards"),
        ("derived.rushingYards", "RUSH", "Rushing Yards", "rushingYards"),
        ("derived.rushingYardsPerGame", "R Y/G", "Rushing Yards / Game", "rushingYards"),
    ],
    "defense": [
        ("derived.pointsAgainst", "PA", "Points Allowed", "derived.pointsAgainst"),
        ("derived.pointsAllowedPerGame", "PA/G", "Points Allowed / Game", "derived.pointsAgainst"),
        ("derived.totalYardsAllowed", "YDS A", "Total Yards Allowed", "derived.totalYardsAllowed"),
        ("derived.yardsAllowedPerGame", "YA/G", "Yards Allowed / Game", "derived.totalYardsAllowed"),
        ("derived.passingYardsAllowed", "PASS A", "Passing Yards Allowed", "derived.passingYardsAllowed"),
        ("derived.passYardsAllowedPerGame", "PY A/G", "Pass Yards Allowed / Game", "derived.passingYardsAllowed"),
        ("derived.rushingYardsAllowed", "RUSH A", "Rushing Yards Allowed", "derived.rushingYardsAllowed"),
        ("derived.rushYardsAllowedPerGame", "RY A/G", "Rush Yards Allowed / Game", "derived.rushingYardsAllowed"),
        ("derived.firstDownsAllowed", "1ST A", "First Downs Allowed", "derived.firstDownsAllowed"),
        ("derived.takeaways", "TAKE", "Takeaways", "derived.takeaways"),
    ],
    "situational": [
        ("derived.thirdDownConversions", "3D CONV", "Third Down Conversions", "derived.thirdDownConversions"),
        ("derived.thirdDownAttempts", "3D ATT", "Third Down Attempts", "derived.thirdDownAttempts"),
        ("derived.thirdDownPct", "3D %", "Third Down %", "derived.thirdDownPct"),
        ("derived.fourthDownConversions", "4D CONV", "Fourth Down Conversions", "derived.fourthDownConversions"),
        ("derived.fourthDownAttempts", "4D ATT", "Fourth Down Attempts", "derived.fourthDownAttempts"),
        ("derived.fourthDownPct", "4D %", "Fourth Down %", "derived.fourthDownPct"),
        ("derived.redZoneScores", "RZ SCORE", "Red Zone Scores", "derived.redZoneScores"),
        ("derived.redZoneAttempts", "RZ ATT", "Red Zone Attempts", "derived.redZoneAttempts"),
        ("derived.redZonePct", "RZ %", "Red Zone %", "derived.redZonePct"),
        ("derived.possessionSecondsPerGame", "TOP", "Possession / Game", "derived.possessionSeconds"),
    ],
    "turnovers": [
        ("derived.giveaways", "GIVE", "Giveaways", "derived.giveaways"),
        ("derived.takeaways", "TAKE", "Takeaways", "derived.takeaways"),
        ("derived.turnoverDifferential", "TO +/-", "Turnover Differential", "derived.turnoverDifferential"),
        ("derived.penalties", "PEN", "Penalties", "derived.penalties"),
        ("derived.penaltyYards", "PEN YDS", "Penalty Yards", "derived.penaltyYards"),
        ("derived.penaltiesPerGame", "PEN/G", "Penalties / Game", "derived.penalties"),
        ("derived.penaltyYardsPerGame", "PY/G", "Penalty Yards / Game", "derived.penaltyYards"),
    ],
}


def get_json(url, params=None):
    last_error = None
    for attempt in range(3):
        try:
            response = requests.get(url, params=params, headers=UA, timeout=TIMEOUT)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.2 * (attempt + 1))
    raise last_error


def load_json(path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def current_context():
    player_payload = load_json(PLAYER_STATS)
    if player_payload.get("season"):
        return int(player_payload["season"]), int(player_payload.get("currentWeek") or 1)
    now = datetime.now(timezone.utc)
    season = now.year if now.month >= 7 else now.year - 1
    return season, 18


def normalize(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def numeric(value):
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)) and math.isfinite(value):
        return value
    if value is None:
        return None
    text = str(value).strip().replace(",", "").replace("%", "")
    try:
        result = float(text)
        return int(result) if result.is_integer() else result
    except ValueError:
        return None


def number_from_stat(stat):
    value = numeric(stat.get("value"))
    if value is not None:
        return value
    display = str(stat.get("displayValue") or "").strip()
    if re.fullmatch(r"-?\d+(?:\.\d+)?%?", display):
        return numeric(display)
    return None


def pair_from_display(value):
    match = re.search(r"(-?\d+)\s*[-/]\s*(-?\d+)", str(value or ""))
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def time_seconds(value):
    match = re.fullmatch(r"\s*(\d+):(\d{2})\s*", str(value or ""))
    if not match:
        return None
    return int(match.group(1)) * 60 + int(match.group(2))


def stat_lookup(stats, *names):
    normalized = {normalize(k): v for k, v in stats.items()}
    for name in names:
        key = normalize(name)
        if key in normalized and normalized[key] is not None:
            return numeric(normalized[key])
    return None


def team_list():
    rows = [
        ("22", "Arizona Cardinals", "Cardinals", "ARI"),
        ("1", "Atlanta Falcons", "Falcons", "ATL"),
        ("33", "Baltimore Ravens", "Ravens", "BAL"),
        ("2", "Buffalo Bills", "Bills", "BUF"),
        ("29", "Carolina Panthers", "Panthers", "CAR"),
        ("3", "Chicago Bears", "Bears", "CHI"),
        ("4", "Cincinnati Bengals", "Bengals", "CIN"),
        ("5", "Cleveland Browns", "Browns", "CLE"),
        ("6", "Dallas Cowboys", "Cowboys", "DAL"),
        ("7", "Denver Broncos", "Broncos", "DEN"),
        ("8", "Detroit Lions", "Lions", "DET"),
        ("9", "Green Bay Packers", "Packers", "GB"),
        ("34", "Houston Texans", "Texans", "HOU"),
        ("11", "Indianapolis Colts", "Colts", "IND"),
        ("30", "Jacksonville Jaguars", "Jaguars", "JAX"),
        ("12", "Kansas City Chiefs", "Chiefs", "KC"),
        ("13", "Las Vegas Raiders", "Raiders", "LV"),
        ("24", "Los Angeles Chargers", "Chargers", "LAC"),
        ("14", "Los Angeles Rams", "Rams", "LAR"),
        ("15", "Miami Dolphins", "Dolphins", "MIA"),
        ("16", "Minnesota Vikings", "Vikings", "MIN"),
        ("17", "New England Patriots", "Patriots", "NE"),
        ("18", "New Orleans Saints", "Saints", "NO"),
        ("19", "New York Giants", "Giants", "NYG"),
        ("20", "New York Jets", "Jets", "NYJ"),
        ("21", "Philadelphia Eagles", "Eagles", "PHI"),
        ("23", "Pittsburgh Steelers", "Steelers", "PIT"),
        ("25", "San Francisco 49ers", "49ers", "SF"),
        ("26", "Seattle Seahawks", "Seahawks", "SEA"),
        ("27", "Tampa Bay Buccaneers", "Buccaneers", "TB"),
        ("10", "Tennessee Titans", "Titans", "TEN"),
        ("28", "Washington Commanders", "Commanders", "WSH"),
    ]
    return [
        {
            "id": tid,
            "name": name,
            "shortName": short,
            "abbreviation": abbr,
            "logo": f"https://a.espncdn.com/i/teamlogos/nfl/500/{abbr.lower()}.png",
            "color": "",
            "alternateColor": "",
        }
        for tid, name, short, abbr in rows
    ]

def classify_raw(category, name, label):
    cat = normalize(category)
    text = normalize(f"{name} {label}")

    if cat in {"passing", "rushing", "receiving"}:
        return "offense"
    if "defens" in cat:
        return "defense"
    if cat in {"returning", "kicking", "punting"}:
        return "specialTeams"
    if "scoring" in cat:
        return "scoring"

    if any(word in text for word in (
        "thirddown", "fourthdown", "redzone", "firstdown", "possession",
        "goaltogo", "drive", "playsper", "yardsperplay"
    )):
        return "situational"
    if any(word in text for word in (
        "penalt", "giveaway", "turnover", "fumblelost", "interceptionthrown"
    )):
        return "turnovers"
    if any(word in text for word in (
        "kickoff", "puntreturn", "kickreturn", "fieldgoal", "extrapoint",
        "touchback", "inside20", "punting"
    )):
        return "specialTeams"
    if any(word in text for word in ("sack", "tackle", "defensiveinterception", "qbpressure")):
        return "defense"
    return "offense"


def stat_format(name, label):
    text = normalize(f"{name} {label}")
    if "possession" in text and ("time" in text or "second" in text):
        return "time"
    if any(word in text for word in ("percent", "percentage", "pct")):
        return "percent"
    if any(word in text for word in ("average", "avg", "pergame", "perattempt", "perplay", "rate")):
        return "decimal"
    return "number"


def higher_is_better(key, label, group):
    text = normalize(f"{key} {label}")
    bad = (
        "allowed", "against", "giveaway", "fumblelost", "interceptionthrown",
        "penalt", "sackstaken", "losses"
    )
    if any(token in text for token in bad):
        return False
    if group == "defense" and any(token in text for token in ("yards", "points", "firstdowns")):
        return False
    return True


def fetch_core_stats(season, team):
    payload = get_json(CORE_STATS.format(season=season, team_id=team["id"]))
    categories = (payload.get("splits") or {}).get("categories") or []
    values = {}
    displays = {}
    catalog = []

    for category in categories:
        category_name = category.get("name") or "other"
        category_label = category.get("displayName") or category_name.title()
        for stat in category.get("stats") or []:
            name = stat.get("name") or stat.get("abbreviation")
            if not name:
                continue
            label = stat.get("displayName") or stat.get("shortDisplayName") or name
            short = stat.get("shortDisplayName") or stat.get("abbreviation") or label
            key = f"raw.{category_name}.{name}"
            value = number_from_stat(stat)
            display = stat.get("displayValue")
            if value is not None:
                values[key] = value
            if display is not None:
                displays[key] = str(display)
            group = classify_raw(category_name, name, label)
            catalog.append({
                "key": key,
                "label": label,
                "short": short,
                "group": group,
                "rawCategory": category_name,
                "rawCategoryLabel": category_label,
                "sourceName": name,
                "chartKey": name,
                "format": stat_format(name, label),
                "higherBetter": higher_is_better(key, label, group),
            })

    return team["id"], values, displays, catalog


def current_week_events(season, current_week):
    events = {}
    for week in range(1, max(1, current_week) + 1):
        payload = get_json(
            WEEK_EVENTS.format(season=season, week=week),
            {"limit": 100},
        )
        for item in payload.get("items") or []:
            ref = str(item.get("$ref") or "")
            match = re.search(r"/events/(\d+)", ref)
            if not match:
                continue
            eid = match.group(1)
            events[eid] = {"week": {"number": week}}
    return events

def previous_game_logs(previous, season):
    if previous.get("schemaVersion") != SCHEMA_VERSION or previous.get("season") != season:
        return {}, set()

    logs = {}
    ids = set()
    for team in previous.get("teams") or []:
        tid = str(team.get("id") or "")
        if not tid:
            continue
        logs[tid] = list(team.get("gameLog") or [])
        for game in logs[tid]:
            if game.get("eventId"):
                ids.add(str(game["eventId"]))
    return logs, ids


def summary_team_stats(entry):
    stats = {}
    displays = {}
    for stat in entry.get("statistics") or []:
        name = stat.get("name") or stat.get("abbreviation")
        if not name:
            continue
        display = str(stat.get("displayValue") or "")
        value = number_from_stat(stat)
        if value is not None:
            stats[name] = value
        displays[name] = display

        n = normalize(name)
        pair = pair_from_display(display)

        if pair and "thirddown" in n:
            stats["thirdDownConversions"], stats["thirdDownAttempts"] = pair
            stats["thirdDownPct"] = round(pair[0] / pair[1] * 100, 1) if pair[1] else 0
        elif pair and "fourthdown" in n:
            stats["fourthDownConversions"], stats["fourthDownAttempts"] = pair
            stats["fourthDownPct"] = round(pair[0] / pair[1] * 100, 1) if pair[1] else 0
        elif pair and "redzone" in n:
            stats["redZoneScores"], stats["redZoneAttempts"] = pair
            stats["redZonePct"] = round(pair[0] / pair[1] * 100, 1) if pair[1] else 0
        elif pair and "penalt" in n:
            stats["penalties"], stats["penaltyYards"] = pair
        elif pair and ("compatt" in n or ("completion" in n and "attempt" in n)):
            stats["passingCompletions"], stats["passingAttempts"] = pair
        elif pair and "sack" in n and "yard" in n:
            stats["sacksTaken"], stats["sackYardsLost"] = pair

        seconds = time_seconds(display)
        if seconds is not None and "possession" in n:
            stats["possessionSeconds"] = seconds

    return stats, displays


def event_scores(summary):
    result = {}
    competitions = ((summary.get("header") or {}).get("competitions") or [])
    if not competitions:
        return result
    for competitor in competitions[0].get("competitors") or []:
        tid = str(competitor.get("id") or (competitor.get("team") or {}).get("id") or "")
        if not tid:
            continue
        score = numeric(competitor.get("score")) or 0
        result[tid] = score
    return result


def parse_summary(event_id, summary, week):
    box_teams = ((summary.get("boxscore") or {}).get("teams") or [])
    if len(box_teams) < 2:
        return []

    scores = event_scores(summary)
    date = (
        ((summary.get("header") or {}).get("competitions") or [{}])[0].get("date")
        or (summary.get("header") or {}).get("season", {}).get("date")
        or ""
    )

    parsed = {}
    team_meta = {}
    for entry in box_teams:
        team = entry.get("team") or {}
        tid = str(team.get("id") or "")
        if not tid:
            continue
        stats, displays = summary_team_stats(entry)
        parsed[tid] = {"stats": stats, "displayStats": displays}
        team_meta[tid] = {
            "id": tid,
            "name": team.get("displayName") or team.get("name") or tid,
            "abbreviation": team.get("abbreviation") or "",
            "logo": team.get("logo") or "",
        }

    ids = list(parsed)
    if len(ids) < 2:
        return []

    output = []
    for tid in ids:
        oid = next((candidate for candidate in ids if candidate != tid), "")
        own = parsed[tid]["stats"]
        opp = parsed[oid]["stats"]
        own_score = scores.get(tid, 0)
        opp_score = scores.get(oid, 0)

        game_stats = dict(own)
        game_stats.update({
            "derived.pointsFor": own_score,
            "derived.pointsAgainst": opp_score,
            "derived.pointDifferential": own_score - opp_score,
            "derived.win": 1 if own_score > opp_score else 0,
            "derived.loss": 1 if own_score < opp_score else 0,
            "derived.tie": 1 if own_score == opp_score else 0,
        })

        for source, dest in (
            ("totalYards", "derived.totalYardsAllowed"),
            ("passingYards", "derived.passingYardsAllowed"),
            ("rushingYards", "derived.rushingYardsAllowed"),
            ("firstDowns", "derived.firstDownsAllowed"),
            ("thirdDownPct", "derived.thirdDownPctAllowed"),
            ("redZonePct", "derived.redZonePctAllowed"),
        ):
            value = stat_lookup(opp, source)
            if value is not None:
                game_stats[dest] = value

        own_turnovers = stat_lookup(own, "turnovers") or 0
        opp_turnovers = stat_lookup(opp, "turnovers") or 0
        game_stats["derived.giveaways"] = own_turnovers
        game_stats["derived.takeaways"] = opp_turnovers
        game_stats["derived.turnoverDifferential"] = opp_turnovers - own_turnovers

        for source, dest in (
            ("thirdDownConversions", "derived.thirdDownConversions"),
            ("thirdDownAttempts", "derived.thirdDownAttempts"),
            ("thirdDownPct", "derived.thirdDownPct"),
            ("fourthDownConversions", "derived.fourthDownConversions"),
            ("fourthDownAttempts", "derived.fourthDownAttempts"),
            ("fourthDownPct", "derived.fourthDownPct"),
            ("redZoneScores", "derived.redZoneScores"),
            ("redZoneAttempts", "derived.redZoneAttempts"),
            ("redZonePct", "derived.redZonePct"),
            ("possessionSeconds", "derived.possessionSeconds"),
            ("penalties", "derived.penalties"),
            ("penaltyYards", "derived.penaltyYards"),
        ):
            value = stat_lookup(own, source)
            if value is not None:
                game_stats[dest] = value

        output.append({
            "teamId": tid,
            "eventId": event_id,
            "week": week,
            "date": date,
            "opponent": team_meta.get(oid) or {"id": oid},
            "isAway": False,
            "score": f"{int(own_score)}-{int(opp_score)}",
            "result": "W" if own_score > opp_score else "L" if own_score < opp_score else "T",
            "stats": game_stats,
            "displayStats": parsed[tid]["displayStats"],
        })

    # Resolve home/away from the summary header.
    competitions = ((summary.get("header") or {}).get("competitions") or [])
    if competitions:
        home_by_id = {}
        for competitor in competitions[0].get("competitors") or []:
            cid = str(competitor.get("id") or (competitor.get("team") or {}).get("id") or "")
            home_by_id[cid] = competitor.get("homeAway") == "home"
        for game in output:
            game["isAway"] = not home_by_id.get(game["teamId"], False)

    return output


def sum_game(logs, key):
    values = [numeric((game.get("stats") or {}).get(key)) for game in logs]
    return sum(v for v in values if v is not None)


def avg(total, games):
    return round(total / games, 2) if games else 0


def derived_stats(logs):
    gp = len(logs)
    values = {
        "derived.gamesPlayed": gp,
        "derived.wins": sum(1 for g in logs if g.get("result") == "W"),
        "derived.losses": sum(1 for g in logs if g.get("result") == "L"),
        "derived.ties": sum(1 for g in logs if g.get("result") == "T"),
    }

    sum_keys = {
        "derived.pointsFor": "derived.pointsFor",
        "derived.pointsAgainst": "derived.pointsAgainst",
        "derived.pointDifferential": "derived.pointDifferential",
        "derived.totalYardsAllowed": "derived.totalYardsAllowed",
        "derived.passingYardsAllowed": "derived.passingYardsAllowed",
        "derived.rushingYardsAllowed": "derived.rushingYardsAllowed",
        "derived.firstDownsAllowed": "derived.firstDownsAllowed",
        "derived.giveaways": "derived.giveaways",
        "derived.takeaways": "derived.takeaways",
        "derived.turnoverDifferential": "derived.turnoverDifferential",
        "derived.thirdDownConversions": "derived.thirdDownConversions",
        "derived.thirdDownAttempts": "derived.thirdDownAttempts",
        "derived.fourthDownConversions": "derived.fourthDownConversions",
        "derived.fourthDownAttempts": "derived.fourthDownAttempts",
        "derived.redZoneScores": "derived.redZoneScores",
        "derived.redZoneAttempts": "derived.redZoneAttempts",
        "derived.possessionSeconds": "derived.possessionSeconds",
        "derived.penalties": "derived.penalties",
        "derived.penaltyYards": "derived.penaltyYards",
    }
    for out_key, game_key in sum_keys.items():
        values[out_key] = sum_game(logs, game_key)

    # Offensive game stats use ESPN's game-boxscore names.
    values["derived.totalYards"] = sum(
        stat_lookup(game.get("stats") or {}, "totalYards") or 0 for game in logs
    )
    values["derived.passingYards"] = sum(
        stat_lookup(game.get("stats") or {}, "passingYards") or 0 for game in logs
    )
    values["derived.rushingYards"] = sum(
        stat_lookup(game.get("stats") or {}, "rushingYards") or 0 for game in logs
    )
    values["derived.firstDowns"] = sum(
        stat_lookup(game.get("stats") or {}, "firstDowns") or 0 for game in logs
    )

    values.update({
        "derived.pointsPerGame": avg(values["derived.pointsFor"], gp),
        "derived.pointsAllowedPerGame": avg(values["derived.pointsAgainst"], gp),
        "derived.yardsPerGame": avg(values["derived.totalYards"], gp),
        "derived.yardsAllowedPerGame": avg(values["derived.totalYardsAllowed"], gp),
        "derived.passingYardsPerGame": avg(values["derived.passingYards"], gp),
        "derived.passYardsAllowedPerGame": avg(values["derived.passingYardsAllowed"], gp),
        "derived.rushingYardsPerGame": avg(values["derived.rushingYards"], gp),
        "derived.rushYardsAllowedPerGame": avg(values["derived.rushingYardsAllowed"], gp),
        "derived.firstDownsPerGame": avg(values["derived.firstDowns"], gp),
        "derived.penaltiesPerGame": avg(values["derived.penalties"], gp),
        "derived.penaltyYardsPerGame": avg(values["derived.penaltyYards"], gp),
        "derived.possessionSecondsPerGame": avg(values["derived.possessionSeconds"], gp),
    })

    values["derived.thirdDownPct"] = round(
        values["derived.thirdDownConversions"] / values["derived.thirdDownAttempts"] * 100, 1
    ) if values["derived.thirdDownAttempts"] else 0
    values["derived.fourthDownPct"] = round(
        values["derived.fourthDownConversions"] / values["derived.fourthDownAttempts"] * 100, 1
    ) if values["derived.fourthDownAttempts"] else 0
    values["derived.redZonePct"] = round(
        values["derived.redZoneScores"] / values["derived.redZoneAttempts"] * 100, 1
    ) if values["derived.redZoneAttempts"] else 0

    return values


def derived_catalog():
    result = {}
    group_labels = {
        "overview": "Overview",
        "offense": "Offense",
        "defense": "Defense",
        "specialTeams": "Special Teams",
        "situational": "Situational",
        "turnovers": "Turnovers & Discipline",
        "scoring": "Scoring",
        "all": "All ESPN Stats",
    }
    for group, rows in CURATED.items():
        result[group] = []
        for key, short, label, chart_key in rows:
            fmt = "time" if "possessionSeconds" in key else (
                "percent" if key.endswith("Pct") else (
                    "decimal" if "PerGame" in key else "number"
                )
            )
            result[group].append({
                "key": key,
                "label": label,
                "short": short,
                "group": group,
                "sourceName": None,
                "chartKey": chart_key,
                "format": fmt,
                "higherBetter": higher_is_better(key, label, group),
                "derived": True,
            })
    return result, group_labels


def dedupe_catalog(raw_catalog):
    seen = {}
    for item in raw_catalog:
        seen[item["key"]] = item
    return list(seen.values())


def merge_catalog(raw_catalog):
    groups, labels = derived_catalog()
    raw = dedupe_catalog(raw_catalog)
    all_rows = []

    curated_keys = {item["key"] for rows in groups.values() for item in rows}
    for item in raw:
        all_rows.append(item)
        group = item["group"]
        groups.setdefault(group, [])
        # Keep all ESPN-native stats accessible, but avoid exact-key duplication.
        if item["key"] not in curated_keys:
            groups[group].append(item)

    groups["all"] = sorted(all_rows, key=lambda item: (item.get("rawCategoryLabel", ""), item["label"]))

    order = ["overview", "offense", "defense", "specialTeams", "situational", "turnovers", "scoring", "all"]
    output = []
    for key in order:
        rows = groups.get(key) or []
        if not rows:
            continue
        output.append({
            "key": key,
            "label": labels.get(key) or key.title(),
            "stats": rows,
        })
    return output


def compact_payload(payload):
    copy = json.loads(json.dumps(payload))
    copy.pop("updatedAt", None)
    return copy


def main():
    season, current_week = current_context()
    previous = load_json(OUT)
    teams = team_list()
    if len(teams) < 30:
        raise RuntimeError(f"Only {len(teams)} NFL teams returned; refusing to write incomplete data.")

    print(f"Season {season}, through Week {current_week}; {len(teams)} teams")

    core_by_team = {}
    displays_by_team = {}
    raw_catalog = []

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_core_stats, season, team): team for team in teams}
        for future in as_completed(futures):
            team = futures[future]
            try:
                tid, values, displays, catalog = future.result()
                core_by_team[tid] = values
                displays_by_team[tid] = displays
                raw_catalog.extend(catalog)
                print(f"season stats: {team['abbreviation']} ({len(values)} numeric stats)")
            except Exception as exc:
                print(f"WARNING: season stats failed for {team['abbreviation']}: {exc}", file=sys.stderr)
                core_by_team[team["id"]] = {}
                displays_by_team[team["id"]] = {}

    logs_by_team, cached_event_ids = previous_game_logs(previous, season)
    for team in teams:
        logs_by_team.setdefault(team["id"], [])

    events = current_week_events(season, current_week)
    missing_events = [
        (eid, event) for eid, event in events.items()
        if eid not in cached_event_ids
    ]
    print(f"{len(events)} completed event(s); {len(missing_events)} new summary fetch(es)")

    if missing_events:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(get_json, CDN_GAME, {"xhr": 1, "gameId": eid}): (eid, event)
                for eid, event in missing_events
            }
            for future in as_completed(futures):
                eid, event = futures[future]
                try:
                    package = future.result().get("gamepackageJSON") or {}
                    competition = (((package.get("header") or {}).get("competitions") or [{}])[0])
                    completed = (((competition.get("status") or {}).get("type") or {}).get("completed"))
                    if not completed:
                        print(f"game package: {eid} not complete yet")
                        continue
                    week = int(((event.get("week") or {}).get("number") or 0))
                    parsed = parse_summary(eid, package, week)
                    for game in parsed:
                        tid = game.pop("teamId")
                        logs_by_team.setdefault(tid, []).append(game)
                    print(f"game package: {eid} ({len(parsed)} team rows)")
                except Exception as exc:
                    print(f"WARNING: game package failed for {eid}: {exc}", file=sys.stderr)

    output_teams = []
    for team in teams:
        tid = team["id"]
        logs = logs_by_team.get(tid) or []
        # Deduplicate by event and keep chronological order.
        deduped = {}
        for game in logs:
            if game.get("eventId"):
                deduped[str(game["eventId"])] = game
        logs = sorted(
            deduped.values(),
            key=lambda game: (int(game.get("week") or 0), str(game.get("date") or ""))
        )

        values = dict(core_by_team.get(tid) or {})
        values.update(derived_stats(logs))

        record = f"{values.get('derived.wins', 0)}-{values.get('derived.losses', 0)}"
        if values.get("derived.ties"):
            record += f"-{values['derived.ties']}"

        output_teams.append({
            **team,
            "record": record,
            "stats": values,
            "displays": displays_by_team.get(tid) or {},
            "gameLog": logs,
        })

    output_teams.sort(key=lambda team: team["name"])
    catalog = merge_catalog(raw_catalog)

    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "season": season,
        "seasonType": "Regular Season",
        "currentWeek": current_week,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESPN",
        "teams": output_teams,
        "views": catalog,
    }

    if previous and compact_payload(previous) == compact_payload(payload):
        print("No team stat changes; leaving data file untouched.")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    stat_count = sum(len(team["stats"]) for team in output_teams)
    game_count = sum(len(team["gameLog"]) for team in output_teams) // 2
    print(f"Wrote {len(output_teams)} teams, {stat_count} team-stat values, {game_count} completed games.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
