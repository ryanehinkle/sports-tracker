import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
from curl_cffi import requests as curl_requests

BASE = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete"
SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
GAMELOG = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{athlete_id}/gamelog"
SEARCH = "https://site.web.api.espn.com/apis/common/v3/search"
ATHLETE = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{athlete_id}"
OUT = Path("data/nfl-stats.json")
ODDS = Path("data/nfl-odds.json")
TIMEOUT = 30
TEAM_IDS = {
    "ARI": 22, "ATL": 1, "BAL": 33, "BUF": 2, "CAR": 29, "CHI": 3, "CIN": 4, "CLE": 5,
    "DAL": 6, "DEN": 7, "DET": 8, "GB": 9, "HOU": 34, "IND": 11, "JAX": 30, "KC": 12,
    "LV": 13, "LAC": 24, "LAR": 14, "MIA": 15, "MIN": 16, "NE": 17, "NO": 18, "NYG": 19,
    "NYJ": 20, "PHI": 21, "PIT": 23, "SF": 25, "SEA": 26, "TB": 27, "TEN": 10, "WSH": 28,
}
ROSTER = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team_id}/roster"
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Origin": "https://www.espn.com",
    "Referer": "https://www.espn.com/",
}

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

GAME_STAT_ALIASES = {
    "receptions": ("receptions", "receivingreceptions"),
    "receivingYards": ("receivingyards",),
    "receivingTouchdowns": ("receivingtouchdowns",),
    "receivingLongest": ("longreception", "longestreception", "receivinglongest", "longreceiving"),
    "receivingTargets": ("receivingtargets", "targets"),
    "rushingAttempts": ("rushingattempts", "carries", "rushattempts"),
    "rushingYards": ("rushingyards",),
    "rushingTouchdowns": ("rushingtouchdowns",),
    "rushingLongest": ("longrushing", "longestrush", "rushinglongest"),
    "passingAttempts": ("passingattempts", "attempts"),
    "passingCompletions": ("passingcompletions", "completions"),
    "passingYards": ("passingyards",),
    "passingTouchdowns": ("passingtouchdowns",),
    "passingInterceptions": ("interceptions", "passinginterceptions"),
    "passingLongest": ("longpassing", "longestcompletion", "passinglongest", "longpass"),
    "soloTackles": ("solotackles",),
    "totalTackles": ("totaltackles", "tackles"),
    "assistedTackles": ("assistedtackles", "assists"),
    "sacks": ("sacks",),
    "defensiveInterceptions": ("defensiveinterceptions", "interceptionsmade"),
    "fieldGoalsMade": ("fieldgoalsmade", "fgmade"),
    "extraPointsMade": ("extrapointsmade", "xpmade", "patmade"),
}


def get_json(url, params=None):
    last_error = None
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=TIMEOUT)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise last_error


