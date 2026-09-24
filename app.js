const state={
  players:[],
  playerIndex:new Map(),
  query:"",
  sortKey:"allPurposeYards",
  sortDir:"desc",
  season:null,
  statsUpdatedAt:null,
  teamStatsRaw:null,
  teamStats:[],
  teamViews:[],
  teamView:"overview",
  teamQuery:"",
  teamStatQuery:"",
  teamSortKey:"derived.pointsPerGame",
  teamSortDir:"desc",
  teamStatsUpdatedAt:null,
  teamModalTeam:null,
  teamModalStat:null,
  teamChartMode:"trend",
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
  modalPlayer:null,
  hitRateRows:new Map(),
  hitRateActiveRow:null,
  hitRateActiveSplit:null,
  parlayOpen:false,
  parlayLegs:[],
  parlayRows:new Map(),
  hitRateCache:new Map(),
  opponentRankCache:new Map(),
  oddsSortedRows:[],
  oddsRenderedCount:0,
  oddsRenderBatch:140,
  oddsRenderVersion:0
};

const body=document.getElementById("statsBody");
const search=document.getElementById("searchInput");
const count=document.getElementById("recordCount");
const seasonLabel=document.getElementById("seasonLabel");
const updatedLabel=document.getElementById("updatedLabel");
const pageFooter=document.getElementById("pageFooter");
const statsView=document.getElementById("statsView");
const teamStatsView=document.getElementById("teamStatsView");
const oddsView=document.getElementById("oddsView");
const statsTabButton=document.getElementById("statsTabButton");
const teamStatsTabButton=document.getElementById("teamStatsTabButton");
const oddsTabButton=document.getElementById("oddsTabButton");

const teamSearch=document.getElementById("teamSearchInput");
const teamRecordCount=document.getElementById("teamRecordCount");
const teamViewButtons=document.getElementById("teamViewButtons");
const teamStatSearchInput=document.getElementById("teamStatSearchInput");
const teamColumnCount=document.getElementById("teamColumnCount");
const teamLeaderStrip=document.getElementById("teamLeaderStrip");
const teamStatsHead=document.getElementById("teamStatsHead");
const teamStatsBody=document.getElementById("teamStatsBody");
const oddsBody=document.getElementById("oddsBody");
const oddsTableScroll=document.querySelector("#oddsView .odds-table-scroll");
const oddsSearch=document.getElementById("oddsSearchInput");
const oddsCount=document.getElementById("oddsCount");
const oddsWorkspace=document.getElementById("oddsWorkspace");
const parlayBuilderButton=document.getElementById("parlayBuilderButton");
const parlayBuilderCount=document.getElementById("parlayBuilderCount");
const parlayPanel=document.getElementById("parlayPanel");
const parlayCloseButton=document.getElementById("parlayCloseButton");
const parlayLegCount=document.getElementById("parlayLegCount");
const parlayCombinedOdds=document.getElementById("parlayCombinedOdds");
const parlayLegs=document.getElementById("parlayLegs");
const parlayFooterOdds=document.getElementById("parlayFooterOdds");
const parlayImpliedProbability=document.getElementById("parlayImpliedProbability");
const parlayClearButton=document.getElementById("parlayClearButton");

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

const hitRateModal=document.getElementById("hitRateModal");
const hitRateClose=document.getElementById("hitRateClose");
const hitRateTitle=document.getElementById("hitRateTitle");
const hitRateSubtitle=document.getElementById("hitRateSubtitle");
const hitRateSplitLabel=document.getElementById("hitRateSplitLabel");
const hitRateSelectedPct=document.getElementById("hitRateSelectedPct");
const hitRateSelectedRecord=document.getElementById("hitRateSelectedRecord");
const hitRateBreakdown=document.getElementById("hitRateBreakdown");
const hitRateAverage=document.getElementById("hitRateAverage");
const hitRateMedian=document.getElementById("hitRateMedian");
const hitRateChart=document.getElementById("hitRateChart");

const teamStatModal=document.getElementById("teamStatModal");
const teamStatModalClose=document.getElementById("teamStatModalClose");
const teamStatModalLogo=document.getElementById("teamStatModalLogo");
const teamStatModalEyebrow=document.getElementById("teamStatModalEyebrow");
const teamStatModalTitle=document.getElementById("teamStatModalTitle");
const teamStatModalMeta=document.getElementById("teamStatModalMeta");
const teamStatSummaryCards=document.getElementById("teamStatSummaryCards");
const teamTrendTab=document.getElementById("teamTrendTab");
const teamLeagueTab=document.getElementById("teamLeagueTab");
const teamStatChart=document.getElementById("teamStatChart");

const fmt=new Intl.NumberFormat("en-US");
const ODDS_SLIDER_MIN=-5000;
const ODDS_SLIDER_MAX=5000;
const PARLAY_STORAGE_KEY="nflTrackerParlayV1";

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
  prop=prop.replace(/\bPass(?:ing)?\s*\+\s*Rush(?:ing)?\s+Yards\b/gi,"Passing + Rushing Yards");
  prop=prop.replace(/\s{2,}/g," ").trim().replace(/^[-:]+|[-:]+$/g,"").trim();
  return prop||String(row.market||"Player Prop");
}

function generalizedMarketLabel(row){
  const player=cleanDisplayPlayerName(row.player);
  let label=String(row.market||row.proposition||"Player Prop").trim();

  if(player){
    label=label.replace(new RegExp(escapeRegex(player),"ig")," ");
  }

  label=label
    .replace(/\bAlt\b/gi," ")
    .replace(/\s+-\s+/g," ")
    .replace(/\s{2,}/g," ")
    .trim();

  const lower=label.toLowerCase();
  const period=lower.includes("1h")?"1H ":lower.includes("1q")?"1Q ":"";

  if(/player to record a \d+(?:\.\d+)?\+ yard reception/i.test(label)){
    const match=label.match(/player to record a \d+(?:\.\d+)?\+ yard reception/i);
    return match?match[0].replace(/^player/i,"Player"):"Reception Milestone";
  }
  if(/any ?time touchdown scorer/.test(lower)) return "Any Time Touchdown Scorer";
  if(/first touchdown scorer/.test(lower)) return "First Touchdown Scorer";
  if(/last touchdown scorer/.test(lower)) return "Last Touchdown Scorer";
  if(/4th quarter td scorer/.test(lower)) return "Anytime 4th Quarter TD Scorer";
  if(/rush(?:ing)?\s*\+\s*receiv.*yards|rush.*receiv.*yards/.test(lower)) return period+"Rush + Rec Yards";
  if(/pass(?:ing)?\s*\+\s*rush(?:ing)?.*yards/.test(lower)) return period+"Passing + Rushing Yards";
  if(/receiving yards/.test(lower)) return period+"Receiving Yards";
  if(/rushing yards/.test(lower)) return period+"Rushing Yards";
  if(/passing yards/.test(lower)) return period+"Passing Yards";
  if(/total receptions|\breceptions\b/.test(lower)) return period+"Receptions";
  if(/rushing attempts|rush attempts/.test(lower)) return period+"Rushing Attempts";
  if(/passing attempts|pass attempts/.test(lower)) return period+"Passing Attempts";
  if(/pass completions|passing completions/.test(lower)) return period+"Passing Completions";
  if(/passing tds|passing touchdowns/.test(lower)) return period+"Passing TDs";
  if(/rushing tds|rushing touchdowns/.test(lower)) return period+"Rushing TDs";
  if(/receiving tds|receiving touchdowns/.test(lower)) return period+"Receiving TDs";
  if(/longest reception/.test(lower)) return period+"Longest Reception";
  if(/longest rush/.test(lower)) return period+"Longest Rush";
  if(/longest completion|longest pass/.test(lower)) return period+"Longest Completion";
  if(/tackles.*assists/.test(lower)) return "Tackles + Assists";
  if(/solo tackles/.test(lower)) return "Solo Tackles";
  if(/defensive interceptions/.test(lower)) return "Defensive Interceptions";
  if(/\bsacks\b/.test(lower)) return "Sacks";
  if(/field goals/.test(lower)) return "Field Goals";
  if(/kicking points/.test(lower)) return "Kicking Points";

  label=label
    .replace(/^\d+(?:\.\d+)?\+\s*(?:Yards?|Yds?)?\s*/i,"")
    .replace(/^[-:]+|[-:]+$/g,"")
    .trim();
  return label||"Player Prop";
}

function setView(view,updateHash=true){
  state.activeView=view==="odds"?"odds":view==="team-stats"?"team-stats":"stats";
  const isOdds=state.activeView==="odds";
  const isTeams=state.activeView==="team-stats";
  const isPlayers=!isOdds&&!isTeams;

  statsView.classList.toggle("active",isPlayers);
  teamStatsView.classList.toggle("active",isTeams);
  oddsView.classList.toggle("active",isOdds);

  statsTabButton.classList.toggle("active",isPlayers);
  teamStatsTabButton.classList.toggle("active",isTeams);
  oddsTabButton.classList.toggle("active",isOdds);

  statsTabButton.setAttribute("aria-selected",String(isPlayers));
  teamStatsTabButton.setAttribute("aria-selected",String(isTeams));
  oddsTabButton.setAttribute("aria-selected",String(isOdds));

  if(isOdds){
    seasonLabel.textContent="FanDuel Player Props";
    updatedLabel.textContent=formatUpdated(state.oddsUpdatedAt);
    pageFooter.innerHTML="<span>Odds read directly from FanDuel’s public sportsbook web feed.</span><span>Hit rates use ESPN regular-season game logs • “—” means the split is not applicable or unavailable.</span>";
  }else if(isTeams){
    seasonLabel.textContent=(state.teamStatsRaw?.season||state.season||"Current")+" Team Stats";
    updatedLabel.textContent=formatUpdated(state.teamStatsUpdatedAt);
    pageFooter.innerHTML="<span>Team stats sourced from ESPN season statistics and game box scores.</span><span>Click any numeric stat to open its game trend and league comparison chart.</span>";
  }else{
    seasonLabel.textContent=(state.season||"Current")+" Regular Season";
    updatedLabel.textContent=formatUpdated(state.statsUpdatedAt);
    pageFooter.innerHTML="<span>Player stats sourced from ESPN.</span><span>Click a player for their game log • Click a column heading to sort.</span>";
  }

  if(updateHash){
    const hash=isOdds?"#odds":isTeams?"#teams":"#stats";
    history.replaceState(null,"",hash);
  }
}

