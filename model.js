(()=>{
"use strict";
const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat("en-US");
const DEFAULTS={l5:60,l10:55,h2h:0,current:50,previous:0,targetShare:0,carryShare:0,opportunityShare:0,dvpMin:0,dvpSample:2,teamMatchupMin:0,targetsPerGameMin:0,carriesPerGameMin:0,edgeMin:-20,legOddsMin:-500,legOddsMax:500,parlayOddsMin:100,parlayOddsMax:350,legsMin:2,legsMax:4,weights:{recent:30,season:22,h2h:12,usage:14,matchup:14,value:8}};
const HIT_LABELS=[["l5","L5"],["l10","L10"],["h2h","H2H"],["current","2026"],["previous","2025"]];
const WEIGHT_LABELS=[["recent","Recent form"],["season","Season"],["h2h","H2H"],["usage","Usage"],["matchup","Opponent"],["value","Price edge"]];
const state={season:null,players:[],odds:[],teams:[],playerByName:new Map(),usage:new Map(),dvp:new Map(),eligible:[],slips:[],weights:Object.assign({},DEFAULTS.weights),timer:0};

function esc(v){return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]))}
function norm(v){return String(v||"").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g,"").replace(/[^a-z0-9]/g,"")}
function num(v){const x=Number(v);return Number.isFinite(x)?x:0}
function clean(v){return String(v||"").replace(/\s+/g," ").trim()}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function avg(a){a=a.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null}
function median(a){a=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function pct(v,d){return Number.isFinite(v)?v.toFixed(d==null?0:d)+"%":"—"}
function americanToDecimal(o){o=Number(o);if(!Number.isFinite(o)||o===0)return null;return o>0?1+o/100:1+100/Math.abs(o)}
function decimalToAmerican(d){d=Number(d);if(!Number.isFinite(d)||d<=1)return null;return d>=2?Math.round((d-1)*100):Math.round(-100/(d-1))}
function implied(o){const d=americanToDecimal(o);return d?1/d:null}
function formatOdds(o){o=Number(o);return Number.isFinite(o)?(o>0?"+":"")+Math.round(o):"—"}
function fallbackHeadshot(){return "https://a.espncdn.com/i/headshots/nfl/players/full/0.png"}
function percentile(value,values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length||!Number.isFinite(value))return null;let below=0,equal=0;for(const x of a){if(x<value)below++;else if(x===value)equal++}return 100*(below+.5*equal)/a.length}

function logs(player,seasonOnly){
  const out=[],by=player&&player.gameLogsBySeason||{},years=Object.keys(by).sort((a,b)=>Number(b)-Number(a));
  for(const y of years){if(seasonOnly&&Number(y)!==Number(state.season))continue;for(const g of by[y]||[])if(g&&g.played)out.push(Object.assign({_season:Number(y)},g))}
  if(!years.length)for(const g of player&&player.gameLog||[])if(g&&g.played)out.push(Object.assign({_season:Number(state.season)},g));
  return out;
}
function currentLogs(player){return logs(player,true)}

function buildUsage(){
  const teamTotals=new Map(),playerTotals=new Map();
  for(const p of state.players){
    const team=String(p.team||"").toUpperCase();if(!team)continue;
    let targets=0,carries=0;
    for(const g of currentLogs(p)){targets+=num(g.receivingTargets);carries+=num(g.rushingAttempts)}
    playerTotals.set(String(p.id),{targets:targets,carries:carries});
    const t=teamTotals.get(team)||{targets:0,carries:0};t.targets+=targets;t.carries+=carries;teamTotals.set(team,t);
  }
  state.usage.clear();
  for(const p of state.players){
    const own=playerTotals.get(String(p.id))||{targets:0,carries:0},team=teamTotals.get(String(p.team||"").toUpperCase())||{targets:0,carries:0};
    state.usage.set(String(p.id),{
      target:team.targets?100*own.targets/team.targets:0,
      carry:team.carries?100*own.carries/team.carries:0,
      opportunity:(team.targets+team.carries)?100*(own.targets+own.carries)/(team.targets+team.carries):0,
      targets:own.targets,carries:own.carries,games:currentLogs(p).length,targetsPerGame:currentLogs(p).length?own.targets/currentLogs(p).length:0,carriesPerGame:currentLogs(p).length?own.carries/currentLogs(p).length:0
    });
  }
}

