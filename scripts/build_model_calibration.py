"""Build deterministic 2025 walk-forward calibration for the NFL prop model.

Historical FanDuel closing lines are not stored in this project, so the training
target uses a synthetic sportsbook-like line: the player's trailing-five median
plus 0.5. Features are calculated using information available before each game.
Weeks 6-13 train the logistic calibration and weeks 14-18 are held out.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from statistics import mean, median, stdev

STATS = Path("data/nfl-stats.json")
OUT = Path("data/model-calibration.json")
SOURCE_SEASON = 2025

SPECS = {
    "rushingYards": {"positions": {"RB", "QB"}},
    "receivingYards": {"positions": {"WR", "TE", "RB"}},
    "receptions": {"positions": {"WR", "TE", "RB"}},
    "rushingAttempts": {"positions": {"RB", "QB"}},
    "passingYards": {"positions": {"QB"}},
    "passRushYards": {"positions": {"QB"}},
    "passingAttempts": {"positions": {"QB"}},
    "passingCompletions": {"positions": {"QB"}},
    "fieldGoalsMade": {"positions": {"K"}},
    "kickingPoints": {"positions": {"K"}},
}
FEATURES = ["l5", "l10", "season", "lineZ", "trend", "dvp"]


def safe_num(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def metric_value(game, metric):
    if metric == "passRushYards":
        return safe_num(game.get("passingYards")) + safe_num(game.get("rushingYards"))
    if metric == "kickingPoints":
        stored = game.get("kickingPoints")
        if stored is not None:
            return safe_num(stored)
        return safe_num(game.get("fieldGoalsMade")) * 3 + safe_num(game.get("extraPointsMade"))
    return safe_num(game.get(metric))


def avg(values):
    values = list(values)
    return mean(values) if values else 0.0


def std(values):
    values = list(values)
    return stdev(values) if len(values) > 1 else 0.0


def percentile(value, values):
    values = list(values)
    if not values:
        return 0.5
    less = sum(1 for item in values if item < value)
    equal = sum(1 for item in values if item == value)
    return (less + 0.5 * equal) / len(values)


def season_logs(player):
    by_season = player.get("gameLogsBySeason") or {}
    return [
        game for game in (by_season.get(str(SOURCE_SEASON)) or [])
        if game.get("played")
    ]


def build_dvp_lookup(players, metric, position):
    # Sum all production from a position against each defense in each week, then
    # rank the defense by its per-game average entering the next game.
    weekly = {}
    for player in players:
        if str(player.get("position") or "").upper() != position:
            continue
        for game in season_logs(player):
            week = int(safe_num(game.get("week")))
            opponent = str((game.get("opponent") or {}).get("abbreviation") or "").upper()
            if not week or not opponent:
                continue
            key = (week, opponent)
            weekly[key] = weekly.get(key, 0.0) + metric_value(game, metric)

    teams = sorted({team for _, team in weekly})
    result = {}
    for week in range(1, 19):
        averages = {}
        for team in teams:
            values = [
                weekly[(prior_week, team)]
                for prior_week in range(1, week)
                if (prior_week, team) in weekly
            ]
            if len(values) >= 2:
                averages[team] = avg(values)
        peer_values = list(averages.values())
        for team, value in averages.items():
            result[(week, team)] = percentile(value, peer_values)
    return result


def build_rows(players):
    dvp_maps = {}
    for metric, cfg in SPECS.items():
        for position in cfg["positions"]:
            dvp_maps[(metric, position)] = build_dvp_lookup(players, metric, position)

    rows = []
    for metric, cfg in SPECS.items():
        for player in players:
            position = str(player.get("position") or "").upper()
            if position not in cfg["positions"]:
                continue

            games = sorted(season_logs(player), key=lambda game: safe_num(game.get("week")))
            for index in range(5, len(games)):
                past = games[:index]
                last5 = past[-5:]
                last10 = past[-10:]
                current = games[index]
                values5 = [metric_value(game, metric) for game in last5]
                line = float(median(values5)) + 0.5

                def hit_rate(sample):
                    if not sample:
                        return 0.5
                    return avg(1.0 if metric_value(game, metric) > line else 0.0 for game in sample)

                m5 = avg(values5)
                spread = std(values5) + 1.0
                line_z = (m5 - line) / spread
                trend = (avg(values5[-3:]) - m5) / spread
                week = int(safe_num(current.get("week")))
                opponent = str((current.get("opponent") or {}).get("abbreviation") or "").upper()
                dvp = dvp_maps[(metric, position)].get((week, opponent), 0.5)

                rows.append({
                    "metric": metric,
                    "position": position,
                    "week": week,
                    "y": 1.0 if metric_value(current, metric) > line else 0.0,
                    "x": [
                        hit_rate(last5),
                        hit_rate(last10),
                        hit_rate(past),
                        line_z,
                        trend,
                        dvp,
                    ],
                })
    return rows


def sigmoid(value):
    value = max(-20.0, min(20.0, value))
    return 1.0 / (1.0 + math.exp(-value))


def fit(rows):
    train = [row for row in rows if row["week"] <= 13]
    test = [row for row in rows if row["week"] >= 14]
    width = len(FEATURES)

    means = [avg(row["x"][i] for row in train) for i in range(width)]
    stds = [std(row["x"][i] for row in train) or 1.0 for i in range(width)]

    def standardized(row):
        return [
            (row["x"][i] - means[i]) / stds[i]
            for i in range(width)
        ]

    weights = [0.0] * (width + 1)
    learning_rate = 0.035
    regularization = 0.015

    for _ in range(2500):
        gradient = [0.0] * (width + 1)
        for row in train:
            features = standardized(row)
            score = weights[0] + sum(
                weights[i + 1] * features[i] for i in range(width)
            )
            error = sigmoid(score) - row["y"]
            gradient[0] += error
            for i, value in enumerate(features):
                gradient[i + 1] += error * value

        gradient[0] /= max(1, len(train))
        for i in range(1, len(gradient)):
            gradient[i] = gradient[i] / max(1, len(train)) + regularization * weights[i]
        for i in range(len(weights)):
            weights[i] -= learning_rate * gradient[i]

    def evaluate(sample):
        if not sample:
            return {"n": 0, "brier": None, "accuracy": None, "hitRate": None}
        brier = 0.0
        correct = 0
        for row in sample:
            features = standardized(row)
            score = weights[0] + sum(
                weights[i + 1] * features[i] for i in range(width)
            )
            probability = sigmoid(score)
            brier += (probability - row["y"]) ** 2
            correct += int((probability >= 0.5) == (row["y"] == 1.0))
        return {
            "n": len(sample),
            "brier": round(brier / len(sample), 6),
            "accuracy": round(correct / len(sample), 6),
            "hitRate": round(avg(row["y"] for row in sample), 6),
        }

    return {
        "intercept": weights[0],
        "coefficients": weights[1:],
        "means": means,
        "stds": stds,
        "train": evaluate(train),
        "test": evaluate(test),
    }


def main():
    payload = json.loads(STATS.read_text(encoding="utf-8"))
    players = [
        player for player in (payload.get("players") or [])
        if str(SOURCE_SEASON) in (player.get("gameLogsBySeason") or {})
    ]
    rows = build_rows(players)

    calibration = {
        "version": 1,
        "sourceSeason": SOURCE_SEASON,
        "statsUpdatedAt": payload.get("updatedAt"),
        "features": FEATURES,
        "methodology": {
            "targetLine": "trailing-five median + 0.5",
            "walkForward": True,
            "trainWeeks": "6-13",
            "holdoutWeeks": "14-18",
            "note": "Historical sportsbook closing lines are not stored; calibration learns signal reliability from pregame game-log history, not historical betting ROI.",
        },
        "samples": len(rows),
        "all": fit(rows),
        "metrics": {},
    }
    for metric in SPECS:
        metric_rows = [row for row in rows if row["metric"] == metric]
        calibration["metrics"][metric] = fit(metric_rows)

    OUT.write_text(json.dumps(calibration, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} from {len(rows)} walk-forward 2025 samples.")


if __name__ == "__main__":
    main()
