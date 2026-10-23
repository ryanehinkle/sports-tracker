#!/usr/bin/env python3
"""Retrieve actual FanDuel NBA markets; enrich with ESPN game-log hit rates.

NBA lives in its own datasets and archive. Missing/closed markets are never
fabricated. Do not reuse NFL metric definitions or historical results.
"""
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from update_odds import (fetch_json, discover_tabs, american_odds, decimal_odds,
                         infer_line, iso_dt, normalize_name)

ROOT=Path("data")
OUT=ROOT/"nba-odds.json"
STATS=ROOT/"nba-stats.json"
TEAMS=ROOT/"nba-team-stats.json"
HISTORY=ROOT/"nba-odds-history"
LOBBY_URL="https://sbapi.nj.sportsbook.fanduel.com/api/content-managed-page"
EVENT_URL="https://sbapi.nj.sportsbook.fanduel.com/api/event-page"
WEB_KEY="FhMFpcPWXMeyZxOx"
CENTRAL=ZoneInfo("America/Chicago")
TEAM_ABBR={
 "Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BKN","Charlotte Hornets":"CHA",
 "Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN",
 "Detroit Pistons":"DET","Golden State Warriors":"GS","Houston Rockets":"HOU",
 "Indiana Pacers":"IND","Los Angeles Clippers":"LAC","LA Clippers":"LAC",
 "Los Angeles Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA",
 "Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NO",
 "New York Knicks":"NY","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL",
 "Philadelphia 76ers":"PHI","Phoenix Suns":"PHX","Portland Trail Blazers":"POR",
 "Sacramento Kings":"SAC","San Antonio Spurs":"SA","Toronto Raptors":"TOR",
 "Utah Jazz":"UTAH","Washington Wizards":"WSH"
}
MARKETS={
 "pra":("points + rebounds + assists","points, rebounds & assists","pts + reb + ast","points rebounds assists"),
 "pr":("points + rebounds","points & rebounds","pts + reb"),
 "pa":("points + assists","points & assists","pts + ast"),
 "ra":("rebounds + assists","rebounds & assists","reb + ast"),
 "points":("points","player points","pts"),
 "rebounds":("rebounds","rebs","total rebounds"),
 "assists":("assists","asts"),
 "threes":("three pointers","3-pointers","3 pointers","three point field goals","3pt","3ptm","3-pointers made","threes","made threes"),
 "steals":("steals",),
 "blocks":("blocks",),
 "turnovers":("turnovers",),
 "fgm":("field goals made",)
}
LABELS={"pra":"Pts + Reb + Ast","pr":"Pts + Reb","pa":"Pts + Ast",
        "ra":"Reb + Ast","points":"Points","rebounds":"Rebounds","assists":"Assists",
        "threes":"3-Pointers Made","steals":"Steals","blocks":"Blocks",
        "turnovers":"Turnovers","fgm":"Field Goals Made"}
TABS=("popular","player-props","points","player-points","player-rebounds","rebounds",
      "player-assists","assists","threes","three-pointers","player-threes","player-combos",
      "player-points-rebounds-assists","game-lines","game-props","team-totals","alternate-lines")
def load(path,default):
    try:return json.loads(path.read_text())
    except (OSError,ValueError):return default

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,separators=(",",":"))+"\n")

def teams_for_event(event):
    text=str(event.get("name") or "")
    sep=" @ " if " @ " in text else " v " if " v " in text else None
    if not sep:return None
    away,home=(x.split(" (")[0].strip() for x in text.split(sep,1))
    if away not in TEAM_ABBR or home not in TEAM_ABBR:return None
    return (away,home)

