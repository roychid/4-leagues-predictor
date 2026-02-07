// api/fixtures.js
import fetch from 'node-fetch';
const TOKEN = process.env.SPORTMONKS_API_KEY;
if(!TOKEN) throw new Error('SPORTMONKS_API_KEY not set');

export default async function handler(req,res){
  const { date, league } = req.query;
  if(!date) return res.status(400).json({ error:'Date required' });

  try {
    const url = `https://api.sportmonks.com/v3/football/fixtures/date/${date}?api_token=${TOKEN}`;
    const json = await fetch(url).then(r=>r.json());
    let fixtures = (json.data||[]);

    if(league) fixtures = fixtures.filter(f => f.league_id == league);

    fixtures = fixtures.map(f=>({
      id: f.id,
      league: { id: f.league_id, name: f.league?.data?.name||'' },
      home: f.localTeam.data.name,
      away: f.visitorTeam.data.name,
      home_id: f.localTeam.data.id,
      away_id: f.visitorTeam.data.id,
      fixtureDate: f.time.starting_at.date_time
    }));

    res.json({ fixtures });

  } catch(e){
    console.error(e);
    res.status(500).json({ error:'Failed to fetch fixtures' });
  }
}
