import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ODDS = Path("data/nfl-odds.json")
TEAM_STATS = Path("data/nfl-team-stats.json")
HISTORY = Path("data/odds-history")
OUT = Path("data/ladder-picks.json")
CENTRAL = ZoneInfo("America/Chicago")
SIMULATIONS = 30000


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def iso_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def american_to_decimal(odds):
    try:
        odds = float(odds)
    except (TypeError, ValueError):
        return None
    if odds == 0:
        return None
    return 1 + odds / 100 if odds > 0 else 1 + 100 / abs(odds)


def decimal_to_american(decimal):
    if not decimal or decimal <= 1:
        return None
    return round((decimal - 1) * 100) if decimal >= 2 else round(-100 / (decimal - 1))


def norm(value):
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def flatten(odds_payload):
    rows = []
    for event in odds_payload.get("events") or []:
        for prop in event.get("props") or []:
            row = dict(prop)
            row.update({
                "eventId": str(event.get("id") or ""),
                "commenceTime": event.get("commenceTime"),
                "homeAbbr": event.get("homeAbbr") or "",
                "awayAbbr": event.get("awayAbbr") or "",
                "homeTeam": event.get("homeTeam") or "",
                "awayTeam": event.get("awayTeam") or "",
                "matchup": f"{event.get('awayAbbr') or event.get('awayTeam') or ''} @ {event.get('homeAbbr') or event.get('homeTeam') or ''}",
            })
            rows.append(row)
    return rows


def team_catalog(team_payload):
    meta = {}
    for view in team_payload.get("views") or []:
        group = view.get("key") or "other"
        for stat in view.get("stats") or []:
            key = stat.get("key")
            if key and key not in meta:
                meta[key] = {
                    "group": stat.get("group") or group,
                    "higherBetter": stat.get("higherBetter", True),
                }
    return meta


def percentile(value, peers):
    peers = sorted(x for x in peers if isinstance(x, (int, float)) and math.isfinite(x))
    if not peers or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    below = sum(1 for x in peers if x < value)
    equal = sum(1 for x in peers if x == value)
    return (below + 0.5 * equal) / len(peers)


def build_team_profiles(team_payload):
    teams = team_payload.get("teams") or []
    meta = team_catalog(team_payload)
    keys = sorted({
        key
        for team in teams
        for key, value in (team.get("stats") or {}).items()
        if isinstance(value, (int, float)) and math.isfinite(value)
    })
    peer_values = {
        key: [
            team.get("stats", {}).get(key)
            for team in teams
            if isinstance(team.get("stats", {}).get(key), (int, float))
        ]
        for key in keys
    }

    profiles = {}
    for team in teams:
        groups = {}
        all_signals = []
        for key in keys:
            value = team.get("stats", {}).get(key)
            p = percentile(value, peer_values[key])
            if p is None:
                continue
            info = meta.get(key, {})
            signal = p if info.get("higherBetter", True) else 1 - p
            group = info.get("group") or ("defense" if "allowed" in key.lower() else "offense")
            groups.setdefault(group, []).append(signal)
            all_signals.append(signal)
        profiles[str(team.get("abbreviation") or "").upper()] = {
            "team": team,
            "groups": {group: sum(values) / len(values) for group, values in groups.items() if values},
            "all": sum(all_signals) / len(all_signals) if all_signals else 0.5,
            "featureCount": len(all_signals),
        }
    return profiles


