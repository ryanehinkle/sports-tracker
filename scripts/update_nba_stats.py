#!/usr/bin/env python3
"""Build NBA regular-season player/team game logs from ESPN completed box scores.

Only verified ESPN box-score numbers are included. Completed games are cached so
scheduled refreshes fetch only new box scores; the NFL pipeline is unaffected.
"""
import json
import calendar
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path("data")
CACHE = ROOT / "nba-game-cache.json"
STATS = ROOT / "nba-stats.json"
TEAMS = ROOT / "nba-team-stats.json"
ROSTERS = ROOT / "nba-rosters.json"
TEAM_LIST = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams"
TEAM_ROSTER = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{}/roster"
SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
NBA_TEAMS = {
    "ATL":"Atlanta Hawks","BOS":"Boston Celtics","BKN":"Brooklyn Nets",
    "CHA":"Charlotte Hornets","CHI":"Chicago Bulls","CLE":"Cleveland Cavaliers",
    "DAL":"Dallas Mavericks","DEN":"Denver Nuggets","DET":"Detroit Pistons",
    "GS":"Golden State Warriors","HOU":"Houston Rockets","IND":"Indiana Pacers",
    "LAC":"LA Clippers","LAL":"Los Angeles Lakers","MEM":"Memphis Grizzlies",
    "MIA":"Miami Heat","MIL":"Milwaukee Bucks","MIN":"Minnesota Timberwolves",
    "NO":"New Orleans Pelicans","NY":"New York Knicks","OKC":"Oklahoma City Thunder",
    "ORL":"Orlando Magic","PHI":"Philadelphia 76ers","PHX":"Phoenix Suns",
    "POR":"Portland Trail Blazers","SAC":"Sacramento Kings","SA":"San Antonio Spurs",
    "TOR":"Toronto Raptors","UTAH":"Utah Jazz","WSH":"Washington Wizards",
}
ALIAS = {"GSW":"GS","NYK":"NY","NOP":"NO","SAS":"SA","PHO":"PHX","UTH":"UTAH"}
METRICS = ("points","rebounds","assists","threes","steals","blocks","turnovers",
           "minutes","fgm","fga","tpm","tpa","ftm","fta","offReb","defReb","fouls")
COMBOS = {"pra":("points","rebounds","assists"),"pr":("points","rebounds"),
          "pa":("points","assists"),"ra":("rebounds","assists")}
HEADSHOT = "https://a.espncdn.com/i/headshots/nba/players/full/{}.png"

def get(url, params):
    for retry in range(3):
        try:
            resp = requests.get(url, params=params, timeout=25,
                                headers={"User-Agent":"Mozilla/5.0", "Accept":"application/json"})
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            if retry == 2:
                print(f"ESPN request failed: {url}: {exc}")
            else:
                time.sleep(1 + retry)
    return {}

def load(path, fallback):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        return fallback

def abbr(v):
    return ALIAS.get(str(v or "").upper(), str(v or "").upper())

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.

def parse_shots(v):
    bits = str(v or "").split("-")
    return [num(bits[0]), num(bits[1])] if len(bits)==2 else [0.,0.]

def minutes(v):
    v=str(v or "").strip()
    if ":" in v:
        a,b=v.split(":",1)
        return round(num(a)+num(b)/60,2)
    return num(v)

def player_stats(labels, values):
    cols={str(k).upper():str(v) for k,v in zip(labels,values)}
    def val(*keys):
        for key in keys:
            if key in cols:return num(cols[key])
        return 0.
    fgm,fga=parse_shots(cols.get("FG",""))
    tpm,tpa=parse_shots(cols.get("3PT",cols.get("3P","")))
    ftm,fta=parse_shots(cols.get("FT",""))
    result={
        "points":val("PTS"),"rebounds":val("REB","TRB"),"assists":val("AST"),
        "threes":tpm,"steals":val("STL"),"blocks":val("BLK"),"turnovers":val("TO","TOV"),
        "minutes":minutes(cols.get("MIN",0)),"fgm":fgm,"fga":fga,"tpm":tpm,
        "tpa":tpa,"ftm":ftm,"fta":fta,"offReb":val("OREB"),"defReb":val("DREB"),
        "fouls":val("PF"),
    }
    for key,parts in COMBOS.items():result[key]=sum(result[p] for p in parts)
    return result

def month_ranges(first,last):
    y,m=first.year,first.month
    while date(y,m,1)<=last:
        end=date(y,m,calendar.monthrange(y,m)[1])
        yield max(first,date(y,m,1)),min(last,end)
        m+=1
        if m>12:y,m=y+1,1

