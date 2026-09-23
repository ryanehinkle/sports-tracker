const state={
  players:[],
  playerIndex:new Map(),
  query:"",
  sortKey:"allPurposeYards",
  sortDir:"desc",
  season:null,
  statsUpdatedAt:null,
  odds:[],
  oddsRaw:null,
  oddsQuery:"",
  selectedGames:new Set(),
  selectedMarkets:new Set(),
  oddsPosition:"",
  oddsMin:null,
  oddsMax:null,
  availableOddsMin:null,
  availableOddsMax:null,
  oddsSortKey:"player",
  oddsSortDir:"asc",
  oddsUpdatedAt:null,
  activeView:"stats",
  modalPlayer:null
};

const body=document.getElementById("statsBody");
const search=document.getElementById("searchInput");
const count=document.getElementById("recordCount");
const seasonLabel=document.getElementById("seasonLabel");
const updatedLabel=document.getElementById("updatedLabel");
const pageSubtitle=document.getElementById("pageSubtitle");
const pageFooter=document.getElementById("pageFooter");
const statsView=document.getElementById("statsView");
const oddsView=document.getElementById("oddsView");
const statsTabButton=document.getElementById("statsTabButton");
const oddsTabButton=document.getElementById("oddsTabButton");
const oddsBody=document.getElementById("oddsBody");
const oddsSearch=document.getElementById("oddsSearchInput");
const oddsCount=document.getElementById("oddsCount");

const gameFilterButton=document.getElementById("gameFilterButton");
const marketFilterButton=document.getElementById("marketFilterButton");
const positionFilterButton=document.getElementById("positionFilterButton");
const oddsRangeButton=document.getElementById("oddsRangeButton");
const clearFiltersButton=document.getElementById("clearFiltersButton");
const gameFilterLabel=document.getElementById("gameFilterLabel");
const marketFilterLabel=document.getElementById("marketFilterLabel");
const positionFilterLabel=document.getElementById("positionFilterLabel");
const oddsRangeLabel=document.getElementById("oddsRangeLabel");
const gameFilterDialog=document.getElementById("gameFilterDialog");
const marketFilterDialog=document.getElementById("marketFilterDialog");
const positionFilterDialog=document.getElementById("positionFilterDialog");
const oddsRangeDialog=document.getElementById("oddsRangeDialog");
const gameFilterOptions=document.getElementById("gameFilterOptions");
const marketFilterOptions=document.getElementById("marketFilterOptions");
const allGamesMark=document.getElementById("allGamesMark");
const allMarketsMark=document.getElementById("allMarketsMark");
const oddsMinInput=document.getElementById("oddsMinInput");
const oddsMaxInput=document.getElementById("oddsMaxInput");
const oddsMinRange=document.getElementById("oddsMinRange");
const oddsMaxRange=document.getElementById("oddsMaxRange");
const dualRangeFill=document.getElementById("dualRangeFill");
const resetOddsRange=document.getElementById("resetOddsRange");
const applyOddsRange=document.getElementById("applyOddsRange");

const modal=document.getElementById("playerModal");
const modalClose=document.getElementById("modalClose");
const modalHeadshot=document.getElementById("modalHeadshot");
const modalPlayerName=document.getElementById("modalPlayerName");
const modalPlayerMeta=document.getElementById("modalPlayerMeta");
const modalKicker=document.getElementById("modalKicker");
const modalSeasonSelect=document.getElementById("modalSeasonSelect");
const gameLogBody=document.getElementById("gameLogBody");

const fmt=new Intl.NumberFormat("en-US");

