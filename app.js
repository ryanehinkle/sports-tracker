const state={players:[],query:"",sortKey:"allPurposeYards",sortDir:"desc",season:null};
const body=document.getElementById("statsBody");
const search=document.getElementById("searchInput");
const count=document.getElementById("recordCount");
const seasonLabel=document.getElementById("seasonLabel");
const updatedLabel=document.getElementById("updatedLabel");
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
  document.querySelectorAll("th[data-key]").forEach(th=>{
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

async function load(){
  try{
    const res=await fetch("data/nfl-stats.json?v="+Date.now(),{cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    state.players=Array.isArray(data.players)?data.players:[];
    state.season=data.season||null;
    seasonLabel.textContent=(data.season||"Current")+" Regular Season";
    if(data.updatedAt){
      const d=new Date(data.updatedAt);
      updatedLabel.textContent="Updated "+new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(d);
    }else updatedLabel.textContent="Awaiting first automated refresh";
    render();
  }catch(err){
    console.error(err);
    body.innerHTML='<tr><td colspan="8" class="empty-cell">Stats have not been generated yet. Run the “Update NFL Stats” GitHub Action once.</td></tr>';
    seasonLabel.textContent="NFL Regular Season";
    updatedLabel.textContent="No data file yet";
  }
}

search.addEventListener("input",e=>{state.query=e.target.value;render()});
document.querySelectorAll("th[data-key]").forEach(th=>th.addEventListener("click",()=>{
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
modalClose.addEventListener("click",closeModal);
modal.addEventListener("click",e=>{if(e.target===modal) closeModal()});

load();