def completed_games(start,end):
    events={}
    for lo,hi in month_ranges(start,end):
        query={"dates":lo.strftime("%Y%m%d")+"-"+hi.strftime("%Y%m%d"),"limit":500}
        payload=get(SCOREBOARD,query)
        for event in payload.get("events") or []:
            if not (event.get("status") or {}).get("type",{}).get("completed"):continue
            season=event.get("season") or {}
            if int(season.get("type") or 2)!=2:continue
            eid=str(event.get("id") or "")
            if eid:events[eid]=event
    return events

def normalized_game(raw):
    eid=str(raw.get("header",{}).get("id") or raw.get("boxscore",{}).get("id") or "")
    header=raw.get("header") or {}
    competitions=header.get("competitions") or []
    comp=competitions[0] if competitions else {}
    if not eid:eid=str(comp.get("id") or "")
    competitors=comp.get("competitors") or []
    teams={}
    for c in competitors:
        team=c.get("team") or {}
        code=abbr(team.get("abbreviation"))
        if code not in NBA_TEAMS:continue
        teams[code]={
            "id":str(team.get("id") or ""),"name":team.get("displayName") or NBA_TEAMS[code],
            "logo":team.get("logo") or f"https://a.espncdn.com/i/teamlogos/nba/500/{code.lower()}.png",
            "score":num(c.get("score")),"homeAway":c.get("homeAway") or "",
        }
    if len(teams)!=2:return None
    players=[]
    for entry in (raw.get("boxscore") or {}).get("players") or []:
        team=entry.get("team") or {}
        code=abbr(team.get("abbreviation"))
        if code not in teams:continue
        for section in entry.get("statistics") or []:
            labels=section.get("labels") or section.get("names") or []
            if "PTS" not in [str(x).upper() for x in labels]:continue
            for item in section.get("athletes") or []:
                athlete=item.get("athlete") or {}
                pid=str(athlete.get("id") or "")
                if not pid or not item.get("stats"):continue
                if item.get("didNotPlay") or item.get("reason"):continue
                name=athlete.get("displayName") or athlete.get("fullName")
                if not name:continue
                pos=athlete.get("position") or {}
                stat=player_stats(labels,item.get("stats") or [])
                if stat["minutes"]==0 and stat["points"]==0 and all(stat[k]==0 for k in ("rebounds","assists","steals","blocks")):continue
                players.append({
                    "id":pid,"name":name,"team":code,"position":pos.get("abbreviation") or "",
                    "headshot":(athlete.get("headshot") or {}).get("href") or HEADSHOT.format(pid),
                    "stats":stat,
                })
    if not players:return None
    return {"id":eid,"date":comp.get("date") or header.get("competitions",[{}])[0].get("date"),
            "teams":teams,"players":players}

def sumstats(logs):
    result={k:round(sum(num(g["stats"].get(k)) for g in logs),2) for k in METRICS}
    for key,parts in COMBOS.items():result[key]=sum(result[p] for p in parts)
    games=len(logs)
    result["games"]=games
    for key in ("points","rebounds","assists","threes","steals","blocks","turnovers",
                "minutes","pra","pr","pa","ra"):
        result[key+"PerGame"]=round(result[key]/games,2) if games else 0
    result["fgPct"]=round(result["fgm"]/result["fga"]*100,1) if result["fga"] else 0
    result["threePct"]=round(result["tpm"]/result["tpa"]*100,1) if result["tpa"] else 0
    result["ftPct"]=round(result["ftm"]/result["fta"]*100,1) if result["fta"] else 0
    return result

