(()=>{
"use strict";
const $=id=>document.getElementById(id);
const st={players:[],teams:[],events:[],live:[],rows:[],days:[],year:2027,view:"stats",sort:"points",dir:-1,teamSort:"pointsPerGame",teamDir:-1,teamCategory:"overview",scope:"",side:"",games:new Set(),markets:new Set(),min:-5000,max:5000,search:"",date:"live",builder:false,slip:[],limit:350,selected:null,selectedTeam:null,selectedProp:null};
const C=[["points","PTS"],["rebounds","REB"],["assists","AST"],["threes","3PM"],["pra","PRA"],["pr","P+R"],["pa","P+A"],["ra","R+A"],["steals","STL"],["blocks","BLK"],["turnovers","TO"],["minutes","MIN"],["fgm","FGM"],["fga","FGA"],["fgPct","FG%"],["tpa","3PA"],["ftm","FTM"],["ftPct","FT%"],["games","GP"],["pointsPerGame","PPG"],["reboundsPerGame","RPG"],["assistsPerGame","APG"]];
const L=C.slice(0,12);
const T={overview:[["pointsPerGame","PPG"],["pointsAllowedPerGame","Opp PPG"],["pointDiffPerGame","Diff/G"],["reboundsPerGame","RPG"],["assistsPerGame","APG"],["threePct","3P%"]],offense:[["pointsPerGame","PPG"],["fgmPerGame","FGM/G"],["fgaPerGame","FGA/G"],["fgPct","FG%"],["threesPerGame","3PM/G"],["assistsPerGame","APG"]],defense:[["pointsAllowedPerGame","Opp PPG"],["pointDiffPerGame","Diff/G"],["stealsPerGame","STL/G"],["blocksPerGame","BLK/G"]],shooting:[["fgPct","FG%"],["threePct","3P%"],["ftPct","FT%"],["threesPerGame","3PM/G"],["tpaPerGame","3PA/G"]],rebounding:[["reboundsPerGame","RPG"],["rebounds","REB"]],playmaking:[["assistsPerGame","APG"],["turnoversPerGame","TO/G"],["assists","AST"]]};
const escapeHTML=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=v=>String(v||"").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/[^a-z0-9]/g,"");
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const fmt=v=>v===null||v===undefined||v===""?"—":new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(v);
const price=v=>n(v)>0?"+"+Math.round(n(v)):String(Math.round(n(v)));
const logo=v=>"https://a.espncdn.com/i/teamlogos/nba/500/"+String(v||"nba").toLowerCase()+".png";
const date=v=>{const d=new Date(v);return isNaN(+d)?"":d.toLocaleDateString("en-US",{month:"short",day:"numeric"})};
async function fetchData(url){let r=await fetch(url,{cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);return r.json()}
function flatten(events){return(events||[]).flatMap(e=>(e.props||[]).map(p=>Object.assign({},p,{eventId:e.id,commenceTime:e.commenceTime,matchup:(e.awayAbbr||"")+" @ "+(e.homeAbbr||""),homeAbbr:e.homeAbbr,awayAbbr:e.awayAbbr})))}
function key(p){return[p.eventId,p.scope,p.player||p.team,p.metric||p.market,p.selection,p.line].join("¦")}
function view(v,update=true){st.view=["stats","teams","odds"].includes(v)?v:"stats";[["stats","statsView","statsTabButton"],["teams","teamStatsView","teamStatsTabButton"],["odds","oddsView","oddsTabButton"]].forEach(([name,section,tab])=>{$(section).classList.toggle("active",st.view===name);$(tab).classList.toggle("active",st.view===name)});if(update)history.replaceState(null,"","#"+st.view);if(st.view==="stats")renderPlayers();if(st.view==="teams")renderTeams();if(st.view==="odds")renderOdds()}
function renderPlayers(){
 const query=norm($("searchInput").value),dir=st.dir,k=st.sort;
 const players=st.players.filter(p=>norm(p.name+" "+p.team+" "+p.position).includes(query)).sort((a,b)=>(typeof a[k]==="string"?String(a[k]).localeCompare(String(b[k])):n(a[k])-n(b[k]))*dir||a.name.localeCompare(b.name));
 $("recordCount").textContent=players.length+" players";
 $("statsBody").innerHTML=players.length?players.map(p=>'<tr class="player-row" tabindex="0" data-player="'+escapeHTML(p.id)+'"><td class="player-cell"><span class="headshot-wrap"><img loading="lazy" class="headshot" src="'+escapeHTML(p.headshot||"")+'" alt=""></span><span class="player-copy"><span class="player-name">'+escapeHTML(p.name)+'</span><span class="player-meta">'+escapeHTML(p.team)+" · "+escapeHTML(p.position)+'</span></span><span class="row-chevron">›</span></td>'+C.map(([k])=>'<td>'+fmt(p[k])+'</td>').join("")+'</tr>').join(""):'<tr><td colspan="23" class="empty-cell">No NBA players match the search.</td></tr>';
 document.querySelectorAll("#statsView th[data-key]").forEach(x=>x.querySelector(".sort-indicator").textContent=x.dataset.key===k?(dir<0?"↓":"↑"):"");
}
function openPlayer(id){
 const p=st.players.find(x=>String(x.id)===String(id));if(!p)return;st.selected=p;
 $("modalPlayerName").textContent=p.name;$("modalHeadshot").src=p.headshot||"";
 $("modalPlayerMeta").textContent=p.team+" · "+p.position;
 $("modalSeasonSelect").innerHTML=Object.keys(p.gameLogsBySeason||{}).sort((a,b)=>b-a).map(y=>'<option value="'+y+'">'+(Number(y)-1)+"–"+y.slice(-2)+'</option>').join("");
 $("modalSeasonSelect").value=String(st.year);renderLog();$("playerModal").showModal();
}
function renderLog(){
 const p=st.selected;if(!p)return;
 $("gameLogHead").innerHTML="<tr><th>Date</th><th>Opponent</th>"+L.map(([k,label])=>"<th>"+label+"</th>").join("")+"</tr>";
 let logs=(p.gameLogsBySeason||{})[$("modalSeasonSelect").value]||[];
 $("gameLogBody").innerHTML=logs.length?logs.map(g=>'<tr><td class="week-cell">'+escapeHTML(date(g.date))+'</td><td class="opponent-cell"><div class="opponent-matchup"><img class="opponent-logo" src="'+logo(g.opponent?.abbreviation)+'" alt="">'+escapeHTML(g.homeAway==="home"?"vs ":"@ ")+escapeHTML(g.opponent?.abbreviation)+'</div></td>'+L.map(([k])=>"<td>"+fmt(g.stats?.[k])+"</td>").join("")+"</tr>").join(""):'<tr><td colspan="14" class="modal-empty">No verified game logs for this season.</td></tr>';
}
function cols(){return st.teamCategory==="all"?st.catalog.map(x=>[x.key,x.label]):T[st.teamCategory]||T.overview}
function renderTeams(){
 const q=norm($("teamSearchInput").value),search=norm($("teamStatSearchInput").value);
 const columns=cols().filter(([key,label])=>norm(key+label).includes(search));
 const teams=st.teams.filter(t=>norm(t.name+t.abbreviation).includes(q)).sort((a,b)=>st.teamDir*(n(a.stats?.[st.teamSort])-n(b.stats?.[st.teamSort]))||a.name.localeCompare(b.name));
 $("teamColumnCount").textContent=columns.length+" stats";$("teamRecordCount").textContent=teams.length+" teams";
 $("teamStatsHead").innerHTML='<tr><th class="team-col" data-team-sort="name">Team</th>'+columns.map(([k,label])=>'<th data-team-sort="'+escapeHTML(k)+'">'+escapeHTML(label)+(st.teamSort===k?(st.teamDir<0?" ↓":" ↑"):"")+'</th>').join("")+'</tr>';
 $("teamStatsBody").innerHTML=teams.map(t=>'<tr class="player-row" data-team="'+escapeHTML(t.abbreviation)+'" tabindex="0"><td><div class="nba-team-stat"><img src="'+escapeHTML(t.logo||logo(t.abbreviation))+'" alt="">'+escapeHTML(t.name)+'</div></td>'+columns.map(([k])=>"<td>"+fmt(t.stats?.[k])+"</td>").join("")+"</tr>").join("");
 $("teamViewButtons").querySelectorAll("[data-team-view]").forEach(x=>x.classList.toggle("active",x.dataset.teamView===st.teamCategory));
 let best=st.teams.filter(t=>n(t.stats?.games)>0).sort((a,b)=>n(b.stats?.pointsPerGame)-n(a.stats?.pointsPerGame))[0];
 $("teamLeaderStrip").innerHTML=best?'<span class="nba-team-group">Scoring leader</span> '+escapeHTML(best.name)+" · "+fmt(best.stats.pointsPerGame)+" PPG":"";
}
function bars(values,line){const max=Math.max(1,line||0,...values);return'<div class="nba-chart-row">'+values.map(x=>'<div class="nba-bar" title="'+fmt(x)+'" style="height:'+Math.max(3,n(x)/max*100)+'%;background:'+(line!==undefined?(n(x)>line?"var(--win)":"var(--loss)"):"var(--accent)")+'"></div>').join("")+'</div>'}
function openTeam(abbr,metric){
 const t=st.teams.find(x=>x.abbreviation===abbr);if(!t)return;st.selectedTeam=t;
 $("teamStatModalTitle").textContent=t.name;$("teamStatModalLogo").src=t.logo||logo(abbr);
 $("teamStatModalEyebrow").textContent="NBA TEAM STATS";$("teamStatModalMeta").textContent=(st.year-1)+"–"+String(st.year).slice(-2)+" Regular Season";
 $("teamStatSummaryCards").innerHTML=cols().slice(0,4).map(([k,label])=>'<div><small>'+escapeHTML(label)+'</small><strong>'+fmt(t.stats?.[k])+'</strong></div>').join("");
 const key=metric&&metric!=="name"?metric:cols()[0]?.[0]||"pointsPerGame",logs=(t.gameLogsBySeason||{})[st.year]||[];
 const actual=key.replace("PerGame","");
 const values=logs.slice(0,20).reverse().map(g=>n(g.stats?.[actual]??g.stats?.["derived.pointsFor"]));
 $("teamStatChart").innerHTML='<div class="modal-kicker">'+escapeHTML(key)+" · recent games</div>"+bars(values);
 $("teamStatModal").showModal();
}
function controls(){
 $("gameFilterOptions").innerHTML=st.events.map(g=>'<button class="filter-option '+(st.games.has(String(g.id))?"selected":"")+'" type="button" data-nba-game="'+escapeHTML(g.id)+'">'+escapeHTML(g.awayAbbr+" @ "+g.homeAbbr)+' <span class="selection-mark">'+(st.games.has(String(g.id))?"✓":"")+"</span></button>").join("");
 $("marketFilterOptions").innerHTML=[...new Set(st.rows.map(r=>r.market))].sort().map(m=>'<button class="filter-option" data-nba-market="'+escapeHTML(m)+'" type="button">'+escapeHTML(m)+(st.markets.has(m)?" ✓":"")+"</button>").join("");
 $("gameFilterLabel").textContent=st.games.size?st.games.size+" Games":"Games";
 $("marketFilterLabel").textContent=st.markets.size?st.markets.size+" Props":"Propositions";
 $("scopeFilterLabel").textContent=st.scope?st.scope+" Props":"Market Type";
 $("positionFilterLabel").textContent=st.side||"Side";
 $("oddsRangeLabel").textContent=st.min===-5000&&st.max===5000?"Odds":price(st.min)+" to "+price(st.max);
 $("oddsDateLabel").textContent=st.date==="live"?"Live":st.date;
 $("oddsDateOptions").innerHTML='<button class="filter-option" type="button" data-nba-date="live">Live Board '+(st.date==="live"?"✓":"")+'</button>'+st.days.map(x=>'<button class="filter-option" type="button" data-nba-date="'+escapeHTML(x.date)+'">'+escapeHTML(x.date)+(st.date===x.date?" ✓":"")+"</button>").join("");
 [["oddsMinInput",st.min],["oddsMinRange",st.min],["oddsMaxInput",st.max],["oddsMaxRange",st.max]].forEach(([id,value])=>{$(id).value=value});
 $("scopeFilterOptions").querySelectorAll("[data-scope]").forEach(x=>x.classList.toggle("active",x.dataset.scope===st.scope));
 $("positionFilterOptions").querySelectorAll("[data-position]").forEach(x=>x.classList.toggle("active",x.dataset.position===st.side));
}
function filtered(){
 let rows=st.rows.filter(r=>(!st.games.size||st.games.has(String(r.eventId)))&&(!st.markets.size||st.markets.has(r.market))&&(!st.scope||r.scope===st.scope)&&(!st.side||r.selection===st.side)&&n(r.odds)>=st.min&&n(r.odds)<=st.max&&norm([r.player,r.team,r.market,r.matchup,r.proposition].join(" ")).includes(norm(st.search)));
 if(st.oddsSort)rows.sort((a,b)=>{const prop=r=>st.oddsSort.startsWith("hit")?n((r.hitRates||{})[({hitL5:"l5",hitL10:"l10",hitH2H:"h2h",hit2026:"current",hit2025:"previous"})[st.oddsSort]]?.pct):st.oddsSort==="player"?r.player||r.team:r[st.oddsSort];let x=prop(a),y=prop(b);return(typeof x==="string"?x.localeCompare(y||""):n(x)-n(y))*st.oddsDir});
 return rows;
}
function badge(rate){return rate&&rate.total?'<span class="'+(rate.pct>=60?"nba-rate good":rate.pct<40?"nba-rate bad":"")+'">'+fmt(rate.pct)+"%</span>":"—"}
function renderOdds(){
 controls();
 const rows=filtered(),archived=st.date!=="live";$("oddsCount").textContent=rows.length+" props";$("oddsResultHead").hidden=!archived;
 const heads=document.querySelectorAll("#oddsView .hit-head");if(heads[3])heads[3].firstChild.textContent=st.year+" ";if(heads[4])heads[4].firstChild.textContent=(st.year-1)+" ";
 const cells=archived?9:8;
 $("oddsBody").innerHTML=rows.length?rows.slice(0,st.limit).map(r=>{
  const keyval=key(r),selected=st.slip.some(x=>key(x)===keyval);
  const img=r.scope==="player"?r.headshot:logo(r.team||r.homeAbbr);
  return '<tr class="odds-row clickable '+(selected?"parlay-selected":"")+'" tabindex="0" data-nba-prop="'+escapeHTML(keyval)+'"><td class="prop-cell"><div class="prop-player-visual"><span class="odds-headshot-wrap"><img class="odds-headshot" loading="lazy" src="'+escapeHTML(img||"")+'" alt="">'+(r.scope==="player"?'<img class="odds-team-badge" src="'+logo(r.team)+'" alt="">':"")+'</span><div class="prop-copy"><div class="prop-player-line"><span class="prop-player-name">'+escapeHTML(r.player||r.team||"Game")+'</span><span class="prop-divider">·</span><span class="prop-matchup">'+escapeHTML(r.matchup)+'</span></div><div class="prop-name">'+escapeHTML(r.market)+" · "+escapeHTML(r.selection)+(r.alternate?'<span class="alt-badge">ALT</span>':"")+"</div></div></div></td>"+
  '<td class="odds-line">'+fmt(r.line)+'</td><td class="odds-price"><span class="fd-mini">FD</span>'+price(r.odds)+(st.builder?'<button class="parlay-add-leg" type="button" data-nba-add="'+escapeHTML(keyval)+'">'+(selected?"✓":"+")+"</button>":"")+"</td>"+
  (archived?'<td class="odds-result">'+escapeHTML(r.result?.status||"Pending")+"</td>":"")+
  ["l5","l10","h2h","current","previous"].map(k=>"<td>"+badge(r.hitRates?.[k])+"</td>").join("")+"</tr>";
 }).join(""):'<tr><td colspan="'+cells+'" class="odds-empty">No NBA props match this board. FanDuel may not have released eligible NBA markets yet.</td></tr>';
 if(rows.length>st.limit)$("oddsBody").insertAdjacentHTML("beforeend",'<tr><td colspan="'+cells+'" class="odds-empty"><button id="moreNbaProps" class="filter-button" type="button">Show more ('+(rows.length-st.limit)+" remaining)</button></td></tr>");
}
function playerForProp(r){return st.players.find(p=>norm(p.name)===norm(r.player))}
function openRate(row){if(row.scope!=="player")return;st.selectedProp=row;const p=playerForProp(row);
 $("hitRateTitle").textContent=row.player+" · "+row.market;$("hitRateSubtitle").textContent=row.matchup+" · "+row.selection+" "+fmt(row.line)+" · "+price(row.odds);
 $("hitRateBreakdown").innerHTML=[["l5","L5"],["l10","L10"],["h2h","H2H"],["current",String(st.year)],["previous",String(st.year-1)]].map(([k,title])=>'<button class="filter-button" type="button" data-nba-split="'+k+'">'+title+" "+(row.hitRates?.[k]?.pct??"—")+"%</button>").join("");
 const logs=(p?.gameLogsBySeason||{})[st.year]||[];
 const values=logs.slice(0,10).map(g=>Number(g.stats?.[row.metric])).filter(Number.isFinite).sort((a,b)=>a-b);
 $("hitRateAverage").textContent=values.length?fmt(values.reduce((a,b)=>a+b,0)/values.length):"—";
 $("hitRateMedian").textContent=values.length?fmt(values[Math.floor(values.length/2)]):"—";
 $("hitTimingTools").hidden=true;drawRate("l10");$("hitRateModal").showModal();
}
function drawRate(split){
 const row=st.selectedProp;if(!row)return;const p=playerForProp(row),by=p?.gameLogsBySeason||{};
 let logs=split==="previous"?(by[st.year-1]||[]):(by[st.year]||[]);
 if(split==="l5")logs=logs.slice(0,5);if(split==="l10")logs=logs.slice(0,10);
 if(split==="h2h"){let opp=row.team===row.homeAbbr?row.awayAbbr:row.homeAbbr;logs=[...(by[st.year]||[]),...(by[st.year-1]||[])].filter(g=>g.opponent?.abbreviation===opp)}
 let values=logs.map(g=>g.stats?.[row.metric]).filter(x=>Number.isFinite(Number(x)));
 let hits=values.filter(x=>row.selection==="Under"?x<row.line:row.selection==="No"?x<row.line:x>row.line).length;
 $("hitRateSplitLabel").textContent={l5:"Last 5",l10:"Last 10",h2h:"Head to Head",current:"Current Season",previous:"Previous Season"}[split];
 $("hitRateSelectedPct").textContent=values.length?fmt(hits/values.length*100)+"%":"—";$("hitRateSelectedRecord").textContent=values.length?hits+"/"+values.length+" hit":"No games";
 $("hitRateChart").innerHTML=values.length?bars(values.slice().reverse(),n(row.line)):'<div class="nba-empty">No ESPN game logs for this split.</div>';
}
function saveSlip(){try{localStorage.setItem("nbaTrackerParlayV1",JSON.stringify(st.slip))}catch(_){}}
function updateSlip(){
 const decimal=st.slip.reduce((sum,p)=>sum*(n(p.odds)>0?1+n(p.odds)/100:1+100/Math.abs(n(p.odds)||100)),1);
 const odd=decimal>=2?"+"+Math.round((decimal-1)*100):"-"+Math.round(100/(decimal-1));
 $("oddsWorkspace").classList.toggle("parlay-open",st.builder);$("parlayPanel").setAttribute("aria-hidden",String(!st.builder));
 $("parlayBuilderButton").setAttribute("aria-expanded",String(st.builder));$("parlayBuilderCount").hidden=!st.slip.length;
 $("parlayBuilderCount").textContent=st.slip.length;$("parlayLegCount").textContent=st.slip.length+" legs";
 $("parlayCombinedOdds").textContent=st.slip.length?odd:"—";$("parlayFooterOdds").textContent=st.slip.length?odd:"—";
 $("parlayImpliedProbability").textContent=st.slip.length?fmt(100/decimal)+"%":"—";$("parlayClearButton").disabled=!st.slip.length;
 $("parlayLegs").innerHTML=st.slip.length?st.slip.map(p=>'<div class="parlay-leg"><div class="prop-copy"><strong>'+escapeHTML(p.player||p.team||p.matchup)+'</strong><small>'+escapeHTML(p.market)+" · "+escapeHTML(p.selection)+" "+fmt(p.line)+" · "+price(p.odds)+'</small></div><button class="parlay-icon-button" type="button" data-nba-remove="'+escapeHTML(key(p))+'">×</button></div>').join(""):'<div class="parlay-empty"><div class="parlay-empty-icon">+</div><strong>Build your NBA parlay</strong><span>Add props with +.</span></div>';
}
function toggleLeg(p){const k=key(p),i=st.slip.findIndex(x=>key(x)===k);i>=0?st.slip.splice(i,1):st.slip.push(p);saveSlip();updateSlip();renderOdds()}
async function changeDate(value){st.date=value;st.games.clear();st.markets.clear();st.limit=350;
 if(value==="live")st.events=st.live;else{try{st.events=(await fetchData("data/nba-odds-history/"+encodeURIComponent(value)+".json")).events||[]}catch(e){console.error(e);st.events=[]}}
 st.rows=flatten(st.events);renderOdds()}
function bind(){
 [["statsTabButton","stats"],["teamStatsTabButton","teams"],["oddsTabButton","odds"]].forEach(([id,v])=>$(id).addEventListener("click",()=>view(v)));
 window.addEventListener("hashchange",()=>view(location.hash.slice(1),false));
 $("searchInput").addEventListener("input",renderPlayers);
 document.querySelector("#statsView thead").addEventListener("click",e=>{const th=e.target.closest("[data-key]");if(th){st.dir=th.dataset.key===st.sort?-st.dir:-1;st.sort=th.dataset.key;renderPlayers()}});
 $("statsBody").addEventListener("click",e=>{const el=e.target.closest("[data-player]");if(el)openPlayer(el.dataset.player)});
 $("statsBody").addEventListener("keydown",e=>{if(e.key==="Enter"){const el=e.target.closest("[data-player]");if(el)openPlayer(el.dataset.player)}});
 $("modalClose").onclick=()=>$("playerModal").close();$("modalSeasonSelect").onchange=renderLog;
 $("teamSearchInput").oninput=renderTeams;$("teamStatSearchInput").oninput=renderTeams;
 $("teamViewButtons").onclick=e=>{const b=e.target.closest("[data-team-view]");if(b){st.teamCategory=b.dataset.teamView;renderTeams()}};
 $("teamStatsHead").onclick=e=>{const b=e.target.closest("[data-team-sort]");if(b){st.teamDir=st.teamSort===b.dataset.teamSort?-st.teamDir:-1;st.teamSort=b.dataset.teamSort;renderTeams()}};
 $("teamStatsBody").onclick=e=>{const tr=e.target.closest("[data-team]");if(tr)openTeam(tr.dataset.team)};
 $("teamStatsBody").onkeydown=e=>{const tr=e.target.closest("[data-team]");if(tr&&e.key==="Enter")openTeam(tr.dataset.team)};
 $("teamStatModalClose").onclick=()=>$("teamStatModal").close();
 $("oddsSearchInput").oninput=e=>{st.search=e.target.value;st.limit=350;renderOdds()};
 [["gameFilterButton","gameFilterDialog"],["marketFilterButton","marketFilterDialog"],["scopeFilterButton","scopeFilterDialog"],["positionFilterButton","positionFilterDialog"],["oddsRangeButton","oddsRangeDialog"],["oddsDateButton","oddsDateDialog"]].forEach(([b,p])=>$(b).addEventListener("click",e=>{e.stopPropagation();let opening=$(p).hidden;document.querySelectorAll(".filter-popover").forEach(x=>x.hidden=true);$(p).hidden=!opening;$(b).setAttribute("aria-expanded",String(opening))}));
 $("gameFilterOptions").onclick=e=>{const b=e.target.closest("[data-nba-game]");if(b){let k=b.dataset.nbaGame;st.games.has(k)?st.games.delete(k):st.games.add(k);renderOdds()}};
 $("marketFilterOptions").onclick=e=>{const b=e.target.closest("[data-nba-market]");if(b){let k=b.dataset.nbaMarket;st.markets.has(k)?st.markets.delete(k):st.markets.add(k);renderOdds()}};
 document.querySelectorAll("[data-clear-filter]").forEach(b=>b.onclick=()=>{(b.dataset.clearFilter==="games"?st.games:st.markets).clear();renderOdds()});
 $("scopeFilterOptions").onclick=e=>{const b=e.target.closest("[data-scope]");if(b){st.scope=b.dataset.scope;renderOdds()}};
 $("positionFilterOptions").onclick=e=>{const b=e.target.closest("[data-position]");if(b){st.side=b.dataset.position;renderOdds()}};
 ["oddsMinInput","oddsMinRange"].forEach(id=>$(id).onchange=e=>{st.min=n(e.target.value);renderOdds()});
 ["oddsMaxInput","oddsMaxRange"].forEach(id=>$(id).onchange=e=>{st.max=n(e.target.value);renderOdds()});
 $("resetOddsRange").onclick=()=>{st.min=-5000;st.max=5000;renderOdds()};
 $("applyOddsRange").onclick=()=>{st.min=n($("oddsMinInput").value);st.max=n($("oddsMaxInput").value);$("oddsRangeDialog").hidden=true;renderOdds()};
 $("clearFiltersButton").onclick=()=>{st.games.clear();st.markets.clear();st.scope="";st.side="";st.min=-5000;st.max=5000;st.search="";$("oddsSearchInput").value="";renderOdds()};
 $("oddsDateOptions").onclick=e=>{const b=e.target.closest("[data-nba-date]");if(b){$("oddsDateDialog").hidden=true;changeDate(b.dataset.nbaDate)}};
 document.querySelector("#oddsView thead").onclick=e=>{const h=e.target.closest("[data-odds-key]");if(h){st.oddsDir=st.oddsSort===h.dataset.oddsKey?-st.oddsDir:-1;st.oddsSort=h.dataset.oddsKey;renderOdds()}};
 $("oddsBody").onclick=e=>{if(e.target.closest("#moreNbaProps")){st.limit+=350;renderOdds();return}let tr=e.target.closest("[data-nba-prop]");if(!tr)return;let r=st.rows.find(p=>key(p)===tr.dataset.nbaProp);if(!r)return;if(e.target.closest("[data-nba-add]"))toggleLeg(r);else openRate(r)};
 $("oddsBody").onkeydown=e=>{let tr=e.target.closest("[data-nba-prop]");if(tr&&e.key==="Enter"){let r=st.rows.find(p=>key(p)===tr.dataset.nbaProp);if(r)openRate(r)}};
 $("parlayBuilderButton").onclick=()=>{st.builder=!st.builder;updateSlip();renderOdds()};
 $("parlayCloseButton").onclick=()=>{st.builder=false;updateSlip();renderOdds()};
 $("parlayClearButton").onclick=()=>{st.slip=[];saveSlip();updateSlip();renderOdds()};
 $("parlayLegs").onclick=e=>{let b=e.target.closest("[data-nba-remove]");if(b){st.slip=st.slip.filter(p=>key(p)!==b.dataset.nbaRemove);saveSlip();updateSlip();renderOdds()}};
 $("hitRateClose").onclick=()=>$("hitRateModal").close();
 $("hitRateBreakdown").onclick=e=>{const b=e.target.closest("[data-nba-split]");if(b)drawRate(b.dataset.nbaSplit)};
 ["playerModal","teamStatModal","hitRateModal"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target===$(id))$(id).close()}));
 document.addEventListener("click",e=>{if(!e.target.closest(".filter-control"))document.querySelectorAll(".filter-popover").forEach(x=>x.hidden=true)});
}
async function init(){
 bind();view(location.hash.slice(1)||"stats",false);
 try{
  const [stats,teams,odds,days]=await Promise.all([fetchData("data/nba-stats.json"),fetchData("data/nba-team-stats.json"),fetchData("data/nba-odds.json").catch(()=>({events:[]})),fetchData("data/nba-odds-history/index.json").catch(()=>({days:[]}))]);
  st.players=stats.players||[];st.teams=teams.teams||[];st.catalog=teams.statCatalog||[];
  st.year=n(stats.season)||2027;st.live=odds.events||[];st.events=st.live;st.rows=flatten(st.events);st.days=days.days||[];
  $("seasonLabel").textContent=stats.seasonLabel||"NBA Regular Season";
  $("updatedLabel").textContent="Updated "+date(stats.updatedAt);
  try{st.slip=JSON.parse(localStorage.getItem("nbaTrackerParlayV1")||"[]");if(!Array.isArray(st.slip))st.slip=[]}catch(_){st.slip=[]}
  renderPlayers();renderTeams();renderOdds();updateSlip();
 }catch(err){console.error(err);$("seasonLabel").textContent="NBA data unavailable";$("updatedLabel").textContent="ESPN NBA refresh pending";$("statsBody").innerHTML='<tr><td colspan="23" class="empty-cell">NBA stats are not available. Check the NBA update workflow.</td></tr>'}
}
init();
})();