function safe(v){return Number.isFinite(Number(v))?Number(v):0}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function escapeRegex(value){return String(value||"").replace(/[.*+?^$()|[\]{}\\]/g,"\\$&")}
function normalizeName(value){
  return String(value||"").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g,"").replace(/[^a-z0-9]/g,"");
}
function fallbackHeadshot(name){
  const initials=String(name||"?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="92" height="92"><rect width="100%" height="100%" fill="#242d3a"/><text x="50%" y="56%" text-anchor="middle" fill="#94a2b5" font-size="30" font-family="Arial" font-weight="700">'+initials+'</text></svg>';
  return "data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(svg);
}
function fallbackTeamLogo(abbr){
  const label=String(abbr||"NFL").slice(0,3).toUpperCase();
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="36" fill="#242d3a"/><text x="40" y="47" text-anchor="middle" fill="#94a2b5" font-size="18" font-family="Arial" font-weight="700">'+label+'</text></svg>';
  return "data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(svg);
}
function teamLogo(abbr){
  if(!abbr) return fallbackTeamLogo("NFL");
  return "https://a.espncdn.com/i/teamlogos/nfl/500/"+String(abbr).toLowerCase()+".png";
}
function formatUpdated(value){
  if(!value) return "Awaiting first refresh";
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return "Updated recently";
  return "Updated "+new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(d);
}
function formatAmerican(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return "—";
  return n>0?"+"+Math.round(n):String(Math.round(n));
}
function formatLine(value){
  if(value===null||value===undefined||value==="") return "—";
  const n=Number(value);
  if(!Number.isFinite(n)) return String(value);
  return Number.isInteger(n)?String(n):String(n);
}
function shortTeamName(name){
  const parts=String(name||"").trim().split(/\s+/);
  return parts.length?parts[parts.length-1]:"Team";
}
function formatGameTime(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US",{weekday:"long",hour:"numeric",minute:"2-digit"}).format(d);
}

function findPlayer(name){
  const key=normalizeName(name);
  if(state.playerIndex.has(key)) return state.playerIndex.get(key);
  for(const [norm,p] of state.playerIndex.entries()){
    if(norm.length>=6&&(norm.includes(key)||key.includes(norm))) return p;
  }
  return null;
}

function cleanDisplayPlayerName(value){
  let text=String(value||"").trim();
  text=text.replace(/\s+-\s+Alt\b.*$/i,"");
  text=text.replace(/\s+\d+(?:\.\d+)?\+\s*(?:Yards?|Yds?|Receptions?|TDs?|Touchdowns?)?\s*$/i,"");
  return text.trim();
}

function cleanDisplayProposition(row){
  const player=cleanDisplayPlayerName(row.player);
  let prop=String(row.proposition||row.market||"Player Prop").trim();

  if(player){
    const escaped=escapeRegex(player);
    prop=prop.replace(new RegExp("^"+escaped+"\\s*-?\\s*","i"),"");
    prop=prop.replace(new RegExp("\\b"+escaped+"\\s*-\\s*","ig"),"");
  }

  const milestone=prop.match(/(?:Player\s+)?to Record a \d+(?:\.\d+)?\+ Yard Reception/i);
  if(milestone) return milestone[0].replace(/^to Record/i,"Player to Record");

  if(/\d+(?:\.\d+)?\+/.test(prop)&&/^Over\s+\d+(?:\.\d+)?\s+/i.test(prop)){
    prop=prop.replace(/^Over\s+\d+(?:\.\d+)?\s+/i,"");
  }

  prop=prop.replace(/\bAlt\s+/gi,"");
  prop=prop.replace(/\bYds\b/gi,"Yards");
  prop=prop.replace(/\s{2,}/g," ").trim().replace(/^[-:]+|[-:]+$/g,"").trim();
  return prop||String(row.market||"Player Prop");
}

function setView(view,updateHash=true){
  state.activeView=view==="odds"?"odds":"stats";
  const isOdds=state.activeView==="odds";
  statsView.classList.toggle("active",!isOdds);
  oddsView.classList.toggle("active",isOdds);
  statsTabButton.classList.toggle("active",!isOdds);
  oddsTabButton.classList.toggle("active",isOdds);
  statsTabButton.setAttribute("aria-selected",String(!isOdds));
  oddsTabButton.setAttribute("aria-selected",String(isOdds));

  if(isOdds){
    pageSubtitle.textContent="Current FanDuel NFL player props with historical hit rates from ESPN game logs.";
    seasonLabel.textContent="FanDuel Player Props";
    updatedLabel.textContent=formatUpdated(state.oddsUpdatedAt);
    pageFooter.innerHTML="<span>Odds read directly from FanDuel’s public sportsbook web feed.</span><span>Hit rates use ESPN regular-season game logs • “—” means the split is not applicable or unavailable.</span>";
  }else{
    pageSubtitle.textContent="Current regular-season offensive production, refreshed automatically after NFL game days.";
    seasonLabel.textContent=(state.season||"Current")+" Regular Season";
    updatedLabel.textContent=formatUpdated(state.statsUpdatedAt);
    pageFooter.innerHTML="<span>Player stats sourced from ESPN.</span><span>Click a player for their game log • Click a column heading to sort.</span>";
  }

  if(updateHash) history.replaceState(null,"",isOdds?"#odds":"#stats");
}

function render(){
  const q=state.query.trim().toLowerCase();
  let rows=state.players.filter(p=>!p.oddsOnly&&(!q||[p.name,p.team,p.position].some(v=>String(v||"").toLowerCase().includes(q))));
  rows.sort((a,b)=>{
    let av=a[state.sortKey],bv=b[state.sortKey],result;
    if(state.sortKey==="name") result=String(av).localeCompare(String(bv));
    else result=safe(av)-safe(bv);
    return state.sortDir==="asc"?result:-result;
  });
  count.textContent=fmt.format(rows.length)+" player"+(rows.length===1?"":"s");
  document.querySelectorAll("#statsView th[data-key]").forEach(th=>{
    const mark=th.querySelector(".sort-indicator");
    mark.textContent=th.dataset.key===state.sortKey?(state.sortDir==="asc"?"▲":"▼"):"";
  });
  if(!rows.length){
    body.innerHTML='<tr><td colspan="8" class="empty-cell">No players match that search.</td></tr>';
    return;
  }
  body.innerHTML=rows.map(p=>
    '<tr class="player-row" data-player-id="'+esc(p.id)+'" tabindex="0" role="button" aria-label="Open '+esc(p.name)+' game log">'+
      '<td class="player-cell">'+
        '<div class="headshot-wrap"><img class="headshot" src="'+esc(p.headshot||fallbackHeadshot(p.name))+'" alt="" loading="lazy" onerror="this.src=\''+fallbackHeadshot(p.name)+'\'"></div>'+
        '<div class="player-copy"><div class="player-name">'+esc(p.name)+'</div><div class="player-meta"><span>'+esc(p.position||"—")+'</span><span class="team-dot"></span><span>'+esc(p.team||"NFL")+'</span></div></div>'+
        '<span class="row-chevron" aria-hidden="true">›</span>'+
      '</td>'+
      '<td class="stat-strong">'+fmt.format(safe(p.touchdowns))+'</td>'+
      '<td class="all-purpose">'+fmt.format(safe(p.allPurposeYards))+'</td>'+
      '<td>'+fmt.format(safe(p.receivingYards))+'</td>'+
      '<td>'+fmt.format(safe(p.rushingYards))+'</td>'+
      '<td>'+fmt.format(safe(p.receptions))+'</td>'+
      '<td>'+fmt.format(safe(p.passingTouchdowns))+'</td>'+
      '<td>'+fmt.format(safe(p.passingYards))+'</td>'+
    '</tr>'
  ).join("");
}

function gameStat(game,key){
  if(!game||!game.played) return "-";
  return fmt.format(safe(game[key]));
}
function resultHtml(game){
  if(!game||!game.played||!game.result) return "";
  const result=String(game.result).toUpperCase();
  const cls=result==="W"?"win":result==="L"?"loss":"tie";
  const score=game.score?" "+esc(game.score):"";
  return '<span class="game-result '+cls+'">('+esc(result)+score+')</span>';
}
function opponentHtml(game){
  if(!game||!game.played||!game.opponent) return '<span class="no-game">—</span>';
  const away=Boolean(game.isAway);
  const logo=game.opponent.logo||fallbackTeamLogo(game.opponent.abbreviation);
  const abbr=game.opponent.abbreviation||game.opponent.name||"NFL";
  return '<div class="opponent-matchup">'+
    (away?'<span class="venue-marker">@</span>':'')+
    '<img class="opponent-logo" src="'+esc(logo)+'" alt="'+esc(abbr)+' logo" loading="lazy" onerror="this.src=\''+fallbackTeamLogo(abbr)+'\'">'+
    (!away?'<span class="venue-marker home">vs</span>':'')+
    '<span class="opponent-name">'+esc(game.opponent.name||abbr)+'</span>'+
    resultHtml(game)+
  '</div>';
}
function logsForSeason(player,season){
  const bySeason=player?.gameLogsBySeason||{};
  if(Array.isArray(bySeason[String(season)])) return bySeason[String(season)];
  if(Number(season)===Number(state.season)&&Array.isArray(player?.gameLog)) return player.gameLog;
  return [];
}
function renderModalSeason(){
  const player=state.modalPlayer;
  if(!player) return;
  const season=Number(modalSeasonSelect.value||state.season);
  const logs=logsForSeason(player,season);
  modalKicker.textContent=season+" REGULAR SEASON • GAME LOG";

  if(!logs.length){
    gameLogBody.innerHTML='<tr><td colspan="9" class="modal-empty">No regular-season game log is available for '+esc(season)+'.</td></tr>';
    return;
  }

  gameLogBody.innerHTML=logs.map(game=>
    '<tr class="'+(game.played?"":"no-game-row")+'">'+
      '<td class="week-cell">Week '+esc(game.week)+'</td>'+
      '<td class="opponent-cell">'+opponentHtml(game)+'</td>'+
      '<td class="stat-strong">'+gameStat(game,"touchdowns")+'</td>'+
      '<td class="all-purpose">'+gameStat(game,"allPurposeYards")+'</td>'+
      '<td>'+gameStat(game,"receivingYards")+'</td>'+
      '<td>'+gameStat(game,"rushingYards")+'</td>'+
      '<td>'+gameStat(game,"receptions")+'</td>'+
      '<td>'+gameStat(game,"passingTouchdowns")+'</td>'+
      '<td>'+gameStat(game,"passingYards")+'</td>'+
    '</tr>'
  ).join("");
}
function openPlayer(player){
  state.modalPlayer=player;
  modalHeadshot.src=player.headshot||fallbackHeadshot(player.name);
  modalHeadshot.onerror=()=>{modalHeadshot.src=fallbackHeadshot(player.name)};
  modalPlayerName.textContent=player.name;
  modalPlayerMeta.textContent=[player.position,player.team].filter(Boolean).join(" • ");

  const bySeason=player.gameLogsBySeason||{};
  const seasons=Object.keys(bySeason)
    .filter(year=>Array.isArray(bySeason[year])&&bySeason[year].some(g=>g.played))
    .map(Number)
    .sort((a,b)=>b-a);
  if(!seasons.includes(Number(state.season))&&Array.isArray(player.gameLog)) seasons.unshift(Number(state.season));
  const unique=[...new Set(seasons)];
  modalSeasonSelect.innerHTML=unique.map(year=>'<option value="'+year+'">'+year+'</option>').join("");
  modalSeasonSelect.value=String(unique[0]||state.season);
  renderModalSeason();
  modal.showModal();
}
function closeModal(){if(modal.open) modal.close()}

function playerPlayedLogs(player){
  if(!player) return [];
  const bySeason=player.gameLogsBySeason||{};
  const years=Object.keys(bySeason).map(Number).sort((a,b)=>b-a);
  if(!years.length&&Array.isArray(player.gameLog)) years.push(Number(state.season));
  const out=[];
  for(const year of years){
    const logs=logsForSeason(player,year)
      .filter(g=>g&&g.played)
      .sort((a,b)=>safe(b.week)-safe(a.week));
    for(const game of logs) out.push({...game,_season:year});
  }
  return out;
}

function metricSpec(row){
  const market=String(row.market||row.proposition||"").toLowerCase();
  const prop=String(row.proposition||"").toLowerCase();
  const text=(market+" "+prop).replace(/\s+/g," ");

  if(/first touchdown scorer|last touchdown scorer|quarter td scorer|1q |1h /.test(text)) return null;

  const receptionMilestone=text.match(/(?:record a |record |)(\d+(?:\.\d+)?)\+ yard reception/);
  if(receptionMilestone) return {metric:"receivingLongest",threshold:Number(receptionMilestone[1]),comparison:"gte"};

  const tdMilestone=text.match(/(?:score |)(\d+(?:\.\d+)?)\+ touchdowns?/);
  if(tdMilestone) return {metric:"touchdowns",threshold:Number(tdMilestone[1]),comparison:"gte"};

  if(/any time touchdown scorer|anytime touchdown scorer/.test(text)) return {metric:"touchdowns",threshold:1,comparison:"gte"};
  if(/pass \+ rush \+ rec.*yards|pass.*rush.*reception.*yards/.test(text)) return {metric:"passRushRecYards"};
  if(/pass \+ rush.*yards/.test(text)) return {metric:"passRushYards"};
  if(/rush \+ rec.*yards|rush.*reception.*yards/.test(text)) return {metric:"allPurposeYards"};
  if(/passing yards/.test(text)) return {metric:"passingYards"};
  if(/receiving yards/.test(text)) return {metric:"receivingYards"};
  if(/rushing yards/.test(text)) return {metric:"rushingYards"};
  if(/receptions/.test(text)&&!/longest/.test(text)) return {metric:"receptions"};
  if(/passing tds|passing touchdowns/.test(text)) return {metric:"passingTouchdowns"};
  if(/receiving tds|receiving touchdowns/.test(text)) return {metric:"receivingTouchdowns"};
  if(/rushing tds|rushing touchdowns/.test(text)) return {metric:"rushingTouchdowns"};
  if(/rushing attempts|rush attempts/.test(text)) return {metric:"rushingAttempts"};
  if(/pass attempts/.test(text)) return {metric:"passingAttempts"};
  if(/pass completions|passing completions/.test(text)) return {metric:"passingCompletions"};
  if(/interceptions thrown|pass interceptions/.test(text)) return {metric:"passingInterceptions"};
  if(/longest completion|longest pass/.test(text)) return {metric:"passingLongest"};
  if(/longest reception/.test(text)) return {metric:"receivingLongest"};
  if(/longest rush/.test(text)) return {metric:"rushingLongest"};
  if(/solo tackles/.test(text)) return {metric:"soloTackles"};
  if(/tackles \+ assists/.test(text)) return {metric:"totalTackles"};
  if(/\bsacks\b/.test(text)) return {metric:"sacks"};
  if(/defensive interceptions/.test(text)) return {metric:"defensiveInterceptions"};
  if(/field goals/.test(text)) return {metric:"fieldGoalsMade"};
  if(/kicking points/.test(text)) return {metric:"kickingPoints"};
  if(/^touchdowns?$/.test(market.trim())||/ total touchdowns/.test(text)) return {metric:"touchdowns"};
  return null;
}
function metricValue(game,spec){
  if(!game||!spec) return null;
  if(spec.metric==="passRushYards") return safe(game.passingYards)+safe(game.rushingYards);
  if(spec.metric==="passRushRecYards") return safe(game.passingYards)+safe(game.rushingYards)+safe(game.receivingYards);
  const value=game[spec.metric];
  return Number.isFinite(Number(value))?Number(value):null;
}
function propHit(row,game){
  const spec=metricSpec(row);
  if(!spec) return null;
  const value=metricValue(game,spec);
  if(value===null) return null;

  if(spec.comparison==="gte") return value>=spec.threshold;

  const line=Number(row.line);
  if(!Number.isFinite(line)) return null;
  if(row.selection==="Under") return value<line;
  if(row.selection==="Over") return value>line;
  if(row.selection==="Yes") return value>line;
  if(row.selection==="No") return value<=line;
  return null;
}
function rateForGames(row,games){
  let hits=0,total=0;
  for(const game of games){
    const hit=propHit(row,game);
    if(hit===null) continue;
    total++;
    if(hit) hits++;
  }
  if(!total) return null;
  return {pct:Math.round((hits/total)*100),hits,total};
}
function opponentForRow(row,player){
  const team=String(row.team||player?.team||"").toUpperCase();
  if(team&&team===String(row.homeAbbr||"").toUpperCase()) return String(row.awayAbbr||"").toUpperCase();
  if(team&&team===String(row.awayAbbr||"").toUpperCase()) return String(row.homeAbbr||"").toUpperCase();
  return "";
}
function computeHitRates(row){
  const player=findPlayer(row.player);
  if(!player) return {l5:null,l10:null,h2h:null,current:null,previous:null};

  const all=playerPlayedLogs(player);
  const currentYear=Number(state.season||2026);
  const previousYear=currentYear-1;
  const opponent=opponentForRow(row,player);
  const h2h=opponent?all.filter(g=>String(g.opponent?.abbreviation||"").toUpperCase()===opponent):[];

  return {
    l5:rateForGames(row,all.slice(0,5)),
    l10:rateForGames(row,all.slice(0,10)),
    h2h:rateForGames(row,h2h),
    current:rateForGames(row,logsForSeason(player,currentYear).filter(g=>g.played)),
    previous:rateForGames(row,logsForSeason(player,previousYear).filter(g=>g.played))
  };
}
function hitCell(rate){
  if(!rate) return '<td class="hit-cell hit-na">-</td>';
  const cls=rate.pct>=70?"hit-good":rate.pct>=50?"hit-mid":"hit-low";
  return '<td class="hit-cell '+cls+'" title="'+rate.hits+' of '+rate.total+' games">'+rate.pct+'%</td>';
}

function renderGameFilters(){
  const events=[...(state.oddsRaw?.events||[])].sort((a,b)=>String(a.commenceTime||"").localeCompare(String(b.commenceTime||"")));
  gameFilterOptions.innerHTML=events.map(event=>{
    const id=String(event.id||"");
    const checked=state.selectedGames.has(id);
    const awayAbbr=event.awayAbbr||"NFL";
    const homeAbbr=event.homeAbbr||"NFL";
    return '<button type="button" class="filter-option game-option '+(checked?"selected":"")+'" data-game-id="'+esc(id)+'">'+
      '<span class="game-option-logos"><img src="'+esc(teamLogo(awayAbbr))+'" alt=""><img src="'+esc(teamLogo(homeAbbr))+'" alt=""></span>'+
      '<span class="game-option-copy"><span class="game-option-time">'+esc(formatGameTime(event.commenceTime))+'</span><span class="game-option-name">'+esc(shortTeamName(event.awayTeam))+' @ '+esc(shortTeamName(event.homeTeam))+'</span></span>'+
      '<span class="option-checkbox">'+(checked?"✓":"")+'</span>'+
    '</button>';
  }).join("");
  allGamesMark.textContent=state.selectedGames.size?"":"✓";
  gameFilterLabel.textContent=state.selectedGames.size?state.selectedGames.size+" Game"+(state.selectedGames.size===1?"":"s"):"Games";
}
function renderMarketFilters(){
  const markets=[...new Set(state.odds.map(row=>row.market).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  marketFilterOptions.innerHTML=markets.map(market=>{
    const checked=state.selectedMarkets.has(market);
    return '<button type="button" class="filter-option '+(checked?"selected":"")+'" data-market="'+esc(market)+'">'+
      '<span class="filter-option-label">'+esc(market)+'</span><span class="option-checkbox">'+(checked?"✓":"")+'</span>'+
    '</button>';
  }).join("");
  allMarketsMark.textContent=state.selectedMarkets.size?"":"✓";
  marketFilterLabel.textContent=state.selectedMarkets.size?state.selectedMarkets.size+" Prop"+(state.selectedMarkets.size===1?"":"s"):"Propositions";
}
function renderPositionFilter(){
  document.querySelectorAll(".position-option").forEach(btn=>{
    const active=btn.dataset.position===state.oddsPosition;
    btn.classList.toggle("active",active);
    btn.querySelector(".selection-mark").textContent=active?"✓":"";
  });
  positionFilterLabel.textContent=state.oddsPosition||"Over / Under";
}
function syncOddsRangeControls(){
  const min=state.availableOddsMin??-1000;
  const max=state.availableOddsMax??1000;
  const selectedMin=state.oddsMin??min;
  const selectedMax=state.oddsMax??max;

  for(const input of [oddsMinRange,oddsMaxRange]){
    input.min=String(min);
    input.max=String(max);
    input.step="1";
  }
  oddsMinRange.value=String(selectedMin);
  oddsMaxRange.value=String(selectedMax);
  oddsMinInput.value=String(selectedMin);
  oddsMaxInput.value=String(selectedMax);

  const span=Math.max(max-min,1);
  const left=((selectedMin-min)/span)*100;
  const right=((selectedMax-min)/span)*100;
  dualRangeFill.style.left=left+"%";
  dualRangeFill.style.width=Math.max(0,right-left)+"%";

  const changed=selectedMin!==min||selectedMax!==max;
  oddsRangeLabel.textContent=changed?formatAmerican(selectedMin)+" to "+formatAmerican(selectedMax):"Odds";
}
function updateFilterButtons(){
  renderGameFilters();
  renderMarketFilters();
  renderPositionFilter();
  syncOddsRangeControls();
  const active=state.selectedGames.size||state.selectedMarkets.size||state.oddsPosition||state.oddsMin!==null||state.oddsMax!==null;
  clearFiltersButton.classList.toggle("visible",Boolean(active));
}

function oddsRowPassesFilters(row){
  if(state.selectedGames.size&&!state.selectedGames.has(row.eventId)) return false;
  if(state.selectedMarkets.size&&!state.selectedMarkets.has(row.market)) return false;
  if(state.oddsPosition&&row.selection!==state.oddsPosition) return false;
  const odds=Number(row.odds);
  if(state.oddsMin!==null&&Number.isFinite(odds)&&odds<state.oddsMin) return false;
  if(state.oddsMax!==null&&Number.isFinite(odds)&&odds>state.oddsMax) return false;

  const q=state.oddsQuery.trim().toLowerCase();
  if(q&&![row.player,row.team,row.position,row.market,row.proposition,row.matchup,row.selection]
    .some(value=>String(value||"").toLowerCase().includes(q))) return false;
  return true;
}

function renderOdds(){
  let rows=state.odds.filter(oddsRowPassesFilters).map(row=>({...row,_rates:computeHitRates(row)}));

  const hitKeyMap={hitL5:"l5",hitL10:"l10",hitH2H:"h2h",hit2026:"current",hit2025:"previous"};
  rows.sort((a,b)=>{
    let result=0;
    if(state.oddsSortKey==="line") result=(Number(a.line)||0)-(Number(b.line)||0);
    else if(state.oddsSortKey==="odds") result=(Number(a.odds)||0)-(Number(b.odds)||0);
    else if(hitKeyMap[state.oddsSortKey]){
      const key=hitKeyMap[state.oddsSortKey];
      const av=a._rates[key]?.pct;
      const bv=b._rates[key]?.pct;
      if(av==null&&bv==null) result=0;
      else if(av==null) result=-1;
      else if(bv==null) result=1;
      else result=av-bv;
    }else{
      result=String(a.player).localeCompare(String(b.player))||
        String(a.market).localeCompare(String(b.market))||
        (Number(a.line)||0)-(Number(b.line)||0);
    }
    return state.oddsSortDir==="asc"?result:-result;
  });

  oddsCount.textContent=fmt.format(rows.length)+" prop"+(rows.length===1?"":"s");
  document.querySelectorAll(".odds-table th[data-odds-key]").forEach(th=>{
    const mark=th.querySelector(".odds-sort-indicator");
    mark.textContent=th.dataset.oddsKey===state.oddsSortKey?(state.oddsSortDir==="asc"?"▲":"▼"):"";
  });

  if(!rows.length){
    const message=state.odds.length?"No FanDuel props match those filters.":"No FanDuel NFL player props are currently available in the feed.";
    oddsBody.innerHTML='<tr><td colspan="8" class="odds-empty">'+esc(message)+'</td></tr>';
    return;
  }

  oddsBody.innerHTML=rows.map(row=>{
    const profile=findPlayer(row.player);
    const displayPlayer=cleanDisplayPlayerName(profile?.name||row.player);
    const team=row.team||profile?.team||"";
    const headshot=row.headshot||profile?.headshot||fallbackHeadshot(displayPlayer);
    const logo=teamLogo(team);
    const alt=row.alternate?'<span class="alt-badge">ALT</span>':'';
    const proposition=cleanDisplayProposition({...row,player:displayPlayer});
    const content=
      '<div class="prop-player-visual">'+
        '<div class="odds-headshot-wrap"><img class="odds-headshot" src="'+esc(headshot)+'" alt="" loading="lazy" onerror="this.src=\''+fallbackHeadshot(displayPlayer)+'\'"><img class="odds-team-badge" src="'+esc(logo)+'" alt="" loading="lazy" onerror="this.src=\''+fallbackTeamLogo(team)+'\'"></div>'+
        '<div class="prop-copy">'+
          '<div class="prop-player-line"><span class="prop-player-name">'+esc(displayPlayer)+'</span><span class="prop-divider">•</span><span class="prop-matchup">'+esc(row.matchup)+'</span></div>'+
          '<div class="prop-name">'+esc(proposition)+' '+alt+'</div>'+
        '</div>'+
      '</div>';

    return '<tr class="odds-row">'+
      '<td class="prop-cell">'+content+'</td>'+
      '<td class="odds-line">'+esc(formatLine(row.line))+'</td>'+
      '<td class="odds-price"><span class="fd-mini">FD</span>'+esc(formatAmerican(row.odds))+'</td>'+
      hitCell(row._rates.l5)+
      hitCell(row._rates.l10)+
      hitCell(row._rates.h2h)+
      hitCell(row._rates.current)+
      hitCell(row._rates.previous)+
    '</tr>';
  }).join("");
}

async function loadStats(){
  try{
    const res=await fetch("data/nfl-stats.json?v="+Date.now(),{cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    state.players=Array.isArray(data.players)?data.players:[];
    state.playerIndex=new Map(state.players.map(p=>[normalizeName(p.name),p]));
    state.season=data.season||null;
    state.statsUpdatedAt=data.updatedAt||null;
    render();
    if(state.odds.length) renderOdds();
    if(state.activeView==="stats") setView("stats",false);
  }catch(err){
    console.error(err);
    body.innerHTML='<tr><td colspan="8" class="empty-cell">Stats have not been generated yet. Run the “Update NFL Stats” GitHub Action once.</td></tr>';
  }
}

async function loadOdds(){
  try{
    const res=await fetch("data/nfl-odds.json?v="+Date.now(),{cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    state.oddsRaw=data;
    state.oddsUpdatedAt=data.updatedAt||null;
    const flattened=[];

    for(const event of data.events||[]){
      const away=event.awayAbbr||event.awayTeam||"AWAY";
      const home=event.homeAbbr||event.homeTeam||"HOME";
      const matchup=away+" @ "+home;
      for(const prop of event.props||[]){
        const cleanedPlayer=cleanDisplayPlayerName(prop.player);
        const profile=findPlayer(cleanedPlayer);
        flattened.push({
          ...prop,
          player:profile?.name||cleanedPlayer,
          team:prop.team||profile?.team||"",
          position:prop.position||profile?.position||"",
          headshot:prop.headshot||profile?.headshot||"",
          eventId:String(event.id||""),
          commenceTime:event.commenceTime||"",
          homeTeam:event.homeTeam||"",
          awayTeam:event.awayTeam||"",
          homeAbbr:event.homeAbbr||"",
          awayAbbr:event.awayAbbr||"",
          matchup
        });
      }
    }

    state.odds=flattened;
    const numericOdds=flattened.map(r=>Number(r.odds)).filter(Number.isFinite);
    state.availableOddsMin=numericOdds.length?Math.min(...numericOdds):null;
    state.availableOddsMax=numericOdds.length?Math.max(...numericOdds):null;
    state.oddsMin=null;
    state.oddsMax=null;
    updateFilterButtons();
    renderOdds();
    if(state.activeView==="odds") setView("odds",false);
  }catch(err){
    console.error(err);
    oddsBody.innerHTML='<tr><td colspan="8" class="odds-empty">Odds data is not available yet.</td></tr>';
    oddsCount.textContent="— props";
  }
}

search.addEventListener("input",e=>{state.query=e.target.value;render()});
document.querySelectorAll("#statsView th[data-key]").forEach(th=>th.addEventListener("click",()=>{
  const key=th.dataset.key;
  if(state.sortKey===key) state.sortDir=state.sortDir==="asc"?"desc":"asc";
  else{state.sortKey=key;state.sortDir=key==="name"?"asc":"desc"}
  render();
}));

body.addEventListener("click",e=>{
  const row=e.target.closest(".player-row");
  if(!row) return;
  const player=state.players.find(p=>String(p.id)===row.dataset.playerId);
  if(player) openPlayer(player);
});
body.addEventListener("keydown",e=>{
  if(!["Enter"," "].includes(e.key)) return;
  const row=e.target.closest(".player-row");
  if(!row) return;
  e.preventDefault();
  const player=state.players.find(p=>String(p.id)===row.dataset.playerId);
  if(player) openPlayer(player);
});

oddsSearch.addEventListener("input",e=>{state.oddsQuery=e.target.value;renderOdds()});
document.querySelectorAll(".odds-table th[data-odds-key]").forEach(th=>th.addEventListener("click",()=>{
  const key=th.dataset.oddsKey;
  if(state.oddsSortKey===key) state.oddsSortDir=state.oddsSortDir==="asc"?"desc":"asc";
  else{
    state.oddsSortKey=key;
    state.oddsSortDir=key==="player"?"asc":"desc";
  }
  renderOdds();
}));

gameFilterButton.addEventListener("click",()=>{renderGameFilters();gameFilterDialog.showModal()});
marketFilterButton.addEventListener("click",()=>{renderMarketFilters();marketFilterDialog.showModal()});
positionFilterButton.addEventListener("click",()=>{renderPositionFilter();positionFilterDialog.showModal()});
oddsRangeButton.addEventListener("click",()=>{syncOddsRangeControls();oddsRangeDialog.showModal()});

gameFilterOptions.addEventListener("click",e=>{
  const btn=e.target.closest("[data-game-id]");
  if(!btn) return;
  const id=btn.dataset.gameId;
  state.selectedGames.has(id)?state.selectedGames.delete(id):state.selectedGames.add(id);
  updateFilterButtons();
  renderOdds();
});
marketFilterOptions.addEventListener("click",e=>{
  const btn=e.target.closest("[data-market]");
  if(!btn) return;
  const market=btn.dataset.market;
  state.selectedMarkets.has(market)?state.selectedMarkets.delete(market):state.selectedMarkets.add(market);
  updateFilterButtons();
  renderOdds();
});
document.querySelectorAll("[data-clear-filter]").forEach(btn=>btn.addEventListener("click",()=>{
  if(btn.dataset.clearFilter==="games") state.selectedGames.clear();
  if(btn.dataset.clearFilter==="markets") state.selectedMarkets.clear();
  updateFilterButtons();
  renderOdds();
}));
document.querySelectorAll(".position-option").forEach(btn=>btn.addEventListener("click",()=>{
  state.oddsPosition=btn.dataset.position||"";
  updateFilterButtons();
  renderOdds();
}));
document.querySelectorAll("[data-close-filter]").forEach(btn=>btn.addEventListener("click",()=>{
  const dialog=btn.closest("dialog");
  if(dialog) dialog.close();
}));

function clampRanges(changed){
  let min=Number(oddsMinRange.value);
  let max=Number(oddsMaxRange.value);
  if(changed==="min"&&min>max){min=max;oddsMinRange.value=String(min)}
  if(changed==="max"&&max<min){max=min;oddsMaxRange.value=String(max)}
  oddsMinInput.value=String(min);
  oddsMaxInput.value=String(max);
  const lo=Number(oddsMinRange.min),hi=Number(oddsMinRange.max),span=Math.max(hi-lo,1);
  dualRangeFill.style.left=((min-lo)/span*100)+"%";
  dualRangeFill.style.width=((max-min)/span*100)+"%";
}
oddsMinRange.addEventListener("input",()=>clampRanges("min"));
oddsMaxRange.addEventListener("input",()=>clampRanges("max"));
oddsMinInput.addEventListener("input",()=>{oddsMinRange.value=oddsMinInput.value;clampRanges("min")});
oddsMaxInput.addEventListener("input",()=>{oddsMaxRange.value=oddsMaxInput.value;clampRanges("max")});
resetOddsRange.addEventListener("click",()=>{
  state.oddsMin=null;state.oddsMax=null;
  syncOddsRangeControls();
});
applyOddsRange.addEventListener("click",()=>{
  const min=Number(oddsMinInput.value),max=Number(oddsMaxInput.value);
  const fullMin=state.availableOddsMin,fullMax=state.availableOddsMax;
  state.oddsMin=Number.isFinite(min)&&min!==fullMin?Math.min(min,max):null;
  state.oddsMax=Number.isFinite(max)&&max!==fullMax?Math.max(min,max):null;
  updateFilterButtons();
  renderOdds();
  oddsRangeDialog.close();
});
clearFiltersButton.addEventListener("click",()=>{
  state.selectedGames.clear();
  state.selectedMarkets.clear();
  state.oddsPosition="";
  state.oddsMin=null;
  state.oddsMax=null;
  updateFilterButtons();
  renderOdds();
});

for(const dialog of [gameFilterDialog,marketFilterDialog,positionFilterDialog,oddsRangeDialog]){
  dialog.addEventListener("click",e=>{if(e.target===dialog) dialog.close()});
}

statsTabButton.addEventListener("click",()=>setView("stats"));
oddsTabButton.addEventListener("click",()=>setView("odds"));
window.addEventListener("hashchange",()=>setView(location.hash==="#odds"?"odds":"stats",false));

modalClose.addEventListener("click",closeModal);
modal.addEventListener("click",e=>{if(e.target===modal) closeModal()});
modalSeasonSelect.addEventListener("change",renderModalSeason);

setView(location.hash==="#odds"?"odds":"stats",false);
Promise.all([loadStats(),loadOdds()]);