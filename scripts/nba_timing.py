"""NBA first-hit timing from independently box-score-validated ESPN play events."""
import re
import unicodedata
from collections import defaultdict

TIMING_VERSION=3
METRICS=("points","rebounds","assists","threes","steals","blocks","turnovers","fgm")
COMBOS={"pra":("points","rebounds","assists"),"pr":("points","rebounds"),"pa":("points","assists"),"ra":("rebounds","assists")}

def elapsed(period,clock):
    try:
        q=int(period);clock=str(clock).strip()
        iso=re.fullmatch(r"PT(?:(\d+)M)?([\d.]+)S",clock,re.I)
        if iso:left=int(iso.group(1) or 0)*60+float(iso.group(2))
        elif ":" in clock:
            a,b=clock.split(":",1);left=int(a)*60+float(b)
        else:left=float(clock)
        duration=720 if q<=4 else 300
        if q<1 or not 0<=left<=duration:return None
        return (q-1)*720+duration-left if q<=4 else 2880+(q-5)*300+duration-left
    except (TypeError,ValueError,AttributeError):return None

def canonical(s):
    return re.sub(r"[^a-z0-9]+"," ",unicodedata.normalize("NFKD",str(s or "")).encode("ascii","ignore").decode().lower()).strip()

def athlete_id(p):
    a=p.get("athlete") or p.get("player") or {}
    if not isinstance(a,dict):a={}
    return str(a.get("id") or p.get("athleteId") or p.get("playerId") or "")

def roles(p):
    r=p.get("type") or p.get("role") or p.get("participantType") or ""
    if isinstance(r,dict):r=" ".join(str(r.get(k) or "") for k in ("name","text","abbreviation","description"))
    return canonical(r)

def merge_components(parts,stats,verified):
    """Merge validated cumulative component changes at the same game clock."""
    if any(k not in stats or (stats[k]!=0 and k not in verified) for k in parts):return []
    events=defaultdict(dict)
    for k in parts:
        for v,q,c in verified.get(k,[]):
            e=elapsed(q,c)
            if e is not None:events[(e,q,c)][k]=v
    totals={k:0 for k in parts};out=[]
    for (e,q,c),changes in sorted(events.items(),key=lambda x:(x[0][0],x[0][1])):
        totals.update(changes);out.append([sum(totals.values()),q,c])
    return out

def coverage(game,timing):
    possible=covered=0
    for p in game.get("players",[]):
        stats=p.get("stats") or {};rows=(timing or {}).get(str(p["id"]),{})
        for k in METRICS+tuple(COMBOS):
            if stats.get(k,0)>0:
                possible+=1
                if rows.get(k):covered+=1
    return covered,possible

