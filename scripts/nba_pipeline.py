"""NBA-only pregame features, archived event grading, adaptive learning and daily slate picks.

The NFL learner is reused as a fitting implementation, not as a dataset.
Only independently verified real NBA games and pre-tip frozen rows are eligible.
"""
import json
import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import learn_model as lm
import numpy as np
from nba_timing import average_hit

ROOT=Path("data/nba-odds-history")
EVENTS=ROOT/"learning"
LEARNING=ROOT/"learning.json"
PICKS=ROOT/"ladder-picks.json"
CENTRAL=ZoneInfo("America/Chicago")
PICK_LEAD_TIME=timedelta(hours=2)

def daily_pick_window(schedule,now):
    """Use the first official scheduled game of the Central-time slate, not the first game with odds."""
    local=now.astimezone(CENTRAL).date()
    tips=[x["tip"] for x in schedule if x["tip"].astimezone(CENTRAL).date()==local]
    first=min(tips) if tips else None
    return first, first-PICK_LEAD_TIME if first else None

METRICS=("points","rebounds","assists","threes","pra","pr","pa","ra","steals","blocks","turnovers","fgm","moneyline","spread","teamTotal","gameTotal")
BASE_FEATURES=list(lm.FEATURES)
NBA_FEATURES=BASE_FEATURES+["margin","minutes","fga","tpa","matchup"]+["market:"+k for k in METRICS]
BASE_VECTOR=lm.feature_vector
DEFAULT_WEIGHTS=(30,22,12,14,14,8)

def load(path,default):
    try:return json.loads(path.read_text())
    except (OSError,ValueError):return default

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value,separators=(",",":"),allow_nan=False)+"\n")
    tmp.replace(path)

def dt(value):
    try:return datetime.fromisoformat(str(value).replace("Z","+00:00")).astimezone(timezone.utc)
    except (ValueError,TypeError):return None

def number(value):
    return lm.safe_num(value)

def num(value,default=0):
    v=number(value)
    return default if v is None else v

def metric(row):
    return row.get("teamMarketType") if row.get("scope")!="player" else row.get("metric")

def norm(name):
    return lm.normalize(name)

def opponent(event,row):
    team=row.get("team") or event.get("homeAbbr")
    return event.get("awayAbbr") if team==event.get("homeAbbr") else event.get("homeAbbr")

def logs(obj,season,cutoff):
    return sorted([g for g in (obj.get("gameLogsBySeason") or {}).get(str(season),[]) if dt(g.get("date")) and dt(g["date"])<cutoff],key=lambda g:g["date"],reverse=True)

def value(row,game):
    s=game.get("stats") or {}
    if row.get("scope")=="player":return number(s.get(row.get("metric")))
    pf,pa=number(s.get("derived.pointsFor")),number(s.get("derived.pointsAgainst"))
    if pf is None or pa is None:return None
    return pf-pa if metric(row) in ("moneyline","spread") else pf+pa if row.get("scope")=="game" else pf

def threshold(row):
    return 0 if metric(row)=="moneyline" else -num(row.get("line")) if metric(row)=="spread" else num(row.get("line"))

def outcome(row,v):
    if v is None:return None
    line=threshold(row);side=row.get("selection")
    if side=="Yes":return "hit" if v>=line else "miss"
    if side=="No":return "hit" if v<line else "miss"
    if v==line:return "push"
    return "hit" if (v<line if side=="Under" else v>line) else "miss"

def rate(row,games):
    results=[outcome(row,value(row,g)) for g in games]
    graded=[r for r in results if r in ("hit","miss")]
    if not graded:return None
    hits=graded.count("hit")
    return {"hits":hits,"total":len(graded),"pct":100*hits/len(graded)}

def percentile(value,values):
    if not values or value is None:return .5
    return (sum(x<value for x in values)+.5*sum(x==value for x in values))/len(values)

def avg(values,default=None):
    vals=[v for v in values if v is not None and math.isfinite(v)]
    return sum(vals)/len(vals) if vals else default

def smooth(rate):
    return (rate["hits"]+1.5)/(rate["total"]+3) if rate and rate["total"] else None

def implied(row):
    return lm.implied_probability(row)

def pair_probabilities(event):
    rows=event.get("props") or []
    groups={}
    for row in rows:
        groups.setdefault(lm.pair_key(str(event.get("id")),row),[]).append(row)
    result={}
    for index,row in enumerate(rows):
        own=implied(row);kind=metric(row)
        other=None
        for candidate in groups[lm.pair_key(str(event.get("id")),row)]:
            if candidate is row:continue
            if kind in ("moneyline","spread"):
                if candidate.get("team")!=row.get("team"):other=candidate;break
            elif candidate.get("selection")=={"Over":"Under","Under":"Over","Yes":"No","No":"Yes"}.get(row.get("selection")):
                other=candidate;break
        result[index]=own/(own+implied(other)) if other else own
    return result