def make_payload(games, current_season):
    player_map={}
    team_map={t:{"id":"","abbreviation":t,"name":n,"shortName":n.split(" ")[-1],
                 "logo":f"https://a.espncdn.com/i/teamlogos/nba/500/{t.lower()}.png",
                 "gameLogsBySeason":{}} for t,n in NBA_TEAMS.items()}
    # Normalize completed game dates to stable YYYY-MM-DD values.
    def keydate(g):
        return str(g.get("date") or "")[:10]
    for game in sorted(games,key=keydate):
        teams=game.get("teams") or {}
        if len(teams)!=2:continue
        season=str(int(keydate(game)[:4])+(1 if int(keydate(game)[5:7])>=7 else 0))
        date_value=game.get("date") or ""
        scores={t:num(info.get("score")) for t,info in teams.items()}
        for code,info in teams.items():
            if code not in team_map:continue
            opp=next((k for k in teams if k!=code),"")
            record=team_map[code]
            record["id"]=info.get("id") or record["id"]
            record["logo"]=info.get("logo") or record["logo"]
            log={"eventId":game["id"],"date":date_value,
                 "opponent":{"abbreviation":opp},"homeAway":info.get("homeAway"),
                 "stats":{"derived.pointsFor":scores[code],"derived.pointsAgainst":scores.get(opp,0)}}
            roster=[p for p in game.get("players") or [] if p["team"]==code]
            for metric in METRICS+tuple(COMBOS):
                log["stats"][metric]=round(sum(num(p["stats"].get(metric)) for p in roster),2)
            record["gameLogsBySeason"].setdefault(season,[]).append(log)
        for p in game.get("players") or []:
            pid=str(p.get("id") or "")
            if not pid or not p.get("team"):continue
            entry=player_map.setdefault(pid,{
                "id":pid,"name":p["name"],"team":p["team"],"position":p.get("position") or "",
                "headshot":p.get("headshot") or HEADSHOT.format(pid),"gameLogsBySeason":{}
            })
            entry.update(name=p["name"],team=p["team"],position=p.get("position") or entry["position"],
                         headshot=p.get("headshot") or entry["headshot"])
            opp=next((k for k in teams if k!=p["team"]),"")
            log={"eventId":game["id"],"date":date_value,
                 "opponent":{"abbreviation":opp},"homeAway":teams[p["team"]].get("homeAway"),
                 "stats":p["stats"]}
            entry["gameLogsBySeason"].setdefault(season,[]).append(log)
    players=[]
    for entry in player_map.values():
        for logs in entry["gameLogsBySeason"].values():logs.sort(key=lambda g:g["date"],reverse=True)
        current=entry["gameLogsBySeason"].get(str(current_season),[])
        if not current:continue
        entry.update(sumstats(current))
        entry["gameLog"]=current
        players.append(entry)
    players.sort(key=lambda p:(-p.get("points",0),p["name"]))
    team_list=[]
    for code,entry in team_map.items():
        by=entry["gameLogsBySeason"]
        for logs in by.values():logs.sort(key=lambda g:g["date"],reverse=True)
        current=by.get(str(current_season),[])
        stat=sumstats(current)
        for key in ("points","rebounds","assists","threes","steals","blocks","turnovers",
                    "fgm","fga","tpm","tpa","ftm","fta","minutes"):
            stat[key+"PerGame"]=round(stat[key]/len(current),2) if current else 0
        stat["pointsAllowedPerGame"]=round(sum(g["stats"]["derived.pointsAgainst"] for g in current)/len(current),2) if current else 0
        stat["pointDiffPerGame"]=round(stat["pointsPerGame"]-stat["pointsAllowedPerGame"],2)
        entry["stats"]=stat
        entry["gameLog"]=current
        team_list.append(entry)
    # NBA defensive matchup profile: points/rebounds/assists/etc surrendered
    # to each opposing position per completed team game this regular season.
    allowed=defaultdict(lambda:defaultdict(lambda:defaultdict(float)))
    sample=defaultdict(int)
    dvp_metrics=("points","rebounds","assists","threes","steals","blocks","turnovers","pra","pr","pa","ra")
    for game in games:
        if not str(game.get("date") or "").startswith((str(current_season-1)+"-",str(current_season)+"-")):
            continue
        day=str(game.get("date") or "")[:10]
        if int(day[:4])+(1 if int(day[5:7])>=7 else 0)!=current_season:
            continue
        for code in game.get("teams") or {}:
            sample[code]+=1
            for athlete in game.get("players") or []:
                if athlete.get("team")==code:continue
                position=str(athlete.get("position") or "").upper()
                if position not in ("PG","SG","SF","PF","C"):continue
                for metric in dvp_metrics:
                    allowed[code][position][metric]+=num(athlete.get("stats",{}).get(metric))
    for entry in team_list:
        code=entry["abbreviation"]
        games_played=sample.get(code,0)
        entry["allowedByPosition"]={
            pos:dict({k:round(v/games_played,2) for k,v in metrics.items()},sampleGames=games_played)
            for pos,metrics in allowed[code].items() if games_played
        }
    now=datetime.now(timezone.utc).isoformat()
    stat_payload={"league":"NBA","season":current_season,"seasonLabel":f"{current_season-1}–{str(current_season)[-2:]} Regular Season",
                  "updatedAt":now,"players":players}
    catalog=[]
    for key in ("games","pointsPerGame","pointsAllowedPerGame","pointDiffPerGame",
                "reboundsPerGame","assistsPerGame","threesPerGame","stealsPerGame",
                "blocksPerGame","turnoversPerGame","fgPct","threePct","ftPct","points",
                "rebounds","assists","threes","fgmPerGame","fgaPerGame","tpmPerGame"):
        catalog.append({"key":key,"label":key.replace("PerGame"," / G").replace("Pct"," %").replace("Allowed"," Allowed").replace("pointDiff","Point Diff").title(),
                        "group":("defense" if key in ("pointsAllowedPerGame","stealsPerGame","blocksPerGame") else
                                 "shooting" if key in ("fgPct","threePct","ftPct","threesPerGame","fgmPerGame","fgaPerGame","tpmPerGame") else
                                 "rebounding" if "rebounds" in key else
                                 "playmaking" if "assists" in key or "turnovers" in key else "overview")})
    team_payload={"league":"NBA","season":current_season,"seasonLabel":stat_payload["seasonLabel"],
                  "updatedAt":now,"teams":team_list,"statCatalog":catalog}
    return stat_payload,team_payload