def team_market_signal(row, profiles):
    scope = row.get("scope")
    if scope not in {"team", "game"}:
        return None
    home = profiles.get(str(row.get("homeAbbr") or "").upper(), {})
    away = profiles.get(str(row.get("awayAbbr") or "").upper(), {})
    if not home or not away:
        return 0.5

    kind = row.get("teamMarketType")
    selection = str(row.get("selection") or "")
    selected_abbr = str(row.get("team") or "").upper()
    selected = profiles.get(selected_abbr, {})
    opponent = away if selected_abbr == str(row.get("homeAbbr") or "").upper() else home

    def group(profile, name, fallback=None):
        value = profile.get("groups", {}).get(name)
        if value is None and fallback:
            value = profile.get("groups", {}).get(fallback)
        return value if value is not None else profile.get("all", 0.5)

    if kind in {"moneyline", "spread"} and selected:
        selected_strength = (
            0.22 * group(selected, "offense")
            + 0.22 * group(selected, "defense")
            + 0.17 * group(selected, "scoring")
            + 0.13 * group(selected, "situational")
            + 0.11 * group(selected, "turnovers")
            + 0.08 * group(selected, "specialTeams")
            + 0.07 * selected.get("all", 0.5)
        )
        opponent_strength = (
            0.22 * group(opponent, "offense")
            + 0.22 * group(opponent, "defense")
            + 0.17 * group(opponent, "scoring")
            + 0.13 * group(opponent, "situational")
            + 0.11 * group(opponent, "turnovers")
            + 0.08 * group(opponent, "specialTeams")
            + 0.07 * opponent.get("all", 0.5)
        )
        return max(0.05, min(0.95, 0.5 + (selected_strength - opponent_strength) * 0.75))

    # Totals still include every team-stat category through the "all" term,
    # with offense/scoring/defense/situational given more influence.
    scoring_env = (
        0.20 * group(home, "offense") + 0.20 * group(away, "offense")
        + 0.17 * group(home, "scoring") + 0.17 * group(away, "scoring")
        + 0.08 * (1 - group(home, "defense")) + 0.08 * (1 - group(away, "defense"))
        + 0.04 * group(home, "situational") + 0.04 * group(away, "situational")
        + 0.01 * home.get("all", 0.5) + 0.01 * away.get("all", 0.5)
    )
    signal = max(0.05, min(0.95, scoring_env / 1.0))
    if kind == "teamTotal" and selected:
        signal = max(0.05, min(0.95,
            0.34 * group(selected, "offense")
            + 0.24 * group(selected, "scoring")
            + 0.16 * (1 - group(opponent, "defense"))
            + 0.10 * group(selected, "situational")
            + 0.08 * group(selected, "specialTeams")
            + 0.08 * selected.get("all", 0.5)
        ))
    return 1 - signal if selection == "Under" else signal


def rate_pct(row, key):
    rate = (row.get("hitRates") or {}).get(key)
    try:
        return float(rate.get("pct")) / 100 if rate else None
    except (TypeError, ValueError, AttributeError):
        return None


def estimated_probability(row, profiles):
    decimal = row.get("decimalOdds") or american_to_decimal(row.get("odds"))
    book = 1 / float(decimal) if decimal and float(decimal) > 1 else 0.5

    parts = []
    weights = []
    for key, weight in (("l5", 0.30), ("l10", 0.26), ("current", 0.16), ("previous", 0.20), ("h2h", 0.08)):
        value = rate_pct(row, key)
        if value is not None:
            parts.append(value)
            weights.append(weight)
    history = sum(v * w for v, w in zip(parts, weights)) / sum(weights) if weights else book

    team_signal = team_market_signal(row, profiles)
    if team_signal is None:
        probability = 0.38 * book + 0.62 * history
    else:
        probability = 0.28 * book + 0.37 * history + 0.35 * team_signal

    return max(0.03, min(0.97, probability))


def strict_candidate(row):
    try:
        odds = float(row.get("odds"))
    except (TypeError, ValueError):
        return False
    if not (-1200 <= odds <= -280):
        return False
    l5 = rate_pct(row, "l5")
    l10 = rate_pct(row, "l10")
    prev = rate_pct(row, "previous")
    return l5 is not None and l5 >= 1.0 and l10 is not None and l10 >= 0.75 and prev is not None and prev >= 0.70


def family_key(row):
    entity = row.get("player") or row.get("team") or row.get("scope") or "game"
    return (str(row.get("eventId") or ""), norm(entity), str(row.get("market") or "").lower(), str(row.get("line")))


def compatible(combo, row, max_spread=700):
    if any(family_key(existing) == family_key(row) for existing in combo):
        return False
    player = norm(row.get("player"))
    if player and any(norm(existing.get("player")) == player for existing in combo):
        return False
    values = [float(item.get("odds")) for item in combo + [row] if item.get("odds") is not None]
    return not values or max(values) - min(values) <= max_spread