def enrich_event(event,players,teams,season,timing=None):
    cutoff=dt(event.get("commenceTime"))
    if not cutoff:return
    pairs=pair_probabilities(event)
    team_points=[num(t.get("stats",{}).get("pointsAllowedPerGame")) for t in teams.values() if num(t.get("stats",{}).get("games"))>0]
    team_diffs=[num(t.get("stats",{}).get("pointDiffPerGame")) for t in teams.values() if num(t.get("stats",{}).get("games"))>0]
    cached_logs={}
    for index,row in enumerate(event.get("props") or []):
        is_player=row.get("scope")=="player"
        obj=players.get(norm(row.get("player"))) if is_player else teams.get(row.get("team") or event.get("homeAbbr"))
        obj=obj or {}
        opp=opponent(event,row);op=teams.get(opp,{})
        cache_key=(row.get("scope"),row.get("player") or row.get("team") or event.get("homeAbbr"))
        if cache_key not in cached_logs:cached_logs[cache_key]=(logs(obj,season,cutoff),logs(obj,season-1,cutoff))
        cur,prev=cached_logs[cache_key]
        h2h=[g for g in cur+prev if (g.get("opponent") or {}).get("abbreviation")==opp]
        rates={"l5":rate(row,cur[:5]),"l10":rate(row,cur[:10]),"h2h":rate(row,h2h),"current":rate(row,cur),"previous":rate(row,prev)}
        row["hitRates"]=rates
        if is_player:
            row["avgHitTime"]=average_hit(row,obj,cur,timing or {},season,value,outcome,threshold)
        values=[v for g in cur[:10] if (v:=value(row,g)) is not None]
        average=avg(values);sign=-1 if row.get("selection") in ("Under","No") else 1
        margin=(average-threshold(row))*sign if average is not None else None
        sd=math.sqrt(sum((v-average)**2 for v in values)/(len(values)-1)) if len(values)>1 else None
        margin_signal=lm.clamp(lm.sigmoid(margin/max(1.5,sd or abs(average)*.3 or 1)),.05,.95) if margin is not None else .5
        minutes=num(obj.get("minutesPerGame")) if is_player else 0
        fga=num(obj.get("fga"))/max(1,num(obj.get("games"))) if is_player else 0
        tpa=num(obj.get("tpa"))/max(1,num(obj.get("games"))) if is_player else 0
        matchup=.5;samples=0
        if is_player:
            allowed=(op.get("allowedByPosition") or {}).get(row.get("position"),{})
            actual=number(allowed.get(row.get("metric")))
            peers=[x for t in teams.values() if num((p:=(t.get("allowedByPosition") or {}).get(row.get("position"),{})).get("sampleGames"))>=2 and (x:=number(p.get(row.get("metric")))) is not None]
            if actual is not None and len(peers)>=4 and num(allowed.get("sampleGames"))>=2:
                matchup=percentile(actual,peers);samples=num(allowed["sampleGames"])
                if sign<0:matchup=1-matchup
        elif metric(row) in ("moneyline","spread") and len(team_diffs)>=4 and obj and op:
            matchup=lm.clamp(.5+(percentile(number(obj.get("stats",{}).get("pointDiffPerGame")),team_diffs)-percentile(number(op.get("stats",{}).get("pointDiffPerGame")),team_diffs))/2,.05,.95)
            samples=num(op.get("stats",{}).get("games"))
        elif len(team_points)>=4 and op:
            matchup=percentile(number(op.get("stats",{}).get("pointsAllowedPerGame")),team_points)
            if sign<0:matchup=1-matchup
            samples=num(op.get("stats",{}).get("games"))
        row["modelFeatures"]={"average":average,"margin":margin,"marginSignal":margin_signal,"minutes":minutes,"fga":fga,"tpa":tpa,"matchup":matchup,"samples":samples,"usageSignal":lm.clamp(minutes/36,0,1) if is_player else .5,"book":pairs[index]}

def feature_vector(row,book):
    f=row.get("modelFeatures") or {}
    return BASE_VECTOR(row,book)+[num(f.get("marginSignal"),.5),lm.clamp(num(f.get("minutes"))/48,0,1),lm.clamp(num(f.get("fga"))/40,0,1),lm.clamp(num(f.get("tpa"))/25,0,1),num(f.get("matchup"),.5)]+[float(metric(row)==k) for k in METRICS]

