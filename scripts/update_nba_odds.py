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
from update_nba_stats import get as espn_get, SCOREBOARD, abbr

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

def partial_market(label):
    text=re.sub(r"[_-]+"," ",str(label or "").lower())
    return bool(re.search(r"\b(?:[1-4]\s*q|q\s*[1-4]|[12]\s*h|h\s*[12]|quarter|half|period|race to|first to|first \d+ minutes?|winning margin|double double|triple double|overtime|parlay|boost)\b",text))

def verified_schedule(now,ahead):
    days={}
    start=now.astimezone(CENTRAL).date()-timedelta(days=1)
    for delta in range(int(ahead/24)+4):
        day=start+timedelta(days=delta)
        payload=espn_get(SCOREBOARD,{"dates":day.strftime("%Y%m%d"),"limit":100})
        for event in payload.get("events") or []:
            comp=(event.get("competitions") or [{}])[0]
            teams={c.get("homeAway"):abbr((c.get("team") or {}).get("abbreviation")) for c in comp.get("competitors") or []}
            tip=iso_dt(event.get("date") or comp.get("date"))
            state=(event.get("status") or {}).get("type",{}).get("state")
            season=(event.get("season") or {}).get("type")
            if tip and teams.get("home") and teams.get("away") and event.get("id") and season in (None,2):
                days[str(event["id"])]={"espnEventId":str(event["id"]),"home":teams["home"],"away":teams["away"],"tip":tip,"state":state}
    return list(days.values())

def scheduled_match(event,schedule):
    pair=teams_for_event(event)
    tip=iso_dt(event.get("openDate"))
    if not pair or not tip:return None
    away,home=(TEAM_ABBR[p] for p in pair)
    matches=[x for x in schedule if x["home"]==home and x["away"]==away and x["state"]=="pre" and abs((x["tip"]-tip).total_seconds())<=1800]
    return matches[0] if len(matches)==1 else None

def market_metric(label):
    if partial_market(label):return None
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
    if selection in ("Over","Under"):values=[v for v in values if v!=threshold]
    if not values:return None
    outcomes=[(v<threshold if selection in ("Under","No") else v>=threshold if selection=="Yes" else v>threshold) for v in values]
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

def parse_event(event,pages,roster,season,team_reference):
    pair=teams_for_event(event)
    if not pair:return None
    away,home=pair
    result={"id":str(event.get("eventId") or event.get("id") or ""),"commenceTime":event.get("openDate"),
            "homeTeam":home,"awayTeam":away,"homeAbbr":TEAM_ABBR[home],"awayAbbr":TEAM_ABBR[away],
            "bookmaker":"FanDuel","props":[],"espnEventId":event["espnEventId"],"commenceTime":event["verifiedTip"],"verifiedNBA":True}
    props={}
    for tab,page in pages.items():
        for market_id,market in ((page.get("attachments") or {}).get("markets") or {}).items():
            if str(market.get("marketStatus") or market.get("status") or "OPEN").upper() not in ("ACTIVE","OPEN"):continue
            name=str(market.get("marketName") or "").strip()
            if partial_market(name+" "+str(market.get("marketType") or "")):continue
            metric=market_metric(name)
            for runner in market.get("runners") or []:
                if str(runner.get("runnerStatus") or runner.get("status") or "ACTIVE").upper() not in ("ACTIVE","OPEN"):continue
                odds=american_odds(runner)
                if odds is None:continue
                runner_name=str(runner.get("runnerName") or "").strip()
                player=player_for_market(name,runner_name,roster) if metric else None
                selection=choose_selection(runner_name)
                line=infer_line(name,runner) if metric else None
                if player and player.get("team") in (result["homeAbbr"],result["awayAbbr"]) and selection in ("Over","Under","Yes","No") and line is not None:
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
                        "sourceTab":tab,"marketId":str(market_id),"selectionId":str(runner.get("selectionId") or ""),"marketName":name,"period":"fullGame",
                        "alternate":bool("alt" in name.lower() or "+" in name),
                    }
                    obj["hitRates"]=enrich(obj,player,opp,season)
                    key=("player",normalize_name(player["name"]),metric,selection,threshold)
                    props[key]=obj
                    continue
                # Include only explicit, full-game lines. Do not label 1Q/1H
                # lines as full-game totals, or blend player/team markets.
                lower=name.lower()
                if partial_market(lower) or any(p in lower for p in ("player","rebounds","assists","three pointer","3-pointer","steals","blocks","turnovers","field goals","team to score","both teams","correct score")):continue
                kind="total" if ("total" in lower or "over/under" in lower) else "spread" if "spread" in lower or "handicap" in lower else "moneyline" if any(x in lower for x in ("moneyline","money line","match winner","game winner")) else ""
                if not kind:continue
                teams_here={full:code for full,code in TEAM_ABBR.items() if code in (result["homeAbbr"],result["awayAbbr"])}
                name_team=next((code for full,code in teams_here.items() if full.lower() in lower or full.split(" ")[-1].lower() in lower),"")
                runner_team=next((code for full,code in teams_here.items() if full.lower() in runner_name.lower() or re.search(r"\b"+re.escape(full.split(" ")[-1].lower())+r"\b",runner_name.lower())),"")
                is_team_total=kind=="total" and (bool(name_team) or "team" in lower)
                scope="game" if kind=="total" and not is_team_total else "team"
                team=(name_team or runner_team) if is_team_total else runner_team
                if (kind in ("spread","moneyline") or is_team_total) and not team:continue
                side=choose_selection(runner_name) if kind=="total" else "Cover" if kind=="spread" else "Win"
                if kind=="total" and side not in ("Over","Under"):continue
                if kind=="moneyline":line=0
                elif kind=="spread":
                    signed=re.search(r"([+-]\s*\d+(?:\.\d+)?)\s*$",runner_name)
                    try:
                        line=float(signed.group(1).replace(" ","")) if signed else float(runner["handicap"])
                    except (KeyError,TypeError,ValueError):
                        if re.search(r"\b(?:pk|pick.?em)\b",runner_name,re.I):line=0
                        else:continue
                else:
                    line=infer_line(name,runner)
                    if line is None or float(line)<0:continue
                obj={"scope":scope,"player":"","team":team,"metric":kind,"teamMarketType":"teamTotal" if is_team_total else "gameTotal" if scope=="game" else kind,
                     "market":"Game Total" if scope=="game" else "Team Total" if is_team_total else ("Spread" if kind=="spread" else "Moneyline"),
                     "selection":side,"line":line,"odds":odds,"decimalOdds":decimal_odds(runner),
                     "proposition":f"{team or 'Game'} {kind.title()} {side} {line if kind!='moneyline' else ''}".strip(),
                     "marketId":str(market_id),"sourceTab":tab,"marketName":name,"period":"fullGame","alternate":"alt" in lower}
                props[(scope,team,kind,side,line)]=obj
    team_by_abbr={t.get("abbreviation"):t for t in team_reference.get("teams",[])}
    for prop in props.values():
        if prop.get("scope")!="player":
            prop["hitRates"]=enrich_team(prop,result,team_by_abbr,season)
    result["props"]=sorted(props.values(),key=lambda x:(x.get("scope") or "",x.get("player") or x.get("team") or "",x["market"],str(x["line"])))
    return result if result["props"] else None

