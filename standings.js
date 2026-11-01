// League data from the public Sleeper API and the NDL standings rules. No DOM, so node can check it too.
const API = "https://api.sleeper.app/v1";
const get = (path) => fetch(API + path, { cache: "no-store" }).then((r) => {
  if (!r.ok) throw new Error(`Sleeper ${r.status} on ${path}`);
  return r.json();
});
const num = (whole, hundredths) => (whole ?? 0) + (hundredths ?? 0) / 100;
const pct = (w, l, t) => (w + l + t ? (w + t / 2) / (w + l + t) : null);

/** Everything the page shows, in one load. `week` picks the matchup box's week (defaults to the current one). */
export async function loadLeague(leagueId, week) {
  const [state, league, users, rosters, picks] = await Promise.all([
    get("/state/nfl"), get(`/league/${leagueId}`), get(`/league/${leagueId}/users`),
    get(`/league/${leagueId}/rosters`), get(`/league/${leagueId}/traded_picks`),
  ]);
  const s = league.settings;
  const lastRegular = s.playoff_week_start - 1;
  const scored = s.last_scored_leg ?? 0;
  const completed = Math.min(scored, lastRegular);
  const sameSeason = state.season === league.season;
  const current = Math.max(1, Math.min(sameSeason ? state.display_week || state.week : scored || 1, 18));
  const shown = week ?? current;

  const user = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const teams = rosters.map((r) => {
    const u = user[r.owner_id];
    const avatar = u?.metadata?.avatar || (u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null);
    return {
      id: r.roster_id, name: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`, username: u?.display_name ?? "",
      avatar, streak: r.metadata?.streak ?? "", faab: (s.waiver_budget ?? 0) - (r.settings.waiver_budget_used ?? 0),
      pp: num(r.settings.ppts, r.settings.ppts_decimal), source: r.settings,
      w: 0, l: 0, t: 0, pf: 0, pa: 0, aw: 0, al: 0, at: 0, games: 0, h2h: {},
    };
  });
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));

  const weeks = Array.from({ length: completed }, (_, i) => i + 1);
  const needed = [...new Set([...weeks, shown])];
  const fetched = await Promise.all(needed.map((w) => get(`/league/${leagueId}/matchups/${w}`)));
  const matchups = Object.fromEntries(needed.map((w, i) => [w, fetched[i] ?? []]));

  for (const w of weeks) {
    const entries = matchups[w].filter((e) => e.matchup_id != null);
    for (const a of entries) {
      const t = byId[a.roster_id], b = entries.find((o) => o !== a && o.matchup_id === a.matchup_id);
      if (!t || !b) continue;
      for (const o of entries) if (o !== a) a.points > o.points ? t.aw++ : a.points < o.points ? t.al++ : t.at++;
      t.games++; t.pf += a.points; t.pa += b.points;
      const h = (t.h2h[b.roster_id] ??= { w: 0, l: 0, t: 0 });
      if (a.points > b.points) { t.w++; h.w++; } else if (a.points < b.points) { t.l++; h.l++; } else { t.t++; h.t++; }
    }
  }
  for (const t of teams) {
    t.pct = pct(t.w, t.l, t.t); t.allPct = pct(t.aw, t.al, t.at);
    t.eff = t.pp ? t.pf / t.pp : null;
    t.avgPf = t.games ? t.pf / t.games : null; t.avgPa = t.games ? t.pa / t.games : null;
  }

  // Ties on win %: record among the tied teams, then points scored, then all-play, then a coin flip (left as a tie).
  const groups = {};
  for (const t of teams) (groups[(t.pct ?? 0).toFixed(6)] ??= []).push(t);
  for (const g of Object.values(groups)) for (const t of g) {
    let w = 0, l = 0, tie = 0;
    t.tieGames = [];
    for (const o of g) if (o !== t && t.h2h[o.id]) { const h = t.h2h[o.id]; w += h.w; l += h.l; tie += h.t; t.tieGames.push({ opponent: o, ...h }); }
    t.tiePct = g.length > 1 ? pct(w, l, tie) : null;
    t.tieRecord = g.length > 1 ? `${w}-${l}${tie ? `-${tie}` : ""}` : null;
  }
  teams.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || (b.tiePct ?? 0) - (a.tiePct ?? 0) || b.pf - a.pf || (b.allPct ?? 0) - (a.allPct ?? 0));
  teams.forEach((t, i) => { t.rank = i + 1; });

  // Each tied group in table order, with the rule that put every team above the next one down.
  const tiebreaks = Object.values(groups).filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.rank - b.rank))
    .sort((a, b) => a[0].rank - b[0].rank).map((g) => ({ rows: g.map((t, i) => ({ team: t, over: g[i + 1] ? decidedBy(t, g[i + 1]) : null })) }));

  // Records must agree with Sleeper's own counts, or the page says so instead of showing a wrong table.
  const mismatched = completed ? teams.filter((t) => t.w !== (t.source.wins ?? 0) || t.l !== (t.source.losses ?? 0) || t.t !== (t.source.ties ?? 0)) : [];

  return { league, state, teams, byId, completed, playerIds: rosters.flatMap((r) => [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]),
    slots: (league.roster_positions ?? []).filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI"), lastRegular, current, shown, inProgress: shown > scored,
    matchups: pairs(matchups[shown], byId), draft: await draftRace(teams, byId, picks, league, leagueId), mismatched, tiebreaks };
}

/** The first rule in the league order that separates two teams tied on win %, and both sides of it. */
function decidedBy(a, b) {
  const p = (n) => n == null ? "—" : n.toFixed(3).replace(/^0/, "");
  if ((a.tiePct ?? 0) !== (b.tiePct ?? 0)) return { rule: "Head-to-head", a: a.tieRecord, b: b.tieRecord };
  if (a.pf !== b.pf) return { rule: "Points", a: a.pf.toFixed(2), b: b.pf.toFixed(2) };
  if ((a.allPct ?? 0) !== (b.allPct ?? 0)) return { rule: "All-play", a: p(a.allPct), b: p(b.allPct) };
  return { rule: "Coin flip", a: "", b: "" };
}

function pairs(entries, byId) {
  const g = {};
  for (const e of entries ?? []) if (e.matchup_id != null) (g[e.matchup_id] ??= []).push(e);
  return Object.keys(g).sort((a, b) => a - b).map((id) => g[id].map((e) => {
    const pts = e.players_points ?? {};
    const starters = (e.starters ?? []).map((pid, i) => ({ id: pid, points: e.starters_points?.[i] ?? pts[pid] ?? 0 }));
    const bench = (e.players ?? []).filter((pid) => !e.starters?.includes(pid)).map((pid) => ({ id: pid, points: pts[pid] ?? 0 }))
      .sort((a, b) => b.points - a.points);
    return { team: byId[e.roster_id], points: e.points ?? 0, starters, bench };
  }));
}

/**
 * Names for player ids. Sleeper's player list is ~2.6 MB, so it's fetched at most once a day per browser and only
 * the ids asked for are kept; an id missing from the kept set fetches it again.
 */
const PLAYERS_KEY = "ndl-players-v2";
export async function loadPlayers(ids) {
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(PLAYERS_KEY)); } catch { /* no storage */ }
  const fresh = cache && Date.now() - cache.at < 864e5;
  const wanted = ids.filter((id) => id && id !== "0");
  if (fresh && wanted.every((id) => id in cache.map)) return cache.map;
  const all = await get("/players/nfl");
  const map = { ...(fresh ? cache.map : {}) };
  for (const id of wanted) {
    const p = all[id];
    map[id] = p ? { name: p.position === "DEF" ? p.last_name : p.full_name || `${p.first_name} ${p.last_name}`,
      pos: p.position ?? "", team: p.team ?? "", status: p.injury_status ?? "" } : { name: id, pos: "", team: "", status: "" };
  }
  try { localStorage.setItem(PLAYERS_KEY, JSON.stringify({ at: fresh ? cache.at : Date.now(), map })); } catch { /* full or blocked */ }
  return map;
}

/** Next season's first round: potential points, lowest first; once the title game is set, its two teams pick 11 and 12. */
async function draftRace(teams, byId, picks, league, leagueId) {
  const season = String(Number(league.season) + 1);
  let finalists = [], champion = null;
  try {
    const bracket = await get(`/league/${leagueId}/winners_bracket`);
    const final = bracket?.find((m) => m.p === 1);
    if (final?.t1 && final?.t2) finalists = [final.t1, final.t2];
    if (final?.w) champion = final.w;
  } catch { /* no bracket yet */ }
  const holder = Object.fromEntries(picks.filter((p) => p.season === season && p.round === 1).map((p) => [p.roster_id, p.owner_id]));
  const field = teams.filter((t) => !finalists.includes(t.id)).sort((a, b) => a.pp - b.pp);
  const last = finalists.length ? (champion ? [finalists.find((id) => id !== champion), champion] : finalists).map((id) => byId[id]) : [];
  return { season, finalistsSet: finalists.length === 2, decided: !!champion,
    rows: [...field, ...last].map((t, i) => ({ pick: i + 1, team: t, holder: byId[holder[t.id] ?? t.id], finalist: finalists.includes(t.id) })) };
}