const DVP_KEYS=["receivingYards","receptions","receivingTargets","rushingYards","rushingAttempts","passingYards","passingTouchdowns","rushingTouchdowns","receivingTouchdowns","touchdowns","allPurposeYards"];
function buildDvp(){
  const raw=new Map();
  for(const p of state.players){
    const pos=String(p.position||"").toUpperCase();if(!["QB","RB","WR","TE"].includes(pos))continue;
    for(const g of currentLogs(p)){
      const opp=String(g&&g.opponent&&g.opponent.abbreviation||"").toUpperCase();if(!opp)continue;
      const key=opp+"|"+pos,b=raw.get(key)||{samples:0,metrics:{}};
      b.samples++;
      for(const metric of DVP_KEYS){
        let value=0;
        if(metric==="touchdowns")value=num(g.rushingTouchdowns)+num(g.receivingTouchdowns);
        else if(metric==="allPurposeYards")value=num(g.rushingYards)+num(g.receivingYards);
        else value=num(g[metric]);
        b.metrics[metric]=(b.metrics[metric]||0)+value;
      }
      raw.set(key,b);
    }
  }
  const means=new Map();
  for(const [key,b] of raw){const m={};for(const metric of DVP_KEYS)m[metric]=b.samples?b.metrics[metric]/b.samples:0;means.set(key,{samples:b.samples,metrics:m})}
  state.dvp.clear();
  for(const [key,row] of means){
    const pos=key.split("|")[1],entry={samples:row.samples,metrics:{}};
    for(const metric of DVP_KEYS){
      const peers=[];for(const [peerKey,peer] of means)if(peerKey.endsWith("|"+pos))peers.push(peer.metrics[metric]);
      entry.metrics[metric]={value:row.metrics[metric],percentile:percentile(row.metrics[metric],peers)};
    }
    state.dvp.set(key,entry);
  }
}