def configure_learner():
    lm.HISTORY_DIR=EVENTS;lm.OUT=LEARNING;lm.VERSION=2
    lm.FEATURES=NBA_FEATURES
    lm.FEATURE_LABELS.update({"margin":"Average vs line","minutes":"Minutes per game","fga":"Field-goal attempts","tpa":"Three-point attempts","matchup":"Opponent matchup"})
    lm.FEATURE_LABELS.update({"market:"+k:"NBA "+k for k in METRICS})
    lm.feature_vector=feature_vector
    lm.collect_samples=collect_samples
    lm.fit=fit_vectorized
    lm.market_family=lambda row:str(row.get("market") or metric(row) or "Other")

def collect_samples():
    rows=[];order={}
    for path in sorted(EVENTS.glob("*.json")):
        snap=load(path,{})
        event=snap.get("event") or {}
        eid=str(event.get("espnEventId") or "")
        capture,tip=dt(snap.get("capturedAt")),dt(event.get("commenceTime"))
        if not snap.get("pregameVerified") or not eid or not capture or not tip or capture>=tip:continue
        for row in event.get("props") or []:
            result=(row.get("result") or {}).get("status")
            if result not in ("hit","miss") or not row.get("modelFeatures") or row.get("period")!="fullGame":continue
            order[eid]=event["commenceTime"]
            rows.append({"event":eid,"date":tip.astimezone(CENTRAL).date().isoformat(),"time":event["commenceTime"],"y":float(result=="hit"),"x":feature_vector(row,num(row["modelFeatures"].get("book"),implied(row))),"market":str(row.get("market") or metric(row)),"position":str(row.get("position") or row.get("scope")),"scope":row.get("scope"),"family":(eid,row.get("player") or row.get("team") or "game",metric(row))})
    events=sorted(order,key=lambda e:order[e]);ranks={e:i for i,e in enumerate(events)}
    for row in rows:row["eventRank"]=ranks[row["event"]]
    rows.sort(key=lambda row:row["eventRank"])
    return rows,events

def fit_vectorized(rows,config):
    width=len(NBA_FEATURES)
    if not rows:return {"intercept":0.,"coefficients":[0.]*width,"means":[0.]*width,"stds":[1.]*width,"config":dict(config)}
    x=np.asarray([r["x"] for r in rows],dtype=float);y=np.asarray([r["y"] for r in rows],dtype=float)
    means=x.mean(axis=0);stds=x.std(axis=0);stds[stds<1e-9]=1
    z=(x-means)/stds
    counts=Counter(r["family"] for r in rows)
    family_counts=Counter(e for e,_,_ in counts)
    newest=max(r["eventRank"] for r in rows)
    weights=np.asarray([config["decay"]**(newest-r["eventRank"])/(counts[r["family"]]*family_counts[r["event"]]) for r in rows])
    weights/=weights.sum()
    coef=np.zeros(width);intercept=0.
    for _ in range(180):
        pred=1/(1+np.exp(-np.clip(z@coef+intercept,-20,20)))
        error=(pred-y)*weights
        intercept-=config["lr"]*error.sum()
        coef-=config["lr"]*(z.T@error+config["l2"]*coef)
    return {"intercept":float(intercept),"coefficients":coef.tolist(),"means":means.tolist(),"stds":stds.tolist(),"config":dict(config)}

def probability(row,learning):
    f=row.get("modelFeatures") or {};rates=row.get("hitRates") or {};book=num(f.get("book"),implied(row))
    recent=avg([smooth(rates.get("l5")),smooth(rates.get("l10"))],book)
    season=avg([smooth(rates.get("current")),smooth(rates.get("previous"))],book)
    h2h=smooth(rates.get("h2h"))
    signals=[recent,season,book if h2h is None else h2h,book+(num(f.get("usageSignal"),.5)-.5)*.2,lm.clamp(book+(num(f.get("matchup"),.5)-.5)*.35,.01,.99),num(f.get("marginSignal"),.5)]
    weighted=sum(a*b for a,b in zip(signals,DEFAULT_WEIGHTS))/sum(DEFAULT_WEIGHTS)
    reliability=min(1,num((rates.get("l10") or {}).get("total"))/8)
    base=lm.clamp(book+(weighted-book)*.65*reliability,.02,.98)
    champion=learning.get("champion") or {};blend=num(learning.get("liveBlend"))
    if champion.get("features")==NBA_FEATURES and blend>0:
        base=lm.clamp(base*(1-blend)+lm.predict(champion,{"x":feature_vector(row,book)})*blend,.03,.97)
    edge=base-implied(row)
    score=lm.clamp(100*(.75*base+.25*lm.clamp(.5+edge,0,1))*(.76+.24*reliability),0,100)
    return base,score,edge

