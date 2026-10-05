import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
from curl_cffi import requests as curl_requests

STATS = Path("data/nfl-stats.json")
OUT = Path("data/nfl-hit-timing.json")
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"
SUMMARY_FALLBACK = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary"
TIMEOUT = 30
MAX_WORKERS = 12
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Origin": "https://www.espn.com",
    "Referer": "https://www.espn.com/",
}

BASE_METRICS = (
    "receptions", "receivingYards", "rushingYards", "rushingAttempts",
    "passingYards", "passingAttempts", "passingCompletions", "passingTouchdowns",
    "receivingTouchdowns", "rushingTouchdowns", "passingInterceptions",
    "passingLongest", "receivingLongest", "rushingLongest",
    "soloTackles", "totalTackles", "sacks", "defensiveInterceptions",
    "fieldGoalsMade", "kickingPoints",
)
DERIVED_METRICS = ("touchdowns", "allPurposeYards", "passRushYards", "passRushRecYards")
ALL_METRICS = BASE_METRICS + DERIVED_METRICS


def number(value):
    try:
        if value in (None, "", "--", "-"):
            return 0
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return 0


def fetch_summary(event_id):
    errors = []
    params = {"event": str(event_id)}
    for attempt in range(3):
        try:
            response = requests.get(SUMMARY, params=params, headers=UA, timeout=TIMEOUT)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            errors.append(exc)
            if attempt < 2:
                time.sleep(1.0 * (attempt + 1))

    for url in (SUMMARY, SUMMARY_FALLBACK):
        try:
            response = curl_requests.get(
                url,
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


def summary_plays(payload):
    plays = payload.get("plays")
    if isinstance(plays, list):
        return plays

    rows = []
    drives = payload.get("drives") or {}
    for drive in drives.get("previous") or []:
        rows.extend(drive.get("plays") or [])
    current = drives.get("current")
    if isinstance(current, dict):
        rows.extend(current.get("plays") or [])
    return rows


def role_text(participant):
    role = participant.get("type")
    if isinstance(role, str):
        return role.lower()
    if isinstance(role, dict):
        return str(
            role.get("text")
            or role.get("name")
            or role.get("abbreviation")
            or role.get("id")
            or ""
        ).lower()
    return str(participant.get("role") or "").lower()


def athlete_id(participant):
    athlete = participant.get("athlete") or {}
    if isinstance(athlete, dict):
        if athlete.get("id"):
            return str(athlete["id"])
        ref = str(athlete.get("$ref") or "")
        match = re.search(r"/athletes/(\d+)", ref)
        if match:
            return match.group(1)
    return str(participant.get("athleteId") or participant.get("id") or "")


def participant_roles(play):
    roles = {}
    for participant in play.get("participants") or []:
        pid = athlete_id(participant)
        if not pid:
            continue
        roles.setdefault(pid, []).append(role_text(participant))
    return roles



def clean_player_name(value):
    text = re.sub(r"\b(Jr|Sr|II|III|IV)\.?\b", "", str(value or ""), flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def compact_name_pattern(name):
    clean = clean_player_name(name)
    parts = clean.split()
    if len(parts) < 2:
        return None
    first = parts[0]
    last = " ".join(parts[1:])
    last_pattern = re.escape(last)
    last_pattern = last_pattern.replace(r"\ ", r"\s+")
    last_pattern = last_pattern.replace(r"\-", r"[-\s]?")
    last_pattern = last_pattern.replace(r"\'", r"['’]?")
    return re.compile(r"\b" + re.escape(first[0]) + r"\.?\s*" + last_pattern + r"\b", re.IGNORECASE)


def full_name_pattern(name):
    clean = clean_player_name(name)
    if not clean:
        return None
    pattern = re.escape(clean)
    pattern = pattern.replace(r"\ ", r"\s+")
    pattern = pattern.replace(r"\-", r"[-\s]?")
    pattern = pattern.replace(r"\'", r"['’]?")
    return re.compile(r"\b" + pattern + r"\b", re.IGNORECASE)


def infer_text_roles(play, player_names):
    """Infer ESPN play participant roles from shortText/text when site summary omits participant IDs."""
    short_text = str(play.get("shortText") or "")
    long_text = str(play.get("text") or play.get("alternativeText") or "")
    type_text = play_type_text(play)
    roles = {}

    def add(pid, role):
        roles.setdefault(pid, [])
        if role not in roles[pid]:
            roles[pid].append(role)

    for pid, name in player_names.items():
        full = full_name_pattern(name)
        compact = compact_name_pattern(name)
        if not full and not compact:
            continue

        full_in_short = bool(full and full.search(short_text))
        compact_in_long = bool(compact and compact.search(long_text))
        if not full_in_short and not compact_in_long:
            continue

        # ESPN shortText is highly standardized and normally uses full names.
        if full:
            if re.search(r"^\s*" + full.pattern + r"\s+Pass\b", short_text, re.IGNORECASE):
                add(pid, "passer")
            if re.search(r"\bto\s+" + full.pattern + r"\b", short_text, re.IGNORECASE):
                add(pid, "receiver")
            if re.search(r"^\s*" + full.pattern + r"\s+(?:Rush|Run)\b", short_text, re.IGNORECASE):
                add(pid, "rusher")
            if re.search(r"^\s*" + full.pattern + r".*\bField Goal\b", short_text, re.IGNORECASE):
                add(pid, "kicker")
            if re.search(r"^\s*" + full.pattern + r".*\bExtra Point\b", short_text, re.IGNORECASE):
                add(pid, "kicker")
            if re.search(r"\bIntercepted by\s+" + full.pattern + r"\b", short_text, re.IGNORECASE):
                add(pid, "interceptor")
            if re.search(r"\bSacked(?:.*?\bby)?\s+" + full.pattern + r"\b", short_text, re.IGNORECASE):
                add(pid, "sacker")

        # Older/long-form play text uses J.Allen / S.Diggs-style names.
        if compact:
            cp = compact.pattern
            if re.search(cp + r"\s+pass\b", long_text, re.IGNORECASE):
                add(pid, "passer")
            if re.search(r"\bto\s+" + cp + r"\b", long_text, re.IGNORECASE):
                add(pid, "receiver")
            if "rush" in type_text.lower() and re.search(cp + r".{0,55}\bfor\b", long_text, re.IGNORECASE):
                add(pid, "rusher")
            if "field goal" in (type_text + " " + short_text).lower() and re.search(cp, long_text, re.IGNORECASE):
                add(pid, "kicker")
            if re.search(r"\bintercepted(?:.*?\bby)?\s+" + cp + r"\b", long_text, re.IGNORECASE):
                add(pid, "interceptor")
            if re.search(r"\bsacked(?:.*?\bby)?\s+" + cp + r"\b", long_text, re.IGNORECASE):
                add(pid, "sacker")

    return roles


def merge_roles(primary, secondary):
    out = {pid: list(values) for pid, values in primary.items()}
    for pid, values in secondary.items():
        out.setdefault(pid, [])
        for value in values:
            if value not in out[pid]:
                out[pid].append(value)
    return out


def has_role(roles, player_id, needles):
    values = roles.get(str(player_id), [])
    return any(
        any(str(needle).lower() in role for needle in needles)
        for role in values
    )


def any_role(roles, needles):
    return any(
        any(any(str(needle).lower() in role for needle in needles) for role in role_list)
        for role_list in roles.values()
    )


def play_type_text(play):
    value = play.get("type")
    if isinstance(value, str):
        return value.lower()
    if isinstance(value, dict):
        return str(value.get("text") or value.get("name") or value.get("abbreviation") or "").lower()
    return ""


def play_yards(play):
    direct = play.get("statYardage")
    try:
        if direct is not None and direct != "":
            return float(direct)
    except (TypeError, ValueError):
        pass

    text = str(play.get("text") or play.get("shortText") or "")
    match = re.search(r"\bfor\s+(-?\d+)\s+yards?\b", text, flags=re.IGNORECASE)
    if match:
        return float(match.group(1))
    match = re.search(r"\bfor a loss of\s+(\d+)\s+yards?\b", text, flags=re.IGNORECASE)
    if match:
        return -float(match.group(1))
    if re.search(r"\bfor no gain\b", text, flags=re.IGNORECASE):
        return 0.0
    return 0.0


def clean_value(value):
    if abs(value - round(value)) < 1e-9:
        return int(round(value))
    return round(value, 2)


def append_timeline(timelines, metric, value, quarter, clock):
    value = clean_value(float(value))
    rows = timelines.setdefault(metric, [])
    if rows and abs(float(rows[-1][0]) - float(value)) < 1e-9:
        return
    rows.append([value, int(quarter or 0), str(clock or "")])


def derived_values(state):
    return {
        "touchdowns": state["rushingTouchdowns"] + state["receivingTouchdowns"],
        "allPurposeYards": state["rushingYards"] + state["receivingYards"],
        "passRushYards": state["passingYards"] + state["rushingYards"],
        "passRushRecYards": state["passingYards"] + state["rushingYards"] + state["receivingYards"],
    }


def parse_event(payload, wanted_players):
    player_names = {str(pid): str(name or "") for pid, name in wanted_players.items()}
    wanted = set(player_names)
    states = {pid: {metric: 0.0 for metric in BASE_METRICS} for pid in wanted}
    timelines = {pid: {} for pid in wanted}

    for play in summary_plays(payload):
        text = str(play.get("text") or play.get("shortText") or "")
        context = (play_type_text(play) + " " + text).lower()
        if re.search(r"\bno play\b", context):
            continue

        roles = merge_roles(participant_roles(play), infer_text_roles(play, player_names))
        if not roles:
            continue

        quarter_value = play.get("period") or {}
        if isinstance(quarter_value, dict):
            quarter = int(number(quarter_value.get("number")))
        else:
            quarter = int(number(quarter_value))
        clock_value = play.get("clock") or {}
        clock = (
            str(clock_value.get("displayValue") or "")
            if isinstance(clock_value, dict)
            else str(clock_value or "")
        )
        yards = play_yards(play)
        pass_play = bool(re.search(r"\bpass\b|interception", context))
        receiver_on_play = any_role(roles, ("receiver", "reception"))
        completion = pass_play and receiver_on_play and not re.search(
            r"incomplete|intercepted|interception|\bsack\b", context
        )
        touchdown = bool(play.get("scoringPlay")) and "touchdown" in context

        touched = set()
        for pid in wanted:
            state = states[pid]
            before_derived = derived_values(state)
            changed = set()

            is_passer = has_role(roles, pid, ("passer",))
            is_receiver = has_role(roles, pid, ("receiver", "reception"))
            is_rusher = has_role(roles, pid, ("rusher", "rush"))
            is_kicker = has_role(roles, pid, ("kicker",))
            is_sacker = has_role(roles, pid, ("sacker", "sack"))
            is_interceptor = has_role(roles, pid, ("interceptor",))
            is_tackler = has_role(roles, pid, ("tackler", "tackle"))
            is_assist_tackler = has_role(roles, pid, ("assist", "assisted"))

            if is_passer and pass_play and not re.search(r"\bsack\b", context):
                state["passingAttempts"] += 1
                changed.add("passingAttempts")
                if completion:
                    state["passingCompletions"] += 1
                    state["passingYards"] += yards
                    state["passingLongest"] = max(state["passingLongest"], max(0.0, yards))
                    changed.update(("passingCompletions", "passingYards", "passingLongest"))
                if touchdown and completion:
                    state["passingTouchdowns"] += 1
                    changed.add("passingTouchdowns")
                if re.search(r"intercepted|interception", context):
                    state["passingInterceptions"] += 1
                    changed.add("passingInterceptions")

            if is_receiver and completion:
                state["receptions"] += 1
                state["receivingYards"] += yards
                state["receivingLongest"] = max(state["receivingLongest"], max(0.0, yards))
                changed.update(("receptions", "receivingYards", "receivingLongest"))
                if touchdown:
                    state["receivingTouchdowns"] += 1
                    changed.add("receivingTouchdowns")

            if is_rusher:
                state["rushingAttempts"] += 1
                state["rushingYards"] += yards
                state["rushingLongest"] = max(state["rushingLongest"], max(0.0, yards))
                changed.update(("rushingAttempts", "rushingYards", "rushingLongest"))
                if touchdown:
                    state["rushingTouchdowns"] += 1
                    changed.add("rushingTouchdowns")

            if is_kicker and "field goal" in context and not re.search(r"no good|missed|blocked", context):
                if bool(play.get("scoringPlay")) or re.search(r"\bgood\b", context):
                    state["fieldGoalsMade"] += 1
                    state["kickingPoints"] += 3
                    changed.update(("fieldGoalsMade", "kickingPoints"))

            if is_kicker and re.search(r"extra point|\bpat\b", context) and not re.search(r"no good|missed|blocked", context):
                if bool(play.get("scoringPlay")) or re.search(r"\bgood\b", context):
                    state["kickingPoints"] += 1
                    changed.add("kickingPoints")

            if is_sacker:
                state["sacks"] += 1
                changed.add("sacks")

            if is_interceptor and "intercept" in context:
                state["defensiveInterceptions"] += 1
                changed.add("defensiveInterceptions")

            if is_tackler:
                state["totalTackles"] += 1
                changed.add("totalTackles")
                if not is_assist_tackler:
                    state["soloTackles"] += 1
                    changed.add("soloTackles")

            if not changed:
                continue

            touched.add(pid)
            for metric in changed:
                append_timeline(timelines[pid], metric, state[metric], quarter, clock)

            after_derived = derived_values(state)
            for metric, value in after_derived.items():
                if abs(float(value) - float(before_derived[metric])) > 1e-9:
                    append_timeline(timelines[pid], metric, value, quarter, clock)

    return {pid: timelines[pid] for pid in wanted}


def expected_value(game, metric):
    if metric == "touchdowns":
        return number(game.get("rushingTouchdowns")) + number(game.get("receivingTouchdowns"))
    if metric == "allPurposeYards":
        return number(game.get("rushingYards")) + number(game.get("receivingYards"))
    if metric == "passRushYards":
        return number(game.get("passingYards")) + number(game.get("rushingYards"))
    if metric == "passRushRecYards":
        return (
            number(game.get("passingYards"))
            + number(game.get("rushingYards"))
            + number(game.get("receivingYards"))
        )
    return number(game.get(metric))


def validate_player_timelines(raw_timelines, game):
    valid = {}
    for metric in ALL_METRICS:
        expected = expected_value(game, metric)
        rows = raw_timelines.get(metric) or []
        if abs(expected) < 1e-9:
            continue
        if not rows:
            continue
        actual = number(rows[-1][0])
        if abs(actual - expected) <= 0.01:
            valid[metric] = rows
    return valid


def load_json(path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return fallback


def main():
    stats = load_json(STATS, {})
    players = stats.get("players") or []
    if not players:
        raise RuntimeError("No NFL stats found; cannot build hit timing.")

    seasons = {str(stats.get("season") or ""), str((stats.get("season") or 0) - 1)}
    wanted = {}
    player_names = {}
    for player in players:
        pid = str(player.get("id") or "")
        if pid:
            player_names[pid] = str(player.get("name") or "")
        if not pid:
            continue
        by_season = player.get("gameLogsBySeason") or {}
        for season, games in by_season.items():
            if seasons and str(season) not in seasons:
                continue
            for game in games or []:
                event_id = str(game.get("eventId") or "")
                if not game.get("played") or not event_id:
                    continue
                wanted.setdefault(event_id, {})[pid] = game

    existing = load_json(OUT, {})
    schema_version = 2
    existing_events = (existing.get("events") or {}) if existing.get("schemaVersion") == schema_version else {}
    events = {}
    pending = {}

    for event_id, player_games in wanted.items():
        prior = existing_events.get(event_id) or {}
        retained = {
            pid: prior.get(pid)
            for pid in player_games
            if pid in prior
        }
        events[event_id] = retained
        missing = [pid for pid in player_games if pid not in retained]
        if missing:
            pending[event_id] = missing

    print(f"Hit timing coverage: {len(wanted) - len(pending)}/{len(wanted)} events complete; {len(pending)} to fetch.")

    fetched = {}
    if pending:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {
                pool.submit(fetch_summary, event_id): event_id
                for event_id in pending
            }
            for future in as_completed(futures):
                event_id = futures[future]
                try:
                    names = {pid: player_names.get(pid, "") for pid in pending[event_id]}
                    fetched[event_id] = parse_event(future.result(), names)
                    print(f"play-by-play: {event_id} ({len(pending[event_id])} players)")
                except Exception as exc:
                    print(f"WARNING: play-by-play failed for {event_id}: {exc}", file=sys.stderr)

    changed = False
    for event_id, by_player in fetched.items():
        player_games = wanted[event_id]
        for pid, raw_timelines in by_player.items():
            valid = validate_player_timelines(raw_timelines, player_games[pid])
            events.setdefault(event_id, {})[pid] = valid
            changed = True

    # Keep only current/prior-season games so the file stays bounded.
    if set(existing_events) != set(events):
        changed = True

    if not changed and OUT.exists():
        print("Hit timing database already up to date.")
        return

    payload = {
        "schemaVersion": schema_version,
        "season": stats.get("season"),
        "availableSeasons": stats.get("availableSeasons") or [],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "ESPN play-by-play",
        "events": events,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    covered_players = sum(len(x) for x in events.values())
    covered_metrics = sum(len(metrics) for event in events.values() for metrics in event.values())
    print(f"Wrote hit timing for {len(events)} events / {covered_players} player-games / {covered_metrics} validated metric timelines.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