function metricSpec(row){
  const text=(String(row.market||"")+" "+String(row.proposition||"")).toLowerCase();
  let m=text.match(/(\d+(?:\.\d+)?)\+ yard reception/);if(m)return{metric:"receivingLongest",threshold:Number(m[1]),comparison:"gte"};
  if(/any.?time touchdown|score.*touchdown/.test(text))return{metric:"touchdowns",threshold:1,comparison:"gte"};
  if(/pass.*rush.*rec.*yards/.test(text))return{metric:"passRushRecYards"};
  if(/pass.*rush.*yards/.test(text)&&!/rec/.test(text))return{metric:"passRushYards"};
  if(/rush.*rec.*yards/.test(text))return{metric:"allPurposeYards"};
  if(/passing yards/.test(text))return{metric:"passingYards"};
  if(/receiving yards/.test(text))return{metric:"receivingYards"};
  if(/rushing yards/.test(text))return{metric:"rushingYards"};
  if(/receptions/.test(text)&&!/longest/.test(text))return{metric:"receptions"};
  if(/passing (tds|touchdowns)/.test(text))return{metric:"passingTouchdowns"};
  if(/receiving (tds|touchdowns)/.test(text))return{metric:"receivingTouchdowns"};
  if(/rushing (tds|touchdowns)/.test(text))return{metric:"rushingTouchdowns"};
  if(/rushing attempts|rush attempts/.test(text))return{metric:"rushingAttempts"};
  if(/pass attempts/.test(text))return{metric:"passingAttempts"};
  if(/completions/.test(text))return{metric:"passingCompletions"};
  if(/longest reception/.test(text))return{metric:"receivingLongest"};
  if(/longest rush/.test(text))return{metric:"rushingLongest"};
  return null;
}
function metricValue(g,m){
  if(m==="touchdowns")return num(g.rushingTouchdowns)+num(g.receivingTouchdowns);
  if(m==="allPurposeYards")return num(g.rushingYards)+num(g.receivingYards);
  if(m==="passRushRecYards")return num(g.passingYards)+num(g.rushingYards)+num(g.receivingYards);
  if(m==="passRushYards")return num(g.passingYards)+num(g.rushingYards);
  return num(g[m]);
}
function isHit(g,row,spec){
  const threshold=Number.isFinite(Number(spec.threshold))?Number(spec.threshold):Number(row.line);if(!Number.isFinite(threshold))return null;
  const value=metricValue(g,spec.metric);
  if(spec.comparison==="gte")return value>=threshold;
  return String(row.selection||"Over")==="Under"?value<threshold:value>threshold;
}
function split(logRows,row,spec){
  const values=logRows.map(g=>isHit(g,row,spec)).filter(v=>v!==null);if(!values.length)return null;
  const hits=values.filter(Boolean).length;return{hits:hits,total:values.length,pct:100*hits/values.length};
}
function normalizeSplit(x){if(!x)return null;if(Number.isFinite(Number(x.pct)))return{hits:Number(x.hits)||0,total:Number(x.total)||0,pct:Number(x.pct)};return null}
function ratesFor(row,player){
  if(row.hitRates)return{l5:normalizeSplit(row.hitRates.l5),l10:normalizeSplit(row.hitRates.l10),h2h:normalizeSplit(row.hitRates.h2h),current:normalizeSplit(row.hitRates.current),previous:normalizeSplit(row.hitRates.previous)};
  const spec=metricSpec(row);if(!spec)return{l5:null,l10:null,h2h:null,current:null,previous:null};
  const all=logs(player,false).sort((a,b)=>(b._season-a._season)||num(b.week)-num(a.week)),current=all.filter(g=>g._season===Number(state.season)),prior=all.filter(g=>g._season===Number(state.season)-1);
  const opp=nextOpponent(row),h2h=all.filter(g=>String(g&&g.opponent&&g.opponent.abbreviation||"").toUpperCase()===opp);
  return{l5:split(current.slice(0,5),row,spec),l10:split(current.slice(0,10),row,spec),h2h:split(h2h,row,spec),current:split(current,row,spec),previous:split(prior,row,spec)};
}
function smoothed(s){if(!s||!s.total)return null;return(s.hits+1.5)/(s.total+3)}
function nextOpponent(row){
  const team=String(row.team||"").toUpperCase(),home=String(row.homeAbbr||"").toUpperCase(),away=String(row.awayAbbr||"").toUpperCase();
  if(team&&home===team)return away;if(team&&away===team)return home;
  const parts=String(row.matchup||"").split(" @ ");for(const p of parts)if(String(p).toUpperCase()!==team)return String(p).toUpperCase();return"";
}
function dvpMetric(spec){
  const m=spec&&spec.metric;if(DVP_KEYS.includes(m))return m;
  if(m==="passRushRecYards"||m==="passRushYards")return"passingYards";
  return null;
}
function teamDefenseMetric(spec){
  const m=spec&&spec.metric;
  if(["receivingYards","receptions","receivingTargets","passingYards","passingTouchdowns"].includes(m))return"derived.passYardsAllowedPerGame";
  if(["rushingYards","rushingAttempts","rushingTouchdowns"].includes(m))return"derived.rushYardsAllowedPerGame";
  if(m==="touchdowns")return"derived.pointsAllowedPerGame";
  return"derived.yardsAllowedPerGame";
}
function teamDefensePercentile(opp,spec){
  const key=teamDefenseMetric(spec);
  const team=state.teams.find(t=>String(t.abbreviation||"").toUpperCase()===String(opp||"").toUpperCase());
  if(!team||!team.stats)return null;
  const value=Number(team.stats[key]);if(!Number.isFinite(value))return null;
  const peers=state.teams.map(t=>Number(t&&t.stats&&t.stats[key])).filter(Number.isFinite);
  return percentile(value,peers);
}
function flattenOdds(raw){
  const out=[];
  for(const event of raw.events||[]){
    const away=event.awayAbbr||event.awayTeam||"AWAY",home=event.homeAbbr||event.homeTeam||"HOME";
    for(const prop of event.props||[]){
      const player=state.playerByName.get(norm(prop.player)),row=Object.assign({},prop,{eventId:String(event.id||""),awayAbbr:event.awayAbbr||"",homeAbbr:event.homeAbbr||"",awayTeam:event.awayTeam||"",homeTeam:event.homeTeam||"",matchup:away+" @ "+home});
      row.player=clean(prop.player);row.team=prop.team||player&&player.team||"";row.position=prop.position||player&&player.position||"";row._marketLabel=String(prop.marketLabel||prop.market||prop.proposition||"Prop");out.push(row);
    }
  }
  return out;
}

