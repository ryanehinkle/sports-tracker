"""Continuously learn from every graded frozen FanDuel leg.

The tracker already freezes each pregame board in data/odds-history and grades it
after ESPN reports the completed game. This script turns those real outcomes into
an adaptive calibration layer used by model.js.

Important safeguards:
- only frozen pregame rows with final hit/miss grades are training samples;
- pushes/pending rows never train the model;
- validation is split by whole games, never random legs from the same game;
- candidate settings are promoted only when out-of-sample validation improves;
- the adaptive layer starts with a small blend and earns more influence as the
  number of completed games and validation quality grow.

The objective deliberately emphasizes precision among the highest-scored legs,
because the Model page is primarily trying to rank the best available legs.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

HISTORY_DIR = Path("data/odds-history")
OUT = Path("data/model-learning.json")
VERSION = 1

FEATURES = [
    "book",
    "l5",
    "l10",
    "current",
    "previous",
    "h2h",
    "sample",
    "alternate",
    "spreadLine",
    "under",
    "team",
    "game",
]

FEATURE_LABELS = {
    "book": "FanDuel no-vig probability",
    "l5": "Last 5 hit rate",
    "l10": "Last 10 hit rate",
    "current": "Current-season hit rate",
    "previous": "Prior-season hit rate",
    "h2h": "Head-to-head hit rate",
    "sample": "History sample strength",
    "alternate": "Alternate-line flag",
    "spreadLine": "Spread points received / given",
    "under": "Under / No side",
    "team": "Team-market flag",
    "game": "Game-market flag",
}

CONFIGS = [
    {"name": "steady", "l2": 0.040, "decay": 0.995, "lr": 0.050},
    {"name": "responsive", "l2": 0.025, "decay": 0.985, "lr": 0.045},
    {"name": "conservative", "l2": 0.080, "decay": 1.000, "lr": 0.055},
    {"name": "fast-reacting", "l2": 0.015, "decay": 0.970, "lr": 0.040},
]


def clamp(value, low, high):
    return max(low, min(high, value))


def safe_num(value, default=None):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def sigmoid(value):
    value = clamp(value, -20.0, 20.0)
    return 1.0 / (1.0 + math.exp(-value))


def normalize(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def american_to_decimal(value):
    odds = safe_num(value)
    if odds is None or odds == 0:
        return None
    return 1.0 + odds / 100.0 if odds > 0 else 1.0 + 100.0 / abs(odds)


def implied_probability(prop):
    decimal = safe_num(prop.get("decimalOdds"))
    if decimal is None or decimal <= 1:
        decimal = american_to_decimal(prop.get("odds"))
    return 1.0 / decimal if decimal and decimal > 1 else 0.5


def pair_key(event_id, prop):
    kind = str(prop.get("teamMarketType") or "")
    line = safe_num(prop.get("line"))
    line_key = "" if line is None else f"{abs(line):.4f}"
    if kind == "moneyline":
        return (event_id, "team", "moneyline")
    if kind == "spread":
        return (event_id, "team", "spread", line_key)
    if kind == "gameTotal":
        return (event_id, "game", "total", line_key)
    if kind == "teamTotal":
        return (event_id, "team", str(prop.get("team") or ""), "total", line_key)
    return (
        event_id,
        "player",
        normalize(prop.get("player")),
        normalize(prop.get("market") or prop.get("proposition")),
        line_key,
    )


def no_vig_probabilities(event):
    props = event.get("props") or []
    groups = {}
    for index, prop in enumerate(props):
        groups.setdefault(pair_key(str(event.get("id") or ""), prop), []).append((index, prop))

    result = {}
    for items in groups.values():
        raw = [(index, implied_probability(prop)) for index, prop in items]
        total = sum(probability for _, probability in raw)
        # Only de-vig true opposing/two-way groups. Multi-runner markets and
        # one-sided props keep their raw implied probability.
        if len(raw) == 2 and total > 0:
            for index, probability in raw:
                result[index] = probability / total
        else:
            for index, probability in raw:
                result[index] = probability
    return result


def rate_value(prop, key):
    rate = (prop.get("hitRates") or {}).get(key) or {}
    pct = safe_num(rate.get("pct"))
    if pct is not None:
        return clamp(pct / 100.0, 0.0, 1.0)
    hits = safe_num(rate.get("hits"))
    total = safe_num(rate.get("total"))
    if hits is not None and total and total > 0:
        return clamp(hits / total, 0.0, 1.0)
    return 0.5


def rate_total(prop, key):
    return max(0.0, safe_num(((prop.get("hitRates") or {}).get(key) or {}).get("total"), 0.0) or 0.0)


def feature_vector(prop, book):
    kind = str(prop.get("teamMarketType") or "")
    scope = str(prop.get("scope") or "player")
    line = safe_num(prop.get("line"), 0.0) or 0.0
    spread_line = clamp(line / 14.0, -1.0, 1.0) if kind == "spread" else 0.0
    sample = min(
        1.0,
        (
            rate_total(prop, "l10")
            + rate_total(prop, "current")
            + 0.35 * rate_total(prop, "previous")
        )
        / 28.0,
    )
    side = str(prop.get("selection") or "")
    return [
        clamp(book, 0.02, 0.98),
        rate_value(prop, "l5"),
        rate_value(prop, "l10"),
        rate_value(prop, "current"),
        rate_value(prop, "previous"),
        rate_value(prop, "h2h"),
        sample,
        1.0 if prop.get("alternate") else 0.0,
        spread_line,
        1.0 if side in {"Under", "No"} else 0.0,
        1.0 if scope == "team" else 0.0,
        1.0 if scope == "game" else 0.0,
    ]


def load_previous():
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def collect_samples():
    samples = []
    event_order = {}
    for path in sorted(HISTORY_DIR.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            day = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        day_key = str(day.get("date") or path.stem)
        for event in day.get("events") or []:
            event_id = str(event.get("id") or "")
            if not event_id:
                continue
            event_time = str(event.get("commenceTime") or day_key)
            event_order[event_id] = min(event_order.get(event_id, event_time), event_time)
            no_vig = no_vig_probabilities(event)
            for index, prop in enumerate(event.get("props") or []):
                status = str((prop.get("result") or {}).get("status") or "")
                if status not in {"hit", "miss"}:
                    continue
                samples.append(
                    {
                        "event": event_id,
                        "date": day_key,
                        "time": event_time,
                        "y": 1.0 if status == "hit" else 0.0,
                        "x": feature_vector(prop, no_vig.get(index, implied_probability(prop))),
                        "market": str(prop.get("market") or "Other"),
                        "position": str(prop.get("position") or prop.get("scope") or "").upper(),
                        "scope": str(prop.get("scope") or "player"),
                    }
                )

    ordered_events = sorted(event_order, key=lambda event_id: event_order[event_id])
    event_rank = {event_id: index for index, event_id in enumerate(ordered_events)}
    for sample in samples:
        sample["eventRank"] = event_rank.get(sample["event"], 0)
    samples.sort(key=lambda sample: (sample["eventRank"], sample["market"], sample["position"]))
    return samples, ordered_events


def split_train_validation(samples, events):
    if len(events) < 4:
        return samples, []
    cut = max(2, int(len(events) * 0.70))
    cut = min(cut, len(events) - 1)
    train_events = set(events[:cut])
    validation_events = set(events[cut:])
    return (
        [sample for sample in samples if sample["event"] in train_events],
        [sample for sample in samples if sample["event"] in validation_events],
    )


def fit(rows, config):
    width = len(FEATURES)
    if not rows:
        return {
            "intercept": 0.0,
            "coefficients": [0.0] * width,
            "means": [0.0] * width,
            "stds": [1.0] * width,
            "config": dict(config),
        }

    means = []
    stds = []
    for i in range(width):
        values = [row["x"][i] for row in rows]
        mean = sum(values) / len(values)
        variance = sum((value - mean) ** 2 for value in values) / max(1, len(values) - 1)
        means.append(mean)
        stds.append(math.sqrt(variance) or 1.0)

    newest_rank = max(row.get("eventRank", 0) for row in rows)
    decay = float(config["decay"])
    row_weights = [decay ** max(0, newest_rank - row.get("eventRank", newest_rank)) for row in rows]
    weight_sum = sum(row_weights) or 1.0

    weights = [0.0] * (width + 1)
    lr = float(config["lr"])
    l2 = float(config["l2"])

    for epoch in range(180):
        gradient = [0.0] * (width + 1)
        for row, row_weight in zip(rows, row_weights):
            z = [(row["x"][i] - means[i]) / stds[i] for i in range(width)]
            score = weights[0] + sum(weights[i + 1] * z[i] for i in range(width))
            error = (sigmoid(score) - row["y"]) * row_weight
            gradient[0] += error
            for i, value in enumerate(z):
                gradient[i + 1] += error * value

        gradient[0] /= weight_sum
        for i in range(1, len(gradient)):
            gradient[i] = gradient[i] / weight_sum + l2 * weights[i]

        max_step = 0.0
        for i, grad in enumerate(gradient):
            step = lr * grad
            weights[i] -= step
            max_step = max(max_step, abs(step))
        if epoch > 45 and max_step < 1e-6:
            break

    return {
        "intercept": weights[0],
        "coefficients": weights[1:],
        "means": means,
        "stds": stds,
        "config": dict(config),
    }


def predict(model, row):
    score = safe_num(model.get("intercept"), 0.0) or 0.0
    coefficients = model.get("coefficients") or []
    means = model.get("means") or []
    stds = model.get("stds") or []
    for i in range(min(len(FEATURES), len(coefficients))):
        mean = safe_num(means[i] if i < len(means) else 0.0, 0.0) or 0.0
        std = safe_num(stds[i] if i < len(stds) else 1.0, 1.0) or 1.0
        score += (safe_num(coefficients[i], 0.0) or 0.0) * ((row["x"][i] - mean) / std)
    return clamp(sigmoid(score), 0.02, 0.98)


def percentile(values, fraction):
    values = sorted(values)
    if not values:
        return None
    index = int(round((len(values) - 1) * clamp(fraction, 0.0, 1.0)))
    return values[index]


def evaluate(model, rows):
    if not rows:
        return {
            "n": 0,
            "accuracy": None,
            "brier": None,
            "hitRate": None,
            "topHitRate": None,
            "topThreshold": None,
            "objective": None,
        }
    predictions = [(predict(model, row), row["y"], row) for row in rows]
    brier = sum((probability - y) ** 2 for probability, y, _ in predictions) / len(predictions)
    accuracy = sum(int((probability >= 0.5) == (y == 1.0)) for probability, y, _ in predictions) / len(predictions)
    hit_rate = sum(y for _, y, _ in predictions) / len(predictions)
    threshold = percentile([probability for probability, _, _ in predictions], 0.80)
    top = [(probability, y) for probability, y, _ in predictions if threshold is not None and probability >= threshold]
    top_hit = sum(y for _, y in top) / len(top) if top else hit_rate
    objective = 0.72 * top_hit + 0.18 * accuracy + 0.10 * (1.0 - brier)
    return {
        "n": len(rows),
        "accuracy": round(accuracy, 6),
        "brier": round(brier, 6),
        "hitRate": round(hit_rate, 6),
        "topHitRate": round(top_hit, 6),
        "topThreshold": round(threshold, 6) if threshold is not None else None,
        "objective": round(objective, 6),
    }


def compatible_previous_model(previous):
    champion = previous.get("champion") or {}
    return (
        previous.get("version") == VERSION
        and champion.get("features") == FEATURES
        and len(champion.get("coefficients") or []) == len(FEATURES)
    )


def feature_importance(model):
    coefficients = model.get("coefficients") or []
    stds = model.get("stds") or []
    rows = []
    for index, feature in enumerate(FEATURES):
        coefficient = safe_num(coefficients[index] if index < len(coefficients) else 0.0, 0.0) or 0.0
        std = safe_num(stds[index] if index < len(stds) else 1.0, 1.0) or 1.0
        effect = coefficient / std
        rows.append(
            {
                "feature": feature,
                "label": FEATURE_LABELS[feature],
                "coefficient": round(coefficient, 6),
                "effect": round(effect, 6),
                "direction": "up" if effect > 0 else "down" if effect < 0 else "flat",
                "importance": abs(effect),
            }
        )
    total = sum(row["importance"] for row in rows) or 1.0
    for row in rows:
        row["importancePct"] = round(row["importance"] / total * 100.0, 1)
    rows.sort(key=lambda row: row["importance"], reverse=True)
    return rows


def confidence_buckets(model, rows):
    buckets = [
        ("<50", 0.00, 0.50),
        ("50–59", 0.50, 0.60),
        ("60–69", 0.60, 0.70),
        ("70–79", 0.70, 0.80),
        ("80+", 0.80, 1.01),
    ]
    result = []
    for label, low, high in buckets:
        members = [(predict(model, row), row["y"]) for row in rows]
        members = [(p, y) for p, y in members if low <= p < high]
        hits = int(sum(y for _, y in members))
        total = len(members)
        result.append(
            {
                "label": label,
                "hits": hits,
                "total": total,
                "hitRate": round(hits / total, 4) if total else None,
            }
        )
    return result


def market_performance(model, rows):
    grouped = {}
    for row in rows:
        grouped.setdefault(row["market"], []).append(row)
    output = []
    for market, members in grouped.items():
        if len(members) < 8:
            continue
        scored = sorted(((predict(model, row), row["y"]) for row in members), reverse=True)
        take = max(1, int(math.ceil(len(scored) * 0.20)))
        top = scored[:take]
        output.append(
            {
                "market": market,
                "samples": len(members),
                "topSamples": len(top),
                "topHitRate": round(sum(y for _, y in top) / len(top), 4),
                "averageProbability": round(sum(p for p, _ in top) / len(top), 4),
            }
        )
    output.sort(key=lambda item: (-item["samples"], item["market"]))
    return output[:16]


def choose_blend(event_count, validation):
    if event_count <= 0:
        return 0.0
    if not validation or not validation.get("n"):
        return round(min(0.12, 0.04 + event_count * 0.02), 3)
    top = safe_num(validation.get("topHitRate"), 0.0) or 0.0
    brier = safe_num(validation.get("brier"), 0.25) or 0.25
    quality = clamp((top - 0.50) * 2.2 + (0.25 - brier) * 1.5, 0.0, 1.0)
    experience = clamp(event_count / 20.0, 0.0, 1.0)
    return round(0.08 + 0.34 * experience * (0.45 + 0.55 * quality), 3)


def main():
    previous = load_previous()
    samples, events = collect_samples()
    train_rows, validation_rows = split_train_validation(samples, events)

    chosen_config = CONFIGS[0]
    candidate_validation = evaluate(fit(train_rows, chosen_config), validation_rows) if validation_rows else evaluate({}, [])
    tested = []

    if validation_rows:
        best = None
        for config in CONFIGS:
            model = fit(train_rows, config)
            metrics = evaluate(model, validation_rows)
            tested.append({"config": config, "validation": metrics})
            if best is None or (metrics.get("objective") or -1) > (best["validation"].get("objective") or -1):
                best = {"model": model, "config": config, "validation": metrics}
        chosen_config = best["config"]
        candidate_validation = best["validation"]

    candidate = fit(samples, chosen_config)
    candidate["features"] = FEATURES
    candidate["trainedSamples"] = len(samples)
    candidate["trainedGames"] = len(events)

    previous_compatible = compatible_previous_model(previous)
    previous_champion = previous.get("champion") if previous_compatible else None
    previous_validation = evaluate(previous_champion, validation_rows) if previous_champion and validation_rows else None

    promoted = not previous_champion
    reason = "Initial adaptive model"
    champion = candidate

    if previous_champion:
        if validation_rows:
            candidate_objective = safe_num(candidate_validation.get("objective"), -1.0)
            previous_objective = safe_num((previous_validation or {}).get("objective"), -1.0)
            if candidate_objective is not None and previous_objective is not None and candidate_objective + 0.001 >= previous_objective:
                promoted = True
                reason = f"Challenger validation objective {candidate_objective:.3f} >= champion {previous_objective:.3f}"
                champion = candidate
            else:
                promoted = False
                reason = f"Champion held: {previous_objective:.3f} validation objective vs challenger {candidate_objective:.3f}"
                champion = previous_champion
        else:
            # With fewer than four completed games there is no honest game-level
            # holdout. Refit cautiously so each new game can still teach the
            # model, but the live blend remains deliberately small.
            promoted = True
            reason = "Provisional refit; waiting for four completed games before game-level promotion tests"
            champion = candidate

    full_metrics = evaluate(champion, samples)
    live_blend = choose_blend(len(events), candidate_validation if validation_rows else None)
    if previous_champion and not promoted:
        live_blend = safe_num(previous.get("liveBlend"), live_blend) or live_blend

    now = datetime.now(timezone.utc).isoformat()
    run = {
        "updatedAt": now,
        "samples": len(samples),
        "completedGames": len(events),
        "promoted": promoted,
        "status": "provisional" if len(events) < 4 else ("promoted" if promoted else "held"),
        "topHitRate": full_metrics.get("topHitRate"),
        "topThreshold": full_metrics.get("topThreshold"),
        "accuracy": full_metrics.get("accuracy"),
        "brier": full_metrics.get("brier"),
        "liveBlend": live_blend,
    }
    runs = list(previous.get("trainingRuns") or [])
    last = runs[-1] if runs else None
    if not last or last.get("samples") != len(samples) or last.get("completedGames") != len(events):
        runs.append(run)
    elif runs:
        runs[-1] = run
    runs = runs[-20:]

    payload = {
        "version": VERSION,
        "updatedAt": now,
        "source": "Frozen pregame FanDuel boards graded from completed ESPN game logs",
        "objective": "Maximize out-of-sample hit rate among the highest-scored legs while preserving probability calibration",
        "samples": len(samples),
        "completedGames": len(events),
        "status": run["status"],
        "promotionReason": reason,
        "liveBlend": live_blend,
        "features": FEATURES,
        "champion": champion,
        "candidate": {
            "config": chosen_config,
            "validation": candidate_validation,
            "testedSetups": tested,
        },
        "performance": {
            "all": full_metrics,
            "validation": candidate_validation if validation_rows else None,
            "previousChampionValidation": previous_validation,
            "scoreBuckets": confidence_buckets(champion, samples),
            "marketPerformance": market_performance(champion, samples),
        },
        "featureImportance": feature_importance(champion),
        "trainingRuns": runs,
        "notes": [
            "Every graded hit/miss leg from frozen pregame boards is included; pushes and pending outcomes are excluded.",
            "Validation splits by whole games so alternate lines and opposite sides from one game cannot leak into both train and test.",
            "A challenger is promoted only when its game-level holdout objective is at least as good as the current champion.",
            "Before four completed games, updates are provisional and intentionally receive only a small live-model blend.",
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT}: {len(samples)} graded legs across {len(events)} completed games; "
        f"status={payload['status']} blend={live_blend:.3f}."
    )


if __name__ == "__main__":
    main()
