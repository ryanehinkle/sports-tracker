"""ESPN cumulative NBA stat timelines, reconciled to final box scores."""
import re
from collections import defaultdict
METRICS=("points","rebounds","assists","threes","steals","blocks","turnovers","fgm")
COMBOS={"pra":("points","rebounds","assists"),"pr":("points","rebounds"),"pa":("points","assists"),"ra":("rebounds","assists")}
def elapsed(period,clock):
    try:
        q=int(period);a,b=clock.split(":");left=int(a)*60+float(b)
        duration=720 if q<=4 else 300
        if q<1 or not 0<=left<=duration:return None
        return (q-1)*720+duration-left if q<=4 else 2880+(q-5)*300+duration-left
    except (TypeError,ValueError,AttributeError):return None

def build_timing(raw,game):
    plays=raw.get("plays") or []
    if not plays:return None
    players={str(p["id"]):p for p in game.get("players",[])}
    names=sorted([(p["name"],pid) for pid,p in players.items()],key=lambda x:-len(x[0]))
    def named(text):
        t=str(text).strip()
        for name,pid in names:
            if t.lower().startswith(name.lower()+" "):return pid,t[len(name):].strip().lower()
        return None,t.lower()
    actions=[];final=0
    for play in plays:
        q=(play.get("period") or {}).get("number")
        clock=(play.get("clock") or {}).get("displayValue")
        e=elapsed(q,clock)
        if e is None:continue
        q=int(q);final=max(final,q);actions.append((e,q,clock,play))
    if final<4:return None
    actions.sort(key=lambda x:x[0])
    totals=defaultdict(lambda:defaultdict(int)); timelines=defaultdict(lambda:defaultdict(list))
    for e,q,clock,play in actions:
        text=str(play.get("text") or "")
        pid,verb=named(text);delta=defaultdict(lambda:defaultdict(int))
        if pid:
            score=play.get("scoreValue") or 0
            if verb.startswith(("makes ","made ")) and score in (1,2,3) and play.get("scoringPlay"):
                delta[pid]["points"]+=score
                if score>=2:delta[pid]["fgm"]+=1
                if score==3:delta[pid]["threes"]+=1
            if verb.startswith(("offensive rebound","defensive rebound","rebounds")):delta[pid]["rebounds"]+=1
            if verb.startswith(("blocks ","blocked ")):delta[pid]["blocks"]+=1
            if verb.startswith(("steals ","steal ")):delta[pid]["steals"]+=1
            if any(x in verb for x in ("turnover","bad pass","traveling","lost ball","offensive foul","double dribble","out of bounds")) and not verb.startswith(("draws ","blocks ")):
                delta[pid]["turnovers"]+=1
        for clause in re.findall(r"\(([^()]*)\)",text):
            ap,action=named(clause)
            if not ap:continue
            if action in ("assists","assist"):delta[ap]["assists"]+=1
            if action in ("steals","steal"):delta[ap]["steals"]+=1
        for who,changes in delta.items():
            for metric,n in changes.items():
                totals[who][metric]+=n;timelines[who][metric].append([totals[who][metric],q,clock])
            for combo,parts in COMBOS.items():
                if any(k in changes for k in parts):timelines[who][combo].append([sum(totals[who][k] for k in parts),q,clock])
    result={}
    for pid,p in players.items():
        actual=p["stats"];good={k for k in METRICS if k in actual and totals[pid][k]==actual[k]}
        good.update(k for k,parts in COMBOS.items() if all(x in good for x in parts))
        verified={k:timelines[pid][k] for k in good if actual.get(k,0)>0 and timelines[pid][k]}
        if verified:result[pid]=verified
    if not result:return None
    result["_finalPeriod"]=final
    return result

def average_hit(row,player,logs,timing,season,value,outcome,threshold):
    if not player:return None
    pid=str(player.get("id") or "");metric=row.get("metric")
    hits=0;times=[]
    for g in logs:
        if outcome(row,value(row,g))!="hit":continue
        hits+=1;game=timing.get(str(g.get("eventId")),{})
        if row.get("selection") in ("Under","No"):
            q=game.get("_finalPeriod");t=elapsed(q,"0:00") if q else None
            if t is not None:times.append(t)
        else:
            for v,q,clock in game.get(pid,{}).get(metric,[]):
                crossed=v>=threshold(row) if row.get("selection")=="Yes" else v>threshold(row)
                if crossed:
                    t=elapsed(q,clock)
                    if t is not None:times.append(t)
                    break
    return {"elapsedSeconds":round(sum(times)/len(times),1),"sample":len(times),"hits":hits,"season":season} if times else None