def market_metric(label):
    value=re.sub(r"\s+"," ",label.lower()).replace("–","-")
    words=set(re.findall(r"[a-z0-9]+",value))
    points=bool(words & {"points","point","pts"})
    rebounds=bool(words & {"rebounds","rebound","rebs","reb"})
    assists=bool(words & {"assists","assist","asts","ast"})
    if any(x in value for x in ("three pointer","3-pointer","three point","3pt","3pm","threes")):return "threes"
    if points and rebounds and assists:return "pra"
    if points and rebounds:return "pr"
    if points and assists:return "pa"
    if rebounds and assists:return "ra"
    if "team " in value and "player" not in value:return None
    if any(x in value for x in ("1st quarter","first quarter","2nd quarter","first half","2nd half")):return None
    if "race to" in value or "quarter" in value or "half" in value:return None
    for name,needles in MARKETS.items():
        if any(k in value for k in needles):
            # Reject individual stats embedded inside an unrecognized combination.
            if name in ("points","rebounds","assists") and (
                ("points" in value or "pts" in value) and ("rebounds" in value or "reb" in value)
                or ("points" in value or "pts" in value) and ("assists" in value or "ast" in value)
                or ("rebounds" in value or "reb" in value) and ("assists" in value or "ast" in value)
            ):continue
            return name
    return None

def player_for_market(market_name,runner_name,roster):
    text=" "+normalize_name(market_name+" "+runner_name)+" "
    choices=[]
    for normalized,player in roster.items():
        if normalized and normalized in text:
            choices.append((len(normalized),player))
    # Sometimes the market text has suffixes around the player's name; only
    # accept a matched ESPN athlete, never treat a team as a player.
    return max(choices,key=lambda x:x[0])[1] if choices else None

def choose_selection(text):
    lower=str(text or "").lower()
    if re.search(r"\bunder\b",lower):return "Under"
    if re.search(r"\bover\b",lower):return "Over"
    if re.search(r"\bno\b",lower):return "No"
    if re.search(r"\byes\b",lower):return "Yes"
    return None

def rate(values,threshold,selection):
    if not values:return None
    outcomes=[(v<threshold if selection=="Under" else v>=threshold if selection=="Yes" else v>threshold) for v in values]
    count=sum(outcomes)
    return {"hits":count,"total":len(values),"pct":round(count*100/len(values),1)}

def value_for_log(game,metric):
    stats=game.get("stats") or {}
    v=stats.get(metric)
    try:return float(v) if v is not None else None
    except (TypeError,ValueError):return None

def game_logs(profile,season):
    by=profile.get("gameLogsBySeason") or {}
    return sorted(by.get(str(season),[]),key=lambda g:g.get("date") or "",reverse=True)

def enrich(row,player,opponent,season):
    current=game_logs(player,season)
    prev=game_logs(player,season-1)
    metric=row["metric"]
    threshold=float(row["line"])
    selection=row["selection"]
    def values(games):
        return [x for g in games if (x:=value_for_log(g,metric)) is not None]
    h2h=[g for g in current+prev if (g.get("opponent") or {}).get("abbreviation")==opponent]
    return {
        "l5":rate(values(current[:5]),threshold,selection),
        "l10":rate(values(current[:10]),threshold,selection),
        "h2h":rate(values(h2h),threshold,selection),
        "current":rate(values(current),threshold,selection),
        "previous":rate(values(prev),threshold,selection),
        "recentAverage":round(sum(values(current[:10]))/len(values(current[:10])),2) if values(current[:10]) else None,
    }

