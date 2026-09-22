const state={players:[],query:"",sortKey:"allPurposeYards",sortDir:"desc"};
const body=document.getElementById("statsBody");
const search=document.getElementById("searchInput");
const count=document.getElementById("recordCount");
const seasonLabel=document.getElementById("seasonLabel");
const updatedLabel=document.getElementById("updatedLabel");
const fmt=new Intl.NumberFormat("en-US");

function safe(v){return Number.isFinite(Number(v))?Number(v):0}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function fallbackHeadshot(name){
  const initials=String(name||"?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="92" height="92"><rect width="100%" height="100%" fill="#242d3a"/><text x="50%" y="56%" text-anchor="middle" fill="#94a2b5" font-size="30" font-family="Arial" font-weight="700">${initials}</text></svg>`)}`;
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
  count.textContent=`${fmt.format(rows.length)} player${rows.length===1?"":"s"}`;
  document.querySelectorAll("th[data-key]").forEach(th=>{
    const mark=th.querySelector(".sort-indicator");
    mark.textContent=th.dataset.key===state.sortKey?(state.sortDir==="asc"?"▲":"▼"):"";
    th.setAttribute("aria-sort",th.dataset.key===state.sortKey?(state.sortDir==="asc"?"ascending":"descending"):"none");
  });
  if(!rows.length){body.innerHTML='<tr><td colspan="8" class="empty-cell">No players match that search.</td></tr>';return}
  body.innerHTML=rows.map(p=>`
    <tr>
      <td class="player-cell">
        <div class="headshot-wrap"><img class="headshot" src="${esc(p.headshot||fallbackHeadshot(p.name))}" alt="" loading="lazy" onerror="this.src='${fallbackHeadshot(p.name)}'"></div>
        <div><div class="player-name">${esc(p.name)}</div><div class="player-meta"><span>${esc(p.position||"—")}</span><span class="team-dot"></span><span>${esc(p.team||"NFL")}</span></div></div>
      </td>
      <td class="stat-strong">${fmt.format(safe(p.touchdowns))}</td>
      <td class="all-purpose">${fmt.format(safe(p.allPurposeYards))}</td>
      <td>${fmt.format(safe(p.receivingYards))}</td>
      <td>${fmt.format(safe(p.rushingYards))}</td>
      <td>${fmt.format(safe(p.receptions))}</td>
      <td>${fmt.format(safe(p.passingTouchdowns))}</td>
      <td>${fmt.format(safe(p.passingYards))}</td>
    </tr>`).join("");
}
async function load(){
  try{
    const res=await fetch(`data/nfl-stats.json?v=${Date.now()}`,{cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    state.players=Array.isArray(data.players)?data.players:[];
    seasonLabel.textContent=`${data.season||"Current"} Regular Season`;
    if(data.updatedAt){
      const d=new Date(data.updatedAt);
      updatedLabel.textContent=`Updated ${new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(d)}`;
    }else updatedLabel.textContent="Awaiting first automated refresh";
    render();
  }catch(err){
    console.error(err);
    body.innerHTML='<tr><td colspan="8" class="empty-cell">Stats have not been generated yet. Run the “Update NFL Stats & Deploy” GitHub Action once.</td></tr>';
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
load();