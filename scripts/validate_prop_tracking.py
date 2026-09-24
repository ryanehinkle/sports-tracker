"""Small guardrail suite for historical NFL prop tracking.

The site only has ESPN full-game game logs. This validator makes sure period/drive
markets can never silently fall through to full-game totals.
"""
from update_odds import _metric_spec, _metric_value, _prop_hit


def prop(market, proposition=None, line=50.5, selection="Over"):
    return {
        "market": market,
        "proposition": proposition or market,
        "line": line,
        "selection": selection,
    }


def main():
    unsupported = [
        "Drive 1 Rushing Yards",
        "1st Drive Rushing Attempts",
        "1Q Receiving Yards",
        "2Q Passing Yards",
        "1H Rushing + Receiving Yards",
        "First Half Receptions",
        "4th Quarter TD Scorer",
    ]
    for name in unsupported:
        assert _metric_spec(prop(name)) is None, f"{name} must not use full-game totals"

    expected = {
        "Rushing Yards": "rushingYards",
        "Receiving Yards": "receivingYards",
        "Rushing + Receiving Yards": "allPurposeYards",
        "Receptions": "receptions",
        "Rushing Attempts": "rushingAttempts",
        "Passing Yards": "passingYards",
        "Passing Attempts": "passingAttempts",
        "Passing Completions": "passingCompletions",
        "Longest Reception": "receivingLongest",
        "Longest Rush": "rushingLongest",
    }
    for name, metric in expected.items():
        spec = _metric_spec(prop(name))
        assert spec and spec["metric"] == metric, f"{name}: expected {metric}, got {spec}"

    game = {
        "rushingYards": 61,
        "receivingYards": 27,
        "rushingTouchdowns": 1,
        "receivingTouchdowns": 1,
    }
    assert _metric_value(game, {"metric": "allPurposeYards"}) == 88
    assert _metric_value(game, {"metric": "touchdowns"}) == 2
    assert _prop_hit(prop("Rushing Yards", line=60.5), game) is True
    assert _prop_hit(prop("Rushing Yards", line=61.5), game) is False

    print("Prop tracking validation passed.")


if __name__ == "__main__":
    main()