def parse_event(event,pages,roster,season):
    pair=teams_for_event(event)
    if not pair:return None
    away,home=pair
    result={"id":str(event.get("eventId") or event.get("id") or ""),"commenceTime":event.get("openDate"),
            "homeTeam":home,"awayTeam":away,"homeAbbr":TEAM_ABBR[home],"awayAbbr":TEAM_ABBR[away],
            "bookmaker":"FanDuel","props":[]}
    props={}
    for tab,page in pages.items():
        for market_id,market in ((page.get("attachments") or {}).get("markets") or {}).items():
            if str(market.get("marketStatus") or market.get("status") or "OPEN").upper() not in ("ACTIVE","OPEN"):continue
            name=str(market.get("marketName") or "").strip()
            metric=market_metric(name)
            for runner in market.get("runners") or []:
                if str(runner.get("runnerStatus") or runner.get("status") or "ACTIVE").upper() not in ("ACTIVE","OPEN"):continue
                odds=american_odds(runner)
                if odds is None:continue
                runner_name=str(runner.get("runnerName") or "").strip()
                player=player_for_market(name,runner_name,roster) if metric else None
                selection=choose_selection(runner_name)
                line=infer_line(name,runner) if metric else None
                if player and selection in ("Over","Under","Yes","No") and line is not None:
                    # Yes/no thresholds are rare, but a missing milestone must
                    # never be interpreted as 0.5 or substituted with another.
                    try:threshold=float(line)
                    except (ValueError,TypeError):continue
                    if selection in ("Yes","No") and threshold<=0:continue
                    if selection in ("Yes","No"):
                        m=re.search(r"(\d+(?:\.\d+)?)\+",name+" "+runner_name)
                        if m:threshold=float(m.group(1))
                    if threshold<0:continue
                    opp=result["awayAbbr"] if player.get("team")==result["homeAbbr"] else result["homeAbbr"]
                    obj={
                        "scope":"player","player":player["name"],"team":player.get("team") or "",
                        "position":player.get("position") or "","headshot":player.get("headshot") or "",
                        "metric":metric,"market":LABELS[metric],"marketKey":str(market.get("marketType") or ""),
                        "selection":selection,"line":threshold,"odds":odds,"decimalOdds":decimal_odds(runner),
                        "proposition":f"{player['name']} {LABELS[metric]} {selection} {threshold:g}",
                        "sourceTab":tab,"marketId":str(market_id),"selectionId":str(runner.get("selectionId") or ""),
                        "alternate":bool("alt" in name.lower() or "+" in name),
                    }
                    obj["hitRates"]=enrich(obj,player,opp,season)
                    key=("player",normalize_name(player["name"]),metric,selection,threshold)
                    props[key]=obj
                    continue
                # Include only explicit, full-game lines. Do not label 1Q/1H
                # lines as full-game totals, or blend player/team markets.
                lower=name.lower()
                if any(p in lower for p in ("quarter","half","player","first to","race to")):continue
                scope="game" if "total" in lower and "team" not in lower else "team"
                kind="total" if ("total" in lower or "over/under" in lower) else "spread" if "spread" in lower or "handicap" in lower else "moneyline" if any(x in lower for x in ("moneyline","money line","match winner","game winner")) else ""
                if not kind:continue
                team=next((code for full,code in TEAM_ABBR.items() if (full.lower() in runner_name.lower() or full.split(" ")[-1].lower()==runner_name.lower()) and code in (result["homeAbbr"],result["awayAbbr"])),"")
                if kind in ("spread","moneyline") and not team:continue
                side=choose_selection(runner_name) if kind=="total" else "Cover" if kind=="spread" else "Win"
                if kind=="total" and side not in ("Over","Under"):continue
                if kind=="moneyline":line=0
                else:
                    line=infer_line(name,runner)
                    if line is None:continue
                obj={"scope":scope,"player":"","team":team,"metric":kind,"teamMarketType":kind,
                     "market":"Game Total" if scope=="game" else ("Spread" if kind=="spread" else "Moneyline"),
                     "selection":side,"line":line,"odds":odds,"decimalOdds":decimal_odds(runner),
                     "proposition":f"{team or 'Game'} {kind.title()} {side} {line if kind!='moneyline' else ''}".strip(),
                     "marketId":str(market_id),"sourceTab":tab}
                props[(scope,team,kind,side,line)]=obj
    result["props"]=sorted(props.values(),key=lambda x:(x.get("scope") or "",x.get("player") or x.get("team") or "",x["market"],str(x["line"])))
    return result if result["props"] else None