def roster_players(season):
    """Fetch official ESPN team rosters daily, preserving verified prior cache.

    NBA props are often posted before a player's first game; excluding zero-game
    roster members would silently drop legitimate market rows.
    """
    cached=load(ROSTERS,{})
    updated=cached.get("updatedAt","")
    if cached.get("season")==season and updated[:10]==date.today().isoformat() and cached.get("players"):
        return cached["players"]
    listing=get(TEAM_LIST,{"limit":100})
    leagues=((listing.get("sports") or [{}])[0].get("leagues") or [{}])
    teams=(leagues[0].get("teams") or []) if leagues else []
    known=[]
    for entry in teams:
        team=entry.get("team") or entry
        code=abbr(team.get("abbreviation"))
        if code in NBA_TEAMS and team.get("id"):
            known.append((str(team["id"]),code))
    if len(known)<20:
        return cached.get("players") or []
    players=[]
    with ThreadPoolExecutor(max_workers=10) as pool:
        tasks={pool.submit(get,TEAM_ROSTER.format(eid),{"season":season}):code for eid,code in known}
        for future in as_completed(tasks):
            code=tasks[future]
            try: payload=future.result()
            except Exception:continue
            for entry in payload.get("athletes") or []:
                athlete=entry.get("athlete") or entry
                pid=str(athlete.get("id") or "")
                if not pid:continue
                head=athlete.get("headshot") or {}
                pos=athlete.get("position") or {}
                players.append({
                    "id":pid,"name":athlete.get("displayName") or athlete.get("fullName") or "",
                    "team":code,"position":pos.get("abbreviation") or "",
                    "headshot":head.get("href") or HEADSHOT.format(pid),
                })
    if players:
        ROSTERS.write_text(json.dumps({"season":season,"updatedAt":datetime.now(timezone.utc).isoformat(),
                                       "players":players},separators=(",",":"))+"\n")
        return players
    return cached.get("players") or []

def supplement_roster(stats, roster):
    existing={str(p["id"]) for p in stats["players"]}
    for athlete in roster:
        if not athlete.get("name") or str(athlete["id"]) in existing:continue
        p=dict(athlete)
        p["gameLogsBySeason"]={}
        p["gameLog"]=[]
        p.update(sumstats([]))
        stats["players"].append(p)
        existing.add(str(p["id"]))
    stats["players"].sort(key=lambda p:(-p["points"],p["name"]))

def main():
    ROOT.mkdir(parents=True,exist_ok=True)
    today=date.today()
    year=today.year+(1 if today.month>=7 else 0)
    # Current season regular season starts in October; season 2027 is 2026-27.
    begin=date(year-1,10,1)
    if today<begin:begin=date(year-2,10,1)
    prev_start=date(year-1,3,1)
    prev_end=date(year-1,4,20)
    cache=load(CACHE,{"games":{}})
    gamecache=cache.get("games") or {}
    events={}
    for lo,hi in ((begin,min(today, date(year,6,30))), (prev_start,prev_end)):
        if hi>=lo:events.update(completed_games(lo,hi))
    missing=[eid for eid in events if eid not in gamecache]
    print(f"NBA: {len(events)} completed ESPN games, {len(missing)} missing cached box scores")
    if missing:
        with ThreadPoolExecutor(max_workers=12) as pool:
            tasks={pool.submit(get,SUMMARY,{"event":eid}):eid for eid in missing}
            for future in as_completed(tasks):
                eid=tasks[future]
                try:
                    normalized=normalized_game(future.result())
                    if normalized:gamecache[eid]=normalized
                except Exception as exc:print(f"Could not parse NBA game {eid}: {exc}")
    # Keep only NBA season data. Cache persists across game updates and does not overwrite past records.
    cache["games"]=gamecache
    CACHE.write_text(json.dumps(cache,separators=(",",":"))+"\n")
    current_games=[g for g in gamecache.values() if g.get("date")]
    stats,teams=make_payload(current_games,year)
    supplement_roster(stats,roster_players(year))
    if not stats["players"] and STATS.exists():
        raise RuntimeError("ESPN returned no completed NBA player logs; keeping the previous stats file")
    STATS.write_text(json.dumps(stats,separators=(",",":"))+"\n")
    TEAMS.write_text(json.dumps(teams,separators=(",",":"))+"\n")
    print(f"NBA data: {len(stats['players'])} current-season players, {len(teams['teams'])} teams")

if __name__=="__main__":main()
