/* Reconstruct combination timelines from complete, verified components. */
window.nbaCombinedTiming=(data,stats,metric)=>{
  const parts={pa:["points","assists"],pr:["points","rebounds"],ra:["rebounds","assists"],pra:["points","rebounds","assists"]}[metric];
  if(!parts||parts.some(k=>stats[k]==null||!Number.isFinite(Number(stats[k]))||(Number(stats[k])!==0&&(!data[k]?.length||Number(data[k].at(-1)[0])!==Number(stats[k])))))return [];
  const elapsed=(q,c)=>{q=Number(q);const t=String(c),iso=t.match(/^PT(?:(\d+)M)?([\d.]+)S$/i),bits=t.split(":"),left=iso?Number(iso[1]||0)*60+Number(iso[2]):bits.length===2?Number(bits[0])*60+Number(bits[1]):Number(t);return q<=4?q*720-left:2880+(q-4)*300-left};
  const events=parts.flatMap(k=>(data[k]||[]).map(([v,q,c])=>({k,v:Number(v),q,c,t:elapsed(q,c)}))).filter(x=>Number.isFinite(x.t)).sort((a,b)=>a.t-b.t||Number(a.q)-Number(b.q));
  const totals=Object.fromEntries(parts.map(k=>[k,0])),rows=[];
  for(let i=0;i<events.length;){const first=events[i];let j=i;while(j<events.length&&events[j].t===first.t&&events[j].q===first.q){const x=events[j++];totals[x.k]=x.v;}rows.push([Object.values(totals).reduce((a,b)=>a+b,0),first.q,first.c]);i=j;}
  return rows.length&&rows.at(-1)[0]===parts.reduce((s,k)=>s+Number(stats[k]),0)?rows:[];
};
