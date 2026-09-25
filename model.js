(()=>{
"use strict";
const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat("en-US");
const DEFAULTS={l5:60,l10:55,h2h:0,current:50,previous:0,targetShare:0,carryShare:0,opportunityShare:0,dvpMin:0,dvpSample:2,teamMatchupMin:0,targetsPerGameMin:0,carriesPerGameMin:0,edgeMin:-20,oddsSpread:600,legOddsMin:-500,legOddsMax:500,parlayOddsMin:100,parlayOddsMax:350,legsMin:2,legsMax:4,weights:{recent:30,season:22,h2h:12,usage:14,matchup:14,value:8}};
const PRESETS={
  "even-ladder":{label:"Even Ladder",l5:100,l10:75,h2h:0,current:0,previous:70,legOddsMin:-1200,legOddsMax:-280,parlayOddsMin:-110,parlayOddsMax:110,legsMin:3,legsMax:6,oddsSpread:700,edgeMin:-20,uniquePlayers:true,avoidSameGame:false},
  "ten-x":{label:"+1000 Sharp",l5:70,l10:65,h2h:0,current:55,previous:55,legOddsMin:-500,legOddsMax:250,parlayOddsMin:850,parlayOddsMax:1200,legsMin:3,legsMax:5,oddsSpread:1000,edgeMin:0,teamMatchupMin:45,uniquePlayers:true,avoidSameGame:false},
  "high-confidence":{label:"High Confidence",l5:80,l10:70,h2h:0,current:60,previous:60,legOddsMin:-900,legOddsMax:-150,parlayOddsMin:-130,parlayOddsMax:180,legsMin:2,legsMax:4,oddsSpread:650,edgeMin:-2,teamMatchupMin:50,uniquePlayers:true,avoidSameGame:false},
  "balanced-value":{label:"Balanced Value",l5:65,l10:60,h2h:0,current:55,previous:55,legOddsMin:-450,legOddsMax:150,parlayOddsMin:250,parlayOddsMax:550,legsMin:2,legsMax:4,oddsSpread:800,edgeMin:1,teamMatchupMin:40,uniquePlayers:true,avoidSameGame:false}
};
const HIT_LABELS=[["l5","L5"],["l10","L10"],["h2h","H2H"],["current","2026"],["previous","2025"]];
const WEIGHT_LABELS=[["recent","Recent form"],["season","Season"],["h2h","H2H"],["usage","Usage"],["matchup","Opponent"],["value","Price edge"]];
const state={season:null,players:[],odds:[],teams:[],teamRaw:null,teamProfiles:new Map(),teamStatMeta:new Map(),playerByName:new Map(),usage:new Map(),dvp:new Map(),eligible:[],slips:[],slipPage:0,weights:Object.assign({},DEFAULTS.weights),timer:0,chartRows:new Map(),hitRateActiveRow:null,hitRateActiveSplit:null,opponentRankCache:new Map(),calibration:null,learning:null,pricePairs:new Map(),historyCache:new Map(),forecastCache:new Map(),usageStabilityCache:new Map(),teamDefenseCache:new Map(),selectedPositions:new Set(),selectedMarkets:new Set(),selectedSides:new Set(),selectedGames:new Set(),modelScope:"",entityRules:new Map(),ladderData:{picks:[]},ladderIndex:0,modelDate:"live",modelHistorical:false,modelHistoryIndex:{days:[]},modelHistoryManifest:null,resultPlayers:[],resultTeams:[],resultPlayerByName:new Map(),resultTeamByAbbr:new Map(),resultSeason:null,liveLadderData:{picks:[]},resultCache:new Map(),slipMembership:new Map(),loadingDate:false,signalSortKey:"score",signalSortDir:"desc"};
const SLIPS_PER_PAGE=6;
const MODEL_RAW_BASE="https://raw.githubusercontent.com/ryanehinkle/sports-tracker/";
const ENTITY_RULE_STORAGE_KEY="nflModelEntityRulesV1";

function modelArchiveUrl(commit,path){
  return MODEL_RAW_BASE+encodeURIComponent(String(commit||""))+"/"+String(path||"").replace(/^\/+/, "");
}
function formatModelHistoryDate(value){
  if(!value||value==="live")return"Live Model";
  const d=new Date(String(value)+"T12:00:00");
  return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(d);
}
function resultIcon(status){return status==="hit"?"✓":status==="miss"?"×":status==="push"?"↔":"•"}
function resultLabel(status){return status==="hit"?"Hit":status==="miss"?"Miss":status==="push"?"Push":"Pending"}
function modelResultBadge(result,small=false){
  if(!state.modelHistorical)return"";
  const status=String(result&&result.status||"pending");
  const actual=result&&result.actual!==undefined&&result.actual!==null?'<small>'+esc(String(result.actual))+'</small>':"";
  return'<span class="historical-result-badge result-'+esc(status)+(small?" compact":"")+'"><b>'+resultIcon(status)+'</b><span>'+resultLabel(status)+'</span>'+actual+'</span>';
}
function setResultSources(stats,teams,ladder){
  state.resultPlayers=stats&&stats.players||[];
  state.resultTeams=teams&&teams.teams||[];
  state.resultSeason=Number(stats&&stats.season||teams&&teams.season||new Date().getFullYear());
  state.resultPlayerByName=new Map(state.resultPlayers.map(p=>[norm(p.name),p]));
  state.resultTeamByAbbr=new Map(state.resultTeams.map(t=>[String(t.abbreviation||"").toUpperCase(),t]).filter(([k])=>k));
  state.liveLadderData=ladder||{picks:[]};
  state.resultCache.clear();
}
function resultPlayerLogs(player){
  const out=[],by=player&&player.gameLogsBySeason||{};
  for(const [season,games] of Object.entries(by)){
    for(const game of games||[])if(game&&game.played)out.push(Object.assign({_season:Number(season)},game));
  }
  if(!Object.keys(by).length){
    for(const game of player&&player.gameLog||[])if(game&&game.played)out.push(Object.assign({_season:state.resultSeason},game));
  }
  return out;
}
function resultTeamLogs(team){
  const out=[],by=team&&team.gameLogsBySeason||{};
  for(const [season,games] of Object.entries(by)){
    for(const game of games||[])if(game)out.push(Object.assign({_season:Number(season)},game));
  }
  if(!Object.keys(by).length){
    for(const game of team&&team.gameLog||[])if(game)out.push(Object.assign({_season:state.resultSeason},game));
  }
  return out;
}
function resultGameMatch(g,row,opponent){
  const gameOpp=String(g&&g.opponent&&g.opponent.abbreviation||"").toUpperCase();
  if(opponent&&gameOpp!==String(opponent).toUpperCase())return false;
  const eventTime=Date.parse(row&&row.commenceTime||""),gameTime=Date.parse(g&&g.date||"");
  if(Number.isFinite(eventTime)&&Number.isFinite(gameTime)&&Math.abs(gameTime-eventTime)>60*60*1000*60)return false;
  return true;
}
function closestResultGame(games,row,opponent){
  const eventTime=Date.parse(row&&row.commenceTime||"");
  const candidates=(games||[]).filter(g=>resultGameMatch(g,row,opponent));
  candidates.sort((a,b)=>{
    if(!Number.isFinite(eventTime))return num(b&&b.week)-num(a&&a.week);
    const at=Date.parse(a&&a.date||""),bt=Date.parse(b&&b.date||"");
    return Math.abs((Number.isFinite(at)?at:eventTime)-eventTime)-Math.abs((Number.isFinite(bt)?bt:eventTime)-eventTime);
  });
  return candidates[0]||null;
}
function historicalPlayerResult(row){
  const player=state.resultPlayerByName.get(norm(row&&row.player));if(!player)return{status:"pending"};
  const opponent=nextOpponent(row),game=closestResultGame(resultPlayerLogs(player),row,opponent),spec=metricSpec(row);
  if(!game||!spec)return{status:"pending"};
  const value=metricValue(game,spec.metric);if(!Number.isFinite(value))return{status:"pending"};
  const threshold=Number.isFinite(Number(spec.threshold))?Number(spec.threshold):Number(row.line);
  if(!Number.isFinite(threshold))return{status:"pending"};
  let hit;
  if(spec.comparison==="gte"){
    const base=value>=threshold;hit=String(row.selection||"").toLowerCase()==="no"?!base:base;
  }else if(String(row.selection||"")==="Under")hit=value<threshold;
  else if(String(row.selection||"")==="No")hit=value<=threshold;
  else hit=value>threshold;
  const push=spec.comparison!=="gte"&&["Over","Under"].includes(String(row.selection||""))&&Math.abs(value-threshold)<1e-9;
  return{status:push?"push":hit?"hit":"miss",actual:value};
}
function teamResultValue(row,game){
  const stats=game&&game.stats||{},pf=num(stats["derived.pointsFor"]),pa=num(stats["derived.pointsAgainst"]);
  if(row.teamMarketType==="moneyline"||row.teamMarketType==="spread")return pf-pa;
  if(row.teamMarketType==="teamTotal")return pf;
  if(row.teamMarketType==="gameTotal")return pf+pa;
  return null;
}
function historicalTeamResult(row){
  const selected=String(row.team||row.homeAbbr||"").toUpperCase(),team=state.resultTeamByAbbr.get(selected);if(!team)return{status:"pending"};
  const opponent=selected===String(row.homeAbbr||"").toUpperCase()?String(row.awayAbbr||"").toUpperCase():String(row.homeAbbr||"").toUpperCase();
  const game=closestResultGame(resultTeamLogs(team),row,opponent);if(!game)return{status:"pending"};
  const value=teamResultValue(row,game);if(!Number.isFinite(value))return{status:"pending"};
  if(row.teamMarketType==="moneyline"){
    if(value===0)return{status:"push",actual:value};
    return{status:value>0?"hit":"miss",actual:value};
  }
  const line=Number(row.line);if(!Number.isFinite(line))return{status:"pending"};
  if(row.teamMarketType==="spread"){
    const adjusted=value+line;
    if(Math.abs(adjusted)<1e-9)return{status:"push",actual:value};
    return{status:adjusted>0?"hit":"miss",actual:value};
  }
  if(Math.abs(value-line)<1e-9)return{status:"push",actual:value};
  const hit=String(row.selection||"")==="Under"?value<line:value>line;
  return{status:hit?"hit":"miss",actual:value};
}
function historicalResultForRow(row){
  if(!state.modelHistorical)return{status:"live"};
  const key=modelPropKey(row);
  if(state.resultCache.has(key))return state.resultCache.get(key);
  const result=["team","game"].includes(row&&row.scope)?historicalTeamResult(row):historicalPlayerResult(row);
  state.resultCache.set(key,result);return result;
}
function combinedHistoricalStatus(results){
  const statuses=(results||[]).map(r=>String(r&&r.status||"pending"));
  if(!statuses.length||statuses.includes("pending"))return"pending";
  if(statuses.includes("miss"))return"miss";
  if(statuses.includes("push"))return"push";
  return"hit";
}
function currentLadderResultForLeg(leg){
  for(const pick of state.liveLadderData&&state.liveLadderData.picks||[]){
    const found=(pick.legs||[]).find(x=>String(x.key||"")===String(leg.key||""));
    const status=String(found&&found.result&&found.result.status||"");
    if(["hit","miss","push"].includes(status))return found.result;
  }
  return null;
}
function resolvedLadderLegResult(leg){
  if(!state.modelHistorical)return leg.result||{status:"pending"};
  return currentLadderResultForLeg(leg)||historicalResultForRow(leg);
}
function archivedLadderData(frozen){
  if(!state.modelHistorical)return frozen||{picks:[]};
  const copy=JSON.parse(JSON.stringify(frozen||{picks:[]}));
  for(const pick of copy.picks||[]){
    for(const leg of pick.legs||[])leg.result=resolvedLadderLegResult(leg);
    pick.status=combinedHistoricalStatus((pick.legs||[]).map(leg=>leg.result));
  }
  return copy;
}
function slipMembershipFor(row){
  return state.slipMembership.get(modelPropKey(row))||[];
}
function buildSlipMembership(){
  state.slipMembership=new Map();
  state.slips.forEach((slip,index)=>{
    for(const leg of slip.legs||[]){
      const key=modelPropKey(leg.row);
      if(!state.slipMembership.has(key))state.slipMembership.set(key,[]);
      state.slipMembership.get(key).push(index+1);
    }
  });
}
function resetModelCaches(){
  state.pricePairs=new Map();state.usage=new Map();state.dvp=new Map();state.teamProfiles=new Map();state.teamStatMeta=new Map();
  state.historyCache.clear();state.forecastCache.clear();state.usageStabilityCache.clear();state.teamDefenseCache.clear();state.opponentRankCache.clear();state.resultCache.clear();
}
function renderModelDateOptions(){
  const days=state.modelHistoryIndex&&state.modelHistoryIndex.days||[];
  $("modelDateOptions").innerHTML=
    '<button type="button" class="filter-option model-date-option '+(state.modelDate==="live"?"selected":"")+'" data-model-date="live"><span class="filter-option-label"><strong>Live Model</strong><small>Current stats, lines and predictions</small></span><span class="option-checkbox">'+(state.modelDate==="live"?"✓":"")+'</span></button>'+
    days.map(day=>{
      const active=state.modelDate===day.date;
      return'<button type="button" class="filter-option model-date-option '+(active?"selected":"")+'" data-model-date="'+esc(day.date)+'" data-model-history-file="'+esc(day.file||day.date+".json")+'"><span class="filter-option-label"><strong>'+esc(formatModelHistoryDate(day.date))+'</strong><small>Frozen pregame model</small></span><span class="option-checkbox">'+(active?"✓":"")+'</span></button>';
    }).join("");
  $("modelDateLabel").textContent=state.modelDate==="live"?"Live Model":formatModelHistoryDate(state.modelDate);
}
function closeModelDatePopover(){
  const pop=$("modelDatePopover"),button=$("modelDateButton");if(!pop||!button)return;
  pop.hidden=true;button.setAttribute("aria-expanded","false");button.classList.remove("open");
}
function toggleModelDatePopover(){
  const pop=$("modelDatePopover"),button=$("modelDateButton"),opening=pop.hidden;
  closeModelDatePopover();if(!opening)return;
  document.body.appendChild(pop);pop.hidden=false;
  const rect=button.getBoundingClientRect(),width=pop.offsetWidth||290;
  pop.style.left=Math.max(10,Math.min(rect.left,window.innerWidth-width-10))+"px";
  let top=rect.bottom+8;if(top+(pop.offsetHeight||320)>window.innerHeight-10)top=Math.max(10,rect.top-(pop.offsetHeight||320)-8);
  pop.style.top=top+"px";button.setAttribute("aria-expanded","true");button.classList.add("open");
}
async function fetchModelJson(url,cache="no-store"){
  const res=await fetch(url,{cache});if(!res.ok)throw new Error("HTTP "+res.status+" for "+url);return res.json();
}
async function loadModelHistoryIndex(){
  try{state.modelHistoryIndex=await fetchModelJson("data/model-history/index.json?v="+Date.now())}
  catch(_){state.modelHistoryIndex={days:[]}}
  renderModelDateOptions();
}
async function fetchLiveModelBundle(){
  const [stats,odds,teams,calibration,learning,ladder]=await Promise.all([
    fetchModelJson("data/nfl-stats.json?v="+Date.now()),
    fetchModelJson("data/nfl-odds.json?v="+Date.now()),
    fetchModelJson("data/nfl-team-stats.json?v="+Date.now()),
    fetchModelJson("data/model-calibration.json?v="+Date.now()).catch(()=>null),
    fetchModelJson("data/model-learning.json?v="+Date.now()).catch(()=>null),
    fetchModelJson("data/ladder-picks.json?v="+Date.now()).catch(()=>({picks:[]}))
  ]);
  return{stats,odds,teams,calibration,learning,ladder};
}
async function fetchHistoricalModelBundle(manifest){
  const commit=manifest&&manifest.sourceCommit,files=manifest&&manifest.files||{};
  if(!commit)throw new Error("Historical model commit missing");
  const [stats,odds,teams,calibration,learning,ladder]=await Promise.all([
    fetchModelJson(modelArchiveUrl(commit,files.stats||"data/nfl-stats.json"),"force-cache"),
    fetchModelJson(modelArchiveUrl(commit,files.odds||"data/nfl-odds.json"),"force-cache"),
    fetchModelJson(modelArchiveUrl(commit,files.teamStats||"data/nfl-team-stats.json"),"force-cache"),
    fetchModelJson(modelArchiveUrl(commit,files.calibration||"data/model-calibration.json"),"force-cache").catch(()=>null),
    fetchModelJson(modelArchiveUrl(commit,files.learning||"data/model-learning.json"),"force-cache").catch(()=>null),
    fetchModelJson(modelArchiveUrl(commit,files.ladder||"data/ladder-picks.json"),"force-cache").catch(()=>({picks:[]}))
  ]);
  return{stats,odds,teams,calibration,learning,ladder};
}
function applyModelBundle(bundle,{historical=false,date="live",manifest=null}={}){
  const stats=bundle.stats||{},odds=bundle.odds||{},teams=bundle.teams||{teams:[]};
  state.modelHistorical=historical;state.modelDate=historical?date:"live";state.modelHistoryManifest=manifest;
  state.season=stats.season||new Date().getFullYear();state.players=stats.players||[];state.teams=teams.teams||[];state.teamRaw=teams;state.calibration=bundle.calibration||null;state.learning=bundle.learning||null;
  state.playerByName=new Map(state.players.map(p=>[norm(p.name),p]));state.odds=flattenOdds(odds);
  state.ladderData=archivedLadderData(bundle.ladder||{picks:[]});
  resetModelCaches();buildPricePairs();buildUsage();buildDvp();buildTeamProfiles();fillSelects();renderLadderLaunch();if(!$("ladderChallengePanel").hidden)renderLadderPick();renderModelDateOptions();
  $("modelResultHead").hidden=!historical;
  document.body.classList.toggle("model-history-mode",historical);
  $("modelSeason").textContent=historical
    ? (state.season+" Archive • "+fmt.format(state.odds.length)+" markets")
    : (state.season+" Model • "+fmt.format(state.odds.length)+" markets");
  const updated=odds.updatedAt||stats.updatedAt||manifest&&manifest.capturedAt;
  $("modelUpdated").textContent=historical
    ? ("Frozen "+formatModelHistoryDate(date)+(updated?" • "+new Date(updated).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):""))
    : (updated?"Updated "+new Date(updated).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"Live analytical model");
  recalc();
}
async function loadModelDate(date,file){
  if(state.loadingDate||date===state.modelDate)return;
  state.loadingDate=true;closeModelDatePopover();
  $("modelUpdated").textContent=date==="live"?"Refreshing live model…":"Loading frozen model…";
  $("recommendedSlips").innerHTML='<div class="model-loading"><span class="spinner"></span>Loading '+(date==="live"?"live":"archived")+' model data…</div>';
  try{
    if(date==="live"){
      const bundle=await fetchLiveModelBundle();
      setResultSources(bundle.stats,bundle.teams,bundle.ladder);
      applyModelBundle(bundle,{historical:false,date:"live"});
    }else{
      const historyFile=file||date+".json";
      const manifest=await fetchModelJson("data/model-history/"+encodeURIComponent(historyFile)+"?v="+Date.now());
      const bundle=await fetchHistoricalModelBundle(manifest);
      // Current completed-game data is used only for grading; the model itself
      // continues to run entirely on the frozen bundle above.
      const live=await fetchLiveModelBundle();
      setResultSources(live.stats,live.teams,live.ladder);
      state.liveLadderData=live.ladder||{picks:[]};
      applyModelBundle(bundle,{historical:true,date,manifest});
    }
  }catch(err){
    console.error(err);$("modelUpdated").textContent="Historical model load failed";
    $("recommendedSlips").innerHTML='<div class="model-empty">That frozen Model archive could not be loaded.</div>';
  }finally{state.loadingDate=false}
}

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
function rowDecimalOdds(row){const exact=Number(row&&row.decimalOdds);return Number.isFinite(exact)&&exact>1?exact:americanToDecimal(row&&row.odds)}
function formatOdds(o){o=Number(o);return Number.isFinite(o)?(o>0?"+":"")+Math.round(o):"—"}
function formatSpreadLine(v){const x=Number(v);if(!Number.isFinite(x))return"—";if(Math.abs(x)<1e-9)return"PK";return(x>0?"+":"")+String(x)}
function spreadMeaning(row){if(!row||row.teamMarketType!=="spread")return"";const x=Number(row.line);if(!Number.isFinite(x))return"";if(Math.abs(x)<1e-9)return"pick'em";return x>0?"gets "+Math.abs(x)+" pts":"gives "+Math.abs(x)+" pts"}
function fallbackHeadshot(){return "https://a.espncdn.com/i/headshots/nfl/players/full/0.png"}
function modelTeamLogo(abbr){return abbr?"https://a.espncdn.com/i/teamlogos/nfl/500/"+String(abbr).toLowerCase()+".png":fallbackHeadshot()}
function modelShortTeam(name){const parts=String(name||"").trim().split(/\s+/);return parts.length?parts[parts.length-1]:"Team"}
function modelGameTime(value){const d=new Date(value);return Number.isNaN(d.getTime())?"":new Intl.DateTimeFormat("en-US",{weekday:"long",hour:"numeric",minute:"2-digit"}).format(d)}
function modelPropKey(row){return [row.eventId||"",row.player||row.team||row.scope||"",row.market||"",row.selection||"",row.line??"",row.proposition||""].join("¦")}
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

function buildTeamProfiles(){
  state.teamProfiles=new Map();state.teamStatMeta=new Map();
  for(const view of state.teamRaw&&state.teamRaw.views||[]){
    for(const stat of view.stats||[]){
      if(stat&&stat.key&&!state.teamStatMeta.has(stat.key)){
        state.teamStatMeta.set(stat.key,{group:stat.group||view.key||"other",higherBetter:stat.higherBetter!==false,label:stat.label||stat.key});
      }
    }
  }
  const keys=[...new Set(state.teams.flatMap(team=>Object.entries(team.stats||{}).filter(([,v])=>Number.isFinite(Number(v))).map(([k])=>k)))];
  const peers=new Map(keys.map(key=>[key,state.teams.map(t=>Number(t.stats&&t.stats[key])).filter(Number.isFinite)]));
  for(const team of state.teams){
    const groups=new Map(),all=[];
    for(const key of keys){
      const value=Number(team.stats&&team.stats[key]);if(!Number.isFinite(value))continue;
      const raw=percentile(value,peers.get(key)||[]);if(!Number.isFinite(raw))continue;
      const meta=state.teamStatMeta.get(key)||{group:/allowed|against/i.test(key)?"defense":"offense",higherBetter:!/allowed|against|giveaway|penalt|loss/i.test(key)};
      const signal=(meta.higherBetter?raw:100-raw)/100;
      if(!groups.has(meta.group))groups.set(meta.group,[]);
      groups.get(meta.group).push(signal);all.push(signal);
    }
    const groupSignals={};for(const [group,values] of groups)groupSignals[group]=avg(values)??.5;
    const abbr=String(team.abbreviation||"").toUpperCase();
    if(abbr)state.teamProfiles.set(abbr,{team,groups:groupSignals,all:avg(all)??.5,featureCount:all.length});
  }
}
function teamProfile(abbr){return state.teamProfiles.get(String(abbr||"").toUpperCase())||null}
function teamGroup(profile,key){return profile&&Number.isFinite(profile.groups&&profile.groups[key])?profile.groups[key]:profile&&Number.isFinite(profile.all)?profile.all:.5}
function teamMarketSignal(row){
  const home=teamProfile(row.homeAbbr),away=teamProfile(row.awayAbbr);if(!home||!away)return{signal:.5,breadth:0,components:{}};
  const kind=row.teamMarketType,teamAbbr=String(row.team||"").toUpperCase();
  const selected=teamProfile(teamAbbr),opponent=teamAbbr===String(row.homeAbbr||"").toUpperCase()?away:home;
  let signal=.5,components={};
  if((kind==="moneyline"||kind==="spread")&&selected&&opponent){
    const strength=p=>.22*teamGroup(p,"offense")+.22*teamGroup(p,"defense")+.17*teamGroup(p,"scoring")+.13*teamGroup(p,"situational")+.11*teamGroup(p,"turnovers")+.08*teamGroup(p,"specialTeams")+.07*p.all;
    const own=strength(selected),opp=strength(opponent),expectedMargin=(own-opp)*17;
    // Spread lines are always from the selected team's perspective:
    // +7.5 means the team receives 7.5 points; -7.5 means it gives 7.5.
    // The matchup signal therefore evaluates expectedMargin + spreadLine.
    signal=kind==="spread"
      ? logistic((expectedMargin+(Number(row.line)||0))/6.5)
      : logistic(expectedMargin/7);
    signal=clamp(signal,.05,.95);
    components={offense:teamGroup(selected,"offense"),defense:teamGroup(selected,"defense"),scoring:teamGroup(selected,"scoring"),situational:teamGroup(selected,"situational"),turnovers:teamGroup(selected,"turnovers"),specialTeams:teamGroup(selected,"specialTeams"),all:selected.all,expectedMargin:expectedMargin,spreadLine:kind==="spread"?(Number(row.line)||0):0};
  }else{
    const scoringEnv=.20*teamGroup(home,"offense")+.20*teamGroup(away,"offense")+.17*teamGroup(home,"scoring")+.17*teamGroup(away,"scoring")+.08*(1-teamGroup(home,"defense"))+.08*(1-teamGroup(away,"defense"))+.04*teamGroup(home,"situational")+.04*teamGroup(away,"situational")+.01*home.all+.01*away.all;
    signal=clamp(scoringEnv,.05,.95);
    if(kind==="teamTotal"&&selected&&opponent){
      signal=clamp(.34*teamGroup(selected,"offense")+.24*teamGroup(selected,"scoring")+.16*(1-teamGroup(opponent,"defense"))+.10*teamGroup(selected,"situational")+.08*teamGroup(selected,"specialTeams")+.08*selected.all,.05,.95);
    }
    if(String(row.selection||"")==="Under")signal=1-signal;
    components={offense:avg([teamGroup(home,"offense"),teamGroup(away,"offense")]),defense:avg([teamGroup(home,"defense"),teamGroup(away,"defense")]),scoring:avg([teamGroup(home,"scoring"),teamGroup(away,"scoring")]),situational:avg([teamGroup(home,"situational"),teamGroup(away,"situational")]),all:avg([home.all,away.all])};
  }
  const breadth=Math.min(1,((selected&&selected.featureCount)||home.featureCount||0)/Math.max(1,state.teamStatMeta.size||1));
  return{signal,breadth,components};
}
function normalizedRate(rate){return rate&&Number.isFinite(Number(rate.pct))?Number(rate.pct)/100:null}
function modelTeamLogs(abbr){
  const team=state.teams.find(t=>String(t.abbreviation||"").toUpperCase()===String(abbr||"").toUpperCase());
  if(!team)return[];
  const rows=[],by=team.gameLogsBySeason||{};
  for(const [season,games] of Object.entries(by))for(const game of games||[])rows.push(Object.assign({_season:Number(season)},game));
  if(!Object.keys(by).length)for(const game of team.gameLog||[])rows.push(Object.assign({_season:Number(state.season)},game));
  return rows.sort((a,b)=>(a._season-b._season)||num(a.week)-num(b.week));
}
function modelTeamPropHit(row,game){
  const stats=game&&game.stats||{},pf=num(stats["derived.pointsFor"]),pa=num(stats["derived.pointsAgainst"]),kind=row.teamMarketType;
  if(kind==="moneyline")return pf===pa?null:pf>pa;
  const line=Number(row.line);if(!Number.isFinite(line))return null;
  if(kind==="spread"){const adjusted=pf-pa+line;return Math.abs(adjusted)<1e-9?null:adjusted>0}
  const actual=kind==="teamTotal"?pf:kind==="gameTotal"?pf+pa:null;if(actual===null)return null;
  if(Math.abs(actual-line)<1e-9)return null;
  return String(row.selection||"")==="Under"?actual<line:actual>line;
}
function modelTeamRate(games,row){
  let hits=0,total=0;for(const game of games||[]){const hit=modelTeamPropHit(row,game);if(hit===null)continue;total++;if(hit)hits++}
  return total?{hits,total,pct:Math.round(hits/total*1000)/10}:null;
}
function recomputeTeamRates(row){
  const all=modelTeamLogs(row.team||row.homeAbbr),cutoff=Date.parse(row.commenceTime||""),opp=nextOpponent(row);
  const eligible=all.filter(game=>{const t=Date.parse(game.date||"");return !Number.isFinite(cutoff)||!Number.isFinite(t)||t<cutoff});
  const newest=[...eligible].reverse(),current=eligible.filter(g=>g._season===Number(state.season)),previous=eligible.filter(g=>g._season===Number(state.season)-1);
  const h2h=eligible.filter(g=>String(g.opponent&&g.opponent.abbreviation||"").toUpperCase()===opp);
  return{l5:modelTeamRate(newest.slice(0,5),row),l10:modelTeamRate(newest.slice(0,10),row),h2h:modelTeamRate(h2h,row),current:modelTeamRate(current,row),previous:modelTeamRate(previous,row)};
}
function teamRates(row){
  const r=row._recomputeTeamRates?recomputeTeamRates(row):(row.hitRates||{});
  return{l5:normalizeSplit(r.l5),l10:normalizeSplit(r.l10),h2h:normalizeSplit(r.h2h),current:normalizeSplit(r.current),previous:normalizeSplit(r.previous)};
}

const DVP_KEYS=["receivingYards","receptions","receivingTargets","rushingYards","rushingAttempts","passingYards","passingTouchdowns","rushingTouchdowns","receivingTouchdowns","touchdowns","allPurposeYards"];
function buildDvp(){
  const seasonCurrent=Number(state.season),seasonPrior=seasonCurrent-1,weekly=new Map();
  for(const p of state.players){
    const pos=String(p.position||"").toUpperCase();
    if(!["QB","RB","WR","TE"].includes(pos))continue;
    const by=p.gameLogsBySeason||{};
    for(const season of [seasonCurrent,seasonPrior]){
      const rows=Array.isArray(by[String(season)])?by[String(season)]:(season===seasonCurrent?p.gameLog||[]:[]);
      for(const g of rows){
        if(!g||!g.played)continue;
        const opp=String(g.opponent&&g.opponent.abbreviation||"").toUpperCase(),week=num(g.week);
        if(!opp||!week)continue;
        const key=[season,opp,pos,week].join("|"),entry=weekly.get(key)||{};
        for(const metric of DVP_KEYS){
          let value=0;
          if(metric==="touchdowns")value=num(g.rushingTouchdowns)+num(g.receivingTouchdowns);
          else if(metric==="allPurposeYards")value=num(g.rushingYards)+num(g.receivingYards);
          else value=num(g[metric]);
          entry[metric]=(entry[metric]||0)+value;
        }
        weekly.set(key,entry);
      }
    }
  }
  const teamPos=new Map();
  for(const [key,metrics] of weekly){
    const parts=key.split("|"),season=Number(parts[0]),opp=parts[1],pos=parts[2],bucketKey=opp+"|"+pos;
    const bucket=teamPos.get(bucketKey)||{current:[],prior:[]};
    (season===seasonCurrent?bucket.current:bucket.prior).push(metrics);teamPos.set(bucketKey,bucket);
  }
  const means=new Map();
  for(const [key,bucket] of teamPos){
    const metrics={};
    for(const metric of DVP_KEYS){
      const cur=bucket.current.map(g=>num(g[metric])),prior=bucket.prior.map(g=>num(g[metric]));
      const cw=cur.length,pw=prior.length*.35,total=cw+pw;
      metrics[metric]=total?((avg(cur)*cw)+(avg(prior)*pw))/total:0;
    }
    means.set(key,{currentGames:bucket.current.length,priorGames:bucket.prior.length,metrics:metrics});
  }
  state.dvp.clear();
  for(const [key,row] of means){
    const pos=key.split("|")[1],entry={samples:row.currentGames,currentGames:row.currentGames,priorGames:row.priorGames,metrics:{}};
    for(const metric of DVP_KEYS){
      const peers=[];for(const [peerKey,peer] of means)if(peerKey.endsWith("|"+pos))peers.push(peer.metrics[metric]);
      entry.metrics[metric]={value:row.metrics[metric],percentile:percentile(row.metrics[metric],peers)};
    }
    state.dvp.set(key,entry);
  }
}
function metricSpec(row){
  const market=String(row.market||row.proposition||"").toLowerCase();
  const prop=String(row.proposition||"").toLowerCase();
  const text=(market+" "+prop).replace(/\s+/g," ");

  if(/first touchdown scorer|last touchdown scorer|quarter td scorer|\b(?:1q|2q|3q|4q|1h|2h)\b|\bquarter\b|\bhalf\b|\bdrive\b|\bmost\s+(?:rushing|receiving|passing)\s+yards\b/.test(text))return null;

  let match=text.match(/(?:player\s+)?to record a (\d+(?:\.\d+)?)\+ yard reception/);
  if(match)return{metric:"receivingLongest",threshold:Number(match[1]),comparison:"gte"};
  match=text.match(/(?:score\s+)?(\d+(?:\.\d+)?)\+ touchdowns?/);
  if(match)return{metric:"touchdowns",threshold:Number(match[1]),comparison:"gte"};

  if(/any time touchdown scorer|anytime touchdown scorer/.test(text))return{metric:"touchdowns",threshold:1,comparison:"gte"};
  if(/pass\s*\+\s*rush\s*\+\s*rec.*yards|pass.*rush.*reception.*yards/.test(text))return{metric:"passRushRecYards"};
  if(/pass(?:ing)?\s*(?:\+|plus)\s*rush(?:ing)?.*yards/.test(text))return{metric:"passRushYards"};
  if(/rush(?:ing)?\s*\+\s*receiv.*yards|rush.*receiv.*yards/.test(text))return{metric:"allPurposeYards"};
  if(/passing yards/.test(text))return{metric:"passingYards"};
  if(/receiving yards/.test(text))return{metric:"receivingYards"};
  if(/rushing yards/.test(text))return{metric:"rushingYards"};
  if(/receptions/.test(text)&&!/longest/.test(text))return{metric:"receptions"};
  if(/passing tds|passing touchdowns/.test(text))return{metric:"passingTouchdowns"};
  if(/receiving tds|receiving touchdowns/.test(text))return{metric:"receivingTouchdowns"};
  if(/rushing tds|rushing touchdowns/.test(text))return{metric:"rushingTouchdowns"};
  if(/rushing attempts|rush attempts/.test(text))return{metric:"rushingAttempts"};
  if(/pass attempts|passing attempts/.test(text))return{metric:"passingAttempts"};
  if(/pass completions|passing completions/.test(text))return{metric:"passingCompletions"};
  if(/interceptions thrown|pass interceptions/.test(text))return{metric:"passingInterceptions"};
  if(/longest completion|longest pass/.test(text))return{metric:"passingLongest"};
  if(/longest reception/.test(text))return{metric:"receivingLongest"};
  if(/longest rush/.test(text))return{metric:"rushingLongest"};
  if(/solo tackles/.test(text))return{metric:"soloTackles"};
  if(/tackles \+ assists/.test(text))return{metric:"totalTackles"};
  if(/(?:player\s+)?to record a sack|\brecord a sack\b/.test(text))return{metric:"sacks",threshold:1,comparison:"gte"};
  if(/\bsacks\b/.test(text))return{metric:"sacks"};
  if(/defensive interceptions/.test(text))return{metric:"defensiveInterceptions"};
  if(/field goals/.test(text))return{metric:"fieldGoalsMade"};
  if(/kicking points/.test(text))return{metric:"kickingPoints"};
  return null;
}
function metricValue(g,m){
  if(!g||!m)return null;
  if(m==="touchdowns")return num(g.rushingTouchdowns)+num(g.receivingTouchdowns);
  if(m==="allPurposeYards")return num(g.rushingYards)+num(g.receivingYards);
  if(m==="passRushRecYards")return num(g.passingYards)+num(g.rushingYards)+num(g.receivingYards);
  if(m==="passRushYards")return num(g.passingYards)+num(g.rushingYards);
  const value=g[m];
  return Number.isFinite(Number(value))?Number(value):null;
}
function isHit(g,row,spec){
  const hasSpecThreshold=Number.isFinite(Number(spec.threshold)),hasLine=row.line!==null&&row.line!==undefined&&row.line!=="";const threshold=hasSpecThreshold?Number(spec.threshold):(hasLine?Number(row.line):NaN);if(!Number.isFinite(threshold))return null;
  const value=metricValue(g,spec.metric);
  if(spec.comparison==="gte")return value>=threshold;
  return String(row.selection||"Over")==="Under"?value<threshold:value>threshold;
}
function split(logRows,row,spec){
  const values=logRows.map(g=>isHit(g,row,spec)).filter(v=>v!==null);if(!values.length)return null;
  const hits=values.filter(Boolean).length;return{hits:hits,total:values.length,pct:100*hits/values.length};
}
function normalizeSplit(x){if(!x)return null;if(Number.isFinite(Number(x.pct)))return{hits:Number(x.hits)||0,total:Number(x.total)||0,pct:Number(x.pct)};return null}
function playedHistory(player){
  const key=String(player&&player.id||norm(player&&player.name));
  if(state.historyCache.has(key))return state.historyCache.get(key);
  const rows=logs(player,false).filter(g=>g&&g.played).sort((a,b)=>(a._season-b._season)||num(a.week)-num(b.week));
  state.historyCache.set(key,rows);
  return rows;
}
function ratesForSelection(row,player,selection){
  const spec=metricSpec(row);if(!spec)return{l5:null,l10:null,h2h:null,current:null,previous:null};
  const probe=Object.assign({},row,{selection:selection}),all=playedHistory(player),newest=[...all].reverse();
  const current=all.filter(g=>g._season===Number(state.season)),prior=all.filter(g=>g._season===Number(state.season)-1),opp=nextOpponent(row);
  const h2h=all.filter(g=>String(g&&g.opponent&&g.opponent.abbreviation||"").toUpperCase()===opp);
  return{l5:split(newest.slice(0,5),probe,spec),l10:split(newest.slice(0,10),probe,spec),h2h:split(h2h,probe,spec),current:split(current,probe,spec),previous:split(prior,probe,spec)};
}
function ratesFor(row,player){
  if(!metricSpec(row))return{l5:null,l10:null,h2h:null,current:null,previous:null};
  if(row.hitRates)return{l5:normalizeSplit(row.hitRates.l5),l10:normalizeSplit(row.hitRates.l10),h2h:normalizeSplit(row.hitRates.h2h),current:normalizeSplit(row.hitRates.current),previous:normalizeSplit(row.hitRates.previous)};
  return ratesForSelection(row,player,String(row.selection||"Over"));
}
function smoothed(s,strength=3){if(!s||!s.total)return null;return(s.hits+.5*strength)/(s.total+strength)}
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
  if(m==="touchdowns"||m==="kickingPoints"||m==="fieldGoalsMade")return"derived.pointsAllowedPerGame";
  return"derived.yardsAllowedPerGame";
}
function teamDefensePercentile(opp,spec){
  const statKey=teamDefenseMetric(spec);
  if(!state.teamDefenseCache.has(statKey)){
    const peers=state.teams.map(t=>Number(t&&t.stats&&t.stats[statKey])).filter(Number.isFinite),map=new Map();
    for(const team of state.teams){
      const value=Number(team&&team.stats&&team.stats[statKey]),abbr=String(team&&team.abbreviation||"").toUpperCase();
      if(abbr&&Number.isFinite(value))map.set(abbr,percentile(value,peers));
    }
    state.teamDefenseCache.set(statKey,map);
  }
  return state.teamDefenseCache.get(statKey).get(String(opp||"").toUpperCase())??null;
}
function escapeRegex(value){return String(value||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}
function cleanDisplayPlayerName(value){
  let text=String(value||"").trim();
  text=text.replace(/\s+-\s+Alt\b.*$/i,"");
  text=text.replace(/\s+\d+(?:\.\d+)?\+\s*(?:Yards?|Yds?|Receptions?|TDs?|Touchdowns?)?\s*$/i,"");
  return text.trim();
}

function cleanDisplayProposition(row){
  if(row&&row.teamMarketType==="spread"){
    const label=row.alternate?"Alt Spread":"Spread";
    return label+" "+formatSpreadLine(row.line);
  }
  if(row&&row.teamMarketType==="moneyline")return"Moneyline";
  if(row&&row.teamMarketType==="teamTotal")return String(row.selection||"")+" "+modelFormatLine(row.line)+" "+(row.alternate?"Alt Team Total":"Team Total");
  if(row&&row.teamMarketType==="gameTotal")return String(row.selection||"")+" "+modelFormatLine(row.line)+" "+(row.alternate?"Alt Game Total":"Game Total");
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
  if(row&&["team","game"].includes(row.scope)) return String(row.market||"Team / Game Prop");
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
  if(/pass(?:ing)?\s*(?:\+|plus)\s*rush(?:ing)?.*yards/.test(lower)) return period+"Passing + Rushing Yards";
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

function modelSupportedMarketLabel(row){
  if(row&&["team","game"].includes(row.scope)) return String(row.market||"Team / Game Prop");
  const spec=metricSpec(row);
  if(!spec)return"";
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

function normalizedTeamMarketKey(value){return String(value||"").toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"")}
function normalizeLegacyTeamMarket(row,event){
  const key=normalizedTeamMarketKey(row.marketKey);
  const away=event.awayAbbr||"",home=event.homeAbbr||"";
  if(key.includes("AWAY_TEAM_TOTAL")||key.includes("HOME_TEAM_TOTAL")){
    const isAway=key.includes("AWAY_TEAM_TOTAL"),team=isAway?away:home,teamName=isAway?event.awayTeam:event.homeTeam;
    row.scope="team";row.teamMarketType="teamTotal";row.team=team;row.teamName=teamName||team;row.position="TEAM";
    row.market=row.alternate?"Alt Team Total":"Team Total";
    row.proposition=(row.selection||"")+" "+Number(row.line).toString()+" "+team+" "+row.market;
    row._recomputeTeamRates=true;
  }
  if(key==="ALTERNATE_HANDICAP"&&Number(row.line)===0){
    row._invalidTeamMarket=true;
  }
  return row;
}
function flattenOdds(raw){
  const out=[];
  for(const event of raw.events||[]){
    const away=event.awayAbbr||event.awayTeam||"AWAY",home=event.homeAbbr||event.homeTeam||"HOME";
    for(const prop of event.props||[]){
      let scope=prop.scope||"player",player=scope==="player"?state.playerByName.get(norm(prop.player)):null;
      const row=normalizeLegacyTeamMarket(Object.assign({},prop,{scope,eventId:String(event.id||""),awayAbbr:event.awayAbbr||"",homeAbbr:event.homeAbbr||"",awayTeam:event.awayTeam||"",homeTeam:event.homeTeam||"",matchup:away+" @ "+home,commenceTime:event.commenceTime||""}),event);
      if(row._invalidTeamMarket)continue;
      scope=row.scope||scope;
      player=scope==="player"?state.playerByName.get(norm(prop.player)):null;
      row.player=scope==="player"?clean(prop.player):"";
      row.team=row.team||player&&player.team||"";
      row.position=row.position||player&&player.position||(scope==="team"?"TEAM":scope==="game"?"GAME":"");
      row._marketLabel=generalizedMarketLabel(row);
      row._modelMarketLabel=modelSupportedMarketLabel(row);
      out.push(row);
    }
  }
  return out;
}

function pricePairKey(row){
  const event=String(row.eventId||""),kind=String(row.teamMarketType||"");
  if(kind==="moneyline")return[event,"team","moneyline"].join("|");
  if(kind==="spread")return[event,"team","spread",String(Math.abs(Number(row.line)||0))].join("|");
  if(kind==="gameTotal")return[event,"game","total",String(row.line??"")].join("|");
  if(kind==="teamTotal")return[event,"team",String(row.team||""),"total",String(row.line??"")].join("|");
  return[event,norm(row.player||row.team||row.scope||""),String(row._marketLabel||generalizedMarketLabel(row)||"").toLowerCase(),String(row.line??"")].join("|");
}
function buildPricePairs(){
  state.pricePairs=new Map();
  for(const row of state.odds){
    const key=pricePairKey(row),pair=state.pricePairs.get(key)||[];
    pair.push(row);state.pricePairs.set(key,pair);
  }
}
function marketProbability(row){
  const decimal=rowDecimalOdds(row),raw=decimal?1/decimal:null;
  if(!Number.isFinite(raw))return .5;
  const pair=state.pricePairs.get(pricePairKey(row))||[],side=String(row.selection||""),kind=String(row.teamMarketType||"");
  let otherRow=null;
  if(kind==="moneyline"||kind==="spread"){
    otherRow=pair.find(candidate=>candidate!==row&&String(candidate.team||"")!==String(row.team||""));
  }else{
    const opposite=side==="Over"?"Under":side==="Under"?"Over":side==="Yes"?"No":side==="No"?"Yes":"";
    otherRow=opposite?pair.find(candidate=>String(candidate.selection||"")===opposite):null;
  }
  const otherDecimal=otherRow?rowDecimalOdds(otherRow):null,other=otherDecimal?1/otherDecimal:null;
  return Number.isFinite(other)?raw/(raw+other):raw;
}
function learningRateValue(rate){
  if(rate&&Number.isFinite(Number(rate.pct)))return clamp(Number(rate.pct)/100,0,1);
  const hits=Number(rate&&rate.hits),total=Number(rate&&rate.total);
  return Number.isFinite(hits)&&Number.isFinite(total)&&total>0?clamp(hits/total,0,1):.5;
}
function adaptiveFeatureVector(row,rates,book){
  const total=key=>Math.max(0,Number(rates&&rates[key]&&rates[key].total)||0);
  const sample=Math.min(1,(total("l10")+total("current")+.35*total("previous"))/28);
  const spreadLine=row&&row.teamMarketType==="spread"?clamp((Number(row.line)||0)/14,-1,1):0;
  const side=String(row&&row.selection||""),scope=String(row&&row.scope||"player");
  return[
    clamp(Number(book)||.5,.02,.98),
    learningRateValue(rates&&rates.l5),
    learningRateValue(rates&&rates.l10),
    learningRateValue(rates&&rates.current),
    learningRateValue(rates&&rates.previous),
    learningRateValue(rates&&rates.h2h),
    sample,
    row&&row.alternate?1:0,
    spreadLine,
    side==="Under"||side==="No"?1:0,
    scope==="team"?1:0,
    scope==="game"?1:0
  ];
}
function adaptiveHitProbability(row,rates,book){
  const learning=state.learning||{},champion=learning.champion||{};
  const features=champion.features||learning.features||[];
  if(!Array.isArray(champion.coefficients)||features.length!==champion.coefficients.length||features.length!==12)return null;
  const vector=adaptiveFeatureVector(row,rates,book),means=champion.means||[],stds=champion.stds||[];
  let score=Number(champion.intercept)||0;
  for(let i=0;i<champion.coefficients.length;i++){
    const mean=Number(means[i]||0),std=Number(stds[i])||1;
    score+=(Number(champion.coefficients[i])||0)*((vector[i]-mean)/std);
  }
  return clamp(logistic(score),.02,.98);
}
function adaptiveBlend(){
  return clamp(Number(state.learning&&state.learning.liveBlend)||0,0,.55);
}
function blendAdaptiveProbability(base,row,rates,book){
  const learned=adaptiveHitProbability(row,rates,book),blend=adaptiveBlend();
  return Number.isFinite(learned)&&blend>0?clamp(base*(1-blend)+learned*blend,.03,.97):base;
}
function calibrationForMetric(metric){
  return state.calibration&&state.calibration.metrics&&state.calibration.metrics[metric]||null;
}
function logistic(value){return 1/(1+Math.exp(-Math.max(-20,Math.min(20,value))))}
function overForecastFeatures(row,player,dvpPct){
  const spec=metricSpec(row),threshold=Number.isFinite(Number(spec&&spec.threshold))?Number(spec.threshold):Number(row.line);
  if(!spec||!Number.isFinite(threshold))return null;
  const overRates=ratesForSelection(row,player,"Over"),history=playedHistory(player),recent=history.slice(-10),last5=recent.slice(-5);
  const values5=last5.map(g=>metricValue(g,spec.metric)).filter(Number.isFinite);
  if(!values5.length)return null;
  const m=avg(values5),variance=values5.length>1?values5.reduce((s,v)=>s+(v-m)*(v-m),0)/(values5.length-1):0,spread=Math.sqrt(variance)+1;
  const last3=values5.slice(-3),lineZ=(m-threshold)/spread,trend=(avg(last3)-m)/spread;
  const p=s=>s&&s.total?s.hits/s.total:.5;
  let seasonP=p(overRates.current);
  if(!overRates.current||overRates.current.total<4){
    const cur=overRates.current||{hits:0,total:0},prev=overRates.previous||{hits:0,total:0},total=cur.total+prev.total*.35;
    seasonP=total?(cur.hits+prev.hits*.35)/total:.5;
  }
  return{vector:[p(overRates.l5),p(overRates.l10),seasonP,lineZ,trend,Number.isFinite(dvpPct)?dvpPct/100:.5],overRates:overRates,historyCount:Math.min(10,recent.length)};
}
function calibratedOverProbability(row,player,dvpPct){
  const cacheKey=modelPropKey(row)+"|"+String(Number.isFinite(dvpPct)?Math.round(dvpPct*100)/100:"na");
  if(state.forecastCache.has(cacheKey))return state.forecastCache.get(cacheKey);
  const spec=metricSpec(row),features=overForecastFeatures(row,player,dvpPct),cal=calibrationForMetric(spec&&spec.metric);
  if(!features){
    const fallback={probability:.5,reliability:0,calibrationQuality:0,features:null};
    state.forecastCache.set(cacheKey,fallback);return fallback;
  }
  let probability;
  if(cal&&Array.isArray(cal.coefficients)&&Array.isArray(cal.means)&&Array.isArray(cal.stds)){
    let score=Number(cal.intercept)||0;
    for(let i=0;i<cal.coefficients.length;i++){
      const z=(features.vector[i]-Number(cal.means[i]||0))/(Number(cal.stds[i])||1);
      score+=Number(cal.coefficients[i]||0)*z;
    }
    probability=logistic(score);
  }else{
    probability=clamp(.28*features.vector[1]+.27*features.vector[2]+.22*logistic(features.vector[3]*1.5)+.08*logistic(features.vector[4])+.15*features.vector[5],.05,.95);
  }
  const reliability=clamp(features.historyCount/10,0,1);
  const testBrier=Number(cal&&cal.test&&cal.test.brier),testHit=Number(cal&&cal.test&&cal.test.hitRate);
  const baselineBrier=Number.isFinite(testHit)?testHit*(1-testHit):NaN;
  const brierLift=Number.isFinite(testBrier)&&baselineBrier>0?(baselineBrier-testBrier)/baselineBrier:0;
  // A model that barely beats a constant-rate baseline is deliberately shrunk
  // much harder toward the sportsbook. This is what keeps weak 2025 rushing-yard
  // calibration from flooding the board with RB props.
  const calibrationQuality=cal?clamp(brierLift/.12,0,1):.12;
  const result={probability:clamp(probability,.03,.97),reliability:reliability,calibrationQuality:calibrationQuality,features:features};
  state.forecastCache.set(cacheKey,result);return result;
}
function usageStability(player){
  const key=String(player&&player.id||norm(player&&player.name));
  if(state.usageStabilityCache.has(key))return state.usageStabilityCache.get(key);
  const rows=playedHistory(player).slice(-5);
  if(rows.length<2){state.usageStabilityCache.set(key,.5);return .5}
  const values=rows.map(g=>num(g.receivingTargets)+num(g.rushingAttempts)),m=avg(values);
  if(!m){state.usageStabilityCache.set(key,.5);return .5}
  const variance=values.reduce((s,v)=>s+(v-m)*(v-m),0)/(values.length-1),cv=Math.sqrt(variance)/(m+1),value=clamp(1-cv,0,1);
  state.usageStabilityCache.set(key,value);return value;
}

function modelEntityRuleKey(type,value){
  return type+":"+(type==="team"?String(value||"").toUpperCase():norm(value));
}
function saveModelEntityRules(){
  try{localStorage.setItem(ENTITY_RULE_STORAGE_KEY,JSON.stringify([...state.entityRules.values()]))}catch(_){}
}
function loadModelEntityRules(){
  try{
    const rows=JSON.parse(localStorage.getItem(ENTITY_RULE_STORAGE_KEY)||"[]");
    state.entityRules=new Map();
    if(Array.isArray(rows))for(const rule of rows){
      if(!rule||!["player","team"].includes(rule.type)||!["lock","ban"].includes(rule.mode))continue;
      const key=modelEntityRuleKey(rule.type,rule.value);
      state.entityRules.set(key,Object.assign({},rule,{key:key}));
    }
  }catch(_){state.entityRules=new Map()}
}
function modelEntityCatalog(){
  const players=state.players.map(player=>({
    key:modelEntityRuleKey("player",player.name),type:"player",value:player.name,label:player.name,
    sub:[player.position,player.team].filter(Boolean).join(" • "),image:player.headshot||fallbackHeadshot()
  }));
  const teams=state.teams.map(team=>{
    const abbr=String(team.abbreviation||"").toUpperCase();
    return{key:modelEntityRuleKey("team",abbr),type:"team",value:abbr,label:team.name||abbr,sub:abbr,image:team.logo||modelTeamLogo(abbr)};
  }).filter(item=>item.value);
  return players.concat(teams);
}
function modelRuleMatchesRow(rule,row,forBan=false){
  if(!rule||!row)return false;
  if(rule.type==="player")return row.scope==="player"&&norm(row.player)===norm(rule.value);
  const abbr=String(rule.value||"").toUpperCase();
  if(String(row.team||"").toUpperCase()===abbr)return true;
  if(forBan&&row.scope==="game"){
    return String(row.homeAbbr||"").toUpperCase()===abbr||String(row.awayAbbr||"").toUpperCase()===abbr;
  }
  return false;
}
function modelLockedRules(){return[...state.entityRules.values()].filter(rule=>rule.mode==="lock")}
function modelBannedRules(){return[...state.entityRules.values()].filter(rule=>rule.mode==="ban")}
function modelRowIsBanned(row){return modelBannedRules().some(rule=>modelRuleMatchesRow(rule,row,true))}
function modelSlipSatisfiesLocks(legs,locks=modelLockedRules()){
  return locks.every(rule=>(legs||[]).some(item=>modelRuleMatchesRow(rule,item.row||item,false)));
}
function renderModelEntitySearchResults(){
  const input=$("modelEntitySearch"),box=$("modelEntitySearchResults");if(!input||!box)return;
  const q=String(input.value||"").trim().toLowerCase();
  if(!q){box.hidden=true;box.innerHTML="";return}
  const results=modelEntityCatalog().filter(item=>{
    if(state.entityRules.has(item.key))return false;
    return (item.label+" "+item.sub+" "+item.value).toLowerCase().includes(q);
  }).slice(0,12);
  box.innerHTML=results.length?results.map(item=>
    '<button type="button" class="model-entity-result '+esc(item.type)+'" data-entity-add="'+esc(item.key)+'">'+
    '<img src="'+esc(item.image)+'" alt="" loading="lazy"><span><strong>'+esc(item.label)+'</strong><small>'+esc(item.type==="team"?"TEAM • "+item.sub:(item.sub||"PLAYER"))+'</small></span><span>Add</span></button>'
  ).join(""):'<div class="model-entity-rule-empty">No matching player or team.</div>';
  box.hidden=false;
}
function renderModelEntityRules(){
  const list=$("modelEntityRuleList"),count=$("modelEntityRuleCount"),details=$("modelEntityRuleDetails");if(!list||!count)return;
  const rules=[...state.entityRules.values()];
  count.textContent=String(rules.length);
  if(!rules.length){
    list.innerHTML='<div class="model-entity-rule-empty">Search above to add a player or team.</div>';
    return;
  }
  if(details)details.open=true;
  const catalog=new Map(modelEntityCatalog().map(item=>[item.key,item]));
  list.innerHTML=rules.map(rule=>{
    const item=catalog.get(rule.key)||{label:rule.label||rule.value,sub:rule.type==="team"?rule.value:"PLAYER",image:rule.type==="team"?modelTeamLogo(rule.value):fallbackHeadshot()};
    return'<div class="model-entity-rule '+esc(rule.type)+'" data-entity-rule="'+esc(rule.key)+'">'+
      '<img src="'+esc(item.image)+'" alt="" loading="lazy"><div class="model-entity-rule-copy"><strong>'+esc(item.label)+'</strong><small>'+esc(item.sub||rule.type)+'</small></div>'+
      '<button type="button" class="model-rule-mode lock '+(rule.mode==="lock"?"active":"")+'" data-rule-mode="lock" title="Force this player/team into every generated slip">Lock</button>'+
      '<button type="button" class="model-rule-mode ban '+(rule.mode==="ban"?"active":"")+'" data-rule-mode="ban" title="Exclude this player/team from the model">Ban</button>'+
      '<button type="button" class="model-rule-remove" data-rule-remove aria-label="Remove '+esc(item.label)+' rule">×</button></div>';
  }).join("");
}
function addModelEntityRule(key){
  const item=modelEntityCatalog().find(candidate=>candidate.key===key);if(!item)return;
  state.entityRules.set(key,{key:key,type:item.type,value:item.value,label:item.label,mode:"lock"});
  saveModelEntityRules();renderModelEntityRules();
  $("modelEntitySearch").value="";renderModelEntitySearchResults();recalc();
}
function setModelEntityRuleMode(key,mode){
  const rule=state.entityRules.get(key);if(!rule||!["lock","ban"].includes(mode))return;
  rule.mode=mode;state.entityRules.set(key,rule);saveModelEntityRules();renderModelEntityRules();recalc();
}
function removeModelEntityRule(key){
  state.entityRules.delete(key);saveModelEntityRules();renderModelEntityRules();recalc();
}

function controls(){
  const hit={};for(const [k] of HIT_LABELS)hit[k]=Number($(k+"Min").value)||0;
  const rawLegMin=Number($("legOddsMin").value),rawLegMax=Number($("legOddsMax").value);
  const legOddsMin=Math.min(rawLegMin,rawLegMax),legOddsMax=Math.max(rawLegMin,rawLegMax);
  const rawParlayMin=Number($("parlayOddsMin").value),rawParlayMax=Number($("parlayOddsMax").value);
  let parlayOddsMin=rawParlayMin,parlayOddsMax=rawParlayMax;
  const parlayMinD=americanToDecimal(rawParlayMin),parlayMaxD=americanToDecimal(rawParlayMax);
  if(Number.isFinite(parlayMinD)&&Number.isFinite(parlayMaxD)&&parlayMinD>parlayMaxD)[parlayOddsMin,parlayOddsMax]=[rawParlayMax,rawParlayMin];
  return{
    hit:hit,targetShare:Number($("targetShare").value)||0,carryShare:Number($("carryShare").value)||0,opportunityShare:Number($("opportunityShare").value)||0,
    targetsPerGameMin:Number($("targetsPerGameMin").value)||0,carriesPerGameMin:Number($("carriesPerGameMin").value)||0,
    dvpMin:Number($("dvpMin").value)||0,dvpSample:Number($("dvpSample").value)||1,teamMatchupMin:Number($("teamMatchupMin").value)||0,
    edgeMin:Number($("edgeMin").value),oddsSpread:Number($("oddsSpread").value)||600,requireOpponentData:$("requireOpponentData").checked,
    positions:state.selectedPositions,markets:state.selectedMarkets,sides:state.selectedSides,games:state.selectedGames,scope:state.modelScope,
    lineMin:$("lineMin").value===""?null:Number($("lineMin").value),lineMax:$("lineMax").value===""?null:Number($("lineMax").value),
    legOddsMin:legOddsMin,legOddsMax:legOddsMax,parlayOddsMin:parlayOddsMin,parlayOddsMax:parlayOddsMax,
    legsMin:clamp(Number($("legsMin").value)||1,1,10),legsMax:clamp(Number($("legsMax").value)||1,1,10),uniquePlayers:$("uniquePlayers").checked,avoidSameGame:$("avoidSameGame").checked,weights:Object.assign({},state.weights)
  };
}
function analyzeTeamMarket(row,cfg){
  const odds=Number(row.odds),hasLine=row.line!==null&&row.line!==undefined&&row.line!=="",line=hasLine?Number(row.line):null;
  if(!Number.isFinite(odds)||odds<cfg.legOddsMin||odds>cfg.legOddsMax)return null;
  if(cfg.lineMin!==null&&(!Number.isFinite(line)||line<cfg.lineMin))return null;
  if(cfg.lineMax!==null&&(!Number.isFinite(line)||line>cfg.lineMax))return null;

  const pos=String(row.position||row.scope||"TEAM").toUpperCase(),team=String(row.team||"").toUpperCase(),market=row._modelMarketLabel||modelSupportedMarketLabel(row);
  if(!market)return null;
  if(cfg.positions.size&&!cfg.positions.has(pos))return null;
  if(cfg.markets.size&&!cfg.markets.has(market))return null;
  if(cfg.sides.size&&!cfg.sides.has(String(row.selection||"")))return null;
  if(cfg.games.size&&!cfg.games.has(String(row.eventId)))return null;
  const rates=teamRates(row);
  for(const k of Object.keys(cfg.hit)){
    if(cfg.hit[k]>0&&(!rates[k]||rates[k].pct<cfg.hit[k]))return null;
  }

  const statModel=teamMarketSignal(row),matchupSignal=statModel.signal;
  if(cfg.teamMatchupMin>0&&matchupSignal*100<cfg.teamMatchupMin)return null;

  const book=marketProbability(row);
  const historicalParts=[
    [normalizedRate(rates.l5),.30],[normalizedRate(rates.l10),.26],
    [normalizedRate(rates.current),.16],[normalizedRate(rates.previous),.20],
    [normalizedRate(rates.h2h),.08]
  ].filter(([v])=>Number.isFinite(v));
  const history=historicalParts.length?historicalParts.reduce((s,[v,w])=>s+v*w,0)/historicalParts.reduce((s,[,w])=>s+w,0):book;
  const sampleTotal=Math.min(20,[rates.l10,rates.current,rates.previous].reduce((s,r)=>s+num(r&&r.total),0));
  const reliability=clamp(sampleTotal/18,0,1);
  // Team markets deliberately combine market price, actual historical cover/hit
  // rates, and a profile built from every numeric team-stat category.
  let modelProb=.30*book+.38*history+.32*statModel.signal;
  const shrink=.50+.32*reliability+.18*statModel.breadth;
  modelProb=clamp(book+(modelProb-book)*shrink,.03,.97);
  modelProb=blendAdaptiveProbability(modelProb,row,rates,book);
  const edge=modelProb-book;if(edge*100<cfg.edgeMin)return null;

  const recent=avg([normalizedRate(rates.l5),normalizedRate(rates.l10)].filter(Number.isFinite))??modelProb;
  const season=avg([normalizedRate(rates.current),normalizedRate(rates.previous)].filter(Number.isFinite))??recent;
  const h2h=normalizedRate(rates.h2h),h2hSignal=Number.isFinite(h2h)?h2h:season;
  const profileSignal=clamp(.55*statModel.breadth+.45*(statModel.components.all??statModel.signal),0,1);
  const valueSignal=clamp(.5+edge*3,0,1);
  const w=cfg.weights,total=Object.values(w).reduce((a,b)=>a+b,0)||1;
  const weightedSignal=(w.recent*recent+w.season*season+w.h2h*h2hSignal+w.usage*profileSignal+w.matchup*matchupSignal+w.value*valueSignal)/total;
  const score=100*clamp(.68*modelProb+.10*reliability+.12*statModel.breadth+.10*weightedSignal,0,1);

  const opp=team&&team===String(row.homeAbbr||"").toUpperCase()?String(row.awayAbbr||"").toUpperCase():team?String(row.homeAbbr||"").toUpperCase():"";
  return{row,player:null,pos,team,opp,market,rates,usage:{target:0,carry:0,opportunity:0,targetsPerGame:0,carriesPerGame:0},
    dvpRow:null,dvpPct:matchupSignal*100,favorableDvp:matchupSignal*100,teamMatchupPct:matchupSignal*100,dvpMetric:null,
    recentSignal:recent,seasonSignal:season,h2hSignal,usageSignal:profileSignal,matchupSignal,valueSignal,
    modelProb,impliedProb:book,edge,score,reliability,calibrationQuality:statModel.breadth,teamProfile:statModel};
}
function analyze(row,cfg){
  const scope=String(row&&row.scope||"player");
  if(cfg.scope&&scope!==cfg.scope)return null;
  if(modelRowIsBanned(row))return null;
  if(["team","game"].includes(scope))return analyzeTeamMarket(row,cfg);
  const player=state.playerByName.get(norm(row.player));if(!player)return null;
  const odds=Number(row.odds);
  const hasLine=row.line!==null&&row.line!==undefined&&row.line!=="",line=hasLine?Number(row.line):null;
  if(!Number.isFinite(odds)||odds<cfg.legOddsMin||odds>cfg.legOddsMax)return null;
  if(cfg.lineMin!==null&&(!Number.isFinite(line)||line<cfg.lineMin))return null;
  if(cfg.lineMax!==null&&(!Number.isFinite(line)||line>cfg.lineMax))return null;

  const pos=String(row.position||player.position||"").toUpperCase();
  const team=String(row.team||player.team||"").toUpperCase();
  const opp=nextOpponent(Object.assign({},row,{team:team}));
  const market=row._modelMarketLabel||modelSupportedMarketLabel(row);
  if(!market)return null;
  if(cfg.positions.size&&!cfg.positions.has(pos))return null;
  if(cfg.markets.size&&!cfg.markets.has(market))return null;
  if(cfg.sides.size&&!cfg.sides.has(String(row.selection||"")))return null;
  if(cfg.games.size&&!cfg.games.has(String(row.eventId)))return null;

  const spec=metricSpec(row);if(!spec)return null;
  const rates=ratesFor(row,player);
  for(const k of Object.keys(cfg.hit)){
    if(cfg.hit[k]>0&&(!rates[k]||rates[k].pct<cfg.hit[k]))return null;
  }

  const usage=state.usage.get(String(player.id))||{target:0,carry:0,opportunity:0,targetsPerGame:0,carriesPerGame:0};
  if(usage.target<cfg.targetShare||usage.carry<cfg.carryShare||usage.opportunity<cfg.opportunityShare||usage.targetsPerGame<cfg.targetsPerGameMin||usage.carriesPerGame<cfg.carriesPerGameMin)return null;

  const metric=dvpMetric(spec);
  const dvpRow=state.dvp.get(opp+"|"+pos);
  const dvpInfo=metric&&dvpRow&&dvpRow.metrics[metric];
  const dvpPct=dvpInfo&&Number(dvpInfo.percentile);
  const teamMatchupPct=teamDefensePercentile(opp,spec);
  const isUnder=String(row.selection||"")==="Under"||String(row.selection||"")==="No";
  const favorableDvp=Number.isFinite(dvpPct)?(isUnder?100-dvpPct:dvpPct):null;
  const favorableTeam=Number.isFinite(teamMatchupPct)?(isUnder?100-teamMatchupPct:teamMatchupPct):null;
  const effectiveDvpSample=dvpRow?num(dvpRow.currentGames)+num(dvpRow.priorGames)*.35:0;

  if(cfg.requireOpponentData&&(!dvpRow||!Number.isFinite(favorableDvp)))return null;
  if(cfg.dvpMin>0&&(!Number.isFinite(favorableDvp)||favorableDvp<cfg.dvpMin))return null;
  if(cfg.dvpMin>0&&effectiveDvpSample<cfg.dvpSample)return null;
  if(cfg.teamMatchupMin>0&&(!Number.isFinite(favorableTeam)||favorableTeam<cfg.teamMatchupMin))return null;

  // 2025 walk-forward calibration estimates the probability of the OVER.
  // UNDER/NO selections use the complement. The historical estimate is then
  // shrunk toward FanDuel's no-vig probability according to held-out quality.
  const calibrated=calibratedOverProbability(row,player,dvpPct);
  const historicalProb=isUnder?1-calibrated.probability:calibrated.probability;
  const book=marketProbability(row);
  const historyWeight=clamp(.18+.22*calibrated.reliability+.38*calibrated.calibrationQuality,.18,.72);
  let modelProb=book+(historicalProb-book)*historyWeight;

  const h2h=smoothed(rates.h2h,5);
  if(Number.isFinite(h2h)&&rates.h2h&&rates.h2h.total>=2){
    const h2hWeight=Math.min(.08,.02*rates.h2h.total);
    modelProb=modelProb*(1-h2hWeight)+h2h*h2hWeight;
  }
  modelProb=clamp(modelProb,.03,.97);
  modelProb=blendAdaptiveProbability(modelProb,row,rates,book);

  const edge=modelProb-book;
  if(edge*100<cfg.edgeMin)return null;

  const recent=avg([smoothed(rates.l5,4),smoothed(rates.l10,5)].filter(Number.isFinite))??modelProb;
  const season=avg([smoothed(rates.current,5),smoothed(rates.previous,7)].filter(Number.isFinite))??recent;
  const h2hSignal=Number.isFinite(h2h)?h2h:season;
  const usageSignal=usageStability(player);
  const matchup=avg([
    Number.isFinite(favorableDvp)?favorableDvp/100:null,
    Number.isFinite(favorableTeam)?favorableTeam/100:null
  ].filter(Number.isFinite))??.5;
  const valueSignal=clamp(.5+edge*3,0,1);

  const w=cfg.weights,total=Object.values(w).reduce((a,b)=>a+b,0)||1;
  const weightedSignal=(w.recent*recent+w.season*season+w.h2h*h2hSignal+w.usage*usageSignal+w.matchup*matchup+w.value*valueSignal)/total;

  // Success probability is the dominant grade. Reliability and historical
  // calibration quality matter more than raw volume, preventing position bias.
  const score=100*clamp(
    .68*modelProb+
    .10*calibrated.reliability+
    .12*calibrated.calibrationQuality+
    .10*weightedSignal,
    0,1
  );

  return{
    row:row,player:player,pos:pos,team:team,opp:opp,market:market,rates:rates,usage:usage,
    dvpRow:dvpRow,dvpPct:dvpPct,favorableDvp:favorableDvp,teamMatchupPct:teamMatchupPct,
    dvpMetric:metric,recentSignal:recent,seasonSignal:season,h2hSignal:h2hSignal,
    usageSignal:usageSignal,matchupSignal:matchup,valueSignal:valueSignal,
    modelProb:modelProb,impliedProb:book,edge:edge,score:score,
    reliability:calibrated.reliability,calibrationQuality:calibrated.calibrationQuality
  };
}
function modelSlipPropFamilyKey(x){
  const row=x.row||{};
  return[
    String(row.eventId||""),
    norm(row.player||row.team||row.scope||""),
    String(x.market||row._marketLabel||generalizedMarketLabel(row)||"").toLowerCase()
  ].join("|");
}
function modelSlipLegsCompatible(combo,next,cfg){
  if(combo.some(x=>modelSlipPropFamilyKey(x)===modelSlipPropFamilyKey(next)))return false;
  const nextPlayer=norm(next.row.player);
  if(cfg.uniquePlayers&&nextPlayer&&combo.some(x=>norm(x.row.player)===nextPlayer))return false;
  if(cfg.avoidSameGame&&combo.some(x=>x.row.eventId&&x.row.eventId===next.row.eventId))return false;
  const values=combo.map(x=>Number(x.row.odds)).concat(Number(next.row.odds)).filter(Number.isFinite);
  if(values.length>1&&Math.max(...values)-Math.min(...values)>cfg.oddsSpread)return false;
  return true;
}
function modelSlipStats(legs){
  let decimal=1,joint=1,sameGamePairs=0;
  for(let i=0;i<legs.length;i++){
    const d=rowDecimalOdds(legs[i].row);if(!d)return null;
    decimal*=d;joint*=legs[i].modelProb;
    for(let j=0;j<i;j++)if(legs[i].row.eventId&&legs[i].row.eventId===legs[j].row.eventId)sameGamePairs++;
  }
  const conservativeProb=clamp(joint*Math.pow(.97,sameGamePairs),.0001,.9999);
  const bookProb=1/decimal,slipEdge=conservativeProb-bookProb;
  return{
    decimal:decimal,odds:decimalToAmerican(decimal),modelProb:conservativeProb,bookProb:bookProb,slipEdge:slipEdge,
    edge:avg(legs.map(x=>x.edge))||0,score:avg(legs.map(x=>x.score))||0,sameGamePairs:sameGamePairs
  };
}
function modelParlayDecimalRange(cfg){
  let minD=americanToDecimal(cfg.parlayOddsMin),maxD=americanToDecimal(cfg.parlayOddsMax);
  if(Number.isFinite(minD)&&Number.isFinite(maxD)&&minD>maxD)[minD,maxD]=[maxD,minD];
  return{minD:Number.isFinite(minD)?minD:null,maxD:Number.isFinite(maxD)?maxD:null};
}
function modelSlipWithinRange(stats,cfg){
  if(!stats)return false;
  const range=modelParlayDecimalRange(cfg);
  if(range.minD&&stats.decimal<range.minD-1e-9)return false;
  if(range.maxD&&stats.decimal>range.maxD+1e-9)return false;
  return true;
}
function refreshStillValidSlips(previous,candidates,cfg){
  if(!previous||!previous.length)return[];
  const current=new Map(candidates.map(item=>[modelPropKey(item.row),item])),locks=modelLockedRules(),out=[];
  const minLegs=Math.min(cfg.legsMin,cfg.legsMax),maxLegs=Math.max(cfg.legsMin,cfg.legsMax);
  for(const slip of previous){
    const legs=(slip.legs||[]).map(old=>current.get(modelPropKey(old.row))).filter(Boolean);
    if(legs.length!==(slip.legs||[]).length||legs.length<minLegs||legs.length>maxLegs)continue;
    let compatible=true;
    for(let i=0;i<legs.length&&compatible;i++)if(!modelSlipLegsCompatible(legs.slice(0,i),legs[i],cfg))compatible=false;
    if(!compatible||!modelSlipSatisfiesLocks(legs,locks))continue;
    const stats=modelSlipStats(legs);if(!modelSlipWithinRange(stats,cfg))continue;
    out.push(Object.assign({legs:legs},stats));
  }
  return out;
}
function generateSlips(candidates,cfg,previousSlips=[]){
  const locks=modelLockedRules(),range=modelParlayDecimalRange(cfg),minD=range.minD,maxD=range.maxD;
  const minLegs=Math.min(cfg.legsMin,cfg.legsMax),maxLegs=Math.max(cfg.legsMin,cfg.legsMax);
  if(locks.some(rule=>!candidates.some(item=>modelRuleMatchesRow(rule,item.row,false))))return[];

  // A relaxed eligibility filter must never let newly-added heavy favorites
  // crowd every previously-useful leg out of the search. Build the search pool
  // from fixed price bands plus the highest-ranked legs overall. This preserves
  // strong candidates across the entire allowed payout spectrum.
  const pool=[],seenPool=new Set();
  const addCandidate=item=>{
    if(!item||!rowDecimalOdds(item.row))return;
    const key=modelPropKey(item.row);
    if(!seenPool.has(key)){seenPool.add(key);pool.push(item)}
  };
  candidates.slice(0,56).forEach(addCandidate);

  const priceBands=[
    [1,1.08],[1.08,1.15],[1.15,1.25],[1.25,1.4],[1.4,1.6],[1.6,1.85],
    [1.85,2.1],[2.1,2.5],[2.5,3.25],[3.25,4.5],[4.5,7],[7,12],[12,Infinity]
  ];
  for(const [low,high] of priceBands){
    let kept=0;
    for(const item of candidates){
      const d=rowDecimalOdds(item.row);
      if(!d||d<low||d>=high)continue;
      addCandidate(item);
      if(++kept>=14)break;
    }
  }
  for(const rule of locks)candidates.filter(item=>modelRuleMatchesRow(rule,item.row,false)).slice(0,28).forEach(addCandidate);

  // Pull in candidates closest to the payout pace needed to reach the user's
  // minimum total odds by the maximum leg count. This prevents a board full of
  // -500/-1000 favorites from starving +money targets.
  if(minD&&maxLegs>0){
    const ideal=Math.pow(minD,1/maxLegs);
    [...candidates]
      .filter(item=>rowDecimalOdds(item.row))
      .sort((a,b)=>Math.abs(Math.log(rowDecimalOdds(a.row)/ideal))-Math.abs(Math.log(rowDecimalOdds(b.row)/ideal))||b.score-a.score)
      .slice(0,36).forEach(addCandidate);
  }

  pool.sort((a,b)=>b.score-a.score||b.edge-a.edge);
  const top=pool.slice(0,260),recommendations=[];
  function addRecommendation(node){
    if(!modelSlipWithinRange(node.stats,cfg)||!modelSlipSatisfiesLocks(node.legs,locks))return;
    recommendations.push(Object.assign({legs:node.legs},node.stats));
  }
  function partialRank(node,size){
    const probability=node.legs.reduce((p,x)=>p*x.modelProb,1);
    const quality=avg(node.legs.map(x=>x.score))||0,edge=avg(node.legs.map(x=>Math.max(-.05,x.edge)))||0;
    const coverage=locks.length?locks.filter(rule=>node.legs.some(item=>modelRuleMatchesRow(rule,item.row,false))).length/locks.length:1;
    const desiredFinal=minD||Math.min(maxD||2,2);
    const desiredNow=Math.pow(Math.max(1.0001,desiredFinal),size/Math.max(1,maxLegs));
    const payoutDistance=Math.abs(Math.log(Math.max(1.0001,node.stats.decimal)/desiredNow));
    return Math.log(Math.max(probability,1e-8))+quality*.004+edge*.8+coverage*2.4-payoutDistance*.42;
  }
  function pruneBeam(nodes,size){
    // Preserve partial parlays at many payout levels instead of allowing the
    // highest-probability/favorite-heavy states to monopolize the beam.
    const bins=new Map(),upper=Math.log(Math.max(2,maxD||minD||20)),binCount=22;
    for(const node of nodes){
      node.rank=partialRank(node,size);
      const pos=Math.log(Math.max(1.0001,node.stats.decimal))/Math.max(.01,upper);
      const key=Math.max(0,Math.min(binCount-1,Math.floor(pos*binCount)));
      if(!bins.has(key))bins.set(key,[]);
      bins.get(key).push(node);
    }
    const kept=[];
    for(const rows of bins.values()){
      rows.sort((a,b)=>b.rank-a.rank);
      kept.push(...rows.slice(0,54));
    }
    kept.sort((a,b)=>b.rank-a.rank);
    return kept.slice(0,1250);
  }

  let beam=[{legs:[],start:0,stats:null,rank:0}];
  for(let size=1;size<=maxLegs;size++){
    const nextBeam=[];
    for(const node of beam){
      for(let i=node.start;i<top.length;i++){
        const candidate=top[i];if(!modelSlipLegsCompatible(node.legs,candidate,cfg))continue;
        const legs=node.legs.concat(candidate),stats=modelSlipStats(legs);if(!stats)continue;
        if(maxD&&stats.decimal>maxD+1e-9)continue;
        const next={legs:legs,start:i+1,rank:0,stats:stats};
        nextBeam.push(next);
        // Capture valid slips BEFORE beam pruning. Previously a perfectly valid
        // combination could be generated and then discarded simply because a
        // looser leg-odds filter introduced more high-confidence favorites.
        if(size>=minLegs)addRecommendation(next);
      }
    }
    beam=pruneBeam(nextBeam,size);
    if(recommendations.length>5000){
      recommendations.sort((a,b)=>b.modelProb-a.modelProb||b.score-a.score||b.slipEdge-a.slipEdge);
      recommendations.length=2500;
    }
    if(!beam.length)break;
  }

  // Preserve previously displayed slips whenever the new controls still allow
  // them. This makes all pure relaxations monotonic in the UI: lowering a min
  // or raising a max can add options, but cannot erase an already-valid slip.
  recommendations.push(...refreshStillValidSlips(previousSlips,candidates,cfg));
  recommendations.sort((a,b)=>b.modelProb-a.modelProb||b.score-a.score||b.slipEdge-a.slipEdge);

  const out=[],seen=new Set();
  for(const slip of recommendations){
    const sig=slip.legs.map(x=>modelPropKey(x.row)).sort().join("~");
    if(seen.has(sig))continue;seen.add(sig);out.push(slip);if(out.length>=9)break;
  }
  return out;
}
function metricClass(v){if(!Number.isFinite(v))return"metric-na";if(v>=70)return"metric-good";if(v>=50)return"metric-mid";return"metric-low"}
function rateTd(r){return r?'<td class="'+metricClass(r.pct)+'">'+Math.round(r.pct)+'% <small class="cell-sample">'+r.hits+'/'+r.total+'</small></td>':'<td class="metric-na">—</td>'}
function usageText(x){const a=[];if(x.usage.target)a.push("T "+Math.round(x.usage.target)+"%");if(x.usage.carry)a.push("C "+Math.round(x.usage.carry)+"%");return a.length?a.join(" • "):"—"}
function modelEntityName(row){
  if(row.scope==="team")return row.teamName||row.team||"Team";
  if(row.scope==="game")return row.matchup||"Game";
  return cleanDisplayPlayerName(row.player)||"Player";
}
function modelEntityVisual(row,player){
  if(row.scope==="team")return '<span class="model-team-visual"><img src="'+esc(modelTeamLogo(row.team))+'" alt="" loading="lazy"></span>';
  if(row.scope==="game")return '<span class="signal-game-logos"><img src="'+esc(modelTeamLogo(row.awayAbbr))+'" alt=""><img src="'+esc(modelTeamLogo(row.homeAbbr))+'" alt=""></span>';
  return '<img src="'+esc(row.headshot||player&&player.headshot||fallbackHeadshot())+'" alt="" loading="lazy">';
}
function modelProfileText(x){
  if(["team","game"].includes(x.row.scope)){
    const count=x.teamProfile&&x.teamProfile.breadth?Math.round(x.teamProfile.breadth*100):0;
    return "All stats "+count+"%";
  }
  return usageText(x);
}
function signalSortValue(x,key){
  const row=x.row||{};
  if(key==="pick")return (modelEntityName(row)+" "+cleanDisplayProposition(row)).toLowerCase();
  if(key==="score")return Number(x.score);
  if(key==="odds")return Number(row.odds);
  if(key==="result"){
    const status=String(historicalResultForRow(row).status||"pending");
    return({miss:0,pending:1,push:2,hit:3})[status]??1;
  }
  if(["l5","l10","h2h","current","previous"].includes(key)){
    const rate=x.rates&&x.rates[key];
    return rate&&Number.isFinite(Number(rate.pct))?Number(rate.pct):null;
  }
  if(key==="profile")return Number.isFinite(Number(x.usageSignal))?Number(x.usageSignal)*100:null;
  if(key==="matchup")return Number.isFinite(Number(x.matchupSignal))?Number(x.matchupSignal)*100:null;
  return null;
}
function compareSignalValues(a,b,key,dir){
  const av=signalSortValue(a,key),bv=signalSortValue(b,key),mult=dir==="asc"?1:-1;
  const aMissing=av===null||av===undefined||(typeof av==="number"&&!Number.isFinite(av));
  const bMissing=bv===null||bv===undefined||(typeof bv==="number"&&!Number.isFinite(bv));
  if(aMissing&&bMissing)return Number(b.score)-Number(a.score);
  if(aMissing)return 1;
  if(bMissing)return -1;
  if(typeof av==="string"||typeof bv==="string"){
    const result=String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"});
    return result*mult||Number(b.score)-Number(a.score);
  }
  const result=(Number(av)-Number(bv))*mult;
  return result||Number(b.score)-Number(a.score);
}
function sortedSignalRows(){
  return [...state.eligible].sort((a,b)=>compareSignalValues(a,b,state.signalSortKey,state.signalSortDir));
}
function renderSignalSortHeaders(){
  document.querySelectorAll("[data-signal-sort]").forEach(th=>{
    const key=th.dataset.signalSort,active=key===state.signalSortKey;
    th.classList.toggle("active-sort",active);
    const indicator=th.querySelector(".signal-sort-indicator");
    if(indicator)indicator.textContent=active?(state.signalSortDir==="asc"?"↑":"↓"):"";
    const button=th.querySelector(".signal-sort-button");
    if(button)button.setAttribute("aria-label",(button.textContent||key).trim()+", "+(active?(state.signalSortDir==="asc"?"ascending":"descending"):"not sorted"));
  });
}
function setSignalSort(key){
  if(!key)return;
  if(state.signalSortKey===key)state.signalSortDir=state.signalSortDir==="asc"?"desc":"asc";
  else{
    state.signalSortKey=key;
    state.signalSortDir=key==="pick"?"asc":"desc";
  }
  renderSignalSortHeaders();
  renderSignals();
}
function renderSignals(){
  const rows=sortedSignalRows().slice(0,60);$("legBoardCount").textContent=fmt.format(rows.length);renderSignalSortHeaders();
  const colspan=state.modelHistorical?11:10;
  if(!rows.length){
    const unavailable=[...state.selectedMarkets].filter(m=>!state.odds.some(row=>(row._modelMarketLabel||modelSupportedMarketLabel(row))===m));
    const message=unavailable.length===1
      ?"FanDuel has not posted "+unavailable[0]+" for this board."
      :"No markets match the current filters.";
    $("signalBody").innerHTML='<tr><td colspan="'+colspan+'" class="model-empty">'+esc(message)+'</td></tr>';return
  }
  $("signalBody").innerHTML=rows.map(x=>{
    const r=x.row,entity=modelEntityName(r);
    const rowAttrs=' data-prop-key="'+esc(modelPropKey(r))+'" tabindex="0" role="button" aria-label="Open '+esc(entity)+' prop history chart"';
    const result=historicalResultForRow(r),memberships=slipMembershipFor(r);
    const resultCell=state.modelHistorical?'<td class="model-result-cell">'+modelResultBadge(result,true)+(memberships.length?'<small class="slip-membership">Slip '+memberships.join(" • ")+'</small>':"")+'</td>':"";
    return '<tr class="model-board-row model-prop-trigger '+(state.modelHistorical?'historical-row result-'+esc(result.status):"")+'"'+rowAttrs+'><td><div class="signal-player">'+
      modelEntityVisual(r,x.player)+'<div class="signal-copy"><strong>'+esc(entity)+'</strong><span>'+esc(cleanDisplayProposition(r)||x.market)+'</span><small>'+esc(r.scope==="game"?r.matchup:(x.team||"NFL")+" vs "+(x.opp||"—"))+' • '+esc(x.pos||"—")+'</small></div></div></td>'+
      '<td><span class="score-pill">'+x.score.toFixed(1)+'</span></td><td class="signal-odds"><strong>'+formatOdds(r.odds)+'</strong></td>'+resultCell+
      rateTd(x.rates.l5)+rateTd(x.rates.l10)+rateTd(x.rates.h2h)+rateTd(x.rates.current)+rateTd(x.rates.previous)+
      '<td class="'+metricClass(x.usageSignal*100)+'">'+esc(modelProfileText(x))+'</td>'+
      '<td class="'+metricClass(x.matchupSignal*100)+'">'+Math.round(x.matchupSignal*100)+'th'+(["team","game"].includes(r.scope)?' <small>all-team model</small>':x.dvpRow?' <small>(n='+x.dvpRow.samples+')</small>':"")+'</td></tr>';
  }).join("");
}
function slipHtml(s,i){
  let legs="";const legResults=[];
  for(const x of s.legs){
    const r=x.row,entity=modelEntityName(r);
    const trigger=' model-prop-trigger',attrs=' data-prop-key="'+esc(modelPropKey(r))+'" tabindex="0" role="button" aria-label="Open '+esc(entity)+' prop history chart"';
    const result=historicalResultForRow(r);if(state.modelHistorical)legResults.push(result);
    const grade=state.modelHistorical?modelResultBadge(result,true):"";
    legs+='<div class="slip-leg '+(state.modelHistorical?'historical-slip-leg result-'+esc(result.status):"")+trigger+'"'+attrs+'>'+modelEntityVisual(r,x.player)+'<div class="slip-leg-copy"><strong>'+esc(entity)+'</strong><span>'+esc(cleanDisplayProposition(r))+' • '+esc(r.scope==="game"?r.matchup:(x.opp||""))+'</span></div><div class="slip-leg-right"><strong>'+formatOdds(r.odds)+'</strong>'+grade+'</div></div>';
  }
  const priceLabel=s.sameGamePairs>0?"EST. SGP ODDS":"PARLAY ODDS",status=state.modelHistorical?combinedHistoricalStatus(legResults):"live";
  const overall=state.modelHistorical?'<div class="slip-overall-result">'+modelResultBadge({status},false)+'</div>':"";
  return '<article class="slip-card '+(state.modelHistorical?'historical-slip result-'+status:"")+'"><div class="slip-top"><div><span>MODEL SLIP '+(i+1)+' • '+priceLabel+'</span><strong>'+formatOdds(s.odds)+'</strong></div><div class="slip-score">'+overall+'<b>'+s.score.toFixed(1)+'</b><small>AVG GRADE</small></div></div><div class="slip-legs">'+legs+'</div><div class="slip-footer"><div><span>Est. hit prob</span><strong>'+pct(s.modelProb*100,1)+'</strong></div><div><span>Slip edge</span><strong>'+(s.slipEdge>=0?"+":"")+pct(s.slipEdge*100,1)+'</strong></div><div><span>Legs</span><strong>'+s.legs.length+'</strong></div></div></article>';
}
function renderSlips(direction){
  const total=state.slips.length,pages=Math.max(1,Math.ceil(total/SLIPS_PER_PAGE));
  state.slipPage=clamp(state.slipPage,0,pages-1);
  const start=state.slipPage*SLIPS_PER_PAGE,end=Math.min(start+SLIPS_PER_PAGE,total);
  $("slipCount").textContent=fmt.format(total);
  $("slipSub").textContent="";
  $("slipPager").hidden=total<=SLIPS_PER_PAGE;
  $("slipPrev").disabled=state.slipPage===0;
  $("slipNext").disabled=state.slipPage>=pages-1;
  $("slipPageStatus").textContent=total
    ? (total>SLIPS_PER_PAGE?"Showing "+(start+1)+"–"+end+" of "+total:"Showing all "+total+" slips")
    : "No slips in current range";
  const container=$("recommendedSlips");
  if(!total){
    container.innerHTML='<div class="model-empty">'+(modelLockedRules().length?'No slips satisfy the active locks.':'No slips match this range.')+'</div>';
    return;
  }
  container.classList.remove("page-next","page-prev");
  void container.offsetWidth;
  if(direction)container.classList.add(direction>0?"page-next":"page-prev");
  container.innerHTML=state.slips.slice(start,end).map((s,i)=>slipHtml(s,start+i)).join("");
}
function renderSummary(){$("eligibleCount").textContent=fmt.format(state.eligible.length);$("eligibleSub").textContent="";$("bestScore").textContent=state.eligible.length?state.eligible[0].score.toFixed(1):"—";const m=median(state.eligible.map(x=>x.edge*100));$("medianEdge").textContent=Number.isFinite(m)?(m>=0?"+":"")+m.toFixed(1)+"%":"—"}
function renderLearning(){
  const learning=state.learning||{},perf=learning.performance||{},all=perf.all||{},games=Number(learning.completedGames)||0,samples=Number(learning.samples)||0;
  const status=$("learningStatus"),summary=$("learningSummary"),buckets=$("learningBucketChart"),weights=$("learningWeightChart"),runs=$("learningRunChart"),markets=$("learningMarketTable");
  if(!status||!summary||!buckets||!weights||!runs||!markets)return;
  const stateLabel=learning.status==="promoted"?"CHALLENGER PROMOTED":learning.status==="held"?"CHAMPION REFIT":learning.status==="provisional"?"PROVISIONAL LEARNING":"AWAITING RESULTS";
  status.textContent=stateLabel;status.className="learning-status status-"+esc(learning.status||"waiting");
  const validation=perf.validation||{},validated=games>=4&&Number(validation.n)>0;
  const top=Number(validated?validation.topHitRate:all.topHitRate),brier=Number(validated?validation.brier:all.brier),blend=adaptiveBlend();
  const threshold=Number(validated?validation.topThreshold:all.topThreshold);
  summary.innerHTML=[
    ["Completed games",fmt.format(games),games<4?"Validation at 4":"Holdout active"],
    ["Graded legs",fmt.format(samples),"Final legs"],
    [validated?"Validated high-score hit rate":"Observed high-score hit rate",Number.isFinite(top)?pct(top*100,1):"—",validated?"Holdout top 20%":"Training only"],
    ["Adaptive influence",pct(blend*100,0),Number.isFinite(brier)?"Brier "+brier.toFixed(3):""]
  ].map(x=>'<article class="learning-stat"><span>'+x[0]+'</span><strong>'+x[1]+'</strong><small>'+x[2]+'</small></article>').join("");

  const bucketRows=perf.scoreBuckets||[];
  buckets.innerHTML=bucketRows.length?bucketRows.map(bucket=>{
    const hit=Number(bucket.hitRate),width=Number.isFinite(hit)?Math.round(hit*100):0;
    return'<div class="learning-bar-row"><span>'+esc(bucket.label)+'</span><div class="learning-bar-track"><div class="learning-bar-fill" style="width:'+width+'%"></div></div><strong>'+(Number.isFinite(hit)?pct(hit*100,1):"—")+'</strong><small>'+fmt.format(Number(bucket.total)||0)+' legs</small></div>';
  }).join(""):'<div class="learning-empty">Score buckets appear after the first completed frozen board.</div>';

  const importance=(learning.featureImportance||[]).slice(0,8);
  weights.innerHTML=importance.length?importance.map(item=>{
    const width=Math.max(2,Math.round(Number(item.importancePct)||0)),direction=item.direction==="down"?"↓":item.direction==="up"?"↑":"•";
    return'<div class="learning-bar-row feature"><span>'+esc(item.label||item.feature)+'</span><div class="learning-bar-track"><div class="learning-bar-fill" style="width:'+width+'%"></div></div><strong>'+direction+' '+Number(item.importancePct||0).toFixed(1)+'%</strong></div>';
  }).join(""):'<div class="learning-empty">Learned feature weights will appear here.</div>';

  const training=(learning.trainingRuns||[]).slice(-10);
  runs.innerHTML=training.length?training.map(run=>{
    const hit=Number(run.topHitRate),height=Number.isFinite(hit)?Math.max(5,Math.round(hit*100)):5;
    return'<div class="learning-run"><div class="learning-run-bar" style="height:'+height+'%"><span>'+(Number.isFinite(hit)?pct(hit*100,0):"—")+'</span></div><small>'+fmt.format(Number(run.completedGames)||0)+'G</small></div>';
  }).join(""):'<div class="learning-empty">Each new set of graded game results adds a training run.</div>';

  const marketRows=(perf.marketPerformance||[]).slice(0,8);
  markets.innerHTML=marketRows.length?'<div class="learning-market-head"><span>Market</span><span>Top-leg hit</span><span>Samples</span></div>'+marketRows.map(item=>'<div class="learning-market-row"><strong>'+esc(item.market)+'</strong><span>'+pct(Number(item.topHitRate)*100,1)+'</span><span>'+fmt.format(Number(item.samples)||0)+'</span></div>').join(""):'<div class="learning-empty">Market-by-market results appear once enough legs have graded.</div>';

  const reason=$("learningReason");if(reason)reason.textContent=learning.promotionReason||"The learner will compare challenger setups after completed games.";
}
function renderFormula(){
  const cal=state.calibration&&state.calibration.all&&state.calibration.all.test;
  const sample=state.calibration&&state.calibration.samples;
  $("modelFormula").innerHTML=
    '<strong>Calibrated mixed-market probability model</strong><br>'+
    '<code>Players: shrink(2025 walk-forward logistic estimate → current FanDuel no-vig probability)</code><br>'+
    '<code>Teams: book probability + historical cover/hit rates + full team-stat profile</code><br>'+
    '<code>Adaptive layer: every graded frozen leg retrains a champion/challenger model</code><br><br>'+
    'Player history: <strong>L10 + season-to-date + line distance + trend</strong><br>'+
    'Player matchup: <strong>defense-vs-position percentile</strong><br>'+
    'Team matchup: <strong>every numeric ESPN team-stat category normalized league-wide</strong><br>'+
    'Team weighting: <strong>offense, defense, scoring, situational, turnovers, special teams + all-stat composite</strong><br>'+
    'Reliability: <strong>sample size + calibration/stat breadth</strong><br>'+
    'Final grade: <strong>estimated hit probability</strong> + reliability + matchup/profile signals<br>'+
    'Postgame learner: <strong>'+fmt.format(Number(state.learning&&state.learning.samples)||0)+' graded legs • '+fmt.format(Number(state.learning&&state.learning.completedGames)||0)+' completed games • '+pct(adaptiveBlend()*100,0)+' live influence</strong>'+
    (sample?'<br><br><span>2025 walk-forward samples: '+fmt.format(sample)+(cal&&Number.isFinite(Number(cal.brier))?' • holdout Brier '+Number(cal.brier).toFixed(3):'')+'. Historical sportsbook closing lines are not stored, so training uses pregame trailing-five median + 0.5 lines.</span>':'')+
    '<br><span>Same-game parlay prices are estimates unless “Different games only” is enabled.</span>';
}
function renderCharts(){
  const top=state.eligible[0];
  if(!top){$("signalStrengthTitle").textContent="Signal strength";$("candidateScoresTitle").textContent="Top candidate scores";$("signalProfileChart").innerHTML='<div class="model-empty">No eligible leg</div>';$("scoreChart").innerHTML='<div class="model-empty">No eligible candidates</div>';return}
  const topResult=historicalResultForRow(top.row);
  $("signalStrengthTitle").innerHTML='Signal strength'+(state.modelHistorical?' '+modelResultBadge(topResult,true):"");
  $("candidateScoresTitle").textContent=state.modelHistorical?"Top candidate scores • graded":"Top candidate scores";
  const signals=[["Recent",top.recentSignal],["Season",top.seasonSignal],["H2H",top.h2hSignal],["Usage",top.usageSignal],["Opponent",top.matchupSignal],["Value",top.valueSignal]];
  $("signalProfileChart").innerHTML=signals.map(x=>'<div class="bar-row"><span>'+x[0]+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(clamp(x[1],0,1)*100)+'%"></div></div><strong>'+Math.round(clamp(x[1],0,1)*100)+'</strong></div>').join("");
  $("scoreChart").innerHTML=state.eligible.slice(0,8).map(x=>{const result=historicalResultForRow(x.row);return'<div class="bar-row"><span class="score-bar-label">'+(state.modelHistorical?'<b class="mini-result result-'+esc(result.status)+'">'+resultIcon(result.status)+'</b>':"")+esc(modelEntityName(x.row))+'</span><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(x.score)+'%"></div></div><strong>'+x.score.toFixed(1)+'</strong></div>'}).join("");
}
function recalc(){
  const cfg=controls();if(cfg.legsMin>cfg.legsMax){$("legsMax").value=cfg.legsMin;cfg.legsMax=cfg.legsMin}
  const previousSlips=state.slips||[];
  const out=[];for(const row of state.odds){const x=analyze(row,cfg);if(x)out.push(x)}out.sort((a,b)=>b.score-a.score||b.edge-a.edge);state.eligible=out;state.chartRows=new Map(out.map(x=>[modelPropKey(x.row),x.row]));state.slips=generateSlips(out,cfg,previousSlips);buildSlipMembership();state.slipPage=0;renderSummary();renderSlips();renderSignals();renderCharts();renderFormula();renderLearning();
}
function schedule(){clearTimeout(state.timer);state.timer=setTimeout(recalc,35)}
function buildControls(){
  $("hitRateControls").innerHTML=HIT_LABELS.map(pair=>'<label class="range-row"><span><b>'+pair[1]+' minimum</b></span><output id="'+pair[0]+'Value">'+DEFAULTS[pair[0]]+'%</output><input id="'+pair[0]+'Min" type="range" min="0" max="100" step="5" value="'+DEFAULTS[pair[0]]+'"></label>').join("");
  $("weightControls").innerHTML=WEIGHT_LABELS.map(pair=>'<button type="button" class="weight-button active" data-weight="'+pair[0]+'">'+pair[1]+'<strong>'+DEFAULTS.weights[pair[0]]+'</strong></button>').join("");
}
function applyPreset(key){
  const preset=PRESETS[key];if(!preset)return;
  for(const [k] of HIT_LABELS)$(k+"Min").value=preset[k]??DEFAULTS[k];
  for(const id of ["targetShare","carryShare","opportunityShare","dvpMin","targetsPerGameMin","carriesPerGameMin"]){
    $(id).value=0;
  }
  $("dvpSample").value=DEFAULTS.dvpSample;
  $("requireOpponentData").checked=false;
  $("teamMatchupMin").value=preset.teamMatchupMin??0;
  $("edgeMin").value=preset.edgeMin??DEFAULTS.edgeMin;
  $("oddsSpread").value=preset.oddsSpread??DEFAULTS.oddsSpread;
  for(const id of ["legOddsMin","legOddsMax","parlayOddsMin","parlayOddsMax","legsMin","legsMax"])$(id).value=preset[id]??DEFAULTS[id];
  $("lineMin").value="";$("lineMax").value="";
  $("uniquePlayers").checked=preset.uniquePlayers!==false;
  $("avoidSameGame").checked=Boolean(preset.avoidSameGame);
  state.selectedPositions.clear();state.selectedMarkets.clear();state.selectedSides.clear();state.selectedGames.clear();state.modelScope="";state.entityRules.clear();saveModelEntityRules();
  $("modelEntitySearch").value="";renderModelEntityRules();renderModelEntitySearchResults();renderModelFilters();syncLabels();recalc();
  $("modelPresetButton").querySelector("span").textContent=preset.label;
}
function closePresetPopover(){
  const pop=$("modelPresetPopover"),btn=$("modelPresetButton");if(!pop||!btn)return;
  pop.hidden=true;btn.setAttribute("aria-expanded","false");btn.classList.remove("open");
}
function togglePresetPopover(){
  const pop=$("modelPresetPopover"),btn=$("modelPresetButton"),opening=pop.hidden;
  closePresetPopover();if(!opening)return;
  const rect=btn.getBoundingClientRect();pop.hidden=false;document.body.appendChild(pop);
  pop.style.left=Math.max(10,Math.min(rect.left,window.innerWidth-pop.offsetWidth-10))+"px";
  let top=rect.bottom+8;if(top+pop.offsetHeight>window.innerHeight-10)top=Math.max(10,rect.top-pop.offsetHeight-8);
  pop.style.top=top+"px";btn.setAttribute("aria-expanded","true");btn.classList.add("open");
}
function syncLabels(){for(const [k] of HIT_LABELS)$(k+"Value").textContent=$(k+"Min").value+"%";$("targetShareValue").textContent=$("targetShare").value+"%";$("carryShareValue").textContent=$("carryShare").value+"%";$("opportunityShareValue").textContent=$("opportunityShare").value+"%";$("dvpValue").textContent=$("dvpMin").value+"th+";$("dvpSampleValue").textContent=$("dvpSample").value+"+";$("teamMatchupValue").textContent=$("teamMatchupMin").value+"th+";$("edgeValue").textContent=$("edgeMin").value+"%+";$("oddsSpreadValue").textContent=$("oddsSpread").value}
function modelFilterCountLabel(set,singular,allLabel){
  return set.size?set.size+" "+singular+(set.size===1?"":"s"):allLabel;
}
function modelRenderOption(value,label,selectedSet,kind){
  const selected=selectedSet.has(String(value));
  return '<button type="button" class="filter-option '+(selected?"selected":"")+'" data-model-kind="'+kind+'" data-model-value="'+esc(value)+'"><span class="filter-option-label">'+esc(label)+'</span><span class="option-checkbox">'+(selected?"✓":"")+'</span></button>';
}
function renderModelFilters(){
  const scopeLabels={player:"Player Props",team:"Team Props",game:"Game Props","":"All Props"};
  $("modelScopeLabel").textContent=scopeLabels[state.modelScope]||"All Props";
  document.querySelectorAll("[data-model-scope]").forEach(button=>{
    const active=String(button.dataset.modelScope||"")===String(state.modelScope||"");
    button.classList.toggle("selected",active);
    const mark=button.querySelector(".option-checkbox");if(mark)mark.textContent=active?"✓":"";
  });

  const positions=[...new Set([...state.players.map(p=>String(p.position||"").toUpperCase()),...state.odds.map(r=>String(r.position||"").toUpperCase())].filter(Boolean))].sort();
  $("modelPositionOptions").innerHTML=positions.map(x=>modelRenderOption(x,x,state.selectedPositions,"positions")).join("");
  $("modelAllPositionsMark").textContent=state.selectedPositions.size?"":"✓";
  $("modelPositionLabel").textContent=modelFilterCountLabel(state.selectedPositions,"Position","All positions");

  const requiredMarkets=["Moneyline","Spread","Alt Spread","Game Total","Alt Game Total","Team Total","Alt Team Total","Passing + Rushing Yards","Kicking Points","Field Goals"];
  const markets=[...new Set([
    ...requiredMarkets,
    ...state.odds.map(x=>x._modelMarketLabel||modelSupportedMarketLabel(x)).filter(Boolean)
  ])].sort((a,b)=>a.localeCompare(b));
  $("modelMarketOptions").innerHTML=markets.map(x=>modelRenderOption(x,x,state.selectedMarkets,"markets")).join("");
  $("modelAllMarketsMark").textContent=state.selectedMarkets.size?"":"✓";
  $("modelMarketLabel").textContent=modelFilterCountLabel(state.selectedMarkets,"Prop","All props");

  const sides=["Over","Under","Win","Cover"];
  const sideLabels={Over:"Over",Under:"Under",Win:"Moneyline",Cover:"Spread"};
  $("modelSideOptions").innerHTML=sides.map(x=>modelRenderOption(x,sideLabels[x],state.selectedSides,"sides")).join("");
  $("modelAllSidesMark").textContent=state.selectedSides.size?"":"✓";
  $("modelSideLabel").textContent=state.selectedSides.size?modelFilterCountLabel(state.selectedSides,"Side","All sides"):"All sides";

  const events=new Map();
  for(const row of state.odds){
    const id=String(row.eventId||"");if(!id||events.has(id))continue;
    events.set(id,{id:id,matchup:row.matchup,awayAbbr:row.awayAbbr,homeAbbr:row.homeAbbr,awayTeam:row.awayTeam,homeTeam:row.homeTeam,commenceTime:row.commenceTime});
  }
  $("modelGameOptions").innerHTML=[...events.values()].sort((a,b)=>new Date(a.commenceTime||0)-new Date(b.commenceTime||0)).map(event=>{
    const selected=state.selectedGames.has(event.id);
    return '<button type="button" class="filter-option game-option '+(selected?"selected":"")+'" data-model-kind="games" data-model-value="'+esc(event.id)+'">'+
      '<span class="game-option-logos"><img src="'+esc(modelTeamLogo(event.awayAbbr))+'" alt=""><img src="'+esc(modelTeamLogo(event.homeAbbr))+'" alt=""></span>'+
      '<span class="game-option-copy"><span class="game-option-time">'+esc(modelGameTime(event.commenceTime))+'</span><span class="game-option-name">'+esc(modelShortTeam(event.awayTeam||event.awayAbbr))+' @ '+esc(modelShortTeam(event.homeTeam||event.homeAbbr))+'</span></span>'+
      '<span class="option-checkbox">'+(selected?"✓":"")+'</span></button>';
  }).join("");
  $("modelAllGamesMark").textContent=state.selectedGames.size?"":"✓";
  $("modelGameLabel").textContent=modelFilterCountLabel(state.selectedGames,"Game","All games");
}
function modelFilterAnchor(pop){
  return pop&&pop.dataset.anchorButton?$(pop.dataset.anchorButton):null;
}
function closeModelFilterPopovers(except){
  document.querySelectorAll(".model-filter-popover").forEach(pop=>{
    if(pop===except)return;
    pop.hidden=true;
    const btn=modelFilterAnchor(pop);
    if(btn){btn.classList.remove("open");btn.setAttribute("aria-expanded","false")}
  });
}
function positionModelPopover(button,popover){
  const rect=button.getBoundingClientRect(),margin=8;
  const left=Math.max(margin,Math.min(rect.left,window.innerWidth-popover.offsetWidth-margin));
  let top=rect.bottom+7;
  const maxTop=window.innerHeight-popover.offsetHeight-margin;
  if(top>maxTop)top=Math.max(margin,rect.top-popover.offsetHeight-7);
  popover.style.left=left+"px";
  popover.style.top=top+"px";
}
function toggleModelFilter(button,popover){
  const opening=popover.hidden;
  closeModelFilterPopovers(opening?popover:null);
  popover.hidden=!opening;button.classList.toggle("open",opening);button.setAttribute("aria-expanded",opening?"true":"false");
  if(opening)requestAnimationFrame(()=>positionModelPopover(button,popover));
}
function bindModelFilters(){
  const pairs=[
    ["modelScopeButton","modelScopePopover"],
    ["modelPositionButton","modelPositionPopover"],
    ["modelMarketButton","modelMarketPopover"],
    ["modelSideButton","modelSidePopover"],
    ["modelGameButton","modelGamePopover"]
  ];
  for(const [buttonId,popId] of pairs){
    const button=$(buttonId),popover=$(popId);
    popover.dataset.anchorButton=buttonId;
    document.body.appendChild(popover);
    button.addEventListener("click",e=>{e.stopPropagation();toggleModelFilter(button,popover)});
  }
  document.addEventListener("click",e=>{
    const scopeOption=e.target.closest("[data-model-scope]");
    if(scopeOption){
      state.modelScope=String(scopeOption.dataset.modelScope||"");
      renderModelFilters();closeModelFilterPopovers();schedule();return;
    }
    const option=e.target.closest("[data-model-kind][data-model-value]");
    if(option){
      const set=state["selected"+option.dataset.modelKind[0].toUpperCase()+option.dataset.modelKind.slice(1)];
      const value=option.dataset.modelValue;
      const popover=option.closest(".model-filter-popover");
      set.has(value)?set.delete(value):set.add(value);
      renderModelFilters();
      if(popover&&!popover.hidden){
        const button=modelFilterAnchor(popover);
        if(button)requestAnimationFrame(()=>positionModelPopover(button,popover));
      }
      schedule();return;
    }
    const clear=e.target.closest("[data-model-clear]");
    if(clear){
      const key=clear.dataset.modelClear,set=state["selected"+key[0].toUpperCase()+key.slice(1)];
      const popover=clear.closest(".model-filter-popover");
      set.clear();renderModelFilters();
      if(popover&&!popover.hidden){
        const button=modelFilterAnchor(popover);
        if(button)requestAnimationFrame(()=>positionModelPopover(button,popover));
      }
      schedule();return;
    }
    if(!e.target.closest(".model-filter-control")&&!e.target.closest(".model-filter-popover"))closeModelFilterPopovers();
  });
  window.addEventListener("resize",()=>closeModelFilterPopovers());
  const controls=document.querySelector(".model-controls");
  if(controls)controls.addEventListener("scroll",()=>closeModelFilterPopovers(),{passive:true});
}
function fillSelects(){renderModelFilters();renderModelEntityRules()}
function modelPlayerForRow(row){return state.playerByName.get(norm(row&&row.player))}
function modelPlayedLogs(player){
  return logs(player,false).filter(g=>g&&g.played).sort((a,b)=>(b._season-a._season)||num(b.week)-num(a.week));
}
function modelSplitLabel(split){
  return {l5:"Last 5",l10:"Last 10",h2h:"Head-to-Head",current:String(state.season||2026),previous:String((state.season||2026)-1)}[split]||split;
}
function modelCompareGamesChronologically(a,b){
  const at=Date.parse(a&&a.date||"");
  const bt=Date.parse(b&&b.date||"");
  if(Number.isFinite(at)&&Number.isFinite(bt)&&at!==bt)return at-bt;
  const as=Number(a&&a._season||state.season||0),bs=Number(b&&b._season||state.season||0);
  if(as!==bs)return as-bs;
  return num(a&&a.week)-num(b&&b.week);
}
function modelTeamForRow(row){
  const abbr=String(row&&row.team||row&&row.homeAbbr||"").toUpperCase();
  return state.teams.find(team=>String(team&&team.abbreviation||"").toUpperCase()===abbr)||null;
}
function modelTeamPropValue(row,game){
  const stats=game&&game.stats||{},pf=num(stats["derived.pointsFor"]),pa=num(stats["derived.pointsAgainst"]);
  if(row.teamMarketType==="moneyline"||row.teamMarketType==="spread")return pf-pa;
  if(row.teamMarketType==="teamTotal")return pf;
  if(row.teamMarketType==="gameTotal")return pf+pa;
  return null;
}
function modelSplitGames(row,split){
  const currentYear=Number(state.season||2026),previousYear=currentYear-1,cutoff=Date.parse(row&&row.commenceTime||"");
  const beforeGame=game=>{const time=Date.parse(game&&game.date||"");return !Number.isFinite(cutoff)||!Number.isFinite(time)||time<cutoff};
  let games=[];
  if(["team","game"].includes(row&&row.scope)){
    const team=modelTeamForRow(row);if(!team)return[];
    const all=modelTeamLogs(team.abbreviation).filter(beforeGame),newest=[...all].reverse(),opponent=nextOpponent(Object.assign({},row,{team:row.team||team.abbreviation}));
    if(split==="l5")games=newest.slice(0,5);
    else if(split==="l10")games=newest.slice(0,10);
    else if(split==="h2h")games=opponent?all.filter(g=>String(g&&g.opponent&&g.opponent.abbreviation||"").toUpperCase()===opponent):[];
    else if(split==="current")games=all.filter(g=>Number(g._season)===currentYear);
    else if(split==="previous")games=all.filter(g=>Number(g._season)===previousYear);
    return games.filter(game=>modelTeamPropHit(row,game)!==null).sort(modelCompareGamesChronologically);
  }

  const player=modelPlayerForRow(row);if(!player)return[];
  const all=modelPlayedLogs(player).filter(beforeGame);
  if(split==="l5")games=all.slice(0,5);
  else if(split==="l10")games=all.slice(0,10);
  else if(split==="h2h"){const opponent=nextOpponent(row);games=opponent?all.filter(g=>String(g&&g.opponent&&g.opponent.abbreviation||"").toUpperCase()===opponent):[]}
  else if(split==="current")games=all.filter(g=>g._season===currentYear);
  else if(split==="previous")games=all.filter(g=>g._season===previousYear);
  const spec=metricSpec(row);
  return games.filter(g=>spec&&isHit(g,row,spec)!==null).sort(modelCompareGamesChronologically);
}
function modelLineForRow(row){
  if(row&&row.teamMarketType==="moneyline")return 0;
  if(row&&row.teamMarketType==="spread"){
    const spread=Number(row.line);return Number.isFinite(spread)?-spread:null;
  }
  if(row&&["teamTotal","gameTotal"].includes(row.teamMarketType)){
    const total=Number(row.line);return Number.isFinite(total)?total:null;
  }
  const spec=metricSpec(row);
  if(spec&&spec.comparison==="gte"&&Number.isFinite(Number(spec.threshold)))return Number(spec.threshold);
  const line=Number(row.line);return Number.isFinite(line)?line:null;
}
function modelFormatLine(v){
  if(v===null||v===undefined||v==="")return"—";
  const x=Number(v);return Number.isFinite(x)?String(x):String(v);
}
function modelChartDateLabel(game){
  if(game&&game.date){const d=new Date(game.date);if(!Number.isNaN(d.getTime()))return new Intl.DateTimeFormat("en-US",{month:"numeric",day:"numeric"}).format(d)}
  return"W"+String(game&&game.week!=null?game.week:"—");
}
function modelChartOpponentLabel(game){
  const abbr=game&&game.opponent&&game.opponent.abbreviation||"";if(!abbr)return"";
  return(game.isAway?"@ ":"vs ")+abbr;
}
function modelMetricBreakdown(game,spec){
  if(!spec)return[];
  if(spec.metric==="passRushYards")return[["PASS YDS",num(game.passingYards)],["RUSH YDS",num(game.rushingYards)]];
  if(spec.metric==="allPurposeYards")return[["RUSH YDS",num(game.rushingYards)],["REC YDS",num(game.receivingYards)]];
  if(spec.metric==="passRushRecYards")return[["PASS YDS",num(game.passingYards)],["RUSH YDS",num(game.rushingYards)],["REC YDS",num(game.receivingYards)]];
  return[];
}
function modelPctMarkup(rate,key,split,selected){
  const value=rate?Math.round(rate.pct)+"%":"-";
  const cls=!rate?"hit-na-text":rate.pct>=70?"hit-good-text":rate.pct>=50?"hit-mid-text":"hit-low-text";
  const disabled=rate?"":" disabled aria-disabled=\"true\"";
  return'<button type="button" class="hit-summary-item '+(selected?"selected":"")+'" data-chart-split="'+esc(split)+'"'+disabled+'><span>'+esc(key)+'</span><strong class="'+cls+'">'+value+'</strong></button>';
}
function modelLogsForRankSeason(player,season){
  const by=player&&player.gameLogsBySeason||{};
  const rows=Array.isArray(by[String(season)])?by[String(season)]:(Number(season)===Number(state.season)?player&&player.gameLog||[]:[]);
  return rows.filter(g=>g&&g.played);
}
function modelDefenseRankMapFor(season,week,position,spec){
  if(!spec||!position)return new Map();
  const key=[season,week,position,spec.metric].join("|");
  if(state.opponentRankCache.has(key))return state.opponentRankCache.get(key);
  const totals=new Map();
  for(const p of state.players){
    if(String(p.position||"").toUpperCase()!==String(position).toUpperCase())continue;
    for(const game of modelLogsForRankSeason(p,season)){
      if(num(game.week)>=week)continue;
      const defense=String(game&&game.opponent&&game.opponent.abbreviation||"").toUpperCase();
      const value=metricValue(game,spec.metric);
      if(!defense||!Number.isFinite(value))continue;
      if(!totals.has(defense))totals.set(defense,new Map());
      const byWeek=totals.get(defense),gameWeek=num(game.week);
      byWeek.set(gameWeek,(byWeek.get(gameWeek)||0)+value);
    }
  }
  const rows=[];
  for(const [team,byWeek] of totals){
    const values=[...byWeek.values()];if(values.length<2)continue;
    rows.push({team:team,value:values.reduce((s,v)=>s+v,0)/values.length,games:values.length});
  }
  rows.sort((a,b)=>a.value-b.value);
  const result=new Map();
  rows.forEach((item,index)=>result.set(item.team,{rank:index+1,total:rows.length,value:item.value,games:item.games}));
  state.opponentRankCache.set(key,result);
  return result;
}
function modelOpponentRankForGame(player,game,spec){
  if(!player||!game||!spec)return null;
  const season=Number(game._season||state.season),week=Math.max(1,num(game.week));
  const opponent=String(game&&game.opponent&&game.opponent.abbreviation||"").toUpperCase();if(!opponent)return null;
  let info=modelDefenseRankMapFor(season,week,String(player.position||"").toUpperCase(),spec).get(opponent)||null;
  if(!info&&season>2020){
    info=modelDefenseRankMapFor(season-1,99,String(player.position||"").toUpperCase(),spec).get(opponent)||null;
    if(info)info=Object.assign({},info,{priorSeason:true});
  }
  return info;
}
function modelHitBarTooltip(game,row,value,rankInfo,teamScope=false){
  const opp=game&&game.opponent||{},abbr=opp.abbreviation||opp.name||"OPP";
  const logo=opp.logo||(abbr?"https://a.espncdn.com/i/teamlogos/nfl/500/"+String(abbr).toLowerCase()+".png":"");
  const season=game&&game._season||state.season||"";
  const rank=rankInfo?"#"+rankInfo.rank:"—",allowed=rankInfo?(Math.round(rankInfo.value*10)/10).toLocaleString():"—";
  const rankBlock=teamScope?"":'<div class="hit-tooltip-rank"><span>Opp Rank</span><strong>'+rank+'</strong><small>'+allowed+' allowed / game'+(rankInfo&&rankInfo.priorSeason?" • prior season":"")+'</small></div>';
  return'<div class="hit-bar-tooltip"><div class="hit-tooltip-date">'+esc(modelChartDateLabel(game))+' • '+esc(season)+'</div><div class="hit-tooltip-matchup">'+(logo?'<img src="'+esc(logo)+'" alt="">':"")+'<span>'+esc(game&&game.isAway?"@ ":"vs ")+esc(abbr)+'</span><b>'+esc(game&&game.score||"")+'</b></div><div class="hit-tooltip-stat"><span>'+esc(generalizedMarketLabel(row))+'</span><strong>'+fmt.format(value)+'</strong></div>'+rankBlock+'</div>';
}
function renderModelHitRateChart(row,split){
  state.hitRateActiveRow=row;state.hitRateActiveSplit=split;
  const teamScope=["team","game"].includes(row&&row.scope),player=modelPlayerForRow(row),games=modelSplitGames(row,split);
  const rates=teamScope?teamRates(row):ratesFor(row,player),selected=rates&&rates[split]||null,spec=teamScope?{metric:"teamMarket"}:metricSpec(row),line=modelLineForRow(row);
  const valueFor=game=>teamScope?modelTeamPropValue(row,game):metricValue(game,spec.metric);
  const hitFor=game=>teamScope?modelTeamPropHit(row,game):isHit(game,row,spec);
  const values=games.map(valueFor).filter(Number.isFinite);
  const average=values.length?values.reduce((s,v)=>s+v,0)/values.length:null,med=median(values);
  const chartEntity=teamScope?(row.teamName||row.team||(row.scope==="game"?row.matchup:"Team")):cleanDisplayPlayerName(row.player);
  $("hitRateTitle").textContent=chartEntity+" - "+generalizedMarketLabel(row);
  $("hitRateSubtitle").innerHTML=esc(cleanDisplayProposition(row))+" • "+esc(row.matchup)+" <span class=\"hit-rate-odds\">"+formatOdds(row.odds)+"</span>";
  const modalResult=historicalResultForRow(row);
  $("hitRateResultBadge").hidden=!state.modelHistorical;
  $("hitRateResultBadge").innerHTML=state.modelHistorical?modelResultBadge(modalResult,false):"";
  $("hitRateSplitLabel").textContent=modelSplitLabel(split);
  $("hitRateSelectedPct").textContent=selected?Math.round(selected.pct)+"%":"—";
  $("hitRateSelectedPct").className=!selected?"":selected.pct>=70?"hit-good-text":selected.pct>=50?"hit-mid-text":"hit-low-text";
  $("hitRateSelectedRecord").textContent=selected?" "+selected.hits+" of "+selected.total:"";
  $("hitRateAverage").textContent=average===null?"—":(Math.round(average*10)/10).toLocaleString();
  $("hitRateMedian").textContent=med===null?"—":(Math.round(med*10)/10).toLocaleString();
  const cy=String(state.season||2026),py=String((state.season||2026)-1);
  $("hitRateBreakdown").innerHTML=[
    modelPctMarkup(rates.l5,"L5","l5",split==="l5"),
    modelPctMarkup(rates.l10,"L10","l10",split==="l10"),
    modelPctMarkup(rates.h2h,"H2H","h2h",split==="h2h"),
    modelPctMarkup(rates.current,cy,"current",split==="current"),
    modelPctMarkup(rates.previous,py,"previous",split==="previous")
  ].join("");
  if(!games.length||!spec||!values.length){$("hitRateChart").innerHTML='<div class="hit-chart-empty">No applicable game-by-game data is available for this prop.</div>';return}
  const maxValue=Math.max(...values,0),minValue=Math.min(...values,0),positiveLine=line===null?0:Math.max(line,0),chartMax=Math.max(1,maxValue,positiveLine)*1.16,chartMin=Math.min(0,minValue,line===null?0:line),chartSpan=Math.max(1,chartMax-chartMin),linePct=line===null?null:Math.max(0,Math.min(100,((line-chartMin)/chartSpan)*100)),stageHeight=286,thresholdBottom=linePct===null?null:48+(linePct/100)*stageHeight;
  const bars=games.map((game,index)=>{
    const value=valueFor(game),hit=hitFor(game),height=Math.max(2,((value-chartMin)/chartSpan)*100),valueBottom=48+(height/100)*stageHeight;
    const breakdown=teamScope?[]:modelMetricBreakdown(game,spec).filter(([,v])=>v!==0);
    const detail=breakdown.length?'<div class="hit-bar-detail">'+breakdown.map(([label,v])=>'<span><b>'+fmt.format(v)+'</b> '+label+'</span>').join("")+'</div>':"";
    const rankInfo=teamScope?null:modelOpponentRankForGame(player,game,spec),rankBadge=rankInfo?'<span class="hit-opp-rank">Opp #'+rankInfo.rank+'</span>':"";
    return'<div class="hit-bar-column" tabindex="0"><div class="hit-bar-value '+(hit?"hit":"miss")+'" style="bottom:'+valueBottom+'px">'+fmt.format(value)+'</div><div class="hit-bar-track"><div class="hit-bar '+(hit?"hit":"miss")+'" style="height:'+height+'%;--bar-delay:'+(index*45)+'ms">'+detail+'</div></div><div class="hit-bar-label"><span>'+esc(modelChartDateLabel(game))+'</span><span>'+esc(modelChartOpponentLabel(game))+'</span>'+rankBadge+'</div>'+modelHitBarTooltip(game,row,value,rankInfo,teamScope)+'</div>';
  }).join("");
  const threshold=thresholdBottom===null?"":'<div class="hit-threshold" style="bottom:'+thresholdBottom+'px"><span>'+esc(row.teamMarketType==="spread"?formatSpreadLine(row.line):modelFormatLine(line))+'</span></div>';
  $("hitRateChart").innerHTML='<div class="hit-chart-plot">'+threshold+'<div class="hit-bars">'+bars+'</div></div>';
}
function openModelHitRateChart(row){
  if(!row)return;
  const rates=["team","game"].includes(row.scope)?teamRates(row):ratesFor(row,modelPlayerForRow(row));
  const split=rates&&rates.l10?"l10":rates&&rates.current?"current":rates&&rates.l5?"l5":"current";
  renderModelHitRateChart(row,split);
  $("hitRateModal").showModal();
}
function localDateKey(){
  const parts=new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=type=>parts.find(p=>p.type===type)?.value||"";
  return get("year")+"-"+get("month")+"-"+get("day");
}
function ladderDateLabel(value){
  const d=new Date(String(value||"")+"T12:00:00");
  return Number.isNaN(d.getTime())?String(value||""):new Intl.DateTimeFormat("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(d);
}
function ladderStatusIcon(status){return status==="hit"?"✓":status==="miss"?"×":status==="push"?"↔":"•"}
function ladderChronologicalPicks(){
  const picks=[...(state.ladderData&&state.ladderData.picks||[])].sort((a,b)=>{
    const ad=String(a.date||""),bd=String(b.date||"");if(ad!==bd)return ad.localeCompare(bd);
    return String(a.createdAt||"").localeCompare(String(b.createdAt||""));
  });
  let run=1,day=1;
  return picks.map((pick,index)=>{
    const normalized=Object.assign({},pick,{_ladderRun:run,_ladderDay:day,_ladderIndex:index});
    const status=String(pick.status||"pending");
    if(status==="hit")day+=1;
    else if(status==="miss"){run+=1;day=1}
    // Push replays the same rung. Pending cannot advance until it grades.
    return normalized;
  });
}
function ladderRunMaxDay(picks,pick){
  const members=picks.filter(item=>item._ladderRun===pick._ladderRun);
  return Math.max(1,...members.map(item=>num(item._ladderDay)||1));
}
function renderLadderLaunch(){
  const picks=ladderChronologicalPicks(),targetDate=state.modelHistorical?state.modelDate:localDateKey();
  const selected=picks.find(p=>p.date===targetDate),last=picks[picks.length-1];
  if(state.modelHistorical){
    $("todayPickButtonLabel").textContent=selected?"See archived pick (Day "+selected._ladderDay+")":"No archived ladder pick";
  }else if(selected){
    $("todayPickButtonLabel").textContent="See today's pick (Day "+selected._ladderDay+")";
  }else if(last){
    $("todayPickButtonLabel").textContent="See latest pick (Day "+last._ladderDay+")";
  }else{
    $("todayPickButtonLabel").textContent="Today's ladder is queued";
  }
  if(selected)state.ladderIndex=selected._ladderIndex;
  else if(picks.length)state.ladderIndex=picks.length-1;
}
function ladderLegHtml(leg){
  const scope=leg.scope||"player",status=String(leg.result&&leg.result.status||"pending");
  const entity=scope==="player"?cleanDisplayPlayerName(leg.player):(scope==="team"?(leg.teamName||leg.team||"Team"):(leg.matchup||"Game"));
  let visual;
  if(scope==="player")visual='<img src="'+esc(leg.headshot||fallbackHeadshot())+'" alt="">';
  else if(scope==="team")visual='<img src="'+esc(modelTeamLogo(leg.team))+'" alt="">';
  else visual='<span class="ladder-game-logos"><img src="'+esc(modelTeamLogo(leg.awayAbbr))+'" alt=""><img src="'+esc(modelTeamLogo(leg.homeAbbr))+'" alt=""></span>';
  const actual=leg.result&&leg.result.actual!==undefined?'<small>Final: '+esc(String(leg.result.actual))+'</small>':"";
  return '<div class="ladder-leg ladder-'+esc(status)+'">'+visual+'<div class="ladder-leg-copy"><strong>'+esc(entity)+'</strong><span>'+esc(cleanDisplayProposition(leg))+'</span><small>'+formatOdds(leg.odds)+' • confidence '+pct(Number(leg.confidence),1)+'</small></div><div class="ladder-leg-result"><span>'+ladderStatusIcon(status)+'</span><strong>'+esc(status==="pending"?"Pending":status.charAt(0).toUpperCase()+status.slice(1))+'</strong>'+actual+'</div></div>';
}
function renderLadderPick(){
  const picks=ladderChronologicalPicks();
  $("ladderPrev").disabled=state.ladderIndex<=0;
  $("ladderNext").disabled=!picks.length||state.ladderIndex>=picks.length-1;
  if(!picks.length){
    $("ladderPickTitle").textContent="Today's ladder is queued";
    $("ladderPickMeta").textContent="Publishes near kickoff.";
    $("ladderHistoryStatus").textContent="Day 1";
    $("ladderPickBody").innerHTML='<div class="ladder-awaiting"><span class="today-pick-dot"></span><div><strong>Day 1 is preparing</strong></div></div>';
    return;
  }
  state.ladderIndex=clamp(state.ladderIndex,0,picks.length-1);
  const pick=picks[state.ladderIndex],status=String(pick.status||"pending"),runMax=ladderRunMaxDay(picks,pick);
  $("ladderPickTitle").textContent="Day "+pick._ladderDay+" • "+ladderDateLabel(pick.date);
  $("ladderPickMeta").textContent=pick.selectionTier||"Even Ladder";
  $("ladderHistoryStatus").textContent="Day "+pick._ladderDay+" of "+runMax;
  const statusLabel=status==="hit"?"WIN":status==="miss"?"LOSS":status==="push"?"PUSH":"LIVE / PENDING";
  $("ladderPickBody").innerHTML='<article class="ladder-slip ladder-slip-'+esc(status)+'">'+
    '<div class="ladder-slip-summary"><div><span>PARLAY ODDS</span><strong>'+formatOdds(pick.odds)+'</strong></div><div><span>MODEL CONFIDENCE</span><strong>'+pct(Number(pick.confidence),1)+'</strong></div><div><span>EST. HIT PROB.</span><strong>'+pct(Number(pick.estimatedProbability)*100,1)+'</strong></div><div class="ladder-overall-status"><span>'+ladderStatusIcon(status)+'</span><strong>'+statusLabel+'</strong></div></div>'+
    '<div class="ladder-legs">'+(pick.legs||[]).map(ladderLegHtml).join("")+'</div>'+
  '</article>';
}
function toggleLadderPanel(){
  const panel=$("ladderChallengePanel"),opening=panel.hidden;
  panel.hidden=!opening;$("todayPickButton").setAttribute("aria-expanded",opening?"true":"false");
  $("todayPickButton").classList.toggle("active",opening);
  if(opening)renderLadderPick();
}

function bind(){
  bindModelFilters();
  $("signalTableHead").addEventListener("click",e=>{
    const th=e.target.closest("[data-signal-sort]");if(!th||th.hidden)return;
    setSignalSort(th.dataset.signalSort);
  });
  $("modelDateButton").addEventListener("click",e=>{e.stopPropagation();toggleModelDatePopover()});
  $("modelDateOptions").addEventListener("click",async e=>{
    const option=e.target.closest("[data-model-date]");if(!option)return;
    const date=option.dataset.modelDate||"live",file=option.dataset.modelHistoryFile||null;
    if(date===state.modelDate){closeModelDatePopover();return}
    await loadModelDate(date,file);
  });
  $("todayPickButton").addEventListener("click",toggleLadderPanel);
  $("ladderPrev").addEventListener("click",()=>{if(state.ladderIndex<=0)return;state.ladderIndex--;renderLadderPick()});
  $("ladderNext").addEventListener("click",()=>{const n=ladderChronologicalPicks().length;if(state.ladderIndex>=n-1)return;state.ladderIndex++;renderLadderPick()});
  $("modelPresetButton").addEventListener("click",e=>{e.stopPropagation();togglePresetPopover()});
  $("modelPresetPopover").addEventListener("click",e=>{
    const option=e.target.closest("[data-preset]");if(!option)return;
    applyPreset(option.dataset.preset);closePresetPopover();
  });
  document.addEventListener("click",e=>{
    if(!e.target.closest("#modelPresetPopover")&&!e.target.closest("#modelPresetButton"))closePresetPopover();
    if(!e.target.closest("#modelDatePopover")&&!e.target.closest("#modelDateButton"))closeModelDatePopover();
  });
  document.addEventListener("click",e=>{const trigger=e.target.closest(".model-prop-trigger");if(!trigger)return;const row=state.chartRows.get(trigger.dataset.propKey);if(row)openModelHitRateChart(row)});
  document.addEventListener("keydown",e=>{if(!["Enter"," "].includes(e.key))return;const trigger=e.target.closest(".model-prop-trigger");if(!trigger)return;e.preventDefault();const row=state.chartRows.get(trigger.dataset.propKey);if(row)openModelHitRateChart(row)});
  $("hitRateClose").addEventListener("click",()=>$("hitRateModal").close());
  $("hitRateModal").addEventListener("click",e=>{if(e.target===$("hitRateModal"))$("hitRateModal").close()});
  $("hitRateBreakdown").addEventListener("click",e=>{const button=e.target.closest("[data-chart-split]");if(!button||button.disabled||!state.hitRateActiveRow)return;renderModelHitRateChart(state.hitRateActiveRow,button.dataset.chartSplit)});
  $("slipPrev").addEventListener("click",()=>{if(state.slipPage<=0)return;state.slipPage--;renderSlips(-1)});
  $("slipNext").addEventListener("click",()=>{const pages=Math.ceil(state.slips.length/SLIPS_PER_PAGE);if(state.slipPage>=pages-1)return;state.slipPage++;renderSlips(1)});
  let slipTouchStartX=null;
  $("recommendedSlips").addEventListener("touchstart",e=>{slipTouchStartX=e.touches&&e.touches[0]?e.touches[0].clientX:null},{passive:true});
  $("recommendedSlips").addEventListener("touchend",e=>{
    if(slipTouchStartX===null||state.slips.length<=SLIPS_PER_PAGE)return;
    const endX=e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientX:slipTouchStartX,delta=endX-slipTouchStartX;
    slipTouchStartX=null;
    if(Math.abs(delta)<55)return;
    const pages=Math.ceil(state.slips.length/SLIPS_PER_PAGE);
    if(delta<0&&state.slipPage<pages-1){state.slipPage++;renderSlips(1)}
    else if(delta>0&&state.slipPage>0){state.slipPage--;renderSlips(-1)}
  },{passive:true});
  document.querySelectorAll(".model-controls input:not(#modelEntitySearch)").forEach(el=>{el.addEventListener("input",()=>{syncLabels();schedule()});el.addEventListener("change",()=>{syncLabels();schedule()})});
  $("modelEntitySearch").addEventListener("input",renderModelEntitySearchResults);
  $("modelEntitySearch").addEventListener("focus",renderModelEntitySearchResults);
  $("modelEntitySearchResults").addEventListener("click",e=>{const button=e.target.closest("[data-entity-add]");if(button)addModelEntityRule(button.dataset.entityAdd)});
  $("modelEntityRuleList").addEventListener("click",e=>{
    const row=e.target.closest("[data-entity-rule]");if(!row)return;
    const key=row.dataset.entityRule,mode=e.target.closest("[data-rule-mode]"),remove=e.target.closest("[data-rule-remove]");
    if(mode)setModelEntityRuleMode(key,mode.dataset.ruleMode);else if(remove)removeModelEntityRule(key);
  });
  document.addEventListener("click",e=>{if(!e.target.closest(".model-entity-picker"))$("modelEntitySearchResults").hidden=true});
  $("weightControls").addEventListener("click",e=>{const b=e.target.closest("[data-weight]");if(!b)return;const k=b.dataset.weight,levels=[0,8,14,22,30,40],cur=state.weights[k],next=levels[(levels.indexOf(cur)+1)%levels.length];state.weights[k]=next;b.querySelector("strong").textContent=next;b.classList.toggle("active",next>0);schedule()});
  $("resetModel").addEventListener("click",()=>{$("modelPresetButton").querySelector("span").textContent="Presets";for(const [k] of HIT_LABELS)$(k+"Min").value=DEFAULTS[k];for(const id of ["targetShare","carryShare","opportunityShare","dvpMin","teamMatchupMin","edgeMin","targetsPerGameMin","carriesPerGameMin","oddsSpread"])$(id).value=DEFAULTS[id];$("dvpSample").value=DEFAULTS.dvpSample;$("requireOpponentData").checked=false;state.selectedPositions.clear();state.selectedMarkets.clear();state.selectedSides.clear();state.selectedGames.clear();state.modelScope="";state.entityRules.clear();saveModelEntityRules();$("modelEntitySearch").value="";renderModelEntityRules();renderModelEntitySearchResults();renderModelFilters();for(const id of ["legOddsMin","legOddsMax","parlayOddsMin","parlayOddsMax","legsMin","legsMax"])$(id).value=DEFAULTS[id];$("lineMin").value="";$("lineMax").value="";$("uniquePlayers").checked=true;$("avoidSameGame").checked=true;state.weights=Object.assign({},DEFAULTS.weights);document.querySelectorAll("[data-weight]").forEach(b=>{const k=b.dataset.weight;b.querySelector("strong").textContent=state.weights[k];b.classList.add("active")});syncLabels();recalc()});
}
async function init(){
  loadModelEntityRules();buildControls();bind();syncLabels();renderModelEntityRules();
  try{
    await loadModelHistoryIndex();
    const bundle=await fetchLiveModelBundle();
    setResultSources(bundle.stats,bundle.teams,bundle.ladder);
    applyModelBundle(bundle,{historical:false,date:"live"});
  }catch(err){
    console.error(err);
    $("recommendedSlips").innerHTML='<div class="model-empty">The model could not load the current stats/odds datasets. Refresh after the next data update.</div>';
    $("modelSeason").textContent="Model unavailable";
    $("modelUpdated").textContent="Data load failed";
  }
}
init();
})();