def grade_event(event,players,teams,dnp=None):
    eid=str(event.get("espnEventId") or "")
    if not eid:return 0
    graded=0
    for row in event.get("props") or []:
        if (row.get("result") or {}).get("status") in ("hit","miss","push"):continue
        obj=players.get(norm(row.get("player"))) if row.get("scope")=="player" else teams.get(row.get("team") or event.get("homeAbbr"))
        matches=[g for games in ((obj or {}).get("gameLogsBySeason") or {}).values() for g in games if str(g.get("eventId"))==eid]
        if len(matches)!=1:
            if row.get("scope")=="player" and norm(row.get("player")) in (dnp or {}).get(eid,set()):
                row["result"]={"status":"push","reason":"Official DNP"};graded+=1
            continue
        actual=value(row,matches[0]);status=outcome(row,actual)
        if status:
            row["result"]={"status":status,"actual":actual};graded+=1
    return graded

def make_leg(event,row,prob,score):
    leg=dict(row)
    leg.update(eventId=str(event["id"]),espnEventId=str(event["espnEventId"]),commenceTime=event["commenceTime"],homeAbbr=event["homeAbbr"],awayAbbr=event["awayAbbr"],homeTeam=event.get("homeTeam"),awayTeam=event.get("awayTeam"),matchup=event["awayAbbr"]+" @ "+event["homeAbbr"],confidence=score,estimatedProbability=prob,result={"status":"pending"})
    leg["teamName"]=event.get("homeTeam") if row.get("team")==event["homeAbbr"] else event.get("awayTeam") if row.get("team")==event["awayAbbr"] else ""
    leg["key"]="¦".join(str(x) for x in (leg["eventId"],row.get("player") or row.get("team") or row.get("scope"),row.get("market"),row.get("selection"),f"{num(row.get('line')):g}",row.get("proposition") or ""))
    return leg

def select_pick(events,learning,kind):
    min_legs,max_legs,low,high=(2,4,1.9,2.35) if kind=="ladder" else (3,6,9.5,13.5)
    grouped=[]
    for event in events:
        options=[]
        for row in event.get("props") or []:
            d=number(row.get("decimalOdds")) or lm.american_to_decimal(row.get("odds"))
            if not d or d<=1 or d>high or row.get("period")!="fullGame":continue
            rates=row.get("hitRates") or {}
            if num((rates.get("l10") or {}).get("total"))<5:continue
            prob,score,edge=probability(row,learning)
            if edge<-.12:continue
            options.append((row,d,prob,score))
        # Retain strong candidates in multiple price bands rather than crowd
        # out possible payout ranges with many variants of one favorite.
        bands={}
        for item in sorted(options,key=lambda x:(-x[2],-x[3])):
            band=int(math.log(item[1])*16)
            bucket=bands.setdefault(band,[])
            if len(bucket)<4:bucket.append(item)
        grouped.append((event,[x for bucket in bands.values() for x in bucket]))
    beam=[(1.,1.,0.,[])];best=None
    for event,options in grouped:
        expanded=list(beam)
        for dec,prob,score,legs in beam:
            if len(legs)>=max_legs:continue
            for row,d,p,s in options:
                if dec*d>high:continue
                if row.get("player") and any(norm(x.get("player"))==norm(row["player"]) for x in legs):continue
                node=(dec*d,prob*p,score+s,legs+[make_leg(event,row,p,s)])
                expanded.append(node)
                if min_legs<=len(node[3])<=max_legs and low<=node[0]<=high and (best is None or (node[1],node[2]/len(node[3]))>(best[1],best[2]/len(best[3]))):best=node
        bins={}
        for node in expanded:
            key=(len(node[3]),int(math.log(node[0])*25))
            bins.setdefault(key,[]).append(node)
        beam=[n for group in bins.values() for n in sorted(group,key=lambda x:(-x[1],-x[2]))[:12]]
    if best is None:return None
    d,p,s,legs=best
    return {"kind":kind,"odds":round((d-1)*100 if d>=2 else -100/(d-1)),"confidence":s/len(legs),"estimatedProbability":p,"legs":legs,"status":"pending","targetOdds":"~+100" if kind=="ladder" else "~+1000","selectionTier":"Even Ladder" if kind=="ladder" else "Long Shot"}