function controls(){
  const hit={};for(const [k] of HIT_LABELS)hit[k]=Number($(k+"Min").value)||0;
  return{
    hit:hit,targetShare:Number($("targetShare").value)||0,carryShare:Number($("carryShare").value)||0,opportunityShare:Number($("opportunityShare").value)||0,
    targetsPerGameMin:Number($("targetsPerGameMin").value)||0,carriesPerGameMin:Number($("carriesPerGameMin").value)||0,
    dvpMin:Number($("dvpMin").value)||0,dvpSample:Number($("dvpSample").value)||1,teamMatchupMin:Number($("teamMatchupMin").value)||0,
    edgeMin:Number($("edgeMin").value),requireOpponentData:$("requireOpponentData").checked,
    position:$("positionFilter").value,market:$("marketFilter").value,side:$("sideFilter").value,team:$("teamFilter").value,opponent:$("opponentFilter").value,player:$("playerFilter").value.trim().toLowerCase(),
    lineMin:$("lineMin").value===""?null:Number($("lineMin").value),lineMax:$("lineMax").value===""?null:Number($("lineMax").value),
    legOddsMin:Number($("legOddsMin").value),legOddsMax:Number($("legOddsMax").value),parlayOddsMin:Number($("parlayOddsMin").value),parlayOddsMax:Number($("parlayOddsMax").value),
    legsMin:clamp(Number($("legsMin").value)||1,1,10),legsMax:clamp(Number($("legsMax").value)||1,1,10),uniquePlayers:$("uniquePlayers").checked,avoidSameGame:$("avoidSameGame").checked,weights:Object.assign({},state.weights)
  };
}
function analyze(row,cfg){
  const player=state.playerByName.get(norm(row.player));if(!player)return null;
  const odds=Number(row.odds),line=Number(row.line);if(!Number.isFinite(odds)||odds<cfg.legOddsMin||odds>cfg.legOddsMax)return null;
  if(cfg.lineMin!==null&&(!Number.isFinite(line)||line<cfg.lineMin))return null;if(cfg.lineMax!==null&&(!Number.isFinite(line)||line>cfg.lineMax))return null;
  const pos=String(row.position||player.position||"").toUpperCase(),team=String(row.team||player.team||"").toUpperCase(),opp=nextOpponent(Object.assign({},row,{team:team})),market=row._marketLabel;
  if(cfg.position&&pos!==cfg.position)return null;if(cfg.market&&market!==cfg.market)return null;if(cfg.side&&String(row.selection||"")!==cfg.side)return null;if(cfg.team&&team!==cfg.team)return null;if(cfg.opponent&&opp!==cfg.opponent)return null;if(cfg.player&&!String(row.player||"").toLowerCase().includes(cfg.player))return null;
  const rates=ratesFor(row,player);for(const k of Object.keys(cfg.hit)){if(cfg.hit[k]>0&&(!rates[k]||rates[k].pct<cfg.hit[k]))return null}
  const usage=state.usage.get(String(player.id))||{target:0,carry:0,opportunity:0,targetsPerGame:0,carriesPerGame:0};
  if(usage.target<cfg.targetShare||usage.carry<cfg.carryShare||usage.opportunity<cfg.opportunityShare||usage.targetsPerGame<cfg.targetsPerGameMin||usage.carriesPerGame<cfg.carriesPerGameMin)return null;
  const spec=metricSpec(row),metric=dvpMetric(spec),dvpRow=state.dvp.get(opp+"|"+pos),dvpInfo=metric&&dvpRow&&dvpRow.metrics[metric],dvpPct=dvpInfo&&dvpInfo.percentile,teamMatchupPct=teamDefensePercentile(opp,spec);
  if(cfg.requireOpponentData&&(!dvpRow||dvpRow.samples<cfg.dvpSample||!Number.isFinite(dvpPct)))return null;if(cfg.dvpMin>0&&(!Number.isFinite(dvpPct)||dvpPct<cfg.dvpMin))return null;if(cfg.dvpMin>0&&dvpRow&&dvpRow.samples<cfg.dvpSample)return null;if(cfg.teamMatchupMin>0&&(!Number.isFinite(teamMatchupPct)||teamMatchupPct<cfg.teamMatchupMin))return null;
  const recent=avg([smoothed(rates.l5),smoothed(rates.l10)].filter(Number.isFinite))??.5,season=avg([smoothed(rates.current),smoothed(rates.previous)].filter(Number.isFinite))??recent,h2h=smoothed(rates.h2h)??season;
  const usageSignal=clamp(Math.max(usage.target,usage.carry,usage.opportunity)/55,0,1),matchup=avg([Number.isFinite(dvpPct)?dvpPct/100:null,Number.isFinite(teamMatchupPct)?teamMatchupPct/100:null].filter(Number.isFinite))??.5,modelProb=clamp(.38*recent+.32*season+.12*h2h+.10*usageSignal+.08*matchup,.03,.97),book=implied(odds)??.5,edge=modelProb-book;if(edge*100<cfg.edgeMin)return null;
  const valueSignal=clamp(.5+edge*2,0,1),w=cfg.weights,total=Object.values(w).reduce((a,b)=>a+b,0)||1,score=100*(w.recent*recent+w.season*season+w.h2h*h2h+w.usage*usageSignal+w.matchup*matchup+w.value*valueSignal)/total;
  return{row:row,player:player,pos:pos,team:team,opp:opp,market:market,rates:rates,usage:usage,dvpRow:dvpRow,dvpPct:dvpPct,teamMatchupPct:teamMatchupPct,dvpMetric:metric,recentSignal:recent,seasonSignal:season,h2hSignal:h2h,usageSignal:usageSignal,matchupSignal:matchup,valueSignal:valueSignal,modelProb:modelProb,impliedProb:book,edge:edge,score:clamp(score,0,100)};
}
function generateSlips(candidates,cfg){
  const top=candidates.slice(0,34),slips=[],minLegs=Math.min(cfg.legsMin,cfg.legsMax),maxLegs=Math.max(cfg.legsMin,cfg.legsMax),minD=americanToDecimal(cfg.parlayOddsMin),maxD=americanToDecimal(cfg.parlayOddsMax);
  function add(combo){let d=1;for(const x of combo){const leg=americanToDecimal(x.row.odds);if(!leg)return;d*=leg}if(minD&&d<minD)return;if(maxD&&d>maxD)return;slips.push({legs:combo.slice(),decimal:d,odds:decimalToAmerican(d),score:avg(combo.map(x=>x.score))||0,edge:avg(combo.map(x=>x.edge))||0})}
  function walk(start,combo,target){if(slips.length>1600)return;if(combo.length===target){add(combo);return}for(let i=start;i<top.length;i++){const x=top[i];if(cfg.uniquePlayers&&combo.some(y=>norm(y.row.player)===norm(x.row.player)))continue;if(cfg.avoidSameGame&&combo.some(y=>y.row.eventId&&y.row.eventId===x.row.eventId))continue;combo.push(x);walk(i+1,combo,target);combo.pop()}}
  for(let size=minLegs;size<=maxLegs;size++){walk(0,[],size);if(slips.length>1600)break}
  slips.sort((a,b)=>(b.score+Math.max(0,b.edge*100)*.35)-(a.score+Math.max(0,a.edge*100)*.35));
  const out=[],seen=new Set();for(const s of slips){const sig=s.legs.map(x=>norm(x.row.player)+"|"+x.market).sort().join("~");if(seen.has(sig))continue;seen.add(sig);out.push(s);if(out.length>=9)break}return out;
}
function metricClass(v){if(!Number.isFinite(v))return"metric-na";if(v>=70)return"metric-good";if(v>=50)return"metric-mid";return"metric-low"}
function rateTd(r){return r?'<td class="'+metricClass(r.pct)+'">'+Math.round(r.pct)+'% <small class="cell-sample">'+r.hits+'/'+r.total+'</small></td>':'<td class="metric-na">—</td>'}
function usageText(x){const a=[];if(x.usage.target)a.push("T "+Math.round(x.usage.target)+"%");if(x.usage.carry)a.push("C "+Math.round(x.usage.carry)+"%");return a.length?a.join(" • "):"—"}
function renderSignals(){
  const rows=state.eligible.slice(0,120);$("legBoardCount").textContent=fmt.format(rows.length);
  if(!rows.length){$("signalBody").innerHTML='<tr><td colspan="10" class="model-empty">No props satisfy every active constraint. Loosen one or more filters.</td></tr>';return}
  $("signalBody").innerHTML=rows.map(x=>{
    const r=x.row,head=r.headshot||x.player.headshot||fallbackHeadshot();
    return '<tr><td><div class="signal-player"><img src="'+esc(head)+'" alt="" loading="lazy"><div class="signal-copy"><strong>'+esc(r.player)+'</strong><span>'+esc(r.proposition||r.market||x.market)+'</span><small>'+esc(x.team)+' vs '+esc(x.opp||"—")+' • '+esc(x.pos||"—")+'</small></div></div></td><td><span class="score-pill">'+x.score.toFixed(1)+'</span></td>'+rateTd(x.rates.l5)+rateTd(x.rates.l10)+rateTd(x.rates.h2h)+rateTd(x.rates.current)+rateTd(x.rates.previous)+'<td class="'+metricClass(Math.max(x.usage.target,x.usage.carry))+'">'+esc(usageText(x))+'</td><td class="'+metricClass(x.dvpPct)+'">'+(Number.isFinite(x.dvpPct)?Math.round(x.dvpPct)+"th":"—")+(x.dvpRow?' <small>(n='+x.dvpRow.samples+')</small>':"")+'</td><td><strong>'+formatOdds(r.odds)+'</strong></td></tr>';
  }).join("");
}
function slipHtml(s,i){
  let legs="";for(const x of s.legs){legs+='<div class="slip-leg"><img src="'+esc(x.row.headshot||x.player.headshot||fallbackHeadshot())+'" alt=""><div class="slip-leg-copy"><strong>'+esc(x.row.player)+'</strong><span>'+esc(x.row.proposition||x.row.market)+' • '+esc(x.opp||"")+'</span></div><strong>'+formatOdds(x.row.odds)+'</strong></div>'}
  const product=s.legs.reduce((p,x)=>p*x.modelProb,1);
  return '<article class="slip-card"><div class="slip-top"><div><span>MODEL SLIP '+(i+1)+'</span><strong>'+formatOdds(s.odds)+'</strong></div><div class="slip-score"><b>'+s.score.toFixed(1)+'</b><small>AVG SCORE</small></div></div><div class="slip-legs">'+legs+'</div><div class="slip-footer"><div><span>Model prob*</span><strong>'+pct(product*100,1)+'</strong></div><div><span>Avg edge</span><strong>'+(s.edge>=0?"+":"")+pct(s.edge*100,1)+'</strong></div><div><span>Legs</span><strong>'+s.legs.length+'</strong></div></div></article>';
}
function renderSlips(){$("slipCount").textContent=fmt.format(state.slips.length);$("recommendedSlips").innerHTML=state.slips.length?state.slips.slice(0,6).map(slipHtml).join(""):'<div class="model-empty">No parlay combination lands inside the requested final-odds range. Adjust final odds or leg count.</div>'}
function renderSummary(){$("eligibleCount").textContent=fmt.format(state.eligible.length);$("eligibleSub").textContent=state.odds.length?"of "+fmt.format(state.odds.length)+" current props":"after filters";$("bestScore").textContent=state.eligible.length?state.eligible[0].score.toFixed(1):"—";const m=median(state.eligible.map(x=>x.edge*100));$("medianEdge").textContent=Number.isFinite(m)?(m>=0?"+":"")+m.toFixed(1)+"%":"—"}
function renderFormula(){const w=state.weights,total=Object.values(w).reduce((a,b)=>a+b,0)||1;$("modelFormula").innerHTML='<strong>Composite score</strong><br><code>Score = 100 × Σ(weight × signal) / Σ(weight)</code><br><br>Recent form: <strong>'+Math.round(100*w.recent/total)+'%</strong><br>Season consistency: <strong>'+Math.round(100*w.season/total)+'%</strong><br>Head-to-head: <strong>'+Math.round(100*w.h2h/total)+'%</strong><br>Usage: <strong>'+Math.round(100*w.usage/total)+'%</strong><br>Opponent DvP: <strong>'+Math.round(100*w.matchup/total)+'%</strong><br>Price edge: <strong>'+Math.round(100*w.value/total)+'%</strong><br><br><span>*Slip probability uses an independence baseline; sportsbook same-game correlation can differ.</span>'}
function renderCharts(){
  const top=state.eligible[0];
  if(!top){$("signalProfileChart").innerHTML='<div class="model-empty">No eligible leg</div>';$("scoreChart").innerHTML='<div class="model-empty">No eligible candidates</div>';return}
  const signals=[["Recent",top.recentSignal],["Season",top.seasonSignal],["H2H",top.h2hSignal],["Usage",top.usageSignal],["Opponent",top.matchupSignal],["Value",top.valueSignal]];
  $("signalProfileChart").innerHTML=signals.map(x=>'<div class="bar-row"><span>'+x[0]+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(clamp(x[1],0,1)*100)+'%"></div></div><strong>'+Math.round(clamp(x[1],0,1)*100)+'</strong></div>').join("");
  $("scoreChart").innerHTML=state.eligible.slice(0,8).map(x=>'<div class="bar-row"><span>'+esc(x.row.player)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(x.score)+'%"></div></div><strong>'+x.score.toFixed(1)+'</strong></div>').join("");
}
function recalc(){
  const cfg=controls();if(cfg.legsMin>cfg.legsMax){$("legsMax").value=cfg.legsMin;cfg.legsMax=cfg.legsMin}
  const out=[];for(const row of state.odds){const x=analyze(row,cfg);if(x)out.push(x)}out.sort((a,b)=>b.score-a.score||b.edge-a.edge);state.eligible=out;state.slips=generateSlips(out,cfg);renderSummary();renderSlips();renderSignals();renderCharts();renderFormula();
}
function schedule(){clearTimeout(state.timer);state.timer=setTimeout(recalc,35)}
function buildControls(){
  $("hitRateControls").innerHTML=HIT_LABELS.map(pair=>'<label class="range-row"><span><b>'+pair[1]+' minimum</b><small>Required hit rate</small></span><output id="'+pair[0]+'Value">'+DEFAULTS[pair[0]]+'%</output><input id="'+pair[0]+'Min" type="range" min="0" max="100" step="5" value="'+DEFAULTS[pair[0]]+'"></label>').join("");
  $("weightControls").innerHTML=WEIGHT_LABELS.map(pair=>'<button type="button" class="weight-button active" data-weight="'+pair[0]+'">'+pair[1]+'<strong>'+DEFAULTS.weights[pair[0]]+'</strong></button>').join("");
}
function syncLabels(){for(const [k] of HIT_LABELS)$(k+"Value").textContent=$(k+"Min").value+"%";$("targetShareValue").textContent=$("targetShare").value+"%";$("carryShareValue").textContent=$("carryShare").value+"%";$("opportunityShareValue").textContent=$("opportunityShare").value+"%";$("dvpValue").textContent=$("dvpMin").value+"th+";$("dvpSampleValue").textContent=$("dvpSample").value+"+";$("teamMatchupValue").textContent=$("teamMatchupMin").value+"th+";$("edgeValue").textContent=$("edgeMin").value+"%+"}
function fillSelects(){
  const positions=[...new Set(state.players.map(p=>String(p.position||"").toUpperCase()).filter(Boolean))].sort();$("positionFilter").insertAdjacentHTML("beforeend",positions.map(x=>'<option>'+esc(x)+'</option>').join(""));
  const markets=[...new Set(state.odds.map(x=>x._marketLabel).filter(Boolean))].sort((a,b)=>a.localeCompare(b));$("marketFilter").insertAdjacentHTML("beforeend",markets.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join(""));
  const teams=[...new Set(state.odds.map(x=>String(x.team||"").toUpperCase()).filter(Boolean))].sort();$("teamFilter").insertAdjacentHTML("beforeend",teams.map(x=>'<option>'+esc(x)+'</option>').join(""));
  const opponents=[...new Set(state.odds.map(nextOpponent).filter(Boolean))].sort();$("opponentFilter").insertAdjacentHTML("beforeend",opponents.map(x=>'<option>'+esc(x)+'</option>').join(""));
}
function bind(){
  document.querySelectorAll(".model-controls input,.model-controls select").forEach(el=>{el.addEventListener("input",()=>{syncLabels();schedule()});el.addEventListener("change",()=>{syncLabels();schedule()})});
  $("weightControls").addEventListener("click",e=>{const b=e.target.closest("[data-weight]");if(!b)return;const k=b.dataset.weight,levels=[0,8,14,22,30,40],cur=state.weights[k],next=levels[(levels.indexOf(cur)+1)%levels.length];state.weights[k]=next;b.querySelector("strong").textContent=next;b.classList.toggle("active",next>0);schedule()});
  $("resetModel").addEventListener("click",()=>{for(const [k] of HIT_LABELS)$(k+"Min").value=DEFAULTS[k];for(const id of ["targetShare","carryShare","opportunityShare","dvpMin","teamMatchupMin","edgeMin","targetsPerGameMin","carriesPerGameMin"])$(id).value=DEFAULTS[id];$("dvpSample").value=DEFAULTS.dvpSample;$("requireOpponentData").checked=false;for(const id of ["positionFilter","marketFilter","sideFilter","teamFilter","opponentFilter","playerFilter"])$(id).value="";for(const id of ["legOddsMin","legOddsMax","parlayOddsMin","parlayOddsMax","legsMin","legsMax"])$(id).value=DEFAULTS[id];$("lineMin").value="";$("lineMax").value="";$("uniquePlayers").checked=true;$("avoidSameGame").checked=false;state.weights=Object.assign({},DEFAULTS.weights);document.querySelectorAll("[data-weight]").forEach(b=>{const k=b.dataset.weight;b.querySelector("strong").textContent=state.weights[k];b.classList.add("active")});syncLabels();recalc()});
}
async function init(){
  buildControls();bind();syncLabels();
  try{
    const responses=await Promise.all([fetch("data/nfl-stats.json",{cache:"default"}),fetch("data/nfl-odds.json",{cache:"default"}),fetch("data/nfl-team-stats.json",{cache:"default"})]);
    if(!responses[0].ok||!responses[1].ok)throw new Error("Model data unavailable");
    const stats=await responses[0].json(),odds=await responses[1].json(),teams=responses[2].ok?await responses[2].json():{teams:[]};
    state.season=stats.season||new Date().getFullYear();state.players=stats.players||[];state.teams=teams.teams||[];state.playerByName=new Map(state.players.map(p=>[norm(p.name),p]));state.odds=flattenOdds(odds);buildUsage();buildDvp();fillSelects();
    $("modelSeason").textContent=state.season+" Model • "+fmt.format(state.odds.length)+" props";const updated=odds.updatedAt||stats.updatedAt;$("modelUpdated").textContent=updated?"Updated "+new Date(updated).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"Live analytical model";recalc();
  }catch(err){console.error(err);$("recommendedSlips").innerHTML='<div class="model-empty">The model could not load the current stats/odds datasets. Refresh after the next data update.</div>';$("modelSeason").textContent="Model unavailable";$("modelUpdated").textContent="Data load failed"}
}
init();
})();