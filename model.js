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
const state={season:null,players:[],odds:[],teams:[],teamRaw:null,teamProfiles:new Map(),teamStatMeta:new Map(),playerByName:new Map(),usage:new Map(),dvp:new Map(),eligible:[],slips:[],slipPage:0,weights:Object.assign({},DEFAULTS.weights),timer:0,chartRows:new Map(),hitRateActiveRow:null,hitRateActiveSplit:null,opponentRankCache:new Map(),calibration:null,pricePairs:new Map(),historyCache:new Map(),forecastCache:new Map(),usageStabilityCache:new Map(),teamDefenseCache:new Map(),selectedPositions:new Set(),selectedMarkets:new Set(),selectedSides:new Set(),selectedGames:new Set(),ladderData:{picks:[]},ladderIndex:0,modelDate:"live",modelHistorical:false,modelHistoryIndex:{days:[]},modelHistoryManifest:null,resultPlayers:[],resultTeams:[],resultPlayerByName:new Map(),resultTeamByAbbr:new Map(),resultSeason:null,liveLadderData:{picks:[]},resultCache:new Map(),slipMembership:new Map(),loadingDate:false};
const SLIPS_PER_PAGE=6;
const MODEL_RAW_BASE="https://raw.githubusercontent.com/ryanehinkle/sports-tracker/";

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
  const [stats,odds,teams,calibration,ladder]=await Promise.all([
    fetchModelJson("data/nfl-stats.json?v="+Date.now()),
    fetchModelJson("data/nfl-odds.json?v="+Date.now()),
    fetchModelJson("data/nfl-team-stats.json?v="+Date.now()),
    fetchModelJson("data/model-calibration.json?v="+Date.now()).catch(()=>null),
    fetchModelJson("data/ladder-picks.json?v="+Date.now()).catch(()=>({picks:[]}))
  ]);
  return{stats,odds,teams,calibration,ladder};
}
async function fetchHistoricalModelBundle(manifest){
  const commit=manifest&&manifest.sourceCommit,files=manifest&&manifest.files||{};
  if(!commit)throw new Error("Historical model commit missing");
  const [stats,odds,teams,calibration,ladder]=await Promise.all([
    fetchModelJson(modelArchiveUrl(commit,files.stats||"data/nfl-stats.json"),"force-cache"),
    fetchModelJson(modelArchiveUrl(commit,files.odds||"data/nfl-odds.json"),"force-cache"),
    fetchModelJson(modelArchiveUrl(commit,files.teamStats||"data/nfl-team-stats.json"),"force-cache"),
    fetchModelJson(modelArchiveUrl(commit,files.calibration||"data/model-calibration.json"),"force-cache").catch(()=>null),
    fetchModelJson(modelArchiveUrl(commit,files.ladder||"data/ladder-picks.json"),"force-cache").catch(()=>({picks:[]}))
  ]);
  return{stats,odds,teams,calibration,ladder};
}
function applyModelBundle(bundle,{historical=false,date="live",manifest=null}={}){
  const stats=bundle.stats||{},odds=bundle.odds||{},teams=bundle.teams||{teams:[]};
  state.modelHistorical=historical;state.modelDate=historical?date:"live";state.modelHistoryManifest=manifest;
  state.season=stats.season||new Date().getFullYear();state.players=stats.players||[];state.teams=teams.teams||[];state.teamRaw=teams;state.calibration=bundle.calibration||null;
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
    const own=strength(selected),opp=strength(opponent);signal=clamp(.5+(own-opp)*.75,.05,.95);
    components={offense:teamGroup(selected,"offense"),defense:teamGroup(selected,"defense"),scoring:teamGroup(selected,"scoring"),situational:teamGroup(selected,"situational"),turnovers:teamGroup(selected,"turnovers"),specialTeams:teamGroup(selected,"specialTeams"),all:selected.all};
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
function teamRates(row){
  const r=row.hitRates||{};return{l5:normalizeSplit(r.l5),l10:normalizeSplit(r.l10),h2h:normalizeSplit(r.h2h),current:normalizeSplit(r.current),previous:normalizeSplit(r.previous)};
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

function flattenOdds(raw){
  const out=[];
  for(const event of raw.events||[]){
    const away=event.awayAbbr||event.awayTeam||"AWAY",home=event.homeAbbr||event.homeTeam||"HOME";
    for(const prop of event.props||[]){
      const scope=prop.scope||"player",player=scope==="player"?state.playerByName.get(norm(prop.player)):null;
      const row=Object.assign({},prop,{scope,eventId:String(event.id||""),awayAbbr:event.awayAbbr||"",homeAbbr:event.homeAbbr||"",awayTeam:event.awayTeam||"",homeTeam:event.homeTeam||"",matchup:away+" @ "+home,commenceTime:event.commenceTime||""});
      row.player=scope==="player"?clean(prop.player):"";
      row.team=prop.team||player&&player.team||"";
      row.position=prop.position||player&&player.position||(scope==="team"?"TEAM":scope==="game"?"GAME":"");
      row._marketLabel=generalizedMarketLabel(row);
      row._modelMarketLabel=modelSupportedMarketLabel(row);
      out.push(row);
    }
  }
  return out;
}

function pricePairKey(row){
  return[String(row.eventId||""),norm(row.player||row.team||row.scope||""),String(row._marketLabel||generalizedMarketLabel(row)||"").toLowerCase(),String(row.line??"")].join("|");
}
function buildPricePairs(){
  state.pricePairs=new Map();
  for(const row of state.odds){
    const key=pricePairKey(row),pair=state.pricePairs.get(key)||{};
    pair[String(row.selection||"")]=row;state.pricePairs.set(key,pair);
  }
}
function marketProbability(row){
  const decimal=rowDecimalOdds(row),raw=decimal?1/decimal:null;
  if(!Number.isFinite(raw))return .5;
  const pair=state.pricePairs.get(pricePairKey(row));
  const side=String(row.selection||""),opposite=side==="Over"?"Under":side==="Under"?"Over":side==="Yes"?"No":side==="No"?"Yes":"";
  const otherRow=opposite&&pair&&pair[opposite],otherDecimal=otherRow?rowDecimalOdds(otherRow):null,other=otherDecimal?1/otherDecimal:null;
  return Number.isFinite(other)?raw/(raw+other):raw;
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

function controls(){
  const hit={};for(const [k] of HIT_LABELS)hit[k]=Number($(k+"Min").value)||0;
  return{
    hit:hit,targetShare:Number($("targetShare").value)||0,carryShare:Number($("carryShare").value)||0,opportunityShare:Number($("opportunityShare").value)||0,
    targetsPerGameMin:Number($("targetsPerGameMin").value)||0,carriesPerGameMin:Number($("carriesPerGameMin").value)||0,
    dvpMin:Number($("dvpMin").value)||0,dvpSample:Number($("dvpSample").value)||1,teamMatchupMin:Number($("teamMatchupMin").value)||0,
    edgeMin:Number($("edgeMin").value),oddsSpread:Number($("oddsSpread").value)||600,requireOpponentData:$("requireOpponentData").checked,
    positions:state.selectedPositions,markets:state.selectedMarkets,sides:state.selectedSides,games:state.selectedGames,player:$("playerFilter").value.trim().toLowerCase(),
    lineMin:$("lineMin").value===""?null:Number($("lineMin").value),lineMax:$("lineMax").value===""?null:Number($("lineMax").value),
    legOddsMin:Number($("legOddsMin").value),legOddsMax:Number($("legOddsMax").value),parlayOddsMin:Number($("parlayOddsMin").value),parlayOddsMax:Number($("parlayOddsMax").value),
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
  const identity=[row.teamName,row.team,row.matchup,row.proposition,market].join(" ").toLowerCase();
  if(cfg.player&&!identity.includes(cfg.player))return null;

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
  if(["team","game"].includes(row&&row.scope))return analyzeTeamMarket(row,cfg);
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
  if(cfg.player&&!String(row.player||"").toLowerCase().includes(cfg.player))return null;

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
function generateSlips(candidates,cfg){
  const top=candidates.slice(0,80);
  const minLegs=Math.min(cfg.legsMin,cfg.legsMax),maxLegs=Math.max(cfg.legsMin,cfg.legsMax);
  const minD=americanToDecimal(cfg.parlayOddsMin),maxD=americanToDecimal(cfg.parlayOddsMax);
  const recommendations=[];

  function propFamilyKey(x){
    const row=x.row||{};
    return[
      String(row.eventId||""),
      norm(row.player||row.team||row.scope||""),
      String(x.market||row._marketLabel||generalizedMarketLabel(row)||"").toLowerCase()
    ].join("|");
  }
  function compatible(combo,next){
    if(combo.some(x=>propFamilyKey(x)===propFamilyKey(next)))return false;
    const nextPlayer=norm(next.row.player);if(cfg.uniquePlayers&&nextPlayer&&combo.some(x=>norm(x.row.player)===nextPlayer))return false;
    if(cfg.avoidSameGame&&combo.some(x=>x.row.eventId&&x.row.eventId===next.row.eventId))return false;
    const values=combo.map(x=>Number(x.row.odds)).concat(Number(next.row.odds)).filter(Number.isFinite);
    if(values.length>1&&Math.max(...values)-Math.min(...values)>cfg.oddsSpread)return false;
    return true;
  }
  function statsFor(legs){
    let decimal=1,joint=1,sameGamePairs=0;
    for(let i=0;i<legs.length;i++){
      const d=rowDecimalOdds(legs[i].row);if(!d)return null;
      decimal*=d;joint*=legs[i].modelProb;
      for(let j=0;j<i;j++)if(legs[i].row.eventId&&legs[i].row.eventId===legs[j].row.eventId)sameGamePairs++;
    }
    // We do not have historical SGP correlation matrices. Apply a small
    // conservative ranking haircut instead of pretending the legs are independent.
    const conservativeProb=clamp(joint*Math.pow(.97,sameGamePairs),.0001,.9999);
    const bookProb=1/decimal;
    const slipEdge=conservativeProb-bookProb;
    return{
      decimal:decimal,odds:decimalToAmerican(decimal),modelProb:conservativeProb,
      bookProb:bookProb,slipEdge:slipEdge,edge:avg(legs.map(x=>x.edge))||0,
      score:avg(legs.map(x=>x.score))||0,sameGamePairs:sameGamePairs
    };
  }
  function partialRank(node){
    // Probability is primary. Model grade and positive edge are small tie-breakers.
    const probability=node.legs.reduce((p,x)=>p*x.modelProb,1);
    const quality=avg(node.legs.map(x=>x.score))||0;
    const edge=avg(node.legs.map(x=>Math.max(-.05,x.edge)))||0;
    return Math.log(Math.max(probability,1e-8))+quality*.004+edge*.8;
  }

  // Bounded beam search prevents large leg ranges from creating combinatorial UI lag.
  let beam=[{legs:[],start:0}];
  const beamWidth=900;
  for(let size=1;size<=maxLegs;size++){
    const nextBeam=[];
    for(const node of beam){
      for(let i=node.start;i<top.length;i++){
        const candidate=top[i];
        if(!compatible(node.legs,candidate))continue;
        const legs=node.legs.concat(candidate);
        const stats=statsFor(legs);if(!stats)continue;
        if(maxD&&stats.decimal>maxD)continue; // decimal odds can only increase with more legs
        nextBeam.push({legs:legs,start:i+1,rank:0,stats:stats});
      }
    }
    for(const node of nextBeam)node.rank=partialRank(node);
    nextBeam.sort((a,b)=>b.rank-a.rank);
    beam=nextBeam.slice(0,beamWidth);

    if(size>=minLegs){
      for(const node of beam){
        const st=node.stats;
        if(minD&&st.decimal<minD)continue;
        if(maxD&&st.decimal>maxD)continue;
        recommendations.push(Object.assign({legs:node.legs},st));
      }
    }
    if(!beam.length)break;
  }

  recommendations.sort((a,b)=>
    b.modelProb-a.modelProb||
    b.score-a.score||
    b.slipEdge-a.slipEdge
  );

  const out=[],seen=new Set();
  for(const slip of recommendations){
    const sig=slip.legs.map(x=>modelPropKey(x.row)).sort().join("~");
    if(seen.has(sig))continue;
    seen.add(sig);out.push(slip);
    if(out.length>=9)break;
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
  if(row.scope==="team")return '<img src="'+esc(modelTeamLogo(row.team))+'" alt="" loading="lazy">';
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
function renderSignals(){
  const rows=state.eligible.slice(0,60);$("legBoardCount").textContent=fmt.format(rows.length);
  const colspan=state.modelHistorical?11:10;
  if(!rows.length){
    const unavailable=[...state.selectedMarkets].filter(m=>!state.odds.some(row=>(row._modelMarketLabel||modelSupportedMarketLabel(row))===m));
    const message=unavailable.length===1
      ?"FanDuel has not posted "+unavailable[0]+" for this board."
      :"No markets satisfy every active constraint. Loosen one or more filters.";
    $("signalBody").innerHTML='<tr><td colspan="'+colspan+'" class="model-empty">'+esc(message)+'</td></tr>';return
  }
  $("signalBody").innerHTML=rows.map(x=>{
    const r=x.row,entity=modelEntityName(r),isPlayer=r.scope!=="team"&&r.scope!=="game";
    const trigger=isPlayer?' model-player-trigger':'';
    const triggerAttrs=isPlayer?' data-player-id="'+esc(x.player&&x.player.id||"")+'" data-prop-key="'+esc(modelPropKey(r))+'"':'';
    const result=historicalResultForRow(r),memberships=slipMembershipFor(r);
    const resultCell=state.modelHistorical?'<td class="model-result-cell">'+modelResultBadge(result,true)+(memberships.length?'<small class="slip-membership">Slip '+memberships.join(" • ")+'</small>':"")+'</td>':"";
    return '<tr class="'+(state.modelHistorical?'historical-row result-'+esc(result.status):"")+'"><td><button type="button" class="signal-player'+trigger+'"'+triggerAttrs+'>'+
      modelEntityVisual(r,x.player)+'<div class="signal-copy"><strong>'+esc(entity)+'</strong><span>'+esc(cleanDisplayProposition(r)||x.market)+'</span><small>'+esc(r.scope==="game"?r.matchup:(x.team||"NFL")+" vs "+(x.opp||"—"))+' • '+esc(x.pos||"—")+'</small></div></button></td>'+
      '<td><span class="score-pill">'+x.score.toFixed(1)+'</span></td><td class="signal-odds"><strong>'+formatOdds(r.odds)+'</strong></td>'+resultCell+
      rateTd(x.rates.l5)+rateTd(x.rates.l10)+rateTd(x.rates.h2h)+rateTd(x.rates.current)+rateTd(x.rates.previous)+
      '<td class="'+metricClass(x.usageSignal*100)+'">'+esc(modelProfileText(x))+'</td>'+
      '<td class="'+metricClass(x.matchupSignal*100)+'">'+Math.round(x.matchupSignal*100)+'th'+(["team","game"].includes(r.scope)?' <small>all-team model</small>':x.dvpRow?' <small>(n='+x.dvpRow.samples+')</small>':"")+'</td></tr>';
  }).join("");
}
function slipHtml(s,i){
  let legs="";const legResults=[];
  for(const x of s.legs){
    const r=x.row,isPlayer=r.scope!=="team"&&r.scope!=="game",entity=modelEntityName(r);
    const trigger=isPlayer?' model-player-trigger':'',attrs=isPlayer?' data-player-id="'+esc(x.player&&x.player.id||"")+'" data-prop-key="'+esc(modelPropKey(r))+'" tabindex="0" role="button" aria-label="Open '+esc(entity)+' prop chart"':'';
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
  $("slipSub").textContent=total?(total>SLIPS_PER_PAGE?fmt.format(total)+" generated • "+SLIPS_PER_PAGE+" per page":"all shown below"):"within requested odds";
  $("slipPager").hidden=total<=SLIPS_PER_PAGE;
  $("slipPrev").disabled=state.slipPage===0;
  $("slipNext").disabled=state.slipPage>=pages-1;
  $("slipPageStatus").textContent=total
    ? (total>SLIPS_PER_PAGE?"Showing "+(start+1)+"–"+end+" of "+total:"Showing all "+total+" slips")
    : "No slips in current range";
  const container=$("recommendedSlips");
  if(!total){
    container.innerHTML='<div class="model-empty">No parlay combination lands inside the requested final-odds range. Adjust final odds or leg count.</div>';
    return;
  }
  container.classList.remove("page-next","page-prev");
  void container.offsetWidth;
  if(direction)container.classList.add(direction>0?"page-next":"page-prev");
  container.innerHTML=state.slips.slice(start,end).map((s,i)=>slipHtml(s,start+i)).join("");
}
function renderSummary(){$("eligibleCount").textContent=fmt.format(state.eligible.length);$("eligibleSub").textContent=state.odds.length?"of "+fmt.format(state.odds.length)+(state.modelHistorical?" frozen markets":" current markets"):"after filters";$("bestScore").textContent=state.eligible.length?state.eligible[0].score.toFixed(1):"—";const m=median(state.eligible.map(x=>x.edge*100));$("medianEdge").textContent=Number.isFinite(m)?(m>=0?"+":"")+m.toFixed(1)+"%":"—"}
function renderFormula(){
  const cal=state.calibration&&state.calibration.all&&state.calibration.all.test;
  const sample=state.calibration&&state.calibration.samples;
  $("modelFormula").innerHTML=
    '<strong>Calibrated mixed-market probability model</strong><br>'+
    '<code>Players: shrink(2025 walk-forward logistic estimate → current FanDuel no-vig probability)</code><br>'+
    '<code>Teams: book probability + historical cover/hit rates + full team-stat profile</code><br><br>'+
    'Player history: <strong>L10 + season-to-date + line distance + trend</strong><br>'+
    'Player matchup: <strong>defense-vs-position percentile</strong><br>'+
    'Team matchup: <strong>every numeric ESPN team-stat category normalized league-wide</strong><br>'+
    'Team weighting: <strong>offense, defense, scoring, situational, turnovers, special teams + all-stat composite</strong><br>'+
    'Reliability: <strong>sample size + calibration/stat breadth</strong><br>'+
    'Final grade: <strong>estimated hit probability</strong> + reliability + matchup/profile signals'+
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
  const out=[];for(const row of state.odds){const x=analyze(row,cfg);if(x)out.push(x)}out.sort((a,b)=>b.score-a.score||b.edge-a.edge);state.eligible=out;state.chartRows=new Map(out.map(x=>[modelPropKey(x.row),x.row]));state.slips=generateSlips(out,cfg);buildSlipMembership();state.slipPage=0;renderSummary();renderSlips();renderSignals();renderCharts();renderFormula();
}
function schedule(){clearTimeout(state.timer);state.timer=setTimeout(recalc,35)}
function buildControls(){
  $("hitRateControls").innerHTML=HIT_LABELS.map(pair=>'<label class="range-row"><span><b>'+pair[1]+' minimum</b><small>Required hit rate</small></span><output id="'+pair[0]+'Value">'+DEFAULTS[pair[0]]+'%</output><input id="'+pair[0]+'Min" type="range" min="0" max="100" step="5" value="'+DEFAULTS[pair[0]]+'"></label>').join("");
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
  $("lineMin").value="";$("lineMax").value="";$("playerFilter").value="";
  $("uniquePlayers").checked=preset.uniquePlayers!==false;
  $("avoidSameGame").checked=Boolean(preset.avoidSameGame);
  state.selectedPositions.clear();state.selectedMarkets.clear();state.selectedSides.clear();state.selectedGames.clear();
  renderModelFilters();syncLabels();recalc();
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
function fillSelects(){renderModelFilters()}
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
function modelSplitGames(row,split){
  const player=modelPlayerForRow(row);if(!player)return[];
  const currentYear=Number(state.season||2026),previousYear=currentYear-1,all=modelPlayedLogs(player);
  let games=[];
  if(split==="l5")games=all.slice(0,5);
  else if(split==="l10")games=all.slice(0,10);
  else if(split==="h2h"){const opponent=nextOpponent(row);games=opponent?all.filter(g=>String(g&&g.opponent&&g.opponent.abbreviation||"").toUpperCase()===opponent):[]}
  else if(split==="current")games=all.filter(g=>g._season===currentYear);
  else if(split==="previous")games=all.filter(g=>g._season===previousYear);
  const spec=metricSpec(row);
  const applicable=games.filter(g=>spec&&isHit(g,row,spec)!==null);
  return applicable.sort(modelCompareGamesChronologically);
}
function modelLineForRow(row){
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
function modelHitBarTooltip(game,row,value,rankInfo){
  const opp=game&&game.opponent||{},abbr=opp.abbreviation||opp.name||"OPP";
  const logo=opp.logo||(abbr?"https://a.espncdn.com/i/teamlogos/nfl/500/"+String(abbr).toLowerCase()+".png":"");
  const rank=rankInfo?"#"+rankInfo.rank:"—",allowed=rankInfo?(Math.round(rankInfo.value*10)/10).toLocaleString():"—";
  const season=game&&game._season||state.season||"";
  return'<div class="hit-bar-tooltip"><div class="hit-tooltip-date">'+esc(modelChartDateLabel(game))+' • '+esc(season)+'</div><div class="hit-tooltip-matchup">'+(logo?'<img src="'+esc(logo)+'" alt="">':"")+'<span>'+esc(game&&game.isAway?"@ ":"vs ")+esc(abbr)+'</span><b>'+esc(game&&game.score||"")+'</b></div><div class="hit-tooltip-stat"><span>'+esc(generalizedMarketLabel(row))+'</span><strong>'+fmt.format(value)+'</strong></div><div class="hit-tooltip-rank"><span>Opp Rank</span><strong>'+rank+'</strong><small>'+allowed+' allowed / game'+(rankInfo&&rankInfo.priorSeason?" • prior season":"")+'</small></div></div>';
}
function renderModelHitRateChart(row,split){
  state.hitRateActiveRow=row;state.hitRateActiveSplit=split;
  const player=modelPlayerForRow(row),games=modelSplitGames(row,split),rates=ratesFor(row,player),selected=rates&&rates[split]||null,spec=metricSpec(row),line=modelLineForRow(row);
  const values=games.map(g=>metricValue(g,spec.metric)).filter(Number.isFinite);
  const average=values.length?values.reduce((s,v)=>s+v,0)/values.length:null,med=median(values);
  $("hitRateTitle").textContent=cleanDisplayPlayerName(row.player)+" - "+generalizedMarketLabel(row);
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
  if(!games.length||!spec){$("hitRateChart").innerHTML='<div class="hit-chart-empty">No applicable game-by-game data is available for this prop.</div>';return}
  const maxValue=Math.max(...values,0),minValue=Math.min(...values,0),positiveLine=line===null?0:Math.max(line,0),chartMax=Math.max(1,maxValue,positiveLine)*1.16,chartMin=Math.min(0,minValue),chartSpan=Math.max(1,chartMax-chartMin),linePct=line===null?null:Math.max(0,Math.min(100,((line-chartMin)/chartSpan)*100)),plotWidth=Math.max(680,games.length*92),stageHeight=286,thresholdBottom=linePct===null?null:48+(linePct/100)*stageHeight;
  const bars=games.map((game,index)=>{
    const value=metricValue(game,spec.metric),hit=isHit(game,row,spec),height=Math.max(2,((value-chartMin)/chartSpan)*100),valueBottom=48+(height/100)*stageHeight,breakdown=modelMetricBreakdown(game,spec).filter(([,v])=>v!==0);
    const detail=breakdown.length?'<div class="hit-bar-detail">'+breakdown.map(([label,v])=>'<span><b>'+fmt.format(v)+'</b> '+label+'</span>').join("")+'</div>':"";
    const rankInfo=modelOpponentRankForGame(player,game,spec),rankBadge=rankInfo?'<span class="hit-opp-rank">Opp #'+rankInfo.rank+'</span>':"";
    return'<div class="hit-bar-column" tabindex="0"><div class="hit-bar-value '+(hit?"hit":"miss")+'" style="bottom:'+valueBottom+'px">'+fmt.format(value)+'</div><div class="hit-bar-track"><div class="hit-bar '+(hit?"hit":"miss")+'" style="height:'+height+'%;--bar-delay:'+(index*45)+'ms">'+detail+'</div></div><div class="hit-bar-label"><span>'+esc(modelChartDateLabel(game))+'</span><span>'+esc(modelChartOpponentLabel(game))+'</span>'+rankBadge+'</div>'+modelHitBarTooltip(game,row,value,rankInfo)+'</div>';
  }).join("");
  const threshold=thresholdBottom===null?"":'<div class="hit-threshold" style="bottom:'+thresholdBottom+'px"><span>'+esc(modelFormatLine(line))+'</span></div>';
  $("hitRateChart").innerHTML='<div class="hit-chart-plot" style="width:'+plotWidth+'px">'+threshold+'<div class="hit-bars">'+bars+'</div></div>';
}
function openModelHitRateChart(row){
  if(!row)return;
  const rates=ratesFor(row,modelPlayerForRow(row));
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
function renderLadderLaunch(){
  const picks=[...(state.ladderData&&state.ladderData.picks||[])].sort((a,b)=>num(a.day)-num(b.day));
  const targetDate=state.modelHistorical?state.modelDate:localDateKey();
  const selected=picks.find(p=>p.date===targetDate);
  const last=picks[picks.length-1],day=selected?num(selected.day):(num(last&&last.day)+1||1);
  $("todayPickButtonLabel").textContent=state.modelHistorical
    ? (selected?"See archived pick (Day "+day+")":"Archived ladder • Day "+day)
    : "See today's pick (Day "+day+")";
  if(selected)state.ladderIndex=Math.max(0,picks.findIndex(p=>p===selected));
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
  const picks=[...(state.ladderData&&state.ladderData.picks||[])].sort((a,b)=>num(a.day)-num(b.day));
  $("ladderPrev").disabled=state.ladderIndex<=0;
  $("ladderNext").disabled=!picks.length||state.ladderIndex>=picks.length-1;
  if(!picks.length){
    $("ladderPickTitle").textContent="Today's ladder is queued";
    $("ladderPickMeta").textContent="The first challenge entry is generated from the final pregame board roughly one hour before kickoff.";
    $("ladderHistoryStatus").textContent="Day 1";
    $("ladderPickBody").innerHTML='<div class="ladder-awaiting"><span class="today-pick-dot"></span><div><strong>Day 1 is preparing</strong><span>The engine will run tens of thousands of combinations and publish the closest, highest-confidence even-money ladder automatically.</span></div></div>';
    return;
  }
  state.ladderIndex=clamp(state.ladderIndex,0,picks.length-1);
  const pick=picks[state.ladderIndex],status=String(pick.status||"pending");
  $("ladderPickTitle").textContent="Day "+pick.day+" • "+ladderDateLabel(pick.date);
  $("ladderPickMeta").textContent=(pick.selectionTier||"Even Ladder")+" • "+fmt.format(pick.simulations||0)+" combinations searched";
  $("ladderHistoryStatus").textContent="Day "+pick.day+" of "+picks[picks.length-1].day;
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
  $("modelDateButton").addEventListener("click",e=>{e.stopPropagation();toggleModelDatePopover()});
  $("modelDateOptions").addEventListener("click",async e=>{
    const option=e.target.closest("[data-model-date]");if(!option)return;
    const date=option.dataset.modelDate||"live",file=option.dataset.modelHistoryFile||null;
    if(date===state.modelDate){closeModelDatePopover();return}
    await loadModelDate(date,file);
  });
  $("todayPickButton").addEventListener("click",toggleLadderPanel);
  $("ladderPrev").addEventListener("click",()=>{if(state.ladderIndex<=0)return;state.ladderIndex--;renderLadderPick()});
  $("ladderNext").addEventListener("click",()=>{const n=(state.ladderData&&state.ladderData.picks||[]).length;if(state.ladderIndex>=n-1)return;state.ladderIndex++;renderLadderPick()});
  $("modelPresetButton").addEventListener("click",e=>{e.stopPropagation();togglePresetPopover()});
  $("modelPresetPopover").addEventListener("click",e=>{
    const option=e.target.closest("[data-preset]");if(!option)return;
    applyPreset(option.dataset.preset);closePresetPopover();
  });
  document.addEventListener("click",e=>{
    if(!e.target.closest("#modelPresetPopover")&&!e.target.closest("#modelPresetButton"))closePresetPopover();
    if(!e.target.closest("#modelDatePopover")&&!e.target.closest("#modelDateButton"))closeModelDatePopover();
  });
  document.addEventListener("click",e=>{const trigger=e.target.closest(".model-player-trigger");if(!trigger)return;const row=state.chartRows.get(trigger.dataset.propKey);if(row)openModelHitRateChart(row)});
  document.addEventListener("keydown",e=>{if(!["Enter"," "].includes(e.key))return;const trigger=e.target.closest(".model-player-trigger");if(!trigger)return;e.preventDefault();const row=state.chartRows.get(trigger.dataset.propKey);if(row)openModelHitRateChart(row)});
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
  document.querySelectorAll(".model-controls input").forEach(el=>{el.addEventListener("input",()=>{syncLabels();schedule()});el.addEventListener("change",()=>{syncLabels();schedule()})});
  $("weightControls").addEventListener("click",e=>{const b=e.target.closest("[data-weight]");if(!b)return;const k=b.dataset.weight,levels=[0,8,14,22,30,40],cur=state.weights[k],next=levels[(levels.indexOf(cur)+1)%levels.length];state.weights[k]=next;b.querySelector("strong").textContent=next;b.classList.toggle("active",next>0);schedule()});
  $("resetModel").addEventListener("click",()=>{$("modelPresetButton").querySelector("span").textContent="Presets";for(const [k] of HIT_LABELS)$(k+"Min").value=DEFAULTS[k];for(const id of ["targetShare","carryShare","opportunityShare","dvpMin","teamMatchupMin","edgeMin","targetsPerGameMin","carriesPerGameMin","oddsSpread"])$(id).value=DEFAULTS[id];$("dvpSample").value=DEFAULTS.dvpSample;$("requireOpponentData").checked=false;state.selectedPositions.clear();state.selectedMarkets.clear();state.selectedSides.clear();state.selectedGames.clear();$("playerFilter").value="";renderModelFilters();for(const id of ["legOddsMin","legOddsMax","parlayOddsMin","parlayOddsMax","legsMin","legsMax"])$(id).value=DEFAULTS[id];$("lineMin").value="";$("lineMax").value="";$("uniquePlayers").checked=true;$("avoidSameGame").checked=true;state.weights=Object.assign({},DEFAULTS.weights);document.querySelectorAll("[data-weight]").forEach(b=>{const k=b.dataset.weight;b.querySelector("strong").textContent=state.weights[k];b.classList.add("active")});syncLabels();recalc()});
}
async function init(){
  buildControls();bind();syncLabels();
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