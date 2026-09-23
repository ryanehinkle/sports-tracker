const state={
  players:[],
  query:"",
  sortKey:"allPurposeYards",
  sortDir:"desc",
  season:null,
  statsUpdatedAt:null,
  odds:[],
  oddsRaw:null,
  oddsQuery:"",
  oddsGame:"",
  oddsMarket:"",
  oddsSortKey:"player",
  oddsSortDir:"asc",
  oddsUpdatedAt:null,
  activeView:"stats"
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
const gameFilter=document.getElementById("gameFilter");
const marketFilter=document.getElementById("marketFilter");

const modal=document.getElementById("playerModal");
const modalClose=document.getElementById("modalClose");
const modalHeadshot=document.getElementById("modalHeadshot");
const modalPlayerName=document.getElementById("modalPlayerName");
const modalPlayerMeta=document.getElementById("modalPlayerMeta");
const modalKicker=document.getElementById("modalKicker");
const gameLogBody=document.getElementById("gameLogBody");

const fmt=new Intl.NumberFormat("en-US");

function safe(v){return Number.isFinite(Number(v))?Number(v):0}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
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
    pageSubtitle.textContent="All currently captured FanDuel NFL player props, including alternate lines.";
    seasonLabel.textContent="FanDuel Player Props";
    updatedLabel.textContent=formatUpdated(state.oddsUpdatedAt);
    pageFooter.innerHTML="<span>Odds sourced from FanDuel via The Odds API.</span><span>Odds can move at any time • Alternate lines are included when FanDuel offers them.</span>";
  }else{
    pageSubtitle.textContent="Current regular-season offensive production, refreshed automatically after NFL game days.";
    seasonLabel.textContent=(state.season||"Current")+" Regular Season";
    updatedLabel.textContent=formatUpdated(state.statsUpdatedAt);
    pageFooter.innerHTML="<span>Player stats sourced from ESPN.</span><span>Click a player for their game log • Click a column heading to sort.</span>";
  }

  if(updateHash){
    history.replaceState(null,"",isOdds?"#odds":"#stats");
  }
}