def enrich_team(row,event,team_by_abbr,season):
    team=team_by_abbr.get(row.get("team") or event.get("homeAbbr"))
    if not team:return {}
    current=game_logs(team,season)
    previous=game_logs(team,season-1)
    opponent=event["awayAbbr"] if team["abbreviation"]==event["homeAbbr"] else event["homeAbbr"]
    def numeric(g):
        stats=g.get("stats") or {}
        pf=stats.get("derived.pointsFor")
        pa=stats.get("derived.pointsAgainst")
        if pf is None or pa is None:return None
        pf=float(pf);pa=float(pa)
        kind=row.get("teamMarketType")
        return pf+pa if row.get("scope")=="game" else pf-pa if kind in ("spread","moneyline") else pf
    def prop_rate(games):
        values=[v for g in games if (v:=numeric(g)) is not None]
        line=float(row.get("line") or 0)
        kind=row.get("teamMarketType")
        values=[v for v in values if v!=(0 if kind=="moneyline" else -line if kind=="spread" else line)]
        if not values:return None
        def hit(v):
            if kind=="moneyline":return v>0
            if kind=="spread":return v+line>0
            return v<line if row.get("selection")=="Under" else v>line
        hits=sum(hit(v) for v in values)
        return {"hits":hits,"total":len(values),"pct":round(100*hits/len(values),1)}
    h2h=[g for g in current+previous if (g.get("opponent") or {}).get("abbreviation")==opponent]
    return {"l5":prop_rate(current[:5]),"l10":prop_rate(current[:10]),
            "h2h":prop_rate(h2h),"current":prop_rate(current),"previous":prop_rate(previous)}

def load_players(stats):
    return {normalize_name(p["name"]):p for p in stats.get("players") or [] if p.get("name")}

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
    schedule=verified_schedule(now,ahead)
    if not schedule:raise RuntimeError("No verified ESPN NBA schedule; refusing unverified sportsbook events")
    lobby=fetch_json(LOBBY_URL,{"page":"CUSTOM","customPageId":"nba","_ak":WEB_KEY})
    events=(lobby.get("attachments") or {}).get("events") or {}
    selected=[]
    for id,item in events.items():
        event=dict(item);event["eventId"]=str(event.get("eventId") or id)
        date=iso_dt(event.get("openDate"))
        match=scheduled_match(event,schedule)
        if match and date and now<match["tip"]<=now+timedelta(hours=ahead):
            event["espnEventId"]=match["espnEventId"];event["verifiedTip"]=match["tip"].isoformat()
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
            parsed=parse_event(event,pages,roster,season,teams)
            if parsed and iso_dt(parsed["commenceTime"])>datetime.now(timezone.utc):fresh.append(parsed);refreshed.add(eid)
            else:print(f"  {eid}: no eligible NBA markets; keeping previous snapshot if any")
        except Exception as exc:print(f"  NBA odds failed for {eid}: {exc}")
    captured=datetime.now(timezone.utc)
    # Never reintroduce old, started or simulated events when a tab fails.
    active={x["espnEventId"] for x in schedule if x["state"]=="pre" and x["tip"]>captured}
    live_by_espn={}
    for event in fresh:
        if event["espnEventId"] not in active or iso_dt(event["commenceTime"])<=captured:continue
        prior=live_by_espn.get(event["espnEventId"])
        if not prior or len(event["props"])>len(prior["props"]):live_by_espn[event["espnEventId"]]=event
    live=sorted(live_by_espn.values(),key=lambda e:e["commenceTime"])
    payload={"league":"NBA","bookmaker":"FanDuel","source":"FanDuel real NBA markets matched to ESPN schedule",
             "updatedAt":captured.isoformat(),"season":season,"events":live,"schemaVersion":2}
    from nba_pipeline import run
    run(payload,stats,teams,schedule,captured)
    save(OUT,payload)
    print(f"NBA odds: {len(live)} verified games, {sum(len(x['props']) for x in live)} actual outcomes")

if __name__=="__main__":main()