def run(payload,stats,teams_payload,schedule,now):
    ROOT.mkdir(parents=True,exist_ok=True);EVENTS.mkdir(parents=True,exist_ok=True)
    players={norm(p.get("name")):p for p in stats.get("players") or []}
    teams={t.get("abbreviation"):t for t in teams_payload.get("teams") or []}
    season=int(stats.get("season") or 2027)
    events=payload.get("events") or []
    timing=load(ROOT/"hit-timing.json",{}).get("events",{})
    gamecache=load(Path("data/nba-game-cache.json"),{}).get("games",{})
    dnp={eid:{norm(p.get("name")) for p in g.get("dnp",[]) if p.get("name")} for eid,g in gamecache.items()}
    for event in events:enrich_event(event,players,teams,season,timing)
    # Each actual event has one rolling pregame observation. Once the tip
    # passes it is never replaced; only its result fields may be updated.
    for event in events:
        tip=dt(event.get("commenceTime"))
        if event.get("verifiedNBA") and event.get("espnEventId") and tip and now<tip:
            save(EVENTS/(str(event["espnEventId"])+".json"),{"pregameVerified":True,"capturedAt":now.isoformat(),"event":event})
    graded=0
    for path in EVENTS.glob("*.json"):
        snap=load(path,{});event=snap.get("event") or {}
        tip=dt(event.get("commenceTime"))
        if not tip or tip>=now:continue
        count=grade_event(event,players,teams,dnp)
        if count:save(path,snap);graded+=count
    configure_learner()
    learning=load(LEARNING,{})
    if graded or not learning:
        lm.main()
        learning=load(LEARNING,{})
    picks=load(PICKS,{"picks":[]})
    for pick in picks["picks"]:
        for leg in pick.get("legs") or []:
            if (leg.get("result") or {}).get("status") in ("hit","miss","push"):continue
            event={"espnEventId":leg.get("espnEventId"),"homeAbbr":leg.get("homeAbbr"),"props":[leg]}
            grade_event(event,players,teams,dnp)
        statuses=[(r.get("result") or {}).get("status","pending") for r in pick.get("legs") or []]
        pick["status"]="miss" if "miss" in statuses else "pending" if not statuses or "pending" in statuses else "push" if "push" in statuses else "hit"
    local=now.astimezone(CENTRAL).date().isoformat()
    day_events=[e for e in events if dt(e["commenceTime"]).astimezone(CENTRAL).date().isoformat()==local and dt(e["commenceTime"])>now]
    first,publish_at=daily_pick_window(schedule,now)
    picks["schedule"]={"date":local,"firstGameAt":first.isoformat() if first else None,"publishAt":publish_at.isoformat() if publish_at else None,"leadMinutes":120}
    print(f"NBA daily picks: {local}, first game {first}, publish at {publish_at} (UTC)")
    if publish_at and day_events and now>=publish_at:
        path=ROOT/(local+".json")
        snap=load(path,{})
        if not snap.get("pregameVerified"):
            snap={"date":local,"pregameVerified":True,"capturedAt":now.isoformat(),"events":day_events,"statsSnapshot":stats,"teamSnapshot":teams_payload,"learningSnapshot":learning}
            if path.exists():save(ROOT/"legacy"/path.name,load(path,{}))
            save(path,snap)
        # Publish once per date and kind, never reconstruct already-started legs.
        for kind in ("ladder","longshot"):
            if any(p.get("date")==local and p.get("kind")==kind for p in picks["picks"]):continue
            pick=select_pick(day_events,learning,kind)
            if pick:
                pick.update(date=local,createdAt=now.isoformat(),scheduledPublishAt=publish_at.isoformat(),slotLabel="Remaining slate" if now>=first else "Daily NBA slate",slotOrder=0)
                picks["picks"].append(pick)
        frozen=snap.setdefault("ladderSnapshot",{"picks":[]})["picks"]
        known={(p.get("date"),p.get("kind")) for p in frozen}
        additions=[p for p in picks["picks"] if p.get("date","")<=local and (p.get("date"),p.get("kind")) not in known]
        if additions:
            frozen.extend(additions);save(path,snap)
    save(PICKS,picks)
    days=[]
    for path in sorted(ROOT.glob("20??-??-??.json"),reverse=True):
        snap=load(path,{})
        if not snap.get("pregameVerified"):continue
        dirty=False
        for event in snap.get("events") or []:dirty=bool(grade_event(event,players,teams,dnp)) or dirty
        if dirty:save(path,snap)
        days.append({"date":path.stem,"file":path.name,"events":len(snap.get("events") or [])})
    save(ROOT/"index.json",{"days":days})
    print(f"NBA pipeline: {graded} newly graded frozen legs, {learning.get('completedGames',0)} learned games, {len(picks['picks'])} published picks")