def load_players(stats):
    return {normalize_name(p["name"]):p for p in stats.get("players") or [] if p.get("name")}

def game_result(event,row,players,teams,season):
    local=(iso_dt(event.get("commenceTime")) or datetime.now(timezone.utc)).astimezone(CENTRAL).date()
    if row.get("scope")=="player":
        player=players.get(normalize_name(row.get("player")))
        if not player:return None
        opponent=event["awayAbbr"] if row.get("team")==event["homeAbbr"] else event["homeAbbr"]
        games=game_logs(player,season)
        matches=[g for g in games if (g.get("opponent") or {}).get("abbreviation")==opponent
                 and abs((datetime.fromisoformat(g["date"].replace("Z","+00:00")).astimezone(CENTRAL).date()-local).days)<=1]
        if not matches:return None
        actual=value_for_log(matches[0],row.get("metric"))
    else:
        teamcode=row.get("team") or event.get("homeAbbr")
        team=next((t for t in teams.get("teams") or [] if t.get("abbreviation")==teamcode),None)
        if not team:return None
        candidates=[g for g in game_logs(team,season) if
                    abs((datetime.fromisoformat(g["date"].replace("Z","+00:00")).astimezone(CENTRAL).date()-local).days)<=1]
        if not candidates:return None
        g=candidates[0]
        pf=float(g["stats"].get("derived.pointsFor") or 0)
        pa=float(g["stats"].get("derived.pointsAgainst") or 0)
        kind=row.get("teamMarketType")
        actual=pf-pa if kind=="spread" else pf if kind=="teamTotal" else pf+pa if kind=="total" else pf-pa
    if actual is None:return None
    threshold=float(row.get("line") or 0)
    selection=row.get("selection")
    if row.get("teamMarketType")=="moneyline":
        win=actual>0;push=actual==0
    elif row.get("teamMarketType")=="spread":
        win=actual+threshold>0;push=actual+threshold==0
    else:
        win=(actual<threshold if selection=="Under" else
             actual>=threshold if selection=="Yes" else
             actual<threshold if selection=="No" else actual>threshold)
        push=actual==threshold and selection in ("Over","Under")
    return {"status":"push" if push else "hit" if win else "miss","actual":actual}

def archive_and_grade(previous,payload,players,teams,season,now):
    HISTORY.mkdir(parents=True,exist_ok=True)
    archived=0
    by_date={}
    for event in previous.get("events") or []:
        kickoff=iso_dt(event.get("commenceTime"))
        if not kickoff or not (kickoff<=now and kickoff>=now-timedelta(days=5)):continue
        local=kickoff.astimezone(CENTRAL).date().isoformat()
        by_date.setdefault(local,[]).append(event)
    for day,events in by_date.items():
        path=HISTORY/f"{day}.json"
        snapshot=load(path,{"date":day,"events":[]})
        stored={str(x["id"]):x for x in snapshot.get("events") or []}
        for event in events:
            if str(event["id"]) not in stored:
                stored[str(event["id"])]=event
                archived+=1
        snapshot["events"]=list(stored.values())
        # Freeze the contemporaneous stats and team context with the first
        # archived NBA event. Historical model views must not use future logs.
        if "statsSnapshot" not in snapshot:
            snapshot["statsSnapshot"]=load(STATS,{})
            snapshot["teamSnapshot"]=teams
        save(path,snapshot)
    graded=0
    for path in sorted(HISTORY.glob("20??-??-??.json")):
        snap=load(path,{})
        dirty=False
        for event in snap.get("events") or []:
            for row in event.get("props") or []:
                if (row.get("result") or {}).get("status") in ("hit","miss","push"):continue
                result=game_result(event,row,players,teams,season)
                if result:
                    row["result"]=result;graded+=1;dirty=True
        if dirty:save(path,snap)
    days=[]
    for path in sorted(HISTORY.glob("20??-??-??.json"),reverse=True):
        snap=load(path,{})
        days.append({"date":path.stem,"file":path.name,
                     "events":len(snap.get("events") or [])})
    save(HISTORY/"index.json",{"days":days})
    return archived,graded