def browser_json(url, params=None, fallback_urls=()):
    """Fetch ESPN JSON with a browser-like fallback for GitHub Actions."""
    errors = []
    try:
        return get_json(url, params)
    except Exception as exc:
        errors.append(exc)

    for candidate in (url, *fallback_urls):
        try:
            response = curl_requests.get(
                candidate,
                params=params,
                headers=UA,
                impersonate="chrome120",
                timeout=TIMEOUT,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            errors.append(exc)
    raise RuntimeError(" / ".join(str(x) for x in errors[-3:]))


def scoreboard_json():
    return browser_json(
        SCOREBOARD,
        {"limit": 100},
        ("https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",),
    )


def stats_publication_safe():
    """Return False while any NFL game is live, or if the safety check cannot be verified."""
    try:
        payload = scoreboard_json()
    except Exception as exc:
        print(f"SAFETY GATE: scoreboard check failed ({exc}); leaving stats untouched.")
        return False

    live = []
    for event in payload.get("events") or []:
        status = ((event.get("status") or {}).get("type") or {})
        state = str(status.get("state") or "").lower()
        completed = status.get("completed")
        name = str(event.get("name") or event.get("shortName") or event.get("id") or "NFL game")
        if state == "in" or (completed is False and state not in {"pre", ""}):
            live.append(name)

    if live:
        print("SAFETY GATE: live NFL game(s) in progress; keeping last completed-game snapshot:")
        for name in live:
            print(f"  - {name}")
        return False
    return True


def current_season():
    now = datetime.now(timezone.utc)
    return now.year if now.month >= 7 else now.year - 1


def number(value):
    try:
        if value in (None, "", "--", "-"):
            return 0
        return int(round(float(str(value).replace(",", ""))))
    except (TypeError, ValueError):
        return 0


def normalize_name(value):
    text = str(value or "").lower()
    text = re.sub(r"\b(jr|sr|ii|iii|iv)\.?\b", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def pick_stat_category(entry, wanted):
    categories = entry.get("categories") or []
    wanted = wanted.lower()
    for cat in categories:
        text = " ".join(str(cat.get(k, "")) for k in ("name", "displayName", "shortDisplayName")).lower()
        if wanted in text:
            return cat
    candidates = [c for c in categories if c.get("totals")]
    return max(candidates, key=lambda c: len(c.get("totals", [])), default={})


def stat_map(category, fallback):
    totals = category.get("totals") or []
    result = {}
    names = category.get("names") or category.get("statNames") or []
    for i, name in enumerate(names):
        if i < len(totals):
            result[str(name)] = number(totals[i])
    for stat in category.get("stats") or []:
        if stat.get("name"):
            result[stat["name"]] = number(stat.get("value", stat.get("displayValue")))
    for key, idx in fallback.items():
        if key not in result and idx < len(totals):
            result[key] = number(totals[idx])
    return result


def athlete_info(entry):
    a = entry.get("athlete") or {}
    aid = str(a.get("id") or "")
    team = a.get("teamShortName") or a.get("teamAbbreviation") or ""
    if not team and isinstance(a.get("team"), dict):
        team = a["team"].get("abbreviation") or ""
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
        if len(rows) < 100 or page > max(int(page_count or 1), 1) or page > 20:
            break
    return players


def merge_players(season):
    merged = {}
    for feed_name, cfg in FEEDS.items():
        try:
            feed = fetch_feed(season, feed_name, cfg)
        except Exception as exc:
            if cfg.get("optional"):
                print(f"WARNING: optional {feed_name} feed failed: {exc}", file=sys.stderr)
                continue
            raise
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
                    "passRushYards": 0,
                    "fieldGoalsMade": 0,
                    "extraPointsMade": 0,
                    "kickingPoints": 0,
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
                "fieldGoalsMade",
                "extraPointsMade",
                "totalPoints",
                "kickingPoints",
            ):
                if k in row:
                    p[k] = number(row[k])

    for p in merged.values():
        p["allPurposeYards"] = p["rushingYards"] + p["receivingYards"]
        p["passRushYards"] = p["passingYards"] + p["rushingYards"]
        p["touchdowns"] = p.get("rushingTouchdowns", 0) + p.get("receivingTouchdowns", 0)
        if not p.get("kickingPoints"):
            p["kickingPoints"] = p.get("totalPoints", 0) or (p.get("fieldGoalsMade", 0) * 3 + p.get("extraPointsMade", 0))
        p.pop("totalPoints", None)
        p.pop("rushingTouchdowns", None)
        p.pop("receivingTouchdowns", None)

    rows = [
        p for p in merged.values()
        if (
            any(p.get(k, 0) for k in ("allPurposeYards", "receptions", "passingYards", "passingTouchdowns", "touchdowns", "kickingPoints", "fieldGoalsMade"))
            or str(p.get("position") or "").upper() == "K"
        )
    ]
    rows.sort(key=lambda p: (p["allPurposeYards"], p["passingYards"], p["name"]), reverse=True)
    return rows



def odds_player_names():
    if not ODDS.exists():
        return []
    try:
        payload = json.loads(ODDS.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []

    names = set()
    for event in payload.get("events") or []:
        for prop in event.get("props") or []:
            name = str(prop.get("player") or "").strip()
            if not name or "defense" in name.lower():
                continue
            names.add(name)
    return sorted(names)


def profile_from_athlete(athlete, fallback_name=""):
    aid = str(athlete.get("id") or "")
    if not aid:
        return None

    team = athlete.get("team") or {}
    if isinstance(team, dict):
        team = (
            team.get("abbreviation")
            or team.get("shortDisplayName")
            or team.get("name")
            or ""
        )
    elif not isinstance(team, str):
        team = ""

    position = athlete.get("position") or {}
    if isinstance(position, dict):
        position = position.get("abbreviation") or position.get("name") or ""
    elif not isinstance(position, str):
        position = ""

    headshot = athlete.get("headshot")
    if isinstance(headshot, dict):
        headshot = headshot.get("href")
    if not headshot and aid:
        headshot = f"https://a.espncdn.com/i/headshots/nfl/players/full/{aid}.png"

    return {
        "id": aid,
        "name": athlete.get("displayName") or athlete.get("fullName") or fallback_name,
        "team": team,
        "position": position,
        "headshot": headshot or "",
        "touchdowns": 0,
        "allPurposeYards": 0,
        "receivingYards": 0,
        "rushingYards": 0,
        "receptions": 0,
        "passingTouchdowns": 0,
        "passingYards": 0,
        "passRushYards": 0,
        "fieldGoalsMade": 0,
        "extraPointsMade": 0,
        "kickingPoints": 0,
        "oddsOnly": True,
    }


def _walk_kicker_athletes(value):
    """Yield athlete-shaped objects with a K position from any roster response shape."""
    if isinstance(value, dict):
        position = value.get("position") or {}
        abbreviation = (
            position.get("abbreviation")
            if isinstance(position, dict)
            else str(position or "")
        )
        if str(abbreviation or "").upper() in {"K", "PK"} and value.get("id"):
            yield value
        for child in value.values():
            yield from _walk_kicker_athletes(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_kicker_athletes(child)


def fetch_team_kickers(team_abbr, team_id):
    payload = browser_json(ROSTER.format(team_id=team_id))
    found = {}
    for athlete in _walk_kicker_athletes(payload):
        profile = profile_from_athlete(athlete, athlete.get("displayName") or athlete.get("fullName") or "")
        if not profile:
            continue
        profile["team"] = team_abbr
        profile["position"] = "K"
        profile.pop("oddsOnly", None)
        found[profile["id"]] = profile
    return list(found.values())


def add_kicker_profiles(players):
    """Add every current NFL kicker from ESPN team rosters, independent of prop availability."""
    by_id = {str(p.get("id")): p for p in players}
    fetched = []

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {
            pool.submit(fetch_team_kickers, abbr, team_id): abbr
            for abbr, team_id in TEAM_IDS.items()
        }
        for future in as_completed(futures):
            abbr = futures[future]
            try:
                fetched.extend(future.result())
            except Exception as exc:
                print(f"WARNING: roster kicker fetch failed for {abbr}: {exc}", file=sys.stderr)

    added = 0
    for profile in fetched:
        aid = str(profile.get("id") or "")
        if not aid:
            continue
        existing = by_id.get(aid)
        if existing:
            existing["position"] = "K"
            existing["team"] = profile.get("team") or existing.get("team") or ""
            existing["headshot"] = profile.get("headshot") or existing.get("headshot") or ""
            existing.pop("oddsOnly", None)
            for key in ("passRushYards", "fieldGoalsMade", "extraPointsMade", "kickingPoints"):
                existing.setdefault(key, 0)
            continue
        players.append(profile)
        by_id[aid] = profile
        added += 1

    players.sort(
        key=lambda p: (
            p.get("oddsOnly", False),
            str(p.get("position") or "").upper() != "K",
            -(p.get("allPurposeYards", 0) or 0),
            -(p.get("passingYards", 0) or 0),
            p.get("name", ""),
        )
    )
    kicker_count = sum(1 for p in players if str(p.get("position") or "").upper() == "K")
    print(f"roster kickers: {kicker_count} total ({added} newly added)")
    return players


def resolve_espn_player(name):
    data = get_json(
        SEARCH,
        {
            "region": "us",
            "lang": "en",
            "query": name,
            "limit": 10,
            "mode": "prefix",
            "type": "player",
            "sport": "football",
        },
    )
    target = normalize_name(name)
    candidates = data.get("items") or []

    exact = None
    for item in candidates:
        if normalize_name(item.get("displayName")) == target:
            exact = item
            break
    if exact is None:
        return None

    aid = str(exact.get("id") or "")
    if not aid:
        return None

    try:
        detail = get_json(ATHLETE.format(athlete_id=aid))
        athlete = detail.get("athlete") or {}
        profile = profile_from_athlete(athlete, name)
        if profile:
            return profile
    except Exception:
        pass

    return {
        "id": aid,
        "name": exact.get("displayName") or name,
        "team": "",
        "position": "",
        "headshot": f"https://a.espncdn.com/i/headshots/nfl/players/full/{aid}.png",
        "touchdowns": 0,
        "allPurposeYards": 0,
        "receivingYards": 0,
        "rushingYards": 0,
        "receptions": 0,
        "passingTouchdowns": 0,
        "passingYards": 0,
        "passRushYards": 0,
        "fieldGoalsMade": 0,
        "extraPointsMade": 0,
        "kickingPoints": 0,
        "oddsOnly": True,
    }


def add_odds_only_players(players):
    wanted = odds_player_names()
    if not wanted:
        return players

    existing_names = {normalize_name(p.get("name")) for p in players}
    existing_ids = {str(p.get("id")) for p in players}
    missing = [name for name in wanted if normalize_name(name) not in existing_names]
    if not missing:
        return players

    print(f"Resolving {len(missing)} prop players missing from the season leaderboard...")
    resolved = []

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(resolve_espn_player, name): name for name in missing}
        for future in as_completed(futures):
            name = futures[future]
            try:
                profile = future.result()
            except Exception as exc:
                profile = None
                print(f"WARNING: player search failed for {name}: {exc}", file=sys.stderr)
            if profile and profile["id"] not in existing_ids:
                resolved.append(profile)
                existing_ids.add(profile["id"])
                existing_names.add(normalize_name(profile["name"]))
                print(f"odds profile: {name} -> {profile['name']} ({profile['id']})")

    if resolved:
        players.extend(resolved)
        players.sort(
            key=lambda p: (
                p.get("oddsOnly", False),
                -(p.get("allPurposeYards", 0) or 0),
                -(p.get("passingYards", 0) or 0),
                p.get("name", ""),
            )
        )
    print(f"Added {len(resolved)} odds-only player profiles.")
    return players


def score_for_event(meta):
    result = str(meta.get("gameResult") or "").strip().upper()
    result = result[:1] if result else ""
    score = str(meta.get("score") or "").strip()
    score = re.sub(r"^[WLT]\s*", "", score, flags=re.IGNORECASE)
    if score:
        return result, score

    home = str(meta.get("homeTeamScore") or "").strip()
    away = str(meta.get("awayTeamScore") or "").strip()
    if not home or not away:
        return result, ""

    is_away = str(meta.get("atVs") or "").strip() == "@"
    player_score = away if is_away else home
    opponent_score = home if is_away else away
    if result == "L":
        return result, f"{opponent_score}-{player_score}"
    return result, f"{player_score}-{opponent_score}"


def get_game_stat(stat_values, aliases):
    normalized = {normalize_name(k): number(v) for k, v in stat_values.items()}
    for alias in aliases:
        if alias in normalized:
            return normalized[alias]
    return 0


def parse_game_log(athlete_id, season):
    data = get_json(GAMELOG.format(athlete_id=athlete_id), {"season": season})
    names = [str(x) for x in (data.get("names") or [])]
    events = data.get("events") or {}
    rows = {}

    for season_type in data.get("seasonTypes") or []:
        type_name = str(season_type.get("displayName") or season_type.get("name") or "")
        if "regular" not in type_name.lower():
            continue
        for category in season_type.get("categories") or []:
            if category.get("type") != "event":
                continue
            for ev in category.get("events") or []:
                event_id = str(ev.get("eventId") or "")
                meta = events.get(event_id) or {}
                week = number(meta.get("week"))
                if week <= 0:
                    continue

                raw_stats = ev.get("stats") or []
                stat_values = {
                    names[i]: raw_stats[i]
                    for i in range(min(len(names), len(raw_stats)))
                }
                tracked = {
                    key: get_game_stat(stat_values, aliases)
                    for key, aliases in GAME_STAT_ALIASES.items()
                }
                result, score = score_for_event(meta)
                if result not in {"W", "L", "T"}:
                    # Do not mark an in-progress game as played even if ESPN exposes partial stats.
                    continue
                opponent = meta.get("opponent") or {}
                opponent_abbr = str(opponent.get("abbreviation") or "").upper()

                tracked["touchdowns"] = tracked["rushingTouchdowns"] + tracked["receivingTouchdowns"]
                tracked["allPurposeYards"] = tracked["rushingYards"] + tracked["receivingYards"]
                tracked["passRushYards"] = tracked["passingYards"] + tracked["rushingYards"]
                tracked["passRushRecYards"] = (
                    tracked["passingYards"] + tracked["rushingYards"] + tracked["receivingYards"]
                )
                tracked["kickingPoints"] = tracked["fieldGoalsMade"] * 3 + tracked["extraPointsMade"]

                game_date = (
                    meta.get("gameDate")
                    or meta.get("date")
                    or meta.get("startDate")
                    or meta.get("startTime")
                    or ""
                )

                rows[week] = {
                    "week": week,
                    "date": game_date,
                    "played": True,
                    "isAway": str(meta.get("atVs") or "").strip() == "@",
                    "opponent": {
                        "id": str(opponent.get("id") or ""),
                        "name": opponent.get("displayName") or opponent.get("shortDisplayName") or opponent_abbr,
                        "abbreviation": opponent_abbr,
                        "logo": (
                            f"https://a.espncdn.com/i/teamlogos/nfl/500/{opponent_abbr.lower()}.png"
                            if opponent_abbr else ""
                        ),
                    },
                    "result": result,
                    "score": score,
                    **tracked,
                }

    return [rows[w] for w in sorted(rows)]


def blank_week(week):
    return {
        "week": week,
        "date": "",
        "played": False,
        "isAway": False,
        "opponent": None,
        "result": "",
        "score": "",
    }


def fill_weeks(logs, max_week):
    if not logs or max_week <= 0:
        return []
    existing = {
        number(g.get("week")): g
        for g in logs
        if number(g.get("week")) > 0
    }
    return [existing.get(week) or blank_week(week) for week in range(1, max_week + 1)]


def aggregate_view(players):
    return [
        {k: v for k, v in p.items() if k not in {"gameLog", "gameLogsBySeason"}}
        for p in players
    ]


def attach_game_logs(players, season, previous_payload, refresh_current=True):
    prior_season = season - 1
    previous_by_id = {
        str(p.get("id")): p
        for p in (previous_payload.get("players") or [])
    } if previous_payload else {}

    raw_logs = {}
    futures = {}

    with ThreadPoolExecutor(max_workers=10) as pool:
        for p in players:
            previous = previous_by_id.get(p["id"], {})
            previous_by_season = previous.get("gameLogsBySeason") or {}

            current_existing = previous_by_season.get(str(season)) or previous.get("gameLog") or []
            current_has_dates = current_existing and all(
                (not g.get("played")) or g.get("date")
                for g in current_existing
            )
            if refresh_current or not current_has_dates:
                futures[pool.submit(parse_game_log, p["id"], season)] = (p, season)
            else:
                raw_logs[(p["id"], season)] = [g for g in current_existing if g.get("played")]

            prior_existing = previous_by_season.get(str(prior_season)) or []
            prior_has_dates = prior_existing and all(
                (not g.get("played")) or g.get("date")
                for g in prior_existing
            )
            if prior_has_dates:
                raw_logs[(p["id"], prior_season)] = [g for g in prior_existing if g.get("played")]
            else:
                futures[pool.submit(parse_game_log, p["id"], prior_season)] = (p, prior_season)

        for future in as_completed(futures):
            p, target_season = futures[future]
            try:
                logs = future.result()
                raw_logs[(p["id"], target_season)] = logs
                print(f"gamelog {target_season}: {p['name']} ({len(logs)} games)")
            except Exception as exc:
                previous = previous_by_id.get(p["id"], {})
                previous_by_season = previous.get("gameLogsBySeason") or {}
                fallback = (
                    previous_by_season.get(str(target_season))
                    or (previous.get("gameLog") if target_season == season else [])
                    or []
                )
                raw_logs[(p["id"], target_season)] = [g for g in fallback if g.get("played")]
                print(
                    f"WARNING: gamelog {target_season} failed for {p['name']}: {exc}",
                    file=sys.stderr,
                )

    current_week = max(
        (g.get("week", 0) for p in players for g in raw_logs.get((p["id"], season), [])),
        default=number(previous_payload.get("currentWeek")) if previous_payload else 0,
    )

    for p in players:
        current_raw = raw_logs.get((p["id"], season), [])
        prior_raw = raw_logs.get((p["id"], prior_season), [])
        current_filled = fill_weeks(current_raw, current_week)
        prior_filled = fill_weeks(prior_raw, 18 if prior_raw else 0)

        p["gameLog"] = current_filled
        p["gameLogsBySeason"] = {
            str(season): current_filled,
            str(prior_season): prior_filled,
        }

    return current_week


def refresh_current_aggregates_from_logs(players):
    """Keep displayed season totals in sync with the same game logs used by prop charts."""
    for p in players:
        games = [g for g in (p.get("gameLog") or []) if g.get("played")]
        if not games:
            continue

        def total(key):
            return sum(number(g.get(key)) for g in games)

        p["receivingYards"] = total("receivingYards")
        p["rushingYards"] = total("rushingYards")
        p["receptions"] = total("receptions")
        p["passingTouchdowns"] = total("passingTouchdowns")
        p["passingYards"] = total("passingYards")
        p["allPurposeYards"] = p["rushingYards"] + p["receivingYards"]
        p["passRushYards"] = p["passingYards"] + p["rushingYards"]
        p["touchdowns"] = total("touchdowns")
        p["fieldGoalsMade"] = total("fieldGoalsMade")
        p["extraPointsMade"] = total("extraPointsMade")
        p["kickingPoints"] = total("kickingPoints")

        # A kicker pulled in through FanDuel before the ESPN leaderboard feed
        # catches up should still appear in Player Stats once we have game logs.
        if str(p.get("position") or "").upper() == "K":
            p.pop("oddsOnly", None)


def load_previous():
    if not OUT.exists():
        return {}
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def main():
    if not stats_publication_safe():
        return

    season = current_season()
    players = merge_players(season)
    players = add_kicker_profiles(players)
    players = add_odds_only_players(players)
    if len(players) < 25:
        raise RuntimeError(f"Only {len(players)} players parsed; refusing to overwrite good data.")

    previous = load_previous()
    previous_players = previous.get("players") or []
    aggregates_unchanged = (
        previous.get("season") == season
        and aggregate_view(previous_players) == aggregate_view(players)
    )
    history_complete = bool(previous_players) and all(
        str(season) in (p.get("gameLogsBySeason") or {})
        and str(season - 1) in (p.get("gameLogsBySeason") or {})
        and all(
            (not g.get("played")) or g.get("date")
            for g in (p.get("gameLogsBySeason") or {}).get(str(season), [])
        )
        and all(
            (not g.get("played")) or g.get("date")
            for g in (p.get("gameLogsBySeason") or {}).get(str(season - 1), [])
        )
        for p in previous_players
    )

    if aggregates_unchanged and history_complete:
        print("No player stat changes; historical game logs already present.")
        return

    current_week = attach_game_logs(
        players,
        season,
        previous,
        refresh_current=not aggregates_unchanged,
    )
    refresh_current_aggregates_from_logs(players)

    payload = {
        "season": season,
        "seasonType": "Regular Season",
        "currentWeek": current_week,
        "availableSeasons": [season, season - 1],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESPN",
        "definition": {
            "allPurposeYards": "rushing + receiving yards",
            "passRushYards": "passing + rushing yards",
            "kickingPoints": "3 × field goals made + extra points made",
        },
        "players": players,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(players)} players with {season} and {season - 1} game logs")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
