(()=>{
"use strict";
const $=id=>document.getElementById(id);
const state={players:[],teams:[],events:[],rows:[],season:2027,days:[],date:"live",ranked:[],sort:"score",dir:-1,selected:null,slips:[],loading:false};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=v=>String(v||"").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/[^a-z0-9]/g,"");
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmt=v=>v===null||v===undefined||!Number.isFinite(Number(v))?"—":Number(v).toFixed(1);
const amer=v=>Number(v)>0?"+"+Math.round(v):Number.isFinite(Number(v))?String(Math.round(v)):"—";
const implied=odds=>{const v=Number(odds);return !Number.isFinite(v)||v===0?null:v>0?100/(v+100):-v/(-v+100)};
const dec=odds=>odds>0?1+odds/100:1+100/Math.abs(odds);
const key=r=>[r.eventId,r.scope,r.player||r.team,r.metric||r.market,r.selection,r.line].join("¦");
const teamBy=abbr=>state.teams.find(t=>t.abbreviation===abbr);
const playerBy=name=>state.players.find(p=>norm(p.name)===norm(name));
async function get(url){let r=await fetch(url,{cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);return r.json()}
function flatten(events){return(events||[]).flatMap(event=>(event.props||[]).map(row=>Object.assign({},row,{eventId:event.id,homeAbbr:event.homeAbbr,awayAbbr:event.awayAbbr,commenceTime:event.commenceTime,matchup:event.awayAbbr+" @ "+event.homeAbbr})))}
function recentLogs(player,year){return((player?.gameLogsBySeason||{})[String(year)]||[])}
function opponentFor(r){return r.team===r.homeAbbr?r.awayAbbr:r.homeAbbr}
function valueFor(row,g){
 const s=g.stats||{},kind=row.teamMarketType||row.metric;
 if(kind==="moneyline"||kind==="spread")return n(s["derived.pointsFor"])-n(s["derived.pointsAgainst"]);
 if(row.scope==="game")return n(s["derived.pointsFor"])+n(s["derived.pointsAgainst"]);
 if(row.scope==="team")return n(s["derived.pointsFor"]);
 return Number.isFinite(Number(s[kind]))?Number(s[kind]):null;
}
function logsFor(row,year){
 const obj=row.scope==="player"?playerBy(row.player):teamBy(row.team||row.homeAbbr);
 return recentLogs(obj,year);
}
function isHit(row,v){
 if(!Number.isFinite(v))return null;
 if(row.teamMarketType==="moneyline")return v>0;
 if(row.teamMarketType==="spread")return v+n(row.line)>0;
 if(row.selection==="Under"||row.selection==="No")return v<n(row.line);
 if(row.selection==="Yes")return v>=n(row.line);
 return v>n(row.line);
}
function rateFromLogs(row,logs){
 const values=logs.map(g=>valueFor(row,g)).filter(Number.isFinite);
 if(!values.length)return null;
 return {hits:values.filter(v=>isHit(row,v)).length,total:values.length,
  pct:100*values.filter(v=>isHit(row,v)).length/values.length};
}
function rateInfo(row){
 if(row.scope==="player"&&row.hitRates)return row.hitRates;
 const logs=logsFor(row,state.season),old=logsFor(row,state.season-1),opp=opponentFor(row);
 const h2h=[...logs,...old].filter(g=>g.opponent?.abbreviation===opp);
 return {l5:rateFromLogs(row,logs.slice(0,5)),l10:rateFromLogs(row,logs.slice(0,10)),
  current:rateFromLogs(row,logs),previous:rateFromLogs(row,old),h2h:rateFromLogs(row,h2h)};
}
function marketAnchor(row){
 const selection=row.selection==="Over"?"Under":row.selection==="Under"?"Over":row.selection==="Yes"?"No":row.selection==="No"?"Yes":"";
 const base=[row.eventId,row.scope,row.player||row.team,row.metric,row.line].join("¦");
 const other=selection?state.pairIndex?.get(base+"¦"+selection):null;
 const own=implied(row.odds),opposite=other?implied(other.odds):null;
 return own===null?.5:opposite===null?own:clamp(own/(own+opposite),.01,.99);
}
function calculate(row){
 const current=logsFor(row,state.season),previous=logsFor(row,state.season-1);
 const info=rateInfo(row);
 const rates=[["l5",.34],["l10",.24],["current",.24],["previous",.12],["h2h",.06]];
 let sum=0,weight=0;
 for(const[k,w]of rates){let r=info[k];if(r&&r.total){const reliability=Math.min(1,r.total/(k==="previous"?12:8));sum+=w*reliability*(r.hits+.5*3)/(r.total+3);weight+=w*reliability}}
 const empirical=weight?sum/weight:null;
 const values=current.slice(0,10).map(g=>valueFor(row,g)).filter(Number.isFinite);
 const avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
 const std=values.length>1?Math.sqrt(values.reduce((a,b)=>a+(b-avg)**2,0)/(values.length-1)):null;
 let trend=null;
 if(avg!==null){
  const threshold=row.teamMarketType==="spread"?-n(row.line):row.teamMarketType==="moneyline"?0:n(row.line);
  let delta=(avg-threshold)/Math.max(1.5,std||Math.abs(avg)*.30||1);
  if(row.selection==="Under"||row.selection==="No")delta=-delta;
  trend=clamp(1/(1+Math.exp(-delta*1.35)),.08,.92);
 }
 const anchor=marketAnchor(row);
 let model=anchor;
 if(empirical!==null){
  const sampleFactor=Math.min(.8,Math.max(.2,weight));
  model=anchor*(1-sampleFactor*.64)+empirical*(sampleFactor*.64);
 }
 if(trend!==null)model=model*.82+trend*.18;
 const player=row.scope==="player"?playerBy(row.player):null;
 const opp=teamBy(opponentFor(row));
 const medianDefense=state.teams.filter(t=>n(t.stats?.games)>0).map(t=>n(t.stats?.pointsAllowedPerGame)).sort((a,b)=>a-b);
 const leagueDefense=medianDefense.length?medianDefense[Math.floor(medianDefense.length/2)]:null;
 let defenseEdge=0;
 if(opp?.stats&&leagueDefense&&n(opp.stats.games)>2){
   defenseEdge=clamp((n(opp.stats.pointsAllowedPerGame)-leagueDefense)/leagueDefense,-.13,.13);
   // A weak defense increases overs, decreases unders. ML/spread have no
   // same interpretation and do not use this per-player defensive adjustment.
   if(row.scope==="player")model+=(row.selection==="Under"?-1:1)*defenseEdge*.20;
 }
 const edge=clamp(model-anchor,-.99,.99);
 const minutes=n(player?.minutesPerGame),fga=n(player?.fga)/Math.max(1,n(player?.games)),tpa=n(player?.tpa)/Math.max(1,n(player?.games));
 // Shrink sparse NBA samples so a season-opening 1/1 never yields a 100% pick.
 const effectiveSample=info.l10?.total||info.current?.total||0;
 const score=clamp(Math.round(100*(.75*model+.25*clamp(.50+edge,0,1))*(.76+.24*Math.min(1,effectiveSample/8))),0,100);
 return Object.assign({},row,{hitRates:info,probability:clamp(model,.01,.99),marketProbability:anchor,
  edge:edge*100,score,average:avg,minutes,fga,tpa,defenseEdge:defenseEdge*100});
}
function filters(row){
 const q=norm($("modelSearch").value);
 if(q&&!norm([row.player,row.team,row.matchup,row.market,row.proposition].join(" ")).includes(q))return false;
 if($("scope").value&&row.scope!==$("scope").value)return false;
 if($("side").value&&row.selection!==$("side").value)return false;
 if($("market").value&&row.market!==$("market").value)return false;
 if($("game").value&&String(row.eventId)!==$("game").value)return false;
 if($("position").value&&row.position!==$("position").value)return false;
 if(n(row.odds)<n($("minLegOdds").value)||n(row.odds)>n($("maxLegOdds").value))return false;
 if(row.minutes<n($("minutes").value)||row.fga<n($("fga").value)||row.tpa<n($("tpa").value))return false;
 if(row.defenseEdge<n($("defense").value))return false;
 if(row.edge<n($("edge").value))return false;
 for(const k of ["l5","l10","h2h","current","previous"]){
  const threshold=n($(k).value);if(!threshold)continue;
  if(!row.hitRates?.[k]||n(row.hitRates[k].pct)<threshold)return false;
 }
 return true;
}
function renderBoard(){
 const filtered=state.ranked.filter(filters);
 $("boardCount").textContent=filtered.length+" props";
 $("nbaModelCount").textContent=filtered.length+" eligible · "+state.ranked.length+" evaluated";
 $("nbaBoard").innerHTML=filtered.length?filtered.slice().sort((a,b)=>{
  const k=state.sort;let av=k==="player"?a.player||a.team:a[k],bv=k==="player"?b.player||b.team:b[k];
  return (typeof av==="string"?av.localeCompare(bv||""):n(av)-n(bv))*state.dir;
 }).slice(0,500).map(row=>
  '<tr class="nba-signal-row" tabindex="0" data-row="'+esc(key(row))+'"><td><strong>'+esc(row.player||row.team||"Game")+
  '</strong><small style="display:block;color:var(--muted)">'+esc(row.market)+" · "+esc(row.selection)+" · "+esc(row.matchup)+'</small></td>'+
  '<td>'+fmt(row.line)+'</td><td>'+amer(row.odds)+'</td><td>'+(row.hitRates?.l10?fmt(row.hitRates.l10.pct)+"%":"—")+'</td>'+
  '<td>'+(row.hitRates?.current?fmt(row.hitRates.current.pct)+"%":"—")+'</td><td>'+fmt(100*row.probability)+
  '%</td><td class="'+(row.edge>0?"nba-rate good":"nba-rate bad")+'">'+(row.edge>0?"+":"")+fmt(row.edge)+'</td><td class="nba-score">'+row.score+'</td></tr>').join("")
  :'<tr><td colspan="8" class="nba-empty">No NBA props currently satisfy these filters. Try relaxing constraints.</td></tr>';
 renderSlips(filtered);
}
function combos(rows,minLegs,maxLegs){
 const options=rows.slice().sort((a,b)=>b.score-a.score||b.edge-a.edge).slice(0,55);
 const low=n($("minParlayOdds").value),high=n($("maxParlayOdds").value);
 const slips=[],seen=new Set();
 for(let seed=0;seed<Math.min(options.length,25);seed++){
  const used=new Set(),players=new Set(),games=new Set(),legs=[];
  const rotated=[options[seed],...options.filter((_,i)=>i!==seed)];
  for(let candidate of rotated){
    if(legs.length>=maxLegs)break;
    if(used.has(key(candidate)))continue;
    if($("uniquePlayers").checked&&players.has(norm(candidate.player||candidate.team)))continue;
    if($("separateGames").checked&&games.has(candidate.eventId))continue;
    if(legs.some(x=>x.eventId===candidate.eventId&&x.player===candidate.player&&x.metric===candidate.metric))continue;
    const decNew=[...legs,candidate].reduce((p,r)=>p*dec(n(r.odds)),1);
    const newOdds=decNew>=2?(decNew-1)*100:-100/(decNew-1);
    if(newOdds>high)continue;
    legs.push(candidate);used.add(key(candidate));players.add(norm(candidate.player||candidate.team));games.add(candidate.eventId);
    if(legs.length>=minLegs&&newOdds>=low&&newOdds<=high){
      const sig=legs.map(key).sort().join("|");
      if(!seen.has(sig)){seen.add(sig);slips.push({legs:legs.slice(),odds:newOdds,
        chance:legs.reduce((p,r)=>p*r.probability,1),score:legs.reduce((a,r)=>a+r.score,0)/legs.length})}
    }
  }
 }
 return slips.sort((a,b)=>(b.chance-(1/dec(b.odds)))-(a.chance-(1/dec(a.odds)))||b.score-a.score).slice(0,6);
}
function renderSlips(filtered){
 const min=clamp(Math.floor(n($("minLegs").value)),1,8),max=clamp(Math.floor(n($("maxLegs").value)),min,8);
 const slips=combos(filtered,min,max);state.slips=slips;
 $("slipsSummary").textContent=slips.length?slips.length+" NBA recommendations":"No qualifying slips";
 $("nbaSlips").innerHTML=slips.length?'<div class="nba-slip-grid">'+slips.map((s,i)=>
  '<article class="nba-slip"><div class="nba-slip-top"><strong>Slip '+(i+1)+'</strong><b>'+amer(Math.round(s.odds))+'</b></div>'+
  '<div class="nba-slip-legs">'+s.legs.map(row=>'<button type="button" data-row="'+esc(key(row))+'">'+esc(row.player||row.team)+" · "+esc(row.market)+" "+esc(row.selection)+" "+fmt(row.line)+" <strong>"+amer(row.odds)+"</strong></button>").join("")+
  '</div><div class="nba-slip-metrics">Estimated hit '+fmt(s.chance*100)+"% · Avg score "+fmt(s.score)+'</div></article>').join("")+'</div>':'<div class="nba-empty">No qualifying NBA slips. Adjust odds or history thresholds; recommendations only appear for available real markets.</div>';
}
function showRate(row){
 if(!row||row.scope!=="player")return;state.selected=row;
 const p=playerBy(row.player);
 $("nbaPropTitle").textContent=row.player+" · "+row.market;
 $("nbaPropMeta").textContent=row.matchup+" · "+row.selection+" "+fmt(row.line)+" · "+amer(row.odds);
 const rate=row.hitRates?.l10;
 $("nbaPropHitPct").textContent=rate?fmt(rate.pct)+"%":"—";
 $("nbaPropHitCount").textContent=rate?rate.hits+"/"+rate.total+" hit":"No games";
 $("nbaPropBreakdown").innerHTML=[["l5","L5"],["l10","L10"],["h2h","H2H"],["current",String(state.season)],["previous",String(state.season-1)]].map(([k,t])=>'<button class="filter-button" type="button" data-split="'+k+'">'+t+" "+(row.hitRates?.[k]?fmt(row.hitRates[k].pct)+"%":"—")+'</button>').join("");
 drawRate("l10");
 $("nbaPropModal").showModal();
}
function drawRate(split){
 const r=state.selected,p=playerBy(r.player),cur=recentLogs(p,state.season),prev=recentLogs(p,state.season-1),opp=opponentFor(r);
 let logs=split==="previous"?prev:split==="h2h"?[...cur,...prev].filter(g=>g.opponent?.abbreviation===opp):split==="l5"?cur.slice(0,5):split==="l10"?cur.slice(0,10):cur;
 const values=logs.map(g=>valueFor(r,g)).filter(Number.isFinite).slice().reverse();
 const max=Math.max(1,n(r.line),...values);
 $("nbaPropChart").innerHTML=values.length?'<div class="nba-chart-row">'+values.map(v=>'<div class="nba-bar" title="'+fmt(v)+'" style="height:'+Math.max(3,v/max*100)+'%;background:'+(isHit(r,v)?"var(--win)":"var(--loss)")+'"></div>').join("")+'</div>':'<div class="nba-empty">No games in this split.</div>';
}
function fillFilters(){
 const market=$("market").value,game=$("game").value;
 $("market").innerHTML='<option value="">All props</option>'+[...new Set(state.rows.map(r=>r.market))].sort().map(s=>'<option value="'+esc(s)+'">'+esc(s)+'</option>').join("");
 $("game").innerHTML='<option value="">All games</option>'+[...new Map(state.rows.map(r=>[r.eventId,r])).values()].map(r=>'<option value="'+esc(r.eventId)+'">'+esc(r.matchup)+'</option>').join("");
 $("market").value=market;$("game").value=game;
}
function syncLabels(){for(const k of ["l5","l10","h2h","current","previous","minutes","fga","tpa","defense","edge"]){let v=$(k).value;$(k+"Val").textContent=v+(["l5","l10","h2h","current","previous","defense","edge"].includes(k)?"%":"")}}
function evaluate(){
 state.pairIndex=new Map(state.rows.map(row=>[[row.eventId,row.scope,row.player||row.team,row.metric,row.line,row.selection].join("¦"),row]));
 state.ranked=state.rows.filter(r=>Number.isFinite(Number(r.odds))&&Number.isFinite(Number(r.line))&&r.scope).map(calculate).sort((a,b)=>b.score-a.score||b.edge-a.edge);
 renderBoard();
}
async function loadDay(day){
 state.date=day;$("nbaModelDatePopover").hidden=true;
 $("nbaModelDateLabel").textContent=day==="live"?"Live Model":day;
 if(day==="live"){await loadLive();return}
 try{
  const history=await get("data/nba-odds-history/"+encodeURIComponent(day)+".json");
  if(!history.statsSnapshot||!history.teamSnapshot){
    state.rows=[];state.players=[];state.teams=[];evaluate();
    $("nbaBoard").innerHTML='<tr><td colspan="8" class="nba-empty">No verified pregame model snapshot exists for this NBA date.</td></tr>';
    $("nbaSlips").innerHTML='<div class="nba-empty">Archived odds without a pregame stats snapshot are not scored using future data.</div>';
    return;
  }
  state.players=history.statsSnapshot.players||[];state.teams=history.teamSnapshot.teams||[];
  state.season=n(history.statsSnapshot.season);state.rows=flatten(history.events||[]);
  fillFilters();evaluate();
 }catch(err){console.error(err);$("nbaBoard").innerHTML='<tr><td colspan="8" class="nba-empty">Could not load the NBA archive.</td></tr>'}
}
async function loadLive(){
 const [stats,teams,odds]=await Promise.all([get("data/nba-stats.json"),get("data/nba-team-stats.json"),get("data/nba-odds.json").catch(()=>({events:[]}))]);
 state.players=stats.players||[];state.teams=teams.teams||[];state.season=n(stats.season);
 state.events=odds.events||[];state.rows=flatten(state.events);
 $("modelSeason").textContent=stats.seasonLabel||"NBA Regular Season";
 $("modelUpdated").textContent="Updated "+new Date(odds.updatedAt||stats.updatedAt).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
 fillFilters();evaluate();
}
function bind(){
 document.querySelectorAll(".nba-model-criteria input,.nba-model-criteria select").forEach(el=>{el.addEventListener("input",()=>{syncLabels();renderBoard()});el.addEventListener("change",()=>{syncLabels();renderBoard()})});
 $("resetNbaModel").onclick=()=>{
  ["l5","l10","h2h","current","previous","minutes","fga","tpa","defense"].forEach(k=>$(k).value=0);
  $("edge").value=-20;
  [["minLegOdds",-500],["maxLegOdds",500],["minParlayOdds",100],["maxParlayOdds",350],["minLegs",2],["maxLegs",4]].forEach(([k,v])=>$(k).value=v);
  ["scope","side","market","game","position","modelSearch"].forEach(k=>$(k).value="");
  $("uniquePlayers").checked=$("separateGames").checked=true;syncLabels();renderBoard();
 };
 $("nbaBoard").onclick=e=>{const tr=e.target.closest("[data-row]");if(tr)showRate(state.ranked.find(r=>key(r)===tr.dataset.row))};
 $("nbaBoard").onkeydown=e=>{const tr=e.target.closest("[data-row]");if(tr&&e.key==="Enter")showRate(state.ranked.find(r=>key(r)===tr.dataset.row))};
 $("nbaSlips").onclick=e=>{const b=e.target.closest("[data-row]");if(b)showRate(state.ranked.find(r=>key(r)===b.dataset.row))};
 document.querySelector(".nba-model-table thead").onclick=e=>{const h=e.target.closest("[data-sort]");if(h){state.dir=state.sort===h.dataset.sort?-state.dir:-1;state.sort=h.dataset.sort;renderBoard()}};
 $("nbaPropClose").onclick=()=>$("nbaPropModal").close();
 $("nbaPropBreakdown").onclick=e=>{const b=e.target.closest("[data-split]");if(b)drawRate(b.dataset.split)};
 $("nbaPropModal").addEventListener("click",e=>{if(e.target===$("nbaPropModal"))e.target.close()});
 $("nbaModelDateButton").onclick=e=>{e.stopPropagation();$("nbaModelDatePopover").hidden=!$("nbaModelDatePopover").hidden};
 $("nbaModelDateOptions").onclick=e=>{const b=e.target.closest("[data-date]");if(b)loadDay(b.dataset.date)};
 document.addEventListener("click",e=>{if(!e.target.closest(".model-date-control"))$("nbaModelDatePopover").hidden=true});
}
async function init(){
 bind();syncLabels();
 try{
  const days=await get("data/nba-odds-history/index.json").catch(()=>({days:[]}));
  state.days=days.days||[];
  $("nbaModelDateOptions").innerHTML='<button class="filter-option" type="button" data-date="live">Live Model</button>'+state.days.map(d=>'<button class="filter-option" type="button" data-date="'+esc(d.date)+'">'+esc(d.date)+'</button>').join("");
  await loadLive();
 }catch(err){console.error(err);$("modelSeason").textContent="NBA data pending";$("modelUpdated").textContent="NBA refresh must complete";$("nbaBoard").innerHTML='<tr><td colspan="8" class="nba-empty">NBA model requires completed ESPN stats and real FanDuel NBA odds.</td></tr>'}
}
init();
})();