def main():
    ROOT.mkdir(parents=True,exist_ok=True)
    now=datetime.now(timezone.utc)
    ahead=int(os.getenv("NBA_ODDS_LOOKAHEAD_HOURS","72"))
    stats=load(STATS,{})
    teams=load(TEAMS,{})
    if not stats.get("players"):raise RuntimeError("NBA player stats missing; run update_nba_stats.py first")
    season=int(stats.get("season") or 2027)
    roster=load_players(stats)
    old=load(OUT,{"events":[]})
    lobby=fetch_json(LOBBY_URL,{"page":"CUSTOM","customPageId":"nba","_ak":WEB_KEY})
    events=(lobby.get("attachments") or {}).get("events") or {}
    selected=[]
    for id,item in events.items():
        event=dict(item);event["eventId"]=str(event.get("eventId") or id)
        date=iso_dt(event.get("openDate"))
        if teams_for_event(event) and date and now-timedelta(hours=10)<=date<=now+timedelta(hours=ahead):
            selected.append(event)
    selected.sort(key=lambda e:e.get("openDate") or "")
    print(f"FanDuel NBA: found {len(selected)} games in window")
    oldmap={str(g.get("id")):g for g in old.get("events") or []}
    fresh=[]
    refreshed=set()
    for event in selected:
        eid=event["eventId"]
        try:
            popular=fetch_json(EVENT_URL,{"eventId":eid,"tab":"popular","_ak":WEB_KEY})
            available=discover_tabs(popular)
            # Use advertised tabs first and supplement familiar basketball tabs.
            tabs=["popular"]+[t for t in sorted(available) if any(word in t.lower() for word in
                 ("point","rebound","assist","three","player","total","game-line","spread","combo"))][:35]
            pages={"popular":popular}
            for tab in dict.fromkeys(tabs[1:]):
                try:
                    page=fetch_json(EVENT_URL,{"eventId":eid,"tab":tab,"_ak":WEB_KEY})
                    if (page.get("attachments") or {}).get("markets"):pages[tab]=page
                except Exception:pass
                time.sleep(.06)
            # If FanDuel omits tab discovery, try canonical basketball tabs.
            if len(pages)<=1:
                for tab in TABS[1:]:
                    try:
                        page=fetch_json(EVENT_URL,{"eventId":eid,"tab":tab,"_ak":WEB_KEY})
                        if (page.get("attachments") or {}).get("markets"):pages[tab]=page
                    except Exception:pass
            parsed=parse_event(event,pages,roster,season)
            if parsed:fresh.append(parsed);refreshed.add(eid)
            else:print(f"  {eid}: no eligible NBA markets; keeping previous snapshot if any")
        except Exception as exc:print(f"  NBA odds failed for {eid}: {exc}")
    preserved=[e for eid,e in oldmap.items() if eid not in refreshed
               and (iso_dt(e.get("commenceTime")) or now)>now-timedelta(hours=10)
               and (iso_dt(e.get("commenceTime")) or now)<now+timedelta(hours=ahead)]
    live=preserved+fresh
    live.sort(key=lambda e:e.get("commenceTime") or "")
    payload={"league":"NBA","bookmaker":"FanDuel","source":"FanDuel public sportsbook web feed",
             "updatedAt":now.isoformat(),"season":season,"events":live}
    archived,graded=archive_and_grade(old,payload,roster,teams,season,now)
    if live or not old.get("events"):
        save(OUT,payload)
    print(f"NBA odds: {len(live)} events, {sum(len(x['props']) for x in live)} actual outcomes, "
          f"{archived} archived games, {graded} graded outcomes")

if __name__=="__main__":main()
