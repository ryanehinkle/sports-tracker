import unittest
from nba_timing import build_timing, elapsed, merge_components, coverage
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
    def test_combined_timing_and_aliases(self):
        game={"players":[{"id":"1","name":"Julius Randle","stats":{"points":20,"assists":1,"pa":21,"rebounds":0,"pr":20}},{"id":"2","name":"Other Player","stats":{"points":2}}]}
        plays=[]
        for i in range(10):
            plays.append({"id":str(i),"period":{"number":1+i//4},"clock":{"displayValue":str(10-i%4)+":00"},"text":"J. Randle makes 2-point shot","scoreValue":2,"scoringPlay":True})
        plays.append({"id":"assist","period":{"number":3},"clock":{"displayValue":"5:00"},"text":"Other Player makes layup (Julius Randle assists)","scoreValue":2,"scoringPlay":True})
        plays.append({"period":{"number":4},"clock":{"displayValue":"0.0"},"text":"End of game"})
        data=build_timing({"plays":plays},game)
        self.assertEqual(data["1"]["pa"][-1],[21,3,"5:00"])
        self.assertEqual(data["1"]["pr"][-1][0],20)
        self.assertEqual(elapsed(4,"0.0"),2880)
        self.assertEqual(elapsed(2,"PT11M30S"),750)
        self.assertEqual(merge_components(("points","assists"),{"points":20,"assists":1},{"points":data["1"]["points"]}),[])
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
    def test_prepared_release(self):
        from nba_pipeline import promote_prepared
        target=datetime(2026,11,28,20,0,tzinfo=timezone.utc)
        from nba_pipeline import PICK_RULE_VERSION
        pick={"date":"2026-11-28","kind":"ladder","ruleVersion":PICK_RULE_VERSION,"scheduledPublishAt":target.isoformat(),"legs":[{"key":"unchanged"}]}
        data={"picks":[],"prepared":[pick]}
        promote_prepared(data,target-timedelta(seconds=1))
        self.assertEqual(data["picks"],[])
        promote_prepared(data,target)
        self.assertEqual(data["picks"],[pick])
        self.assertEqual(data["prepared"],[])
        promote_prepared(data,target+timedelta(minutes=20))
        self.assertEqual(data["picks"],[pick])
    def test_pick_preset_limits(self):
        from nba_pipeline import select_pick, PICK_PRESETS
        from unittest.mock import patch
        def event(i,odds,history=100):
            rate={"pct":history,"total":10,"hits":history/10}
            return {"id":str(i),"espnEventId":str(i),"commenceTime":"2026-11-28T22:00:00Z","homeAbbr":"BOS","awayAbbr":"NY","props":[{"scope":"player","player":"P"+str(i),"team":"BOS","metric":"points","market":"Points","line":10.5,"selection":"Over","period":"fullGame","odds":o,"hitRates":{k:rate for k in ("l5","l10","current","previous")}} for o in odds]}
        with patch("nba_pipeline.probability",return_value=(.8,80,.1)):
            ladder=select_pick([event(i,[-380,-140,-10000]) for i in range(3)],{},"ladder")
            self.assertIsNotNone(ladder)
            self.assertEqual(ladder["selectionTier"],"Exact Even Ladder")
            self.assertEqual(len(ladder["legs"]),3)
            self.assertTrue(all(x["odds"]==-380 for x in ladder["legs"]))
            longshot=select_pick([event(i,[120,790,-10000]) for i in range(3)],{},"longshot")
            self.assertIsNotNone(longshot)
            self.assertTrue(all(x["odds"]==120 for x in longshot["legs"]))
            self.assertIsNone(select_pick([event(i,[790,-10000]) for i in range(3)],{},"longshot"))
            self.assertIsNone(select_pick([event(i,[-380]) for i in range(2)],{},"ladder"))
    def test_feature_size(self):
        self.assertEqual(len(feature_vector({"scope":"player","metric":"points"},.5)),len(NBA_FEATURES))
if __name__=="__main__":unittest.main()
