import unittest
from nba_timing import build_timing, elapsed
from nba_pipeline import outcome, grade_event, feature_vector, NBA_FEATURES, daily_pick_window
from datetime import datetime, timezone, timedelta
class NBAParityTests(unittest.TestCase):
    def test_timing(self):
        self.assertEqual(elapsed(2,"11:00"),780)
        self.assertEqual(elapsed(5,"2:30"),3030)
        raw={"plays":[{"period":{"number":1},"clock":{"displayValue":"11:30"},"text":"Test Player makes 3-point shot (Other Player assists)","scoreValue":3,"scoringPlay":True},{"period":{"number":4},"clock":{"displayValue":"0:00"},"text":"End of game"}]}
        game={"players":[{"id":"1","name":"Test Player","stats":{"points":3,"fgm":1,"threes":1}},{"id":"2","name":"Other Player","stats":{"assists":1}}]}
        data=build_timing(raw,game)
        self.assertEqual(data["1"]["points"],[[3,1,"11:30"]])
        self.assertEqual(data["2"]["assists"],[[1,1,"11:30"]])
        game["players"][0]["stats"]["points"]=4
        self.assertNotIn("points",build_timing(raw,game)["1"])
    def test_outcome(self):
        self.assertEqual(outcome({"scope":"player","line":10,"selection":"Over"},10),"push")
        self.assertEqual(outcome({"scope":"player","line":10,"selection":"Yes"},10),"hit")
        self.assertEqual(outcome({"scope":"team","teamMarketType":"spread","line":-5,"selection":"Cover"},4),"miss")
    def test_exact_event(self):
        row={"scope":"player","player":"Test Player","line":10,"metric":"points","selection":"Over"}
        event={"espnEventId":"1","props":[row]}
        players={"test player":{"gameLogsBySeason":{"2027":[{"eventId":"2","stats":{"points":20}}]}}}
        from nba_pipeline import norm
        players={norm("Test Player"):next(iter(players.values()))}
        self.assertEqual(grade_event(event,players,{}),0)
        players[norm("Test Player")]["gameLogsBySeason"]["2027"][0]["eventId"]="1"
        self.assertEqual(grade_event(event,players,{}),1)
        self.assertEqual(row["result"]["status"],"hit")
    def test_daily_pick_window(self):
        first=datetime(2026,11,28,22,0,tzinfo=timezone.utc)
        now=first-timedelta(hours=2)
        schedule=[{"tip":first+timedelta(hours=3)},{"tip":first},{"tip":first-timedelta(days=1)}]
        tip,release=daily_pick_window(schedule,now)
        self.assertEqual(tip,first)
        self.assertEqual(release,datetime(2026,11,28,20,0,tzinfo=timezone.utc))
        self.assertLess(now-timedelta(seconds=1),release)
        self.assertEqual(daily_pick_window([],now),(None,None))
        # After the earliest game begins, do not reset the release to the next game.
        self.assertEqual(daily_pick_window(schedule,first+timedelta(minutes=10)),(tip,release))
    def test_feature_size(self):
        self.assertEqual(len(feature_vector({"scope":"player","metric":"points"},.5)),len(NBA_FEATURES))
if __name__=="__main__":unittest.main()
