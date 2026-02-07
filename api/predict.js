// api/predict.js
import fetch from 'node-fetch';
const TOKEN = process.env.SPORTMONKS_API_KEY;
if(!TOKEN) throw new Error('SPORTMONKS_API_KEY not set');

async function apiFetch(path){ 
  const url = `https://api.sportmonks.com/v3/football${path}?api_token=${TOKEN}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ---------------- Poisson Helpers ---------------- */
function factorial(n){ if(n<2) return 1; let f=1; for(let i=2;i<=n;i++) f*=i; return f; }
function poissonPmf(k,lambda){ if(lambda<=0) return k===0?1:0; return Math.exp(-lambda)*Math.pow(lambda,k)/factorial(k); }
function computeLeagueAvg(history){ if(!history.length) return 1.35; let t=0; for(const m of history) t+= (m.home_goals||0)+(m.away_goals||0); return t/(history.length*2); }
function computeTeamStrengths(history){
  const gf={}, ga={}, matches={};
  for(const m of history){
    const h=m.home_team, a=m.away_team;
    const hg=m.home_goals||0, ag=m.away_goals||0;
    gf[h]=(gf[h]||0)+hg; ga[h]=(ga[h]||0)+ag; matches[h]=(matches[h]||0)+1;
    gf[a]=(gf[a]||0)+ag; ga[a]=(ga[a]||0)+hg; matches[a]=(matches[a]||0)+1;
  }
  const leagueAvg = computeLeagueAvg(history);
  const stats={};
  for(const t of Object.keys(matches)){
    const mcount=matches[t];
    stats[t]={att:(gf[t]/mcount)/leagueAvg, def:(ga[t]/mcount)/leagueAvg};
  }
  return stats;
}
function expectedGoals(home,away,stats,leagueAvg,homeAdv=1.08){
  const hs=stats[home]||{att:1,def:1}, as=stats[away]||{att:1,def:1};
  return {lambdaH:leagueAvg*hs.att*as.def*homeAdv, lambdaA:leagueAvg*as.att*hs.def};
}
function outcomeProbabilities(lambdaH,lambdaA,maxGoals=6){
  let pH=0,pD=0,pA=0;
  for(let i=0;i<=maxGoals;i++) for(let j=0;j<=maxGoals;j++){
    const p=poissonPmf(i,lambdaH)*poissonPmf(j,lambdaA);
    if(i>j) pH+=p; else if(i===j) pD+=p; else pA+=p;
  }
  const total=pH+pD+pA;
  if(total<=0) return {home:0.33,draw:0.34,away:0.33};
  return {home:pH/total,draw:pD/total,away:pA/total};
}
function bestFromProbs(p){ if(!p) return '-'; return (p.home>=p.draw&&p.home>=p.away)?'Home Win':(p.away>=p.home&&p.away>=p.draw)?'Away Win':'Draw'; }

/* ---------------- Fetch Team Fixtures ---------------- */
async function fetchTeamFixtures(teamId,last=20){
  if(!teamId) return [];
  const path = `/fixtures/teams/${teamId}?status=FT&per_page=${last}`;
  const json = await apiFetch(path);
  return (json.data||[]).map(f=>({
    home_team: f.localTeam.data.name,
    away_team: f.visitorTeam.data.name,
    home_goals: f.scores.localteam_score||0,
    away_goals: f.scores.visitorteam_score||0
  }));
}

/* ---------------- Main Handler ---------------- */
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const { fixture, options={} } = req.body;
  const { last=20, home_advantage=1.08 } = options;

  try{
    const history = await Promise.all([
      fetchTeamFixtures(fixture.home_id,last),
      fetchTeamFixtures(fixture.away_id,last)
    ]).then(arr=>arr.flat());

    const seen = new Set();
    const dedup = history.filter(m=>{ const k=`${m.home_team}|${m.away_team}|${m.home_goals}|${m.away_goals}`; if(seen.has(k)) return false; seen.add(k); return true; });

    const leagueAvg = computeLeagueAvg(dedup);
    const stats = computeTeamStrengths(dedup);
    const { lambdaH, lambdaA } = expectedGoals(fixture.home,fixture.away,stats,leagueAvg,home_advantage);
    const probabilities = outcomeProbabilities(lambdaH,lambdaA);
    const recommendation = bestFromProbs(probabilities);
    const confidence = Math.round(Math.max(probabilities.home,probabilities.draw,probabilities.away)*100);

    res.json({ probabilities, recommendation, expected_goals:{ home:lambdaH, away:lambdaA }, used_history_count:dedup.length, confidence });

  }catch(err){
    console.error(err);
    res.status(500).json({ error:'Prediction failed', probabilities:{home:0.33,draw:0.34,away:0.33}, recommendation:'-', used_history_count:0 });
  }
}