def parlay_decimal(combo):
    value = 1.0
    for row in combo:
        decimal = row.get("decimalOdds") or american_to_decimal(row.get("odds"))
        if not decimal:
            return None
        value *= float(decimal)
    return value


def choose_slip(rows, date_key, profiles):
    scored = []
    for row in rows:
        try:
            odds = float(row.get("odds"))
        except (TypeError, ValueError):
            continue
        row = dict(row)
        row["_prob"] = estimated_probability(row, profiles)
        row["_confidence"] = 100 * row["_prob"]
        scored.append(row)

    tiers = [
        ("Exact Even Ladder", [row for row in scored if strict_candidate(row)]),
        ("Relaxed history", [
            row for row in scored
            if -1400 <= float(row.get("odds")) <= -250
            and (rate_pct(row, "l5") or 0) >= 0.80
            and (rate_pct(row, "l10") or 0) >= 0.65
            and (rate_pct(row, "previous") or 0) >= 0.55
        ]),
        ("Best available", [
            row for row in scored
            if float(row.get("odds")) < 0 and float(row.get("odds")) >= -1800
        ]),
        ("Emergency best board", scored),
    ]

    rng = random.Random(date_key)
    best = None
    best_meta = None
    simulations_done = 0

    for tier_name, pool in tiers:
        pool = sorted(pool, key=lambda row: row["_confidence"], reverse=True)[:160]
        if len(pool) < 3:
            continue

        for _ in range(SIMULATIONS):
            simulations_done += 1
            size = rng.randint(3, min(6, len(pool)))
            sample = rng.sample(pool, min(len(pool), max(size * 4, 14)))
            combo = []
            for row in sample:
                if compatible(combo, row, 700):
                    combo.append(row)
                if len(combo) == size:
                    break
            if len(combo) < 3:
                continue

            decimal = parlay_decimal(combo)
            if not decimal:
                continue
            american = decimal_to_american(decimal)
            if american is None:
                continue

            joint = math.prod(row["_prob"] for row in combo)
            avg_conf = sum(row["_confidence"] for row in combo) / len(combo)
            target_penalty = abs(decimal - 2.0)
            in_even_band = -110 <= american <= 110
            score = math.log(max(joint, 1e-9)) + avg_conf * 0.012 - target_penalty * (3.8 if in_even_band else 6.2)
            if tier_name == "Exact Even Ladder" and not in_even_band:
                score -= 3.0
            if best is None or score > best_meta["score"]:
                best = combo
                best_meta = {
                    "score": score,
                    "tier": tier_name,
                    "decimal": decimal,
                    "odds": american,
                    "joint": joint,
                    "avgConfidence": avg_conf,
                }

        if best and -110 <= best_meta["odds"] <= 110:
            break

    if not best:
        # Deterministic fallback: preserve the requested 3-leg floor whenever
        # a board has at least three outcomes. First keep player uniqueness,
        # then relax only the odds-spread guard if the slate is unusually thin.
        combo = []
        ranked = sorted(scored, key=lambda item: item["_confidence"], reverse=True)
        for row in ranked:
            player = norm(row.get("player"))
            if player and any(norm(existing.get("player")) == player for existing in combo):
                continue
            if any(family_key(existing) == family_key(row) for existing in combo):
                continue
            combo.append(row)
            if len(combo) >= 3:
                break
        if len(combo) < 3:
            for row in ranked:
                if row in combo or any(family_key(existing) == family_key(row) for existing in combo):
                    continue
                combo.append(row)
                if len(combo) >= 3:
                    break
        if len(combo) < 1:
            return None
        decimal = parlay_decimal(combo) or 1
        best = combo
        best_meta = {
            "score": 0,
            "tier": "Fallback board",
            "decimal": decimal,
            "odds": decimal_to_american(decimal),
            "joint": math.prod(row["_prob"] for row in combo),
            "avgConfidence": sum(row["_confidence"] for row in combo) / len(combo),
        }

    return best, best_meta, simulations_done


def prop_key(row):
    return "¦".join([
        str(row.get("eventId") or ""),
        str(row.get("player") or row.get("team") or row.get("scope") or ""),
        str(row.get("market") or ""),
        str(row.get("selection") or ""),
        str(row.get("line") if row.get("line") is not None else ""),
        str(row.get("proposition") or ""),
    ])