def build_timing(raw,game):
    plays=raw.get("plays") or []
    if not plays:return None
    players={str(p["id"]):p for p in game.get("players",[])}
    aliases=defaultdict(set)
    for pid,p in players.items():
        name=canonical(p.get("name"))
        bits=name.split()
        if not bits:continue
        aliases[name].add(pid)
        stripped=re.sub(r" (jr|sr|ii|iii|iv)$","",name)
        aliases[stripped].add(pid)
        if len(bits)>1:
            aliases[bits[0][0]+" "+ " ".join(bits[1:])].add(pid)
            aliases[bits[0][0]+" "+ " ".join(stripped.split()[1:])].add(pid)
    names=sorted(((name,next(iter(ids))) for name,ids in aliases.items() if name and len(ids)==1),key=lambda x:-len(x[0]))
    def named(text):
        t=canonical(text)
        for name,pid in names:
            if t==name:return pid,""
            if t.startswith(name+" "):return pid,t[len(name)+1:]
        return None,t
    actions=[];seen=set();final=0
    for i,play in enumerate(plays):
        q=(play.get("period") or {}).get("number") if isinstance(play.get("period"),dict) else play.get("period")
        clock=(play.get("clock") or {}).get("displayValue") if isinstance(play.get("clock"),dict) else play.get("clock")
        e=elapsed(q,clock)
        if e is None:continue
        q=int(q);final=max(final,q)
        identity=str(play.get("id") or play.get("sequenceNumber") or "")
        if identity and identity in seen:continue
        if identity:seen.add(identity)
        actions.append((e,q,i,str(clock),play))
    if final<4:return None
    actions.sort(key=lambda x:(x[0],x[1],x[2]))
    # Alternate attribution strategies reconcile independently to box scores.
    # Never use an unvalidated timeline merely because a final prop hit.
    variants=[]
    for mode in ("text","hybrid","structured"):
        totals=defaultdict(lambda:defaultdict(int)); timelines=defaultdict(lambda:defaultdict(list))
        for _,q,_,clock,play in actions:
            text=str(play.get("text") or play.get("shortText") or "")
            typ=play.get("type") or {}
            label=canonical(typ.get("text") if isinstance(typ,dict) else typ)
            pid,verb=named(text)
            participants=[(athlete_id(p),roles(p)) for p in play.get("participants") or [] if isinstance(p,dict)]
            participants=[(p,r) for p,r in participants if p in players]
            def role(*terms):
                return next((p for p,r in participants if any(term in r for term in terms)),None)
            primary=pid if mode!="structured" else (role("shooter","scorer","rebounder","turnover","committed","player") or pid)
            if not primary and mode!="text" and participants:primary=participants[0][0]
            context=verb if pid else canonical(text)
            delta=defaultdict(dict)
            def add(who,k,n=1):
                if who in players:delta[who][k]=max(delta[who].get(k,0),n)
            try:score=int(play.get("scoreValue") or 0)
            except (ValueError,TypeError):score=0
            made=bool(re.search(r"\b(?:makes|made|hits|hit)\b",context)) or "made" in label
            if score not in (1,2,3) and made:
                if "free throw" in context or "free throw" in label:score=1
                elif re.search(r"\b(?:3 point|three point|three pointer)\b",context+" "+label):score=3
                elif play.get("scoringPlay") or play.get("shootingPlay"):score=2
            if made and score in (1,2,3) and (play.get("scoringPlay") or mode!="text"):
                add(primary,"points",score)
                if score>=2:add(primary,"fgm")
                if score==3:add(primary,"threes")
            if re.search(r"\b(?:offensive rebound|defensive rebound|rebounds?)\b",context) and not re.search(r"\bteam rebound\b",context):
                if verb.startswith(("offensive rebound","defensive rebound","rebound")) or "rebound" in label:
                    add(role("rebound") or primary if mode!="text" else pid,"rebounds")
            if verb.startswith(("blocks ","blocked ","block ")) or (mode!="text" and "block" in label):
                add((role("block") or primary) if mode!="text" else pid,"blocks")
            if verb.startswith(("steals","steal ")):add(pid,"steals")
            if verb.startswith(("assists","assist ")):add(pid,"assists")
            turn=bool(re.search(r"\b(?:turnover|bad pass|traveling|travelling|lost ball|offensive foul|double dribble|out of bounds|shot clock violation|palming|carrying|3 second violation|three second violation)\b",context+" "+label))
            if turn and not verb.startswith(("draws ","blocks ","steals")):
                add((role("turnover","committed") or primary) if mode!="text" else pid,"turnovers")
            for clause in re.findall(r"\(([^()]*)\)",text):
                ap,action=named(clause)
                if ap and re.search(r"\bassist(?:s|ed)?\b",action):add(ap,"assists")
                if ap and re.search(r"\bsteal(?:s)?\b",action):add(ap,"steals")
                if ap and re.search(r"\bblock(?:s|ed)?\b",action):add(ap,"blocks")
                if not ap:
                    normalized=canonical(clause)
                    for prefix,k in (("assist by ","assists"),("assisted by ","assists"),("steal by ","steals"),("blocked by ","blocks"),("block by ","blocks")):
                        if normalized.startswith(prefix):add(named(normalized[len(prefix):])[0],k)
            # Also recognize non-parenthesized credits and explicit participant roles.
            for name,who in names:
                if re.search(r"\b"+re.escape(name)+r" (?:assists|assist)\b",canonical(text)):add(who,"assists")
                if re.search(r"\b"+re.escape(name)+r" (?:steals|steal)\b",canonical(text)):add(who,"steals")
                if re.search(r"\b(?:blocked by|block by) "+re.escape(name)+r"\b",canonical(text)):add(who,"blocks")
            if mode!="text":
                if made and score>=2:
                    helper=role("assist")
                    if not helper and len(participants)==2 and "assist" in canonical(text):helper=next((p for p,r in participants if p!=primary),None)
                    add(helper,"assists")
                if turn:add(role("steal"),"steals")
                if "block" in canonical(text)+" "+label:add(role("block"),"blocks")
            for who,changes in delta.items():
                for k,n in changes.items():
                    totals[who][k]+=n;timelines[who][k].append([totals[who][k],q,clock])
        variants.append(timelines)
    result={"_finalPeriod":final}
    for pid,p in players.items():
        actual=p.get("stats") or {};verified={}
        for k in METRICS:
            expected=actual.get(k)
            if not expected or expected<0:continue
            for candidate in variants:
                rows=candidate[pid].get(k) or []
                if rows and rows[-1][0]==expected:
                    verified[k]=rows;break
        for k,parts in COMBOS.items():
            rows=merge_components(parts,actual,verified)
            if rows and rows[-1][0]==actual.get(k,sum(actual.get(x,0) for x in parts)):verified[k]=rows
        if verified:result[pid]=verified
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
