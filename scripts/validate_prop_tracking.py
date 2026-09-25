"""Small guardrail suite for historical NFL prop tracking.

The site only has ESPN full-game game logs. This validator makes sure period/drive
markets can never silently fall through to full-game totals.
"""
from update_odds import (
    _full_game_team_market,
    _metric_spec,
    _metric_value,
    _prop_hit,
    _spread_role,
    _team_prop_outcome,
    _team_prop_record,
)


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
        "Most Rushing Yards",
        "Most Receiving Yards",
        "Most Passing Yards",
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
        "Passing + Rushing Yards": "passRushYards",
        "Passing Attempts": "passingAttempts",
        "Passing Completions": "passingCompletions",
        "Longest Reception": "receivingLongest",
        "Longest Rush": "rushingLongest",
        "Player To Record A Sack": "sacks",
        "Field Goals": "fieldGoalsMade",
        "Kicking Points": "kickingPoints",
    }
    for name, metric in expected.items():
        spec = _metric_spec(prop(name))
        assert spec and spec["metric"] == metric, f"{name}: expected {metric}, got {spec}"

    game = {
        "rushingYards": 61,
        "receivingYards": 27,
        "passingYards": 242,
        "fieldGoalsMade": 3,
        "kickingPoints": 11,
        "rushingTouchdowns": 1,
        "receivingTouchdowns": 1,
    }
    assert _metric_value(game, {"metric": "allPurposeYards"}) == 88
    assert _metric_value(game, {"metric": "passRushYards"}) == 303
    assert _metric_value(game, {"metric": "kickingPoints"}) == 11
    assert _metric_value(game, {"metric": "touchdowns"}) == 2
    assert _prop_hit(prop("Rushing Yards", line=60.5), game) is True
    assert _prop_hit(prop("Rushing Yards", line=61.5), game) is False
    sack_game = {"sacks": 1}
    assert _prop_hit(prop("Player To Record A Sack", line=None, selection="Yes"), sack_game) is True

    # FanDuel team/game market taxonomy guardrails.
    assert _full_game_team_market("Total Points", "AWAY_TEAM_TOTAL_POINTS") == "teamTotal"
    assert _full_game_team_market("Total Points", "HOME_TEAM_TOTAL_POINTS") == "teamTotal"
    assert _full_game_team_market("Total Points", "TOTAL_POINTS_(OVER/UNDER)") == "gameTotal"
    assert _full_game_team_market("Money Line", "MONEY_LINE") == "moneyline"
    assert _full_game_team_market("Match Handicap", "MATCH_HANDICAP_(2-WAY)") == "spread"

    event = {"eventId": "test"}
    away, home = "Atlanta Falcons", "Green Bay Packers"
    away_total = _team_prop_record(
        event,
        {"marketName": "Total Points", "marketType": "AWAY_TEAM_TOTAL_POINTS", "marketId": "1"},
        "1",
        {"runnerName": "Over 24.5", "handicap": 24.5, "winRunnerOdds": {"americanDisplayOdds": {"americanOdds": -110}}},
        "popular",
        away,
        home,
    )
    assert away_total and away_total["scope"] == "team"
    assert away_total["team"] == "ATL"
    assert away_total["teamMarketType"] == "teamTotal"
    assert away_total["market"] == "Team Total"
    assert "ATL" in away_total["proposition"]

    home_total = _team_prop_record(
        event,
        {"marketName": "Total Points", "marketType": "HOME_TEAM_TOTAL_POINTS", "marketId": "2"},
        "2",
        {"runnerName": "Under 20.5", "handicap": 20.5, "winRunnerOdds": {"americanDisplayOdds": {"americanOdds": -110}}},
        "popular",
        away,
        home,
    )
    assert home_total and home_total["team"] == "GB"
    assert home_total["teamMarketType"] == "teamTotal"

    alt_spread = _team_prop_record(
        event,
        {"marketName": "Alternate Handicap", "marketType": "ALTERNATE_HANDICAP", "marketId": "3"},
        "3",
        {"runnerName": "Atlanta Falcons +7.5", "handicap": 0, "winRunnerOdds": {"americanDisplayOdds": {"americanOdds": -300}}},
        "popular",
        away,
        home,
    )
    assert alt_spread and alt_spread["line"] == 7.5, alt_spread
    assert alt_spread["market"] == "Alt Spread"
    assert alt_spread["spreadRole"] == "receiving"

    favorite = _team_prop_record(
        event,
        {"marketName": "Match Handicap", "marketType": "MATCH_HANDICAP_(2-WAY)", "marketId": "4"},
        "4",
        {"runnerName": "Green Bay Packers -3.5", "handicap": -3.5, "winRunnerOdds": {"americanDisplayOdds": {"americanOdds": -110}}},
        "popular",
        away,
        home,
    )
    assert favorite and favorite["line"] == -3.5
    assert favorite["spreadRole"] == "giving"
    assert _spread_role(0) == "pickem"

    # Spread math is always from the selected team's perspective:
    # +7.5 covers a 7-point loss; -3.5 requires a win by at least 4.
    loss_by_seven = {"stats": {"derived.pointsFor": 20, "derived.pointsAgainst": 27}}
    win_by_three = {"stats": {"derived.pointsFor": 27, "derived.pointsAgainst": 24}}
    win_by_four = {"stats": {"derived.pointsFor": 28, "derived.pointsAgainst": 24}}
    assert _team_prop_outcome({"teamMarketType": "spread", "line": 7.5}, loss_by_seven) is True
    assert _team_prop_outcome({"teamMarketType": "spread", "line": -3.5}, win_by_three) is False
    assert _team_prop_outcome({"teamMarketType": "spread", "line": -3.5}, win_by_four) is True

    print("Prop tracking validation passed.")


if __name__ == "__main__":
    main()