function rebuildUsageShares(){
  const totals=new Map();
  const own=new Map();
  for(const p of state.players){
    const team=String(p.team||"").toUpperCase();
    let targets=0,carries=0;
    for(const g of p.gameLog||[]){
      if(!g||!g.played) continue;
      targets+=safe(g.receivingTargets);
      carries+=safe(g.rushingAttempts);
    }
    own.set(String(p.id),{targets,carries});
    if(team){
      const t=totals.get(team)||{targets:0,carries:0};
      t.targets+=targets;t.carries+=carries;totals.set(team,t);
    }
  }
  for(const p of state.players){
    const o=own.get(String(p.id))||{targets:0,carries:0};
    const t=totals.get(String(p.team||"").toUpperCase())||{targets:0,carries:0};
    p.targetShare=t.targets?100*o.targets/t.targets:0;
    p.carryShare=t.carries?100*o.carries/t.carries:0;
    p.opportunityShare=(t.targets+t.carries)?100*(o.targets+o.carries)/(t.targets+t.carries):0;
  }
}
function usagePct(value){
  return Number.isFinite(Number(value))?(Math.round(Number(value)*10)/10).toFixed(1)+"%":"—";
}

function render(){
  const q=state.query.trim().toLowerCase();
  let rows=state.players.filter(p=>(!p.oddsOnly||String(p.position||"").toUpperCase()==="K")&&(!q||[p.name,p.team,p.position].some(v=>String(v||"").toLowerCase().includes(q))));
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
    body.innerHTML='<tr><td colspan="13" class="empty-cell">No players match that search.</td></tr>';
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
      '<td>'+fmt.format(safe(p.passRushYards??(safe(p.passingYards)+safe(p.rushingYards))))+'</td>'+
      '<td>'+fmt.format(safe(p.kickingPoints))+'</td>'+
      '<td>'+fmt.format(safe(p.receivingYards))+'</td>'+
      '<td>'+fmt.format(safe(p.rushingYards))+'</td>'+
      '<td>'+fmt.format(safe(p.receptions))+'</td>'+
      '<td>'+usagePct(p.targetShare)+'</td>'+
      '<td>'+usagePct(p.carryShare)+'</td>'+
      '<td>'+usagePct(p.opportunityShare)+'</td>'+
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
    gameLogBody.innerHTML='<tr><td colspan="11" class="modal-empty">No regular-season game log is available for '+esc(season)+'.</td></tr>';
    return;
  }

  gameLogBody.innerHTML=logs.map(game=>
    '<tr class="'+(game.played?"":"no-game-row")+'">'+
      '<td class="week-cell">Week '+esc(game.week)+'</td>'+
      '<td class="opponent-cell">'+opponentHtml(game)+'</td>'+
      '<td class="stat-strong">'+gameStat(game,"touchdowns")+'</td>'+
      '<td class="all-purpose">'+gameStat(game,"allPurposeYards")+'</td>'+
      '<td>'+gameStat(game,"passRushYards")+'</td>'+
      '<td>'+gameStat(game,"kickingPoints")+'</td>'+
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

  if(/first touchdown scorer|last touchdown scorer|quarter td scorer|\b(?:1q|2q|3q|4q|1h|2h)\b|\bquarter\b|\bhalf\b|\bdrive\b|\bmost\s+(?:rushing|receiving|passing)\s+yards\b/.test(text)) return null;

  const receptionMilestone=text.match(/(?:record a |record |)(\d+(?:\.\d+)?)\+ yard reception/);
  if(receptionMilestone) return {metric:"receivingLongest",threshold:Number(receptionMilestone[1]),comparison:"gte"};

  const tdMilestone=text.match(/(?:score |)(\d+(?:\.\d+)?)\+ touchdowns?/);
  if(tdMilestone) return {metric:"touchdowns",threshold:Number(tdMilestone[1]),comparison:"gte"};

  if(/any time touchdown scorer|anytime touchdown scorer/.test(text)) return {metric:"touchdowns",threshold:1,comparison:"gte"};
  if(/pass \+ rush \+ rec.*yards|pass.*rush.*reception.*yards/.test(text)) return {metric:"passRushRecYards"};
  if(/pass(?:ing)? \+ rush(?:ing)?.*yards/.test(text)) return {metric:"passRushYards"};
  if(/rush(?:ing)? \+ receiv.*yards|rush.*receiv.*yards/.test(text)) return {metric:"allPurposeYards"};
  if(/passing yards/.test(text)) return {metric:"passingYards"};
  if(/receiving yards/.test(text)) return {metric:"receivingYards"};
  if(/rushing yards/.test(text)) return {metric:"rushingYards"};
  if(/receptions/.test(text)&&!/longest/.test(text)) return {metric:"receptions"};
  if(/passing tds|passing touchdowns/.test(text)) return {metric:"passingTouchdowns"};
  if(/receiving tds|receiving touchdowns/.test(text)) return {metric:"receivingTouchdowns"};
  if(/rushing tds|rushing touchdowns/.test(text)) return {metric:"rushingTouchdowns"};
  if(/rushing attempts|rush attempts/.test(text)) return {metric:"rushingAttempts"};
  if(/pass attempts|passing attempts/.test(text)) return {metric:"passingAttempts"};
  if(/pass completions|passing completions/.test(text)) return {metric:"passingCompletions"};
  if(/interceptions thrown|pass interceptions/.test(text)) return {metric:"passingInterceptions"};
  if(/longest completion|longest pass/.test(text)) return {metric:"passingLongest"};
  if(/longest reception/.test(text)) return {metric:"receivingLongest"};
  if(/longest rush/.test(text)) return {metric:"rushingLongest"};
  if(/solo tackles/.test(text)) return {metric:"soloTackles"};
  if(/tackles \+ assists/.test(text)) return {metric:"totalTackles"};
  if(/(?:player\s+)?to record a sack|\brecord a sack\b/.test(text)) return {metric:"sacks",threshold:1,comparison:"gte"};
  if(/\bsacks\b/.test(text)) return {metric:"sacks"};
  if(/defensive interceptions/.test(text)) return {metric:"defensiveInterceptions"};
  if(/field goals/.test(text)) return {metric:"fieldGoalsMade"};
  if(/kicking points/.test(text)) return {metric:"kickingPoints"};
  if(/^touchdowns?$/.test(market.trim())||/ total touchdowns/.test(text)) return {metric:"touchdowns"};
  return null;
}
function canonicalPropCategory(row){
  const spec=metricSpec(row);
  if(!spec) return "";
  const labels={
    touchdowns:"Touchdowns",
    passRushRecYards:"Passing + Rushing + Receiving Yards",
    passRushYards:"Passing + Rushing Yards",
    allPurposeYards:"Rushing + Receiving Yards",
    passingYards:"Passing Yards",
    receivingYards:"Receiving Yards",
    rushingYards:"Rushing Yards",
    receptions:"Receptions",
    passingTouchdowns:"Passing TDs",
    receivingTouchdowns:"Receiving TDs",
    rushingTouchdowns:"Rushing TDs",
    rushingAttempts:"Rushing Attempts",
    passingAttempts:"Passing Attempts",
    passingCompletions:"Passing Completions",
    passingInterceptions:"Interceptions Thrown",
    passingLongest:"Longest Completion",
    receivingLongest:"Longest Reception",
    rushingLongest:"Longest Rush",
    soloTackles:"Solo Tackles",
    totalTackles:"Tackles + Assists",
    sacks:"Sacks",
    defensiveInterceptions:"Defensive Interceptions",
    fieldGoalsMade:"Field Goals",
    kickingPoints:"Kicking Points"
  };
  return labels[spec.metric]||"";
}
function metricValue(game,spec){
  if(!game||!spec) return null;
  if(spec.metric==="passRushYards") return safe(game.passingYards)+safe(game.rushingYards);
  if(spec.metric==="passRushRecYards") return safe(game.passingYards)+safe(game.rushingYards)+safe(game.receivingYards);
  if(spec.metric==="allPurposeYards") return safe(game.rushingYards)+safe(game.receivingYards);
  if(spec.metric==="touchdowns") return safe(game.rushingTouchdowns)+safe(game.receivingTouchdowns);
  const value=game[spec.metric];
  return Number.isFinite(Number(value))?Number(value):null;
}
function propHit(row,game){
  const spec=metricSpec(row);
  if(!spec) return null;
  const value=metricValue(game,spec);
  if(value===null) return null;

  if(spec.comparison==="gte") return value>=spec.threshold;

  if(row.line===null||row.line===undefined||row.line==="") return null;
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
function hitCell(rate,rowKey,split){
  if(!rate) return '<td class="hit-cell hit-na">-</td>';
  const cls=rate.pct>=70?"hit-good":rate.pct>=50?"hit-mid":"hit-low";
  return '<td class="hit-cell hit-rate-trigger '+cls+'" data-hit-key="'+esc(rowKey)+'" data-hit-split="'+esc(split)+'" tabindex="0" role="button" title="View '+rate.hits+' of '+rate.total+' games">'+rate.pct+'%</td>';
}

function splitLabel(split){
  return {l5:"Last 5",l10:"Last 10",h2h:"Head-to-Head",current:String(state.season||2026),previous:String((state.season||2026)-1)}[split]||split;
}
function compareGamesChronologically(a,b){
  const at=Date.parse(a?.date||"");
  const bt=Date.parse(b?.date||"");
  if(Number.isFinite(at)&&Number.isFinite(bt)&&at!==bt) return at-bt;
  const as=Number(a?._season||state.season||0);
  const bs=Number(b?._season||state.season||0);
  if(as!==bs) return as-bs;
  return safe(a?.week)-safe(b?.week);
}
function splitGamesForRow(row,split){
  const player=findPlayer(row.player);
  if(!player) return [];

  const currentYear=Number(state.season||2026);
  const previousYear=currentYear-1;
  const all=playerPlayedLogs(player);
  let games=[];

  if(split==="l5") games=all.slice(0,5);
  else if(split==="l10") games=all.slice(0,10);
  else if(split==="h2h"){
    const opponent=opponentForRow(row,player);
    games=opponent?all.filter(g=>String(g.opponent?.abbreviation||"").toUpperCase()===opponent):[];
  }else if(split==="current"){
    games=logsForSeason(player,currentYear).filter(g=>g.played).map(g=>({...g,_season:currentYear}));
  }else if(split==="previous"){
    games=logsForSeason(player,previousYear).filter(g=>g.played).map(g=>({...g,_season:previousYear}));
  }

  const applicable=games.filter(game=>propHit(row,game)!==null);
  return applicable.sort(compareGamesChronologically);
}
function lineForRow(row){
  const spec=metricSpec(row);
  if(spec?.comparison==="gte"&&Number.isFinite(Number(spec.threshold))) return Number(spec.threshold);
  if(row.line===null||row.line===undefined||row.line==="") return null;
  const line=Number(row.line);
  return Number.isFinite(line)?line:null;
}
function median(values){
  if(!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
function chartDateLabel(game){
  const raw=game?.date;
  if(raw){
    const date=new Date(raw);
    if(!Number.isNaN(date.getTime())){
      return new Intl.DateTimeFormat("en-US",{month:"numeric",day:"numeric"}).format(date);
    }
  }
  return "W"+String(game?.week??"—");
}
function chartOpponentLabel(game){
  const abbr=game?.opponent?.abbreviation||"";
  if(!abbr) return "";
  return (game.isAway?"@ ":"vs ")+abbr;
}
function metricBreakdown(game,spec){
  if(!spec) return [];
  if(spec.metric==="passRushYards"){
    return [
      ["PASS YDS",safe(game.passingYards)],
      ["RUSH YDS",safe(game.rushingYards)]
    ];
  }
  if(spec.metric==="allPurposeYards"){
    return [
      ["RUSH YDS",safe(game.rushingYards)],
      ["REC YDS",safe(game.receivingYards)]
    ];
  }
  if(spec.metric==="passRushRecYards"){
    return [
      ["PASS YDS",safe(game.passingYards)],
      ["RUSH YDS",safe(game.rushingYards)],
      ["REC YDS",safe(game.receivingYards)]
    ];
  }
  return [];
}
function pctMarkup(rate,key,split,selected){
  const value=rate?rate.pct+"%":"-";
  const cls=!rate?"hit-na-text":rate.pct>=70?"hit-good-text":rate.pct>=50?"hit-mid-text":"hit-low-text";
  const disabled=rate?"":" disabled aria-disabled=\"true\"";
  return '<button type="button" class="hit-summary-item '+(selected?"selected":"")+'" data-chart-split="'+esc(split)+'"'+disabled+'>'+
    '<span>'+esc(key)+'</span><strong class="'+cls+'">'+value+'</strong>'+
  '</button>';
}
function defenseRankMapFor(season,week,position,spec){
  if(!spec||!position) return new Map();
  const key=[season,week,position,spec.metric].join("|");
  if(state.opponentRankCache.has(key)) return state.opponentRankCache.get(key);

  const totals=new Map();
  for(const p of state.players){
    if(String(p.position||"").toUpperCase()!==String(position).toUpperCase()) continue;
    for(const game of logsForSeason(p,season)){
      if(!game||!game.played||safe(game.week)>=week) continue;
      const defense=String(game.opponent?.abbreviation||"").toUpperCase();
      const value=metricValue(game,spec);
      if(!defense||value===null) continue;
      if(!totals.has(defense)) totals.set(defense,new Map());
      const byWeek=totals.get(defense);
      const gameWeek=safe(game.week);
      byWeek.set(gameWeek,(byWeek.get(gameWeek)||0)+value);
    }
  }

  const rows=[];
  for(const [team,byWeek] of totals){
    const values=[...byWeek.values()];
    if(values.length<2) continue;
    rows.push({team,value:values.reduce((s,v)=>s+v,0)/values.length,games:values.length});
  }
  rows.sort((a,b)=>a.value-b.value);
  const result=new Map();
  rows.forEach((item,index)=>result.set(item.team,{rank:index+1,total:rows.length,value:item.value,games:item.games}));
  state.opponentRankCache.set(key,result);
  return result;
}
function opponentRankForGame(player,game,spec){
  if(!player||!game||!spec)return null;
  const season=Number(game._season||state.season),week=Math.max(1,safe(game.week));
  const opponent=String(game.opponent?.abbreviation||"").toUpperCase();
  if(!opponent)return null;
  let info=defenseRankMapFor(season,week,String(player.position||"").toUpperCase(),spec).get(opponent)||null;
  if(!info&&season>2020){
    info=defenseRankMapFor(season-1,99,String(player.position||"").toUpperCase(),spec).get(opponent)||null;
    if(info) info={...info,priorSeason:true};
  }
  return info;
}
function hitBarTooltip(game,row,value,rankInfo){
  const opp=game?.opponent||{},abbr=opp.abbreviation||opp.name||"OPP";
  const logo=opp.logo||fallbackTeamLogo(abbr);
  const rank=rankInfo?"#"+rankInfo.rank:"—";
  const allowed=rankInfo?(Math.round(rankInfo.value*10)/10).toLocaleString():"—";
  const season=game?._season||state.season||"";
  return '<div class="hit-bar-tooltip">'+
    '<div class="hit-tooltip-date">'+esc(chartDateLabel(game))+' • '+esc(season)+'</div>'+
    '<div class="hit-tooltip-matchup"><img src="'+esc(logo)+'" alt=""><span>'+esc(game?.isAway?"@ ":"vs ")+esc(abbr)+'</span><b>'+esc(game?.score||"")+'</b></div>'+
    '<div class="hit-tooltip-stat"><span>'+esc(generalizedMarketLabel(row))+'</span><strong>'+fmt.format(value)+'</strong></div>'+
    '<div class="hit-tooltip-rank"><span>Opp Rank</span><strong>'+rank+'</strong><small>'+allowed+' allowed / game'+(rankInfo?.priorSeason?" • prior season":"")+'</small></div>'+
  '</div>';
}
function renderHitRateChart(row,split){
  state.hitRateActiveRow=row;
  state.hitRateActiveSplit=split;
  const player=findPlayer(row.player);
  const games=splitGamesForRow(row,split);
  const rates=computeHitRates(row);
  const selectedRate={l5:rates.l5,l10:rates.l10,h2h:rates.h2h,current:rates.current,previous:rates.previous}[split]||null;
  const spec=metricSpec(row);
  const line=lineForRow(row);
  const values=games.map(game=>metricValue(game,spec)).filter(v=>v!==null);
  const average=values.length?values.reduce((sum,v)=>sum+v,0)/values.length:null;
  const med=median(values);

  hitRateTitle.textContent=cleanDisplayPlayerName(row.player)+" - "+generalizedMarketLabel(row);
  hitRateSubtitle.innerHTML=esc(cleanDisplayProposition(row))+" • "+esc(row.matchup)+" <span class=\"hit-rate-odds\">"+formatAmerican(row.odds)+"</span>";
  hitRateSplitLabel.textContent=splitLabel(split);
  hitRateSelectedPct.textContent=selectedRate?selectedRate.pct+"%":"—";
  hitRateSelectedPct.className=!selectedRate?"":selectedRate.pct>=70?"hit-good-text":selectedRate.pct>=50?"hit-mid-text":"hit-low-text";
  hitRateSelectedRecord.textContent=selectedRate?" "+selectedRate.hits+" of "+selectedRate.total:"";
  hitRateAverage.textContent=average===null?"—":(Math.round(average*10)/10).toLocaleString();
  hitRateMedian.textContent=med===null?"—":(Math.round(med*10)/10).toLocaleString();

  const currentYear=String(state.season||2026);
  const previousYear=String((state.season||2026)-1);
  hitRateBreakdown.innerHTML=[
    pctMarkup(rates.l5,"L5","l5",split==="l5"),
    pctMarkup(rates.l10,"L10","l10",split==="l10"),
    pctMarkup(rates.h2h,"H2H","h2h",split==="h2h"),
    pctMarkup(rates.current,currentYear,"current",split==="current"),
    pctMarkup(rates.previous,previousYear,"previous",split==="previous")
  ].join("");

  if(!games.length||!spec){
    hitRateChart.innerHTML='<div class="hit-chart-empty">No applicable game-by-game data is available for this prop.</div>';
    return;
  }

  const maxValue=Math.max(...values,0);
  const minValue=Math.min(...values,0);
  const positiveLine=line===null?0:Math.max(line,0);
  const chartMax=Math.max(1,maxValue,positiveLine)*1.16;
  const chartMin=Math.min(0,minValue);
  const chartSpan=Math.max(1,chartMax-chartMin);
  const linePct=line===null?null:Math.max(0,Math.min(100,((line-chartMin)/chartSpan)*100));
  const plotWidth=Math.max(680,games.length*92);
  const stageHeight=286;
  const thresholdBottom=linePct===null?null:48+(linePct/100)*stageHeight;

  const bars=games.map((game,index)=>{
    const value=metricValue(game,spec);
    const hit=propHit(row,game);
    const height=Math.max(2,((value-chartMin)/chartSpan)*100);
    const valueBottom=48+(height/100)*stageHeight;
    const breakdown=metricBreakdown(game,spec).filter(([,v])=>v!==0);
    const detail=breakdown.length
      ? '<div class="hit-bar-detail">'+breakdown.map(([label,v])=>'<span><b>'+fmt.format(v)+'</b> '+label+'</span>').join("")+'</div>'
      : "";
    const rankInfo=opponentRankForGame(player,game,spec);
    const rankBadge=rankInfo?'<span class="hit-opp-rank">Opp #'+rankInfo.rank+'</span>':"";
    return '<div class="hit-bar-column" tabindex="0">'+
      '<div class="hit-bar-value '+(hit?"hit":"miss")+'" style="bottom:'+valueBottom+'px">'+fmt.format(value)+'</div>'+
      '<div class="hit-bar-track">'+
        '<div class="hit-bar '+(hit?"hit":"miss")+'" style="height:'+height+'%;--bar-delay:'+(index*45)+'ms">'+detail+'</div>'+
      '</div>'+
      '<div class="hit-bar-label"><span>'+esc(chartDateLabel(game))+'</span><span>'+esc(chartOpponentLabel(game))+'</span>'+rankBadge+'</div>'+
      hitBarTooltip(game,row,value,rankInfo)+
    '</div>';
  }).join("");

  const threshold=thresholdBottom===null?"":'<div class="hit-threshold" style="bottom:'+thresholdBottom+'px"><span>'+esc(formatLine(line))+'</span></div>';
  hitRateChart.innerHTML='<div class="hit-chart-plot" style="width:'+plotWidth+'px">'+threshold+'<div class="hit-bars">'+bars+'</div></div>';
}
function openHitRateChart(row,split){
  state.hitRateActiveRow=row;
  state.hitRateActiveSplit=split;
  renderHitRateChart(row,split);
  hitRateModal.showModal();
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
  const markets=[...new Set(state.odds.map(row=>row._marketLabel||canonicalPropCategory(row)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
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
function clampToSlider(value){
  return Math.max(ODDS_SLIDER_MIN,Math.min(ODDS_SLIDER_MAX,value));
}
function paintOddsRange(){
  const min=Number(oddsMinRange.value);
  const max=Number(oddsMaxRange.value);
  const span=ODDS_SLIDER_MAX-ODDS_SLIDER_MIN;
  const left=((min-ODDS_SLIDER_MIN)/span)*100;
  const right=((max-ODDS_SLIDER_MIN)/span)*100;
  dualRangeFill.style.left=left+"%";
  dualRangeFill.style.width=Math.max(0,right-left)+"%";
}
function syncOddsRangeControls(){
  const selectedMin=state.oddsMin??ODDS_SLIDER_MIN;
  const selectedMax=state.oddsMax??ODDS_SLIDER_MAX;

  for(const input of [oddsMinRange,oddsMaxRange]){
    input.min=String(ODDS_SLIDER_MIN);
    input.max=String(ODDS_SLIDER_MAX);
    input.step="1";
  }

  oddsMinInput.value=String(selectedMin);
  oddsMaxInput.value=String(selectedMax);
  oddsMinRange.value=String(clampToSlider(selectedMin));
  oddsMaxRange.value=String(clampToSlider(selectedMax));
  paintOddsRange();

  const changed=state.oddsMin!==null||state.oddsMax!==null;
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


function parlayKeyFor(row){
  if(row?._parlayKey) return row._parlayKey;
  return [
    row.eventId||"",
    cleanDisplayPlayerName(row.player||""),
    row.market||"",
    row.selection||"",
    row.line??"",
    row.proposition||""
  ].join("¦");
}
function getHitRates(row){
  if(!metricSpec(row)) return {l5:null,l10:null,h2h:null,current:null,previous:null};
  if(row?.hitRates) return row.hitRates;
  const key=parlayKeyFor(row);
  if(state.hitRateCache.has(key)) return state.hitRateCache.get(key);
  const player=findPlayer(row.player);
  if(!player) return {l5:null,l10:null,h2h:null,current:null,previous:null};
  const rates=computeHitRates(row);
  state.hitRateCache.set(key,rates);
  return rates;
}
function parlaySnapshot(row){
  return {
    key:parlayKeyFor(row),
    eventId:String(row.eventId||""),
    player:cleanDisplayPlayerName(row.player||""),
    team:row.team||"",
    headshot:row.headshot||"",
    matchup:row.matchup||"",
    awayAbbr:row.awayAbbr||"",
    homeAbbr:row.homeAbbr||"",
    market:row.market||"",
    proposition:row.proposition||"",
    selection:row.selection||"",
    line:row.line??null,
    odds:Number(row.odds),
    decimalOdds:Number(row.decimalOdds)>1?Number(row.decimalOdds):null,
    alternate:Boolean(row.alternate),
    available:true
  };
}
function saveParlay(){
  try{
    localStorage.setItem(PARLAY_STORAGE_KEY,JSON.stringify(state.parlayLegs));
  }catch(err){
    console.warn("Could not save parlay slip",err);
  }
}
function loadSavedParlay(){
  try{
    const parsed=JSON.parse(localStorage.getItem(PARLAY_STORAGE_KEY)||"[]");
    state.parlayLegs=Array.isArray(parsed)?parsed.filter(leg=>leg&&leg.key):[];
  }catch(err){
    state.parlayLegs=[];
  }
}
function reconcileParlay(){
  if(!state.parlayLegs.length) return;
  const current=new Map(state.odds.map(row=>[parlayKeyFor(row),row]));
  state.parlayLegs=state.parlayLegs.map(leg=>{
    const row=current.get(leg.key);
    return row?parlaySnapshot(row):{...leg,available:false};
  });
  saveParlay();
}
function americanToDecimal(odds){
  const n=Number(odds);
  if(!Number.isFinite(n)||n===0) return null;
  return n>0?1+n/100:1+100/Math.abs(n);
}
function decimalToAmerican(decimal){
  const d=Number(decimal);
  if(!Number.isFinite(d)||d<=1) return null;
  return d>=2?Math.round((d-1)*100):Math.round(-100/(d-1));
}
function combinedParlayDecimal(){
  if(!state.parlayLegs.length) return null;
  let product=1;
  for(const leg of state.parlayLegs){
    if(leg.available===false) return null;
    const exact=Number(leg.decimalOdds);
    const decimal=Number.isFinite(exact)&&exact>1?exact:americanToDecimal(leg.odds);
    if(decimal===null) return null;
    product*=decimal;
  }
  return product;
}
function parlayHas(key){
  return state.parlayLegs.some(leg=>leg.key===key);
}
function toggleParlayLeg(row){
  const key=parlayKeyFor(row);
  const index=state.parlayLegs.findIndex(leg=>leg.key===key);
  if(index>=0) state.parlayLegs.splice(index,1);
  else state.parlayLegs.push(parlaySnapshot(row));
  saveParlay();
  renderParlay();
  syncVisibleParlayStates();
}
function removeParlayLeg(key){
  state.parlayLegs=state.parlayLegs.filter(leg=>leg.key!==key);
  saveParlay();
  renderParlay();
  syncVisibleParlayStates();
}
function syncVisibleParlayStates(){
  document.querySelectorAll(".parlay-add-button[data-parlay-key]").forEach(button=>{
    const selected=parlayHas(button.dataset.parlayKey);
    button.classList.toggle("selected",selected);
    button.textContent=selected?"✓":"+";
    button.setAttribute("aria-pressed",String(selected));
    const row=button.closest(".odds-row");
    if(row) row.classList.toggle("parlay-selected",selected);
  });
}
function setParlayOpen(open){
  state.parlayOpen=Boolean(open);
  oddsWorkspace.classList.toggle("parlay-mode",state.parlayOpen);
  parlayPanel.classList.toggle("open",state.parlayOpen);
  parlayPanel.setAttribute("aria-hidden",String(!state.parlayOpen));
  parlayBuilderButton.classList.toggle("active",state.parlayOpen);
  parlayBuilderButton.setAttribute("aria-expanded",String(state.parlayOpen));
  renderParlay();
  syncVisibleParlayStates();
}
function renderParlay(){
  const count=state.parlayLegs.length;
  parlayBuilderCount.hidden=count===0;
  parlayBuilderCount.textContent=String(count);
  parlayLegCount.textContent=count+" leg"+(count===1?"":"s");
  parlayClearButton.disabled=count===0;

  const combinedDecimal=combinedParlayDecimal();
  const combinedAmerican=decimalToAmerican(combinedDecimal);
  const combinedText=combinedAmerican===null?"—":formatAmerican(combinedAmerican);
  parlayCombinedOdds.textContent=combinedText;
  parlayFooterOdds.textContent=combinedText;
  parlayImpliedProbability.textContent=combinedDecimal?((100/combinedDecimal).toFixed(1)+"%"):"—";

  if(!count){
    parlayLegs.innerHTML=
      '<div class="parlay-empty">'+
        '<div class="parlay-empty-icon">+</div>'+
        '<strong>Build your parlay</strong>'+
        '<span>Use the + buttons beside player props to add legs.</span>'+
      '</div>';
    return;
  }

  const groups=new Map();
  for(const leg of state.parlayLegs){
    const groupKey=leg.eventId||leg.matchup||"other";
    if(!groups.has(groupKey)) groups.set(groupKey,[]);
    groups.get(groupKey).push(leg);
  }

  parlayLegs.innerHTML=[...groups.values()].map(legs=>{
    const first=legs[0];
    const away=first.awayAbbr||String(first.matchup||"").split(" @ ")[0]||"";
    const home=first.homeAbbr||String(first.matchup||"").split(" @ ")[1]||"";
    const matchup=first.matchup||[away,home].filter(Boolean).join(" @ ");
    const logos=(away||home)
      ? '<span class="parlay-matchup-logos">'+
          (away?'<img src="'+esc(teamLogo(away))+'" alt="">':"")+
          (home?'<img src="'+esc(teamLogo(home))+'" alt="">':"")+
        '</span>'
      : "";
    return '<section class="parlay-game-group">'+
      '<div class="parlay-game-heading">'+logos+'<strong>'+esc(matchup||"NFL")+'</strong></div>'+
      legs.map(leg=>{
        const player=cleanDisplayPlayerName(leg.player);
        const profile=findPlayer(player);
        const headshot=leg.headshot||profile?.headshot||fallbackHeadshot(player);
        const proposition=cleanDisplayProposition({...leg,player});
        return '<article class="parlay-leg '+(leg.available===false?"unavailable":"")+'">'+
          '<img class="parlay-leg-headshot" src="'+esc(headshot)+'" alt="" onerror="this.src=\''+fallbackHeadshot(player)+'\'">'+
          '<div class="parlay-leg-copy">'+
            '<strong>'+esc(player)+'</strong>'+
            '<span>'+esc(proposition)+'</span>'+
            '<small><b>FD</b> '+esc(leg.available===false?"Unavailable":formatAmerican(leg.odds))+'</small>'+
          '</div>'+
          '<button class="parlay-remove-leg" type="button" data-parlay-remove="'+esc(leg.key)+'" aria-label="Remove '+esc(player)+' from parlay">×</button>'+
        '</article>';
      }).join("")+
    '</section>';
  }).join("");
}

function oddsRowPassesFilters(row){
  if(state.selectedGames.size&&!state.selectedGames.has(row.eventId)) return false;
  const category=row._marketLabel||canonicalPropCategory(row);
  if(!category) return false;
  if(state.selectedMarkets.size&&!state.selectedMarkets.has(category)) return false;
  if(state.oddsPosition&&row.selection!==state.oddsPosition) return false;
  const odds=Number(row.odds);
  const minOdds=state.oddsMin??ODDS_SLIDER_MIN;
  const maxOdds=state.oddsMax??ODDS_SLIDER_MAX;
  if(Number.isFinite(odds)&&odds<minOdds) return false;
  if(Number.isFinite(odds)&&odds>maxOdds) return false;

  const q=state.oddsQuery.trim().toLowerCase();
  if(q&&!(row._searchText||"").includes(q)) return false;
  return true;
}


function hitSortPct(row,key){
  return getHitRates(row)?.[key]?.pct??null;
}
function oddsRowHtml(row,index){
  const hitRowKey=parlayKeyFor(row);
  state.hitRateRows.set(hitRowKey,row);
  state.parlayRows.set(hitRowKey,row);

  const profile=findPlayer(row.player);
  const displayPlayer=row._displayPlayer||cleanDisplayPlayerName(row.player||profile?.name);
  const team=row.team||profile?.team||"";
  const headshot=row.headshot||profile?.headshot||fallbackHeadshot(displayPlayer);
  const logo=teamLogo(team);
  const alt=row.alternate?'<span class="alt-badge">ALT</span>':'';
  const proposition=row._displayProposition||cleanDisplayProposition({...row,player:displayPlayer});
  const playerAttr=esc(displayPlayer);
  const selectedInParlay=parlayHas(hitRowKey);
  const rates=getHitRates(row);

  const addButton=
    '<button type="button" class="parlay-add-button '+(selectedInParlay?"selected":"")+'" data-parlay-key="'+esc(hitRowKey)+'" aria-pressed="'+String(selectedInParlay)+'" aria-label="'+(selectedInParlay?"Remove":"Add")+' '+playerAttr+' '+esc(proposition)+' '+(selectedInParlay?"from":"to")+' parlay">'+(selectedInParlay?"✓":"+")+'</button>';

  const content=
    '<div class="prop-player-visual">'+
      addButton+
      '<div class="odds-headshot-wrap"><img class="odds-headshot" src="'+esc(headshot)+'" alt="" loading="lazy" decoding="async" onerror="this.src=\''+fallbackHeadshot(displayPlayer)+'\'"><img class="odds-team-badge" src="'+esc(logo)+'" alt="" loading="lazy" decoding="async" onerror="this.src=\''+fallbackTeamLogo(team)+'\'"></div>'+
      '<div class="prop-copy">'+
        '<div class="prop-player-line"><span class="prop-player-name">'+esc(displayPlayer)+'</span><span class="prop-divider">•</span><span class="prop-matchup">'+esc(row.matchup)+'</span></div>'+
        '<div class="prop-name">'+esc(proposition)+' '+alt+'</div>'+
      '</div>'+
    '</div>';

  return '<tr class="odds-row '+(selectedInParlay?"parlay-selected":"")+'">'+
    '<td class="prop-cell odds-player-trigger" data-player-name="'+playerAttr+'" tabindex="0" role="button" aria-label="Open '+playerAttr+' game log">'+content+'</td>'+
    '<td class="odds-line">'+esc(formatLine(row.line))+'</td>'+
    '<td class="odds-price"><span class="fd-mini">FD</span>'+esc(formatAmerican(row.odds))+'</td>'+
    hitCell(rates.l5,hitRowKey,"l5")+
    hitCell(rates.l10,hitRowKey,"l10")+
    hitCell(rates.h2h,hitRowKey,"h2h")+
    hitCell(rates.current,hitRowKey,"current")+
    hitCell(rates.previous,hitRowKey,"previous")+
  '</tr>';
}
function appendOddsRows(){
  const start=state.oddsRenderedCount;
  if(start>=state.oddsSortedRows.length) return;
  const end=Math.min(start+state.oddsRenderBatch,state.oddsSortedRows.length);
  const html=state.oddsSortedRows.slice(start,end).map((row,i)=>oddsRowHtml(row,start+i)).join("");
  const sentinel=document.getElementById("oddsLoadMoreRow");
  if(sentinel) sentinel.insertAdjacentHTML("beforebegin",html);
  else oddsBody.insertAdjacentHTML("beforeend",html);
  state.oddsRenderedCount=end;

  const remaining=state.oddsSortedRows.length-end;
  const currentSentinel=document.getElementById("oddsLoadMoreRow");
  if(currentSentinel){
    if(remaining>0){
      currentSentinel.innerHTML='<td colspan="8" class="odds-load-more">Scroll to load '+fmt.format(remaining)+' more props…</td>';
    }else{
      currentSentinel.remove();
    }
  }
  syncVisibleParlayStates();
}
function renderOdds(){
  const version=++state.oddsRenderVersion;
  state.hitRateRows.clear();
  state.parlayRows.clear();

  let rows=state.odds.filter(oddsRowPassesFilters);
  const hitKeyMap={hitL5:"l5",hitL10:"l10",hitH2H:"h2h",hit2026:"current",hit2025:"previous"};

  if(hitKeyMap[state.oddsSortKey]){
    // Precomputed pull-time hit rates make this cheap. Fallback rates are memoized once.
    const key=hitKeyMap[state.oddsSortKey];
    rows.forEach(row=>getHitRates(row));
    rows.sort((a,b)=>{
      const av=hitSortPct(a,key);
      const bv=hitSortPct(b,key);
      let result=0;
      if(av==null&&bv==null) result=0;
      else if(av==null) result=-1;
      else if(bv==null) result=1;
      else result=av-bv;
      return state.oddsSortDir==="asc"?result:-result;
    });
  }else{
    rows.sort((a,b)=>{
      let result=0;
      if(state.oddsSortKey==="line") result=(Number(a.line)||0)-(Number(b.line)||0);
      else if(state.oddsSortKey==="odds") result=(Number(a.odds)||0)-(Number(b.odds)||0);
      else{
        result=String(a.player).localeCompare(String(b.player))||
          String(a.market).localeCompare(String(b.market))||
          (Number(a.line)||0)-(Number(b.line)||0);
      }
      return state.oddsSortDir==="asc"?result:-result;
    });
  }

  if(version!==state.oddsRenderVersion) return;
  state.oddsSortedRows=rows;
  state.oddsRenderedCount=0;

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

  oddsBody.innerHTML='<tr id="oddsLoadMoreRow"><td colspan="8" class="odds-load-more">Loading props…</td></tr>';
  appendOddsRows();
}


function teamViewDefinition(){
  return state.teamViews.find(view=>view.key===state.teamView)||state.teamViews[0]||{key:"overview",label:"Overview",stats:[]};
}
function visibleTeamStats(){
  const q=state.teamStatQuery.trim().toLowerCase();
  const rows=teamViewDefinition().stats||[];
  if(!q) return rows;
  return rows.filter(stat=>[
    stat.label,stat.short,stat.rawCategoryLabel,stat.sourceName
  ].some(value=>String(value||"").toLowerCase().includes(q)));
}
function teamStatNumber(team,stat){
  const value=team?.stats?.[stat.key];
  return Number.isFinite(Number(value))?Number(value):null;
}
function formatSeconds(value){
  const n=Math.max(0,Math.round(Number(value)||0));
  const minutes=Math.floor(n/60);
  const seconds=n%60;
  return minutes+":"+String(seconds).padStart(2,"0");
}
function formatTeamNumber(value,format){
  if(value===null||value===undefined||!Number.isFinite(Number(value))) return "—";
  const n=Number(value);
  if(format==="time") return formatSeconds(n);
  if(format==="percent") return (Math.round(n*10)/10).toLocaleString()+"%";
  if(format==="decimal") return (Math.round(n*10)/10).toLocaleString();
  return Number.isInteger(n)?fmt.format(n):(Math.round(n*100)/100).toLocaleString();
}
function teamStatDisplay(team,stat){
  if(!stat.derived&&team?.displays?.[stat.key]){
    return String(team.displays[stat.key]);
  }
  return formatTeamNumber(teamStatNumber(team,stat),stat.format);
}
function teamRank(team,stat){
  const rows=state.teamStats
    .map(t=>({team:t,value:teamStatNumber(t,stat)}))
    .filter(item=>item.value!==null)
    .sort((a,b)=>{
      const result=a.value-b.value;
      return stat.higherBetter===false?result:-result;
    });
  const index=rows.findIndex(item=>String(item.team.id)===String(team.id));
  return index>=0?index+1:null;
}
function leagueAverage(stat){
  const values=state.teamStats.map(team=>teamStatNumber(team,stat)).filter(v=>v!==null);
  return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
}
function teamStatSortDefault(viewKey,stats){
  const preferred={
    overview:["derived.pointsPerGame","derived.pointDifferential"],
    offense:["derived.totalYards","derived.pointsPerGame"],
    defense:["derived.yardsAllowedPerGame","derived.pointsAllowedPerGame"],
    situational:["derived.thirdDownPct","derived.redZonePct"],
    turnovers:["derived.turnoverDifferential","derived.takeaways"]
  }[viewKey]||[];
  return preferred.find(key=>stats.some(stat=>stat.key===key))||stats[0]?.key||"name";
}
function syncTeamViewButtons(){
  const available=new Set(state.teamViews.map(view=>view.key));
  teamViewButtons.querySelectorAll("[data-team-view]").forEach(button=>{
    button.hidden=!available.has(button.dataset.teamView);
    button.classList.toggle("active",button.dataset.teamView===state.teamView);
  });
}
function renderTeamLeaders(stats){
  const candidates=stats
    .filter(stat=>state.teamStats.some(team=>teamStatNumber(team,stat)!==null))
    .slice(0,4);
  if(!candidates.length){
    teamLeaderStrip.innerHTML="";
    return;
  }
  teamLeaderStrip.innerHTML=candidates.map(stat=>{
    const ranked=state.teamStats
      .map(team=>({team,value:teamStatNumber(team,stat)}))
      .filter(item=>item.value!==null)
      .sort((a,b)=>{
        const result=a.value-b.value;
        return stat.higherBetter===false?result:-result;
      });
    const leader=ranked[0];
    if(!leader) return "";
    return '<button type="button" class="team-leader-card" data-team-id="'+esc(leader.team.id)+'" data-team-stat="'+esc(stat.key)+'">'+
      '<span class="team-leader-label">'+esc(stat.label)+'</span>'+
      '<span class="team-leader-main"><img src="'+esc(leader.team.logo||teamLogo(leader.team.abbreviation))+'" alt=""><strong>'+esc(leader.team.abbreviation)+'</strong><b>'+esc(formatTeamNumber(leader.value,stat.format))+'</b></span>'+
      '<span class="team-leader-caption">League leader</span>'+
    '</button>';
  }).join("");
}
function renderTeamStats(){
  const view=teamViewDefinition();
  const stats=visibleTeamStats();
  syncTeamViewButtons();

  if(!stats.some(stat=>stat.key===state.teamSortKey)){
    state.teamSortKey=teamStatSortDefault(state.teamView,stats);
    const selected=stats.find(stat=>stat.key===state.teamSortKey);
    state.teamSortDir=selected?.higherBetter===false?"asc":"desc";
  }

  const q=state.teamQuery.trim().toLowerCase();
  let teams=state.teamStats.filter(team=>!q||[
    team.name,team.shortName,team.abbreviation
  ].some(value=>String(value||"").toLowerCase().includes(q)));

  teams.sort((a,b)=>{
    if(state.teamSortKey==="name"){
      const result=String(a.name).localeCompare(String(b.name));
      return state.teamSortDir==="asc"?result:-result;
    }
    const av=teamStatNumber(a,{key:state.teamSortKey});
    const bv=teamStatNumber(b,{key:state.teamSortKey});
    if(av===null&&bv===null) return String(a.name).localeCompare(String(b.name));
    if(av===null) return 1;
    if(bv===null) return -1;
    const result=av-bv;
    return state.teamSortDir==="asc"?result:-result;
  });

  teamRecordCount.textContent=fmt.format(teams.length)+" team"+(teams.length===1?"":"s");
  teamColumnCount.textContent=fmt.format(stats.length)+" stat"+(stats.length===1?"":"s");

  teamStatsHead.innerHTML='<tr>'+
    '<th class="team-col" data-team-sort="name">Team <span class="team-sort-indicator">'+(state.teamSortKey==="name"?(state.teamSortDir==="asc"?"▲":"▼"):"")+'</span></th>'+
    stats.map(stat=>
      '<th data-team-sort="'+esc(stat.key)+'" title="'+esc(stat.label)+'">'+
        '<span class="team-th-label">'+esc(stat.short||stat.label)+'</span>'+
        '<span class="team-sort-indicator">'+(state.teamSortKey===stat.key?(state.teamSortDir==="asc"?"▲":"▼"):"")+'</span>'+
      '</th>'
    ).join("")+
  '</tr>';

  if(!teams.length){
    teamStatsBody.innerHTML='<tr><td colspan="'+(stats.length+1)+'" class="empty-cell">No teams match that search.</td></tr>';
    renderTeamLeaders(stats);
    return;
  }

  teamStatsBody.innerHTML=teams.map(team=>{
    const teamCell='<td class="team-cell">'+
      '<img class="team-table-logo" src="'+esc(team.logo||teamLogo(team.abbreviation))+'" alt="" loading="lazy">'+
      '<div><div class="team-table-name">'+esc(team.name)+'</div><div class="team-table-meta">'+esc(team.abbreviation)+' • '+esc(team.record||"—")+'</div></div>'+
    '</td>';

    const statCells=stats.map(stat=>{
      const value=teamStatNumber(team,stat);
      if(value===null){
        return '<td class="team-stat-cell team-stat-na">—</td>';
      }
      const rank=teamRank(team,stat);
      return '<td class="team-stat-cell team-stat-trigger" data-team-id="'+esc(team.id)+'" data-team-stat="'+esc(stat.key)+'" tabindex="0" role="button" aria-label="Open '+esc(team.name)+' '+esc(stat.label)+' chart">'+
        '<span class="team-stat-value">'+esc(teamStatDisplay(team,stat))+'</span>'+
        (rank?'<span class="team-stat-rank">#'+rank+'</span>':"")+
      '</td>';
    }).join("");

    return '<tr>'+teamCell+statCells+'</tr>';
  }).join("");

  renderTeamLeaders(stats);
}
function findTeamStat(key){
  for(const view of state.teamViews){
    const stat=(view.stats||[]).find(item=>item.key===key);
    if(stat) return stat;
  }
  return null;
}
function teamGameValue(game,stat){
  const stats=game?.stats||{};
  const keys=[stat.chartKey,stat.sourceName,stat.key].filter(Boolean);
  for(const key of keys){
    if(Number.isFinite(Number(stats[key]))) return Number(stats[key]);
  }
  const normalizedEntries=Object.entries(stats).map(([key,value])=>[normalizeName(key),value]);
  for(const key of keys){
    const target=normalizeName(key);
    const found=normalizedEntries.find(([name,value])=>name===target&&Number.isFinite(Number(value)));
    if(found) return Number(found[1]);
  }
  return null;
}
function teamGameLabel(game){
  const raw=game?.date;
  let first="W"+String(game?.week||"—");
  if(raw){
    const date=new Date(raw);
    if(!Number.isNaN(date.getTime())){
      first=new Intl.DateTimeFormat("en-US",{month:"numeric",day:"numeric"}).format(date);
    }
  }
  const opp=game?.opponent?.abbreviation||"";
  return {date:first,opponent:(game.isAway?"@ ":"vs ")+opp};
}
function renderTeamSummary(team,stat){
  const value=teamStatNumber(team,stat);
  const rank=teamRank(team,stat);
  const avgValue=leagueAverage(stat);
  const games=(team.gameLog||[]).map(game=>teamGameValue(game,stat)).filter(v=>v!==null);
  const gameAvg=games.length?games.reduce((a,b)=>a+b,0)/games.length:null;
  const high=games.length?Math.max(...games):null;
  const low=games.length?Math.min(...games):null;

  const cards=[
    ["Season",teamStatDisplay(team,stat)],
    ["NFL Rank",rank?"#"+rank:"—"],
    ["League Avg",formatTeamNumber(avgValue,stat.format)],
    ["Game Avg",formatTeamNumber(gameAvg,stat.format)],
    ["Game High",formatTeamNumber(high,stat.format)],
    ["Game Low",formatTeamNumber(low,stat.format)]
  ];
  teamStatSummaryCards.innerHTML=cards.map(([label,value])=>
    '<div class="team-summary-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>'
  ).join("");
}
function renderTeamTrendChart(team,stat){
  const points=(team.gameLog||[])
    .map(game=>({game,value:teamGameValue(game,stat)}))
    .filter(point=>point.value!==null)
    .sort((a,b)=>compareGamesChronologically(a.game,b.game));

  if(!points.length){
    teamStatChart.innerHTML='<div class="team-chart-empty">Game-by-game data is not available for this ESPN stat. Use League Compare to see all 32 teams.</div>';
    return false;
  }

  const values=points.map(point=>point.value);
  const max=Math.max(...values,0);
  const min=Math.min(...values,0);
  const span=Math.max(1,max-min);
  const floor=Math.min(0,min);
  const ceiling=Math.max(1,max)*1.12;
  const chartSpan=Math.max(1,ceiling-floor);
  const width=Math.max(700,points.length*96);
  const seasonAvg=values.reduce((a,b)=>a+b,0)/values.length;
  const avgPct=Math.max(0,Math.min(100,((seasonAvg-floor)/chartSpan)*100));
  const stageHeight=286;
  const avgBottom=48+(avgPct/100)*stageHeight;

  const bars=points.map((point,index)=>{
    const height=Math.max(2,((point.value-floor)/chartSpan)*100);
    const valueBottom=48+(height/100)*stageHeight;
    const label=teamGameLabel(point.game);
    const cls=point.game.result==="W"?"win":point.game.result==="L"?"loss":"tie";
    return '<div class="team-trend-column">'+
      '<div class="team-trend-value" style="bottom:'+valueBottom+'px">'+esc(formatTeamNumber(point.value,stat.format))+'</div>'+
      '<div class="team-trend-track"><div class="team-trend-bar '+cls+'" style="height:'+height+'%;--team-bar-delay:'+(index*45)+'ms"></div></div>'+
      '<div class="team-trend-label"><span>'+esc(label.date)+'</span><span>'+esc(label.opponent)+'</span></div>'+
    '</div>';
  }).join("");

  teamStatChart.innerHTML='<div class="team-trend-plot" style="width:'+width+'px">'+
    '<div class="team-trend-average" style="bottom:'+avgBottom+'px"><span>AVG '+esc(formatTeamNumber(seasonAvg,stat.format))+'</span></div>'+
    '<div class="team-trend-bars">'+bars+'</div>'+
  '</div>';
  return true;
}
function renderTeamLeagueChart(team,stat){
  const rows=state.teamStats
    .map(item=>({team:item,value:teamStatNumber(item,stat)}))
    .filter(item=>item.value!==null)
    .sort((a,b)=>{
      const result=a.value-b.value;
      return stat.higherBetter===false?result:-result;
    });

  if(!rows.length){
    teamStatChart.innerHTML='<div class="team-chart-empty">League comparison data is not available for this stat.</div>';
    return;
  }

  const max=Math.max(...rows.map(row=>Math.abs(row.value)),1);
  teamStatChart.innerHTML='<div class="team-league-chart">'+rows.map((row,index)=>{
    const pct=Math.max(2,Math.abs(row.value)/max*100);
    const selected=String(row.team.id)===String(team.id);
    return '<div class="team-league-row '+(selected?"selected":"")+'">'+
      '<span class="team-league-rank">#'+(index+1)+'</span>'+
      '<img src="'+esc(row.team.logo||teamLogo(row.team.abbreviation))+'" alt="">'+
      '<span class="team-league-abbr">'+esc(row.team.abbreviation)+'</span>'+
      '<div class="team-league-bar-track"><span style="width:'+pct+'%;--league-delay:'+(index*18)+'ms"></span></div>'+
      '<strong>'+esc(formatTeamNumber(row.value,stat.format))+'</strong>'+
    '</div>';
  }).join("")+'</div>';
}
function renderTeamStatModalChart(){
  const team=state.teamModalTeam;
  const stat=state.teamModalStat;
  if(!team||!stat) return;

  const hasTrend=(team.gameLog||[]).some(game=>teamGameValue(game,stat)!==null);
  teamTrendTab.disabled=!hasTrend;
  if(state.teamChartMode==="trend"&&!hasTrend) state.teamChartMode="league";

  teamTrendTab.classList.toggle("active",state.teamChartMode==="trend");
  teamLeagueTab.classList.toggle("active",state.teamChartMode==="league");

  if(state.teamChartMode==="trend") renderTeamTrendChart(team,stat);
  else renderTeamLeagueChart(team,stat);
}
function openTeamStatChart(team,stat){
  state.teamModalTeam=team;
  state.teamModalStat=stat;
  const hasTrend=(team.gameLog||[]).some(game=>teamGameValue(game,stat)!==null);
  state.teamChartMode=hasTrend?"trend":"league";

  teamStatModalLogo.src=team.logo||teamLogo(team.abbreviation);
  teamStatModalLogo.onerror=()=>{teamStatModalLogo.src=fallbackTeamLogo(team.abbreviation)};
  teamStatModalEyebrow.textContent=(state.teamStatsRaw?.season||state.season||"CURRENT")+" REGULAR SEASON • TEAM STAT";
  teamStatModalTitle.textContent=team.name+" — "+stat.label;
  teamStatModalMeta.textContent=team.abbreviation+" • "+(team.record||"—")+" • "+teamViewDefinition().label;
  renderTeamSummary(team,stat);
  renderTeamStatModalChart();
  teamStatModal.showModal();
}
async function loadTeamStats(){
  if(state.teamStatsRaw||state.teamStatsLoading) return;
  state.teamStatsLoading=true;
  try{
    const res=await fetch("data/nfl-team-stats.json",{cache:"default"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    state.teamStatsRaw=data;
    state.teamStats=Array.isArray(data.teams)?data.teams:[];
    state.teamViews=Array.isArray(data.views)?data.views:[];
    state.teamStatsUpdatedAt=data.updatedAt||null;

    if(!state.teamViews.some(view=>view.key===state.teamView)){
      state.teamView=state.teamViews[0]?.key||"overview";
    }
    renderTeamStats();
    if(state.activeView==="team-stats") setView("team-stats",false);
  }catch(err){
    console.error(err);
    teamStatsBody.innerHTML='<tr><td colspan="2" class="empty-cell">Team stats are being generated. Run the “Update NFL Stats” GitHub Action once if this persists.</td></tr>';
    teamRecordCount.textContent="— teams";
  }finally{
    state.teamStatsLoading=false;
  }
}

async function loadStats(){
  if(state.players.length||state.statsLoading) return;
  state.statsLoading=true;
  try{
    const res=await fetch("data/nfl-stats.json",{cache:"default"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    state.players=Array.isArray(data.players)?data.players:[];
    rebuildUsageShares();
    state.playerIndex=new Map(state.players.map(p=>[normalizeName(p.name),p]));
    state.hitRateCache.clear();
    state.opponentRankCache.clear();
    state.season=data.season||null;
    state.statsUpdatedAt=data.updatedAt||null;
    render();
    if(state.odds.length) renderOdds();
    if(state.activeView==="stats") setView("stats",false);
    if(state.activeView==="team-stats"&&!state.teamStatsRaw) setView("team-stats",false);
  }catch(err){
    console.error(err);
    body.innerHTML='<tr><td colspan="13" class="empty-cell">Stats have not been generated yet. Run the “Update NFL Stats” GitHub Action once.</td></tr>';
  }finally{
    state.statsLoading=false;
  }
}

async function loadOdds(){
  if(state.oddsRaw||state.oddsLoading) return;
  state.oddsLoading=true;
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
        const row={
          ...prop,
          player:cleanedPlayer,
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
        };
        row._displayPlayer=cleanedPlayer;
        row._marketLabel=canonicalPropCategory(row);
        row._displayProposition=cleanDisplayProposition(row);
        row._parlayKey=[
          row.eventId||"",
          cleanedPlayer,
          row.market||"",
          row.selection||"",
          row.line??"",
          row.proposition||""
        ].join("¦");
        row._searchText=[
          row.player,row.team,row.position,row.market,row._marketLabel,row.proposition,
          row._displayProposition,row.matchup,row.selection
        ].map(value=>String(value||"").toLowerCase()).join(" ");
        flattened.push(row);
      }
    }

    state.odds=flattened;
    state.hitRateCache.clear();
    reconcileParlay();
    renderParlay();
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
  }finally{
    state.oddsLoading=false;
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

let oddsSearchFrame=0;
oddsSearch.addEventListener("input",e=>{
  state.oddsQuery=e.target.value;
  cancelAnimationFrame(oddsSearchFrame);
  oddsSearchFrame=requestAnimationFrame(renderOdds);
});
document.querySelectorAll(".odds-table th[data-odds-key]").forEach(th=>th.addEventListener("click",()=>{
  const key=th.dataset.oddsKey;
  if(state.oddsSortKey===key) state.oddsSortDir=state.oddsSortDir==="asc"?"desc":"asc";
  else{
    state.oddsSortKey=key;
    state.oddsSortDir=key==="player"?"asc":"desc";
  }
  renderOdds();
}));

oddsBody.addEventListener("click",e=>{
  const button=e.target.closest(".parlay-add-button");
  if(!button) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const row=state.parlayRows.get(button.dataset.parlayKey);
  if(row) toggleParlayLeg(row);
});
oddsBody.addEventListener("keydown",e=>{
  if(!["Enter"," "].includes(e.key)) return;
  const button=e.target.closest(".parlay-add-button");
  if(!button) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const row=state.parlayRows.get(button.dataset.parlayKey);
  if(row) toggleParlayLeg(row);
});

oddsBody.addEventListener("click",e=>{
  const cell=e.target.closest(".hit-rate-trigger");
  if(!cell) return;
  e.stopPropagation();
  const row=state.hitRateRows.get(cell.dataset.hitKey);
  if(row) openHitRateChart(row,cell.dataset.hitSplit);
});
oddsBody.addEventListener("keydown",e=>{
  if(!["Enter"," "].includes(e.key)) return;
  const cell=e.target.closest(".hit-rate-trigger");
  if(!cell) return;
  e.preventDefault();
  e.stopPropagation();
  const row=state.hitRateRows.get(cell.dataset.hitKey);
  if(row) openHitRateChart(row,cell.dataset.hitSplit);
});

oddsBody.addEventListener("click",e=>{
  if(e.target.closest(".parlay-add-button")) return;
  const trigger=e.target.closest(".odds-player-trigger");
  if(!trigger) return;
  const player=findPlayer(trigger.dataset.playerName);
  if(player) openPlayer(player);
});
oddsBody.addEventListener("keydown",e=>{
  if(!["Enter"," "].includes(e.key)) return;
  if(e.target.closest(".parlay-add-button")) return;
  const trigger=e.target.closest(".odds-player-trigger");
  if(!trigger) return;
  e.preventDefault();
  const player=findPlayer(trigger.dataset.playerName);
  if(player) openPlayer(player);
});

parlayBuilderButton.addEventListener("click",()=>setParlayOpen(!state.parlayOpen));
parlayCloseButton.addEventListener("click",()=>setParlayOpen(false));
parlayClearButton.addEventListener("click",()=>{
  state.parlayLegs=[];
  saveParlay();
  renderParlay();
  syncVisibleParlayStates();
});
parlayLegs.addEventListener("click",e=>{
  const button=e.target.closest("[data-parlay-remove]");
  if(button) removeParlayLeg(button.dataset.parlayRemove);
});

let oddsScrollTicking=false;
oddsTableScroll.addEventListener("scroll",()=>{
  if(oddsScrollTicking) return;
  oddsScrollTicking=true;
  requestAnimationFrame(()=>{
    oddsScrollTicking=false;
    const distance=oddsTableScroll.scrollHeight-oddsTableScroll.scrollTop-oddsTableScroll.clientHeight;
    if(distance<700) appendOddsRows();
  });
},{passive:true});

const filterPairs=[
  [gameFilterDialog,gameFilterButton],
  [marketFilterDialog,marketFilterButton],
  [positionFilterDialog,positionFilterButton],
  [oddsRangeDialog,oddsRangeButton]
];
for(const [popover,button] of filterPairs){
  popover.dataset.anchorButton=button.id;
  document.body.appendChild(popover);
}
function closeFilterPopovers(except=null){
  for(const [popover,button] of filterPairs){
    if(popover===except) continue;
    popover.hidden=true;
    button.setAttribute("aria-expanded","false");
    button.classList.remove("open");
  }
}
function positionFilterPopover(popover,button){
  popover.hidden=false;
  const rect=button.getBoundingClientRect();
  const width=popover.offsetWidth;
  const height=popover.offsetHeight;
  let left=Math.max(10,Math.min(rect.left,window.innerWidth-width-10));
  let top=rect.bottom+8;
  if(top+height>window.innerHeight-10&&rect.top-height-8>=10) top=rect.top-height-8;
  popover.style.left=left+"px";
  popover.style.top=Math.max(10,top)+"px";
}
function toggleFilterPopover(popover,button,renderFn){
  const opening=popover.hidden;
  closeFilterPopovers();
  if(!opening) return;
  renderFn();
  positionFilterPopover(popover,button);
  button.setAttribute("aria-expanded","true");
  button.classList.add("open");
}

gameFilterButton.addEventListener("click",e=>{e.stopPropagation();toggleFilterPopover(gameFilterDialog,gameFilterButton,renderGameFilters)});
marketFilterButton.addEventListener("click",e=>{e.stopPropagation();toggleFilterPopover(marketFilterDialog,marketFilterButton,renderMarketFilters)});
positionFilterButton.addEventListener("click",e=>{e.stopPropagation();toggleFilterPopover(positionFilterDialog,positionFilterButton,renderPositionFilter)});
oddsRangeButton.addEventListener("click",e=>{e.stopPropagation();toggleFilterPopover(oddsRangeDialog,oddsRangeButton,syncOddsRangeControls)});

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
function clampSliderPair(changed){
  let min=Number(oddsMinRange.value);
  let max=Number(oddsMaxRange.value);
  if(changed==="min"&&min>max){min=max;oddsMinRange.value=String(min)}
  if(changed==="max"&&max<min){max=min;oddsMaxRange.value=String(max)}
  oddsMinInput.value=String(min);
  oddsMaxInput.value=String(max);
  paintOddsRange();
}
function syncSliderFromTypedInput(input,range){
  const value=Number(input.value);
  if(Number.isFinite(value)) range.value=String(clampToSlider(value));
  paintOddsRange();
}
oddsMinRange.addEventListener("input",()=>clampSliderPair("min"));
oddsMaxRange.addEventListener("input",()=>clampSliderPair("max"));
oddsMinInput.addEventListener("input",()=>syncSliderFromTypedInput(oddsMinInput,oddsMinRange));
oddsMaxInput.addEventListener("input",()=>syncSliderFromTypedInput(oddsMaxInput,oddsMaxRange));
resetOddsRange.addEventListener("click",()=>{
  state.oddsMin=null;
  state.oddsMax=null;
  syncOddsRangeControls();
  renderOdds();
});
applyOddsRange.addEventListener("click",()=>{
  let min=Number(oddsMinInput.value);
  let max=Number(oddsMaxInput.value);
  if(!Number.isFinite(min)) min=ODDS_SLIDER_MIN;
  if(!Number.isFinite(max)) max=ODDS_SLIDER_MAX;
  if(min>max) [min,max]=[max,min];

  oddsMinInput.value=String(min);
  oddsMaxInput.value=String(max);
  state.oddsMin=min===ODDS_SLIDER_MIN?null:min;
  state.oddsMax=max===ODDS_SLIDER_MAX?null:max;
  updateFilterButtons();
  renderOdds();
  closeFilterPopovers();
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

document.addEventListener("click",e=>{
  if(!e.target.closest(".filter-control")&&!e.target.closest(".filter-popover")) closeFilterPopovers();
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape") closeFilterPopovers();
});
window.addEventListener("resize",()=>closeFilterPopovers());

teamSearch.addEventListener("input",e=>{state.teamQuery=e.target.value;renderTeamStats()});
teamStatSearchInput.addEventListener("input",e=>{state.teamStatQuery=e.target.value;renderTeamStats()});
teamViewButtons.addEventListener("click",e=>{
  const button=e.target.closest("[data-team-view]");
  if(!button||button.hidden) return;
  state.teamView=button.dataset.teamView;
  state.teamStatQuery="";
  teamStatSearchInput.value="";
  const stats=teamViewDefinition().stats||[];
  state.teamSortKey=teamStatSortDefault(state.teamView,stats);
  const selected=stats.find(stat=>stat.key===state.teamSortKey);
  state.teamSortDir=selected?.higherBetter===false?"asc":"desc";
  renderTeamStats();
});
teamStatsHead.addEventListener("click",e=>{
  const th=e.target.closest("[data-team-sort]");
  if(!th) return;
  const key=th.dataset.teamSort;
  if(state.teamSortKey===key) state.teamSortDir=state.teamSortDir==="asc"?"desc":"asc";
  else{
    state.teamSortKey=key;
    const stat=findTeamStat(key);
    state.teamSortDir=key==="name"?"asc":stat?.higherBetter===false?"asc":"desc";
  }
  renderTeamStats();
});
function openTeamCell(cell){
  const team=state.teamStats.find(item=>String(item.id)===cell.dataset.teamId);
  const stat=findTeamStat(cell.dataset.teamStat);
  if(team&&stat) openTeamStatChart(team,stat);
}
teamStatsBody.addEventListener("click",e=>{
  const cell=e.target.closest(".team-stat-trigger");
  if(cell) openTeamCell(cell);
});
teamStatsBody.addEventListener("keydown",e=>{
  if(!["Enter"," "].includes(e.key)) return;
  const cell=e.target.closest(".team-stat-trigger");
  if(!cell) return;
  e.preventDefault();
  openTeamCell(cell);
});
teamLeaderStrip.addEventListener("click",e=>{
  const card=e.target.closest("[data-team-id][data-team-stat]");
  if(!card) return;
  const team=state.teamStats.find(item=>String(item.id)===card.dataset.teamId);
  const stat=findTeamStat(card.dataset.teamStat);
  if(team&&stat) openTeamStatChart(team,stat);
});

teamTrendTab.addEventListener("click",()=>{
  if(teamTrendTab.disabled) return;
  state.teamChartMode="trend";
  renderTeamStatModalChart();
});
teamLeagueTab.addEventListener("click",()=>{
  state.teamChartMode="league";
  renderTeamStatModalChart();
});
teamStatModalClose.addEventListener("click",()=>teamStatModal.close());
teamStatModal.addEventListener("click",e=>{if(e.target===teamStatModal) teamStatModal.close()});
teamStatModal.addEventListener("close",()=>{
  state.teamModalTeam=null;
  state.teamModalStat=null;
});

statsTabButton.addEventListener("click",()=>{
  setView("stats");
  loadStats();
});
teamStatsTabButton.addEventListener("click",()=>{
  setView("team-stats");
  loadTeamStats();
});
oddsTabButton.addEventListener("click",()=>{
  setView("odds");
  loadStats();
  loadOdds();
});
window.addEventListener("hashchange",()=>{
  const view=location.hash==="#odds"?"odds":location.hash==="#teams"?"team-stats":"stats";
  setView(view,false);
  if(view==="odds"){loadStats();loadOdds()}
  else if(view==="team-stats") loadTeamStats();
  else loadStats();
});

modalClose.addEventListener("click",closeModal);
modal.addEventListener("click",e=>{if(e.target===modal) closeModal()});
modalSeasonSelect.addEventListener("change",renderModalSeason);
hitRateBreakdown.addEventListener("click",e=>{
  const button=e.target.closest("[data-chart-split]");
  if(!button||button.disabled||!state.hitRateActiveRow) return;
  const split=button.dataset.chartSplit;
  if(split===state.hitRateActiveSplit) return;
  state.hitRateActiveSplit=split;
  renderHitRateChart(state.hitRateActiveRow,split);
});
hitRateClose.addEventListener("click",()=>hitRateModal.close());
hitRateModal.addEventListener("click",e=>{if(e.target===hitRateModal) hitRateModal.close()});
hitRateModal.addEventListener("close",()=>{
  state.hitRateActiveRow=null;
  state.hitRateActiveSplit=null;
});

loadSavedParlay();
renderParlay();
const initialView=location.hash==="#odds"?"odds":location.hash==="#teams"?"team-stats":"stats";
setView(initialView,false);

if(initialView==="odds"){
  loadStats();
  loadOdds();
}else if(initialView==="team-stats"){
  loadTeamStats();
}else{
  loadStats();
}