function render(){
  const q=state.query.trim().toLowerCase();
  let rows=state.players.filter(p=>!q||[p.name,p.team,p.position].some(v=>String(v||"").toLowerCase().includes(q)));
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
    th.setAttribute("aria-sort",th.dataset.key===state.sortKey?(state.sortDir==="asc"?"ascending":"descending"):"none");
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
  return game&&game.played?fmt.format(safe(game[key])):"-";
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
function openPlayer(player){
  const logs=Array.isArray(player.gameLog)?player.gameLog:[];
  modalHeadshot.src=player.headshot||fallbackHeadshot(player.name);
  modalHeadshot.onerror=()=>{modalHeadshot.src=fallbackHeadshot(player.name)};
  modalPlayerName.textContent=player.name;
  modalPlayerMeta.textContent=[player.position,player.team].filter(Boolean).join(" • ");
  modalKicker.textContent=(state.season||"CURRENT")+" REGULAR SEASON • GAME LOG";

  if(!logs.length){
    gameLogBody.innerHTML='<tr><td colspan="9" class="modal-empty">Game log will populate on the next stats refresh.</td></tr>';
  }else{
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
  modal.showModal();
}
function closeModal(){if(modal.open) modal.close()}

function rebuildOddsFilters(){
  const currentGame=state.oddsGame;
  const currentMarket=state.oddsMarket;
  const games=new Map();
  const markets=new Set();

  for(const row of state.odds){
    games.set(row.eventId,row.matchup);
    if(row.market) markets.add(row.market);
  }

  gameFilter.innerHTML='<option value="">All games</option>'+
    [...games.entries()].map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join("");
  marketFilter.innerHTML='<option value="">All player props</option>'+
    [...markets].sort((a,b)=>a.localeCompare(b)).map(label=>'<option value="'+esc(label)+'">'+esc(label)+'</option>').join("");

  if([...games.keys()].includes(currentGame)) gameFilter.value=currentGame;
  if(markets.has(currentMarket)) marketFilter.value=currentMarket;
}

function renderOdds(){
  if(state.oddsRaw&&state.oddsRaw.setupRequired){
    oddsBody.innerHTML='<tr><td colspan="3" class="odds-empty"><div class="odds-empty-title">FanDuel feed is ready to connect</div><div>Add the repository secret <code>ODDS_API_KEY</code>, then run the “Update NFL Odds” workflow once.</div></td></tr>';
    oddsCount.textContent="Setup required";
    return;
  }

  const q=state.oddsQuery.trim().toLowerCase();
  let rows=state.odds.filter(row=>{
    if(state.oddsGame&&row.eventId!==state.oddsGame) return false;
    if(state.oddsMarket&&row.market!==state.oddsMarket) return false;
    if(!q) return true;
    return [row.player,row.team,row.position,row.market,row.proposition,row.matchup,row.selection]
      .some(value=>String(value||"").toLowerCase().includes(q));
  });

  rows.sort((a,b)=>{
    let result=0;
    if(state.oddsSortKey==="line"){
      result=(Number(a.line)||0)-(Number(b.line)||0);
    }else if(state.oddsSortKey==="odds"){
      result=(Number(a.odds)||0)-(Number(b.odds)||0);
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
    th.setAttribute("aria-sort",th.dataset.oddsKey===state.oddsSortKey?(state.oddsSortDir==="asc"?"ascending":"descending"):"none");
  });

  if(!rows.length){
    const message=state.odds.length?"No FanDuel props match those filters.":"No FanDuel NFL player props are currently available in the feed.";
    oddsBody.innerHTML='<tr><td colspan="3" class="odds-empty">'+esc(message)+'</td></tr>';
    return;
  }

  oddsBody.innerHTML=rows.map(row=>{
    const headshot=row.headshot||fallbackHeadshot(row.player);
    const logo=teamLogo(row.team);
    const alt=row.alternate?'<span class="alt-badge">ALT</span>':'';
    const content=
      '<div class="prop-player-visual">'+
        '<div class="odds-headshot-wrap"><img class="odds-headshot" src="'+esc(headshot)+'" alt="" loading="lazy" onerror="this.src=\''+fallbackHeadshot(row.player)+'\'"><img class="odds-team-badge" src="'+esc(logo)+'" alt="" loading="lazy" onerror="this.src=\''+fallbackTeamLogo(row.team)+'\'"></div>'+
        '<div class="prop-copy">'+
          '<div class="prop-player-line"><span class="prop-player-name">'+esc(row.player)+'</span><span class="prop-divider">•</span><span class="prop-matchup">'+esc(row.matchup)+'</span></div>'+
          '<div class="prop-name">'+esc(row.proposition)+' '+alt+'</div>'+
        '</div>'+
      '</div>';
    const rowClass=row.link?"odds-row clickable":"odds-row";
    const linkAttr=row.link?' data-link="'+esc(row.link)+'" tabindex="0" role="link"':'';
    return '<tr class="'+rowClass+'"'+linkAttr+'>'+
      '<td class="prop-cell">'+content+'</td>'+
      '<td class="odds-line">'+esc(formatLine(row.line))+'</td>'+
      '<td class="odds-price"><span class="fd-mini">FD</span>'+esc(formatAmerican(row.odds))+'</td>'+
    '</tr>';
  }).join("");
}

async function loadStats(){
  try{
    const res=await fetch("data/nfl-stats.json?v="+Date.now(),{cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    state.players=Array.isArray(data.players)?data.players:[];
    state.season=data.season||null;
    state.statsUpdatedAt=data.updatedAt||null;
    render();
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
        flattened.push({
          ...prop,
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
    rebuildOddsFilters();
    renderOdds();
    if(state.activeView==="odds") setView("odds",false);
  }catch(err){
    console.error(err);
    oddsBody.innerHTML='<tr><td colspan="3" class="odds-empty">Odds data is not available yet.</td></tr>';
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
gameFilter.addEventListener("change",e=>{state.oddsGame=e.target.value;renderOdds()});
marketFilter.addEventListener("change",e=>{state.oddsMarket=e.target.value;renderOdds()});
document.querySelectorAll(".odds-table th[data-odds-key]").forEach(th=>th.addEventListener("click",()=>{
  const key=th.dataset.oddsKey;
  if(state.oddsSortKey===key) state.oddsSortDir=state.oddsSortDir==="asc"?"desc":"asc";
  else{state.oddsSortKey=key;state.oddsSortDir=key==="player"?"asc":"desc"}
  renderOdds();
}));
oddsBody.addEventListener("click",e=>{
  const row=e.target.closest(".odds-row[data-link]");
  if(row&&row.dataset.link) window.open(row.dataset.link,"_blank","noopener,noreferrer");
});
oddsBody.addEventListener("keydown",e=>{
  if(!["Enter"," "].includes(e.key)) return;
  const row=e.target.closest(".odds-row[data-link]");
  if(row&&row.dataset.link){
    e.preventDefault();
    window.open(row.dataset.link,"_blank","noopener,noreferrer");
  }
});

statsTabButton.addEventListener("click",()=>setView("stats"));
oddsTabButton.addEventListener("click",()=>setView("odds"));
window.addEventListener("hashchange",()=>setView(location.hash==="#odds"?"odds":"stats",false));

modalClose.addEventListener("click",closeModal);
modal.addEventListener("click",e=>{if(e.target===modal) closeModal()});

setView(location.hash==="#odds"?"odds":"stats",false);
Promise.all([loadStats(),loadOdds()]);