def snapshot_leg(row):
    keep = {
        "eventId", "commenceTime", "matchup", "homeAbbr", "awayAbbr", "scope",
        "player", "team", "teamName", "position", "headshot", "market", "teamMarketType",
        "alternate", "selection", "line", "odds", "decimalOdds", "proposition", "hitRates",
    }
    leg = {key: row.get(key) for key in keep if key in row}
    leg["key"] = prop_key(row)
    leg["confidence"] = round(row.get("_confidence", 50), 1)
    leg["estimatedProbability"] = round(row.get("_prob", 0.5), 6)
    leg["result"] = {"status": "pending"}
    return leg


def history_result_index():
    results = {}
    if not HISTORY.exists():
        return results
    for path in HISTORY.glob("*.json"):
        if path.name == "index.json":
            continue
        payload = load_json(path, {})
        for event in payload.get("events") or []:
            for prop in event.get("props") or []:
                row = dict(prop)
                row["eventId"] = str(event.get("id") or "")
                row["commenceTime"] = event.get("commenceTime")
                result = prop.get("result")
                if result:
                    results[prop_key(row)] = result
    return results


def refresh_pick_results(payload):
    results = history_result_index()
    changed = False
    for pick in payload.get("picks") or []:
        for leg in pick.get("legs") or []:
            result = results.get(leg.get("key"))
            if result and result != leg.get("result"):
                leg["result"] = result
                changed = True
        statuses = [(leg.get("result") or {}).get("status") for leg in pick.get("legs") or []]
        if statuses and all(status in {"hit", "miss", "push"} for status in statuses):
            status = "miss" if "miss" in statuses else "hit" if "hit" in statuses else "push"
        else:
            status = "pending"
        if pick.get("status") != status:
            pick["status"] = status
            changed = True
    return changed


def main():
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(CENTRAL)
    odds_payload = load_json(ODDS, {})
    team_payload = load_json(TEAM_STATS, {})
    payload = load_json(OUT, {"version": 1, "picks": []})
    payload.setdefault("version", 1)
    payload.setdefault("picks", [])

    refresh_pick_results(payload)

    events = []
    for event in odds_payload.get("events") or []:
        commence = iso_dt(event.get("commenceTime"))
        if not commence:
            continue
        if commence.astimezone(CENTRAL).date() != local_now.date():
            continue
        if commence >= now:
            events.append(event)

    if events:
        first_start = min(iso_dt(event.get("commenceTime")) for event in events)
        date_key = local_now.date().isoformat()
        existing = next((pick for pick in payload["picks"] if pick.get("date") == date_key), None)

        # Publish once the first kickoff of the local date is within ~90 minutes.
        if not existing and first_start - timedelta(minutes=75) <= now < first_start:
            eligible_event_ids = {str(event.get("id") or "") for event in events}
            rows = [row for row in flatten(odds_payload) if row.get("eventId") in eligible_event_ids]
            profiles = build_team_profiles(team_payload)
            chosen = choose_slip(rows, date_key, profiles)
            if chosen:
                combo, meta, simulations = chosen
                pick = {
                    "day": max([int(item.get("day") or 0) for item in payload["picks"]] or [0]) + 1,
                    "date": date_key,
                    "createdAt": now.isoformat(),
                    "target": "Even Money Ladder",
                    "targetOdds": "+100",
                    "odds": meta["odds"],
                    "decimalOdds": round(meta["decimal"], 6),
                    "estimatedProbability": round(meta["joint"], 6),
                    "confidence": round(meta["avgConfidence"], 1),
                    "selectionTier": meta["tier"],
                    "simulations": simulations,
                    "status": "pending",
                    "legs": [snapshot_leg(row) for row in combo],
                }
                payload["picks"].append(pick)
                payload["picks"].sort(key=lambda item: int(item.get("day") or 0))
                print(f"Created ladder Day {pick['day']} at {pick['odds']:+d} after {simulations:,} simulations ({meta['tier']}).")

    payload["updatedAt"] = now.isoformat()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
