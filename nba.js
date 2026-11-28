(()=>{
"use strict";
const $=id=>document.getElementById(id);
const st={players:[],teams:[],events:[],live:[],rows:[],days:[],year:2027,view:"stats",sort:"points",dir:-1,teamSort:"pointsPerGame",teamDir:-1,teamCategory:"overview",scope:"",side:"",games:new Set(),markets:new Set(),min:-5000,max:5000,search:"",date:"live",builder:false,slip:[],limit:350,selected:null,selectedTeam:null,selectedProp:null};
const C=[["points","PTS"],["rebounds","REB"],["assists","AST"],["threes","3PM"],["pra","PRA"],["pr","P+R"],["pa","P+A"],["ra","R+A"],["steals","STL"],["blocks","BLK"],["turnovers","TO"],["minutes","MIN"],["fgm","FGM"],["fga","FGA"],["fgPct","FG%"],["tpa","3PA"],["ftm","FTM"],["ftPct","FT%"],["games","GP"],["pointsPerGame","PPG"],["reboundsPerGame","RPG"],["assistsPerGame","APG"]];
const L=C.slice(0,12);
const T={overview:[["pointsPerGame","PPG"],["pointsAllowedPerGame","Opp PPG"],["pointDiffPerGame","Diff/G"],["reboundsPerGame","RPG"],["assistsPerGame","APG"],["threePct","3P%"]],offense:[["pointsPerGame","PPG"],["fgmPerGame","FGM/G"],["fgaPerGame","FGA/G"],["fgPct","FG%"],["threesPerGame","3PM/G"],["assistsPerGame","APG"]],defense:[["pointsAllowedPerGame","Opp PPG"],["pointDiffPerGame","Diff/G"],["stealsPerGame","STL/G"],["blocksPerGame","BLK/G"]],shooting:[["fgPct","FG%"],["threePct","3P%"],["ftPct","FT%"],["threesPerGame","3PM/G"],["tpaPerGame","3PA/G"]],rebounding:[["reboundsPerGame","RPG"],["rebounds","REB"]],playmaking:[["assistsPerGame","APG"],["turnoversPerGame","TO/G"],["assists","AST"]],scoring:[["pointsPerGame","PPG"],["points","Total PTS"],["pointDiffPerGame","Diff/G"],["pointsAllowedPerGame","Opp PPG"]]};
const escapeHTML=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=v=>String(v||"").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/[^a-z0-9]/g,"");
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const fmt=v=>v===null||v===undefined||v===""?"—":new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(v);
const price=v=>n(v)>0?"+"+Math.round(n(v)):String(Math.round(n(v)));
const logo=v=>"https://a.espncdn.com/i/teamlogos/nba/500/"+String(v||"nba").toLowerCase()+".png";
const date=v=>{const d=new Date(v);return isNaN(+d)?"":d.toLocaleDateString("en-US",{month:"short",day:"numeric"})};
async function fetchData(url){let r=await fetch(url,{cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);return r.json()}
function verifiedEvents(events,live){return(events||[]).filter(e=>e.verifiedNBA&&e.espnEventId&&(!live||Date.parse(e.commenceTime)>Date.now())).sort((a,b)=>Date.parse(a.commenceTime)-Date.parse(b.commenceTime))}
function flatten(events){return(events||[]).flatMap(e=>(e.props||[]).filter(p=>p.period==="fullGame").map(p=>Object.assign({},p,{eventId:String(e.id),espnEventId:String(e.espnEventId),commenceTime:e.commenceTime,matchup:(e.awayAbbr||"")+" @ "+(e.homeAbbr||""),homeAbbr:e.homeAbbr,awayAbbr:e.awayAbbr,homeTeam:e.homeTeam,awayTeam:e.awayTeam,teamName:p.team===e.homeAbbr?e.homeTeam:p.team===e.awayAbbr?e.awayTeam:""})))}
const seasonLabel=y=>String(Number(y)-1)+"–"+String(y).slice(-2);
const gameTime=v=>{const d=new Date(v);return Number.isNaN(+d)?"":new Intl.DateTimeFormat("en-US",{weekday:"long",hour:"numeric",minute:"2-digit"}).format(d)};
const shortTeam=(v,fallback)=>String(v||fallback||"").split(" ").slice(-1)[0];
const entityName=r=>r.scope==="player"?r.player:r.scope==="game"?r.matchup:r.teamName||r.team;
const propLabel=r=>r.teamMarketType==="moneyline"?"Moneyline":r.teamMarketType==="spread"?r.market+" "+(Number(r.line)>0?"+":"")+r.line:r.market+" · "+r.selection;
function resultStatus(r){return String(r.result?.status||"pending")}
function resultRank(r){return({miss:0,pending:1,push:2,hit:3})[resultStatus(r)]??1}
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
 const teams=st.teams.filter(t=>norm(t.name+t.abbreviation).includes(q)).sort((a,b)=>st.teamDir*(st.teamSort==="name"?a.name.localeCompare(b.name):n(a.stats?.[st.teamSort])-n(b.stats?.[st.teamSort]))||a.name.localeCompare(b.name));
 $("teamColumnCount").textContent=columns.length+" stats";$("teamRecordCount").textContent=teams.length+" teams";
 $("teamStatsHead").innerHTML='<tr><th class="team-col" data-team-sort="name">Team</th>'+columns.map(([k,label])=>'<th data-team-sort="'+escapeHTML(k)+'">'+escapeHTML(label)+(st.teamSort===k?(st.teamDir<0?" ↓":" ↑"):"")+'</th>').join("")+'</tr>';
 $("teamStatsBody").innerHTML=teams.map(t=>'<tr class="player-row" data-team="'+escapeHTML(t.abbreviation)+'" tabindex="0"><td><div class="nba-team-stat"><img src="'+escapeHTML(t.logo||logo(t.abbreviation))+'" alt="">'+escapeHTML(t.name)+'</div></td>'+columns.map(([k])=>'<td data-team-metric="'+escapeHTML(k)+'">'+fmt(t.stats?.[k])+"</td>").join("")+"</tr>").join("");
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
 const values=logs.slice().reverse().map(g=>{const s=g.stats||{};if(key==="pointsAllowedPerGame")return s["derived.pointsAgainst"];if(key==="pointDiffPerGame")return n(s["derived.pointsFor"])-n(s["derived.pointsAgainst"]);if(key==="fgPct")return n(s.fga)?100*n(s.fgm)/n(s.fga):null;if(key==="threePct")return n(s.tpa)?100*n(s.tpm)/n(s.tpa):null;if(key==="ftPct")return n(s.fta)?100*n(s.ftm)/n(s.fta):null;if(key==="games")return 1;return s[actual]}).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));
 $("teamStatChart").innerHTML='<div class="modal-kicker">'+escapeHTML(key)+" · recent games</div>"+(values.length?bars(values):'<div class="hit-chart-empty">No verified game log for this statistic.</div>');
 $("teamStatModal").showModal();
}
function controls(){
 $("gameFilterOptions").innerHTML=st.events.map(g=>{
   const id=String(g.id),selected=st.games.has(id);
   return '<button class="filter-option game-option '+(selected?"selected":"")+'" type="button" data-nba-game="'+escapeHTML(id)+'"><span class="game-option-logos"><img src="'+escapeHTML(logo(g.awayAbbr))+'" alt=""><img src="'+escapeHTML(logo(g.homeAbbr))+'" alt=""></span><span class="game-option-copy"><span class="game-option-time">'+escapeHTML(gameTime(g.commenceTime))+'</span><span class="game-option-name">'+escapeHTML(shortTeam(g.awayTeam,g.awayAbbr)+' @ '+shortTeam(g.homeTeam,g.homeAbbr))+'</span></span><span class="option-checkbox">'+(selected?"✓":"")+'</span></button>';
 }).join("");
 $("marketFilterOptions").innerHTML=[...new Set(st.rows.map(r=>r.market))].sort().map(m=>'<button class="filter-option '+(st.markets.has(m)?"selected":"")+'" data-nba-market="'+escapeHTML(m)+'" type="button"><span class="filter-option-label">'+escapeHTML(m)+'</span><span class="option-checkbox">'+(st.markets.has(m)?"✓":"")+'</span></button>').join("");
 $("allGamesMark").textContent=st.games.size?"":"✓";
 $("allMarketsMark").textContent=st.markets.size?"":"✓";
 $("gameFilterLabel").textContent=st.games.size?st.games.size+" Games":"Games";
 $("marketFilterLabel").textContent=st.markets.size?st.markets.size+" Props":"Propositions";
 $("scopeFilterLabel").textContent=({player:"Player Props",team:"Team Props",game:"Game Props"})[st.scope]||"Market Type";
 $("positionFilterLabel").textContent=({Win:"Moneyline",Cover:"Spread"})[st.side]||st.side||"Side";
 $("oddsRangeLabel").textContent=st.min===-5000&&st.max===5000?"Odds":price(st.min)+" to "+price(st.max);
 $("oddsDateLabel").textContent=st.date==="live"?"Live":st.date;
 $("oddsDateOptions").innerHTML='<button class="filter-option" type="button" data-nba-date="live">Live Board '+(st.date==="live"?"✓":"")+'</button>'+st.days.map(x=>'<button class="filter-option" type="button" data-nba-date="'+escapeHTML(x.date)+'">'+escapeHTML(x.date)+(st.date===x.date?" ✓":"")+"</button>").join("");
 [["oddsMinInput",st.min],["oddsMinRange",st.min],["oddsMaxInput",st.max],["oddsMaxRange",st.max]].forEach(([id,value])=>{$(id).value=value});
 $("scopeFilterOptions").querySelectorAll("[data-scope]").forEach(x=>{const on=x.dataset.scope===st.scope;x.classList.toggle("active",on);x.querySelector(".selection-mark").textContent=on?"✓":""});
 $("positionFilterOptions").querySelectorAll("[data-position]").forEach(x=>{const on=x.dataset.position===st.side;x.classList.toggle("active",on);x.querySelector(".selection-mark").textContent=on?"✓":""});
}
function filtered(){
 let rows=st.rows.filter(r=>(!st.games.size||st.games.has(String(r.eventId)))&&(!st.markets.size||st.markets.has(r.market))&&(!st.scope||r.scope===st.scope)&&(!st.side||r.selection===st.side)&&n(r.odds)>=st.min&&n(r.odds)<=st.max&&norm([r.player,r.team,r.market,r.matchup,r.proposition].join(" ")).includes(norm(st.search)));
 if(st.oddsSort)rows.sort((a,b)=>{const prop=r=>st.oddsSort.startsWith("hit")?n((r.hitRates||{})[({hitL5:"l5",hitL10:"l10",hitH2H:"h2h",hit2026:"current",hit2025:"previous"})[st.oddsSort]]?.pct):st.oddsSort==="player"?entityName(r):st.oddsSort==="result"?resultRank(r):r[st.oddsSort];let x=prop(a),y=prop(b);return(typeof x==="string"?x.localeCompare(y||""):n(x)-n(y))*st.oddsDir});
 return rows;
}
function badge(rate){return rate&&rate.total?'<span class="'+(rate.pct>=60?"nba-rate good":rate.pct<40?"nba-rate bad":"")+'">'+fmt(rate.pct)+"%</span>":"—"}
function renderOdds(){
 if(st.date==="live"){const filtered=verifiedEvents(st.live,true);if(filtered.length!==st.events.length){st.events=filtered;st.rows=flatten(filtered);}}
 controls();
 const rows=filtered(),archived=st.date!=="live";$("oddsCount").textContent=rows.length+" props";$("oddsResultHead").hidden=!archived;
 const heads=document.querySelectorAll("#oddsView .hit-head");if(heads[3])heads[3].firstChild.textContent=seasonLabel(st.oddsYear||st.year)+" ";if(heads[4])heads[4].firstChild.textContent=seasonLabel((st.oddsYear||st.year)-1)+" ";
 document.querySelectorAll("#oddsView [data-odds-key]").forEach(h=>{const i=h.querySelector(".odds-sort-indicator");if(i)i.textContent=h.dataset.oddsKey===st.oddsSort?(st.oddsDir<0?"↓":"↑"):"";});
 const cells=archived?9:8;
 $("oddsBody").innerHTML=rows.length?rows.slice(0,st.limit).map(r=>{
  const keyval=key(r),selected=st.slip.some(x=>key(x)===keyval);
  const img=r.scope==="player"?r.headshot:logo(r.team||r.homeAbbr);
  return '<tr class="odds-row clickable '+(selected?"parlay-selected":"")+'" tabindex="0" data-nba-prop="'+escapeHTML(keyval)+'"><td class="prop-cell"><div class="prop-player-visual"><span class="odds-headshot-wrap"><img class="odds-headshot" loading="lazy" src="'+escapeHTML(img||"")+'" alt="">'+(r.scope==="player"?'<img class="odds-team-badge" src="'+logo(r.team)+'" alt="">':"")+'</span><div class="prop-copy"><div class="prop-player-line"><span class="prop-player-name">'+escapeHTML(entityName(r))+'</span><span class="prop-divider">·</span><span class="prop-matchup">'+escapeHTML(r.matchup)+'</span></div><div class="prop-name">'+escapeHTML(propLabel(r))+(r.alternate?'<span class="alt-badge">ALT</span>':"")+"</div></div></div></td>"+
  '<td class="odds-line">'+fmt(r.line)+'</td><td class="odds-price"><span class="fd-mini">FD</span>'+price(r.odds)+(st.builder?'<button class="parlay-add-leg" type="button" data-nba-add="'+escapeHTML(keyval)+'">'+(selected?"✓":"+")+"</button>":"")+"</td>"+
  (archived?'<td class="odds-result">'+escapeHTML(({hit:"✓ Hit",miss:"× Miss",push:"↔ Push",pending:"• Pending"})[resultStatus(r)]||"Pending")+"</td>":"")+
  ["l5","l10","h2h","current","previous"].map(k=>"<td>"+badge(r.hitRates?.[k])+"</td>").join("")+"</tr>";
 }).join(""):'<tr><td colspan="'+cells+'" class="odds-empty">No NBA props match this board. FanDuel may not have released eligible NBA markets yet.</td></tr>';
 if(rows.length>st.limit)$("oddsBody").insertAdjacentHTML("beforeend",'<tr><td colspan="'+cells+'" class="odds-empty"><button id="moreNbaProps" class="filter-button" type="button">Show more ('+(rows.length-st.limit)+" remaining)</button></td></tr>");
}
function playerForProp(r){return (st.oddsPlayers||st.players).find(p=>norm(p.name)===norm(r.player))}
function propGames(row,split){
 const teamScope=row.scope!=="player",obj=teamScope?(st.oddsTeams||st.teams).find(t=>t.abbreviation===(row.team||row.homeAbbr)):playerForProp(row),year=st.oddsYear||st.year;
 const by=obj?.gameLogsBySeason||{},cutoff=Date.parse(row.commenceTime),before=g=>Number.isFinite(Date.parse(g.date))&&Date.parse(g.date)<cutoff&&String(g.eventId)!==String(row.espnEventId);
 const cur=(by[year]||[]).filter(before).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)),prev=(by[year-1]||[]).filter(before).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const opponent=(row.team||row.homeAbbr)===row.homeAbbr?row.awayAbbr:row.homeAbbr;
 return (split==="l5"?cur.slice(0,5):split==="l10"?cur.slice(0,10):split==="h2h"?[...cur,...prev].filter(g=>g.opponent?.abbreviation===opponent):split==="previous"?prev:cur).filter(g=>propValue(row,g)!==null);
}
function propValue(row,g){
 const s=g?.stats||{};
 if(row.scope==="player"){const v=s[row.metric];return v!==undefined&&v!==null&&Number.isFinite(Number(v))?Number(v):null}
 const pf=s["derived.pointsFor"],pa=s["derived.pointsAgainst"];
 if(pf==null||pa==null)return null;
 return ["moneyline","spread"].includes(row.teamMarketType)?Number(pf)-Number(pa):row.scope==="game"?Number(pf)+Number(pa):Number(pf);
}
function propThreshold(row){return row.teamMarketType==="moneyline"?0:row.teamMarketType==="spread"?-Number(row.line):Number(row.line)}
function propOutcome(row,v){const t=propThreshold(row);if(v===null)return null;if(row.selection==="Yes")return v>=t?"hit":"miss";if(row.selection==="No")return v<t?"hit":"miss";return v===t?"push":(row.selection==="Under"?v<t:v>t)?"hit":"miss"}
function propRate(row,split){const values=propGames(row,split).map(g=>propOutcome(row,propValue(row,g))).filter(x=>x==="hit"||x==="miss"),hits=values.filter(x=>x==="hit").length;return values.length?{hits,total:values.length,pct:100*hits/values.length}:null}
function timingFor(row,g){
 if(propOutcome(row,propValue(row,g))!=="hit")return null;
 if(["Under","No"].includes(row.selection))return {q:"final",clock:""};
 const p=playerForProp(row),data=st.hitTimingData?.events?.[String(g.eventId)]?.[String(p?.id)]||{},list=data[row.metric]?.length?data[row.metric]:(window.nbaCombinedTiming?.(data,g.stats||{},row.metric)||[]);
 const first=list.find(([v])=>row.selection==="Yes"?v>=propThreshold(row):v>propThreshold(row));
 return first?{q:String(first[1]),clock:first[2]}:null;
}
function openRate(row){
 st.selectedProp=row;st.hitTimingFilter="all";
 const initial=propRate(row,"l10")?"l10":propRate(row,"current")?"current":"previous";
 drawRate(initial);$("hitRateModal").showModal();
 if(row.scope==="player"&&!st.hitTimingData&&!st.hitTimingPromise)st.hitTimingPromise=fetchData("data/nba-odds-history/hit-timing.json").catch(()=>({events:{}})).then(data=>{st.hitTimingData=data;if($("hitRateModal").open)drawRate(st.selectedSplit||initial)}).finally(()=>{st.hitTimingPromise=null});
}
function drawRate(split){
 const row=st.selectedProp;if(!row)return;st.selectedSplit=split;
 const base=propGames(row,split).slice().reverse(),filter=st.hitTimingFilter||"all",games=row.scope==="player"&&filter!=="all"?base.filter(g=>{const t=timingFor(row,g);return t&&(filter==="ot"?Number(t.q)>4:t.q===filter)}):base,values=games.map(g=>propValue(row,g)),ordered=values.slice().sort((a,b)=>a-b),median=ordered.length?(ordered[Math.floor((ordered.length-1)/2)]+ordered[Math.floor(ordered.length/2)])/2:null;
 const year=st.oddsYear||st.year,labels={l5:"Last 5",l10:"Last 10",h2h:"Head-to-Head",current:seasonLabel(year),previous:seasonLabel(year-1)};
 $("hitRateTitle").textContent=entityName(row)+" - "+row.market;
 $("hitRateSubtitle").innerHTML=escapeHTML(propLabel(row)+(row.teamMarketType==="spread"||row.teamMarketType==="moneyline"?"":" "+fmt(row.line))+" • "+row.matchup)+' <span class="hit-rate-odds">'+price(row.odds)+'</span>';
 $("hitRateBreakdown").innerHTML=[["l5","L5"],["l10","L10"],["h2h","H2H"],["current",labels.current],["previous",labels.previous]].map(([k,title])=>{const rate=propRate(row,k),pct=rate?Math.round(rate.pct)+"%":"—",cls=!rate?"hit-na-text":rate.pct>=70?"hit-good-text":rate.pct>=50?"hit-mid-text":"hit-low-text";return '<button class="hit-summary-item '+(split===k?"selected":"")+'" type="button" data-nba-split="'+k+'"'+(!rate?" disabled":"")+'><span>'+escapeHTML(title)+'</span><strong class="'+cls+'">'+pct+'</strong></button>'}).join("");
 const selected=propRate(row,split);
 $("hitRateSplitLabel").textContent=labels[split];
 $("hitRateSelectedPct").textContent=selected?Math.round(selected.pct)+"%":"—";
 $("hitRateSelectedPct").className=!selected?"":selected.pct>=70?"hit-good-text":selected.pct>=50?"hit-mid-text":"hit-low-text";
 $("hitRateSelectedRecord").textContent=selected?" "+selected.hits+" of "+selected.total:"";
 $("hitRateAverage").textContent=values.length?fmt(values.reduce((a,b)=>a+b,0)/values.length):"—";
 $("hitRateMedian").textContent=median===null?"—":fmt(median);
 $("hitTimingTools").hidden=row.scope!=="player";
 if(row.scope==="player"){$("hitTimingStatus").textContent=st.hitTimingData?base.filter(g=>timingFor(row,g)).length+" verified timed hits": "Loading ESPN play-by-play…";$("hitTimingFilters").querySelectorAll("[data-hit-timing]").forEach(b=>b.classList.toggle("selected",b.dataset.hitTiming===filter));}
 if(!values.length){$("hitRateChart").innerHTML='<div class="hit-chart-empty">No applicable game-by-game data for this prop.</div>';return;}
 const line=propThreshold(row),max=Math.max(1,line,...values)*1.16,min=Math.min(0,line,...values),span=Math.max(1,max-min),stage=286,thresholdBottom=48+(line-min)/span*stage;
 const chart=games.map((g,index)=>{
   const v=propValue(row,g),status=propOutcome(row,v),hit=status==="hit",height=Math.max(2,(v-min)/span*100),bottom=48+height/100*stage,opp=g.opponent?.abbreviation||"";
   const cls=hit?"hit":status==="push"?"push":"miss",timing=row.scope==="player"?timingFor(row,g):null,timingLabel=timing?(timing.q==="final"?"Final":Number(timing.q)>4?"OT":timing.q+"Q")+" "+timing.clock:"";
   return '<div class="hit-bar-column" tabindex="0"><div class="hit-bar-value '+cls+'" style="bottom:'+bottom+'px">'+fmt(v)+'</div><div class="hit-bar-track"><div class="hit-bar '+cls+'" style="height:'+height+'%;--bar-delay:'+Math.min(index*35,350)+'ms"></div></div><div class="hit-bar-label"><span>'+escapeHTML(date(g.date))+'</span><span>'+escapeHTML((g.homeAway==="away"?"@ ":"vs ")+opp)+'</span>'+(timingLabel?'<span class="hit-timing-chip">'+escapeHTML(timingLabel)+'</span>':'')+'</div><div class="hit-bar-tooltip"><div class="hit-tooltip-date">'+escapeHTML(date(g.date))+'</div><div class="hit-tooltip-matchup"><img src="'+escapeHTML(logo(opp))+'" alt=""><span>'+escapeHTML((g.homeAway==="away"?"@ ":"vs ")+opp)+'</span></div><div class="hit-tooltip-stat"><span>'+escapeHTML(row.market)+'</span><strong>'+fmt(v)+'</strong></div><div class="hit-tooltip-stat"><span>Result</span><strong>'+escapeHTML(status)+'</strong></div></div></div>';
 }).join("");
 $("hitRateChart").innerHTML='<div class="hit-chart-plot"><div class="hit-threshold" style="bottom:'+thresholdBottom+'px"><span>'+escapeHTML(row.teamMarketType==="spread"?(Number(row.line)>0?"+":"")+row.line:fmt(line))+'</span></div><div class="hit-bars">'+chart+'</div></div>';
}
function saveSlip(){try{localStorage.setItem("nbaTrackerParlayV1",JSON.stringify(st.slip))}catch(_){}}
function updateSlip(){
 const decimal=st.slip.reduce((sum,p)=>sum*(n(p.odds)>0?1+n(p.odds)/100:1+100/Math.abs(n(p.odds)||100)),1);
 const odd=decimal>=2?"+"+Math.round((decimal-1)*100):"-"+Math.round(100/(decimal-1));
 $("oddsWorkspace").classList.toggle("parlay-open",st.builder);$("oddsWorkspace").classList.toggle("parlay-mode",st.builder);$("parlayPanel").classList.toggle("open",st.builder);$("parlayPanel").setAttribute("aria-hidden",String(!st.builder));
 $("parlayBuilderButton").setAttribute("aria-expanded",String(st.builder));$("parlayBuilderCount").hidden=!st.slip.length;
 $("parlayBuilderCount").textContent=st.slip.length;$("parlayLegCount").textContent=st.slip.length+" legs";
 $("parlayCombinedOdds").textContent=st.slip.length?odd:"—";$("parlayFooterOdds").textContent=st.slip.length?odd:"—";
 $("parlayImpliedProbability").textContent=st.slip.length?fmt(100/decimal)+"%":"—";$("parlayClearButton").disabled=!st.slip.length;
 $("parlayLegs").innerHTML=st.slip.length?st.slip.map(p=>'<div class="parlay-leg"><div class="prop-copy"><strong>'+escapeHTML(p.player||p.team||p.matchup)+'</strong><small>'+escapeHTML(p.market)+" · "+escapeHTML(p.selection)+" "+fmt(p.line)+" · "+price(p.odds)+'</small></div><button class="parlay-icon-button" type="button" data-nba-remove="'+escapeHTML(key(p))+'">×</button></div>').join(""):'<div class="parlay-empty"><div class="parlay-empty-icon">+</div><strong>Build your NBA parlay</strong><span>Add props with +.</span></div>';
}
function legFamily(p){const type=p.teamMarketType;return [p.eventId,type==="spread"||type==="moneyline"||type==="gameTotal"?"game":p.player||p.team||p.scope,type||p.metric||p.market].join("¦")}
function toggleLeg(p){const k=key(p),i=st.slip.findIndex(x=>key(x)===k);if(i>=0)st.slip.splice(i,1);else{st.slip=st.slip.filter(x=>legFamily(x)!==legFamily(p));st.slip.push(p)}saveSlip();updateSlip();renderOdds()}
async function changeDate(value){st.date=value;st.games.clear();st.markets.clear();st.limit=350;
 if(value==="live"){st.events=verifiedEvents(st.live,true);st.oddsPlayers=st.players;st.oddsTeams=st.teams;st.oddsYear=st.year;}else{try{const snap=await fetchData("data/nba-odds-history/"+encodeURIComponent(value)+".json");if(!snap.pregameVerified)throw Error("Unverified archive");st.events=verifiedEvents(snap.events,false);st.oddsPlayers=snap.statsSnapshot?.players||[];st.oddsTeams=snap.teamSnapshot?.teams||[];st.oddsYear=snap.statsSnapshot?.season||st.year;}catch(e){console.error(e);st.events=[];st.oddsPlayers=[];st.oddsTeams=[];}}
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
 $("teamStatsBody").onclick=e=>{const tr=e.target.closest("[data-team]");if(tr)openTeam(tr.dataset.team,e.target.closest("[data-team-metric]")?.dataset.teamMetric)};
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
 $("hitTimingFilters").onclick=e=>{const b=e.target.closest("[data-hit-timing]");if(b){st.hitTimingFilter=b.dataset.hitTiming;drawRate(st.selectedSplit)}};
 ["playerModal","teamStatModal","hitRateModal"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target===$(id))$(id).close()}));
 document.addEventListener("click",e=>{if(!e.target.closest(".filter-control"))document.querySelectorAll(".filter-popover").forEach(x=>x.hidden=true)});
}
async function init(){
 bind();view(location.hash.slice(1)||"stats",false);
 try{
  const [stats,teams,odds,days]=await Promise.all([fetchData("data/nba-stats.json"),fetchData("data/nba-team-stats.json"),fetchData("data/nba-odds.json").catch(()=>({events:[]})),fetchData("data/nba-odds-history/index.json").catch(()=>({days:[]}))]);
  st.players=stats.players||[];st.teams=teams.teams||[];st.catalog=teams.statCatalog||[];
  st.year=n(stats.season)||2027;st.oddsYear=st.year;st.oddsPlayers=st.players;st.oddsTeams=st.teams;st.live=verifiedEvents(odds.events,true);st.events=st.live;st.rows=flatten(st.events);st.days=days.days||[];
  $("seasonLabel").textContent=stats.seasonLabel||"NBA Regular Season";
  $("updatedLabel").textContent="Updated "+date(stats.updatedAt);
  try{st.slip=JSON.parse(localStorage.getItem("nbaTrackerParlayV1")||"[]");if(!Array.isArray(st.slip))st.slip=[]}catch(_){st.slip=[]}
  renderPlayers();renderTeams();renderOdds();updateSlip();setInterval(()=>{if(st.view==="odds"&&st.date==="live")renderOdds()},60000);
 }catch(err){console.error(err);$("seasonLabel").textContent="NBA data unavailable";$("updatedLabel").textContent="ESPN NBA refresh pending";$("statsBody").innerHTML='<tr><td colspan="23" class="empty-cell">NBA stats are not available. Check the NBA update workflow.</td></tr>'}
}
init();
})();
