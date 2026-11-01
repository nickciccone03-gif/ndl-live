// node check.mjs [leagueId]: prints the standings, the draft race and this week's games from live data.
import { loadLeague } from "./standings.js";

const d = await loadLeague(process.argv[2] ?? "1359577686959222784");
console.log(`${d.league.name}: through week ${d.completed}, showing week ${d.shown}${d.inProgress ? " (in progress)" : ""}`);
if (d.mismatched.length) console.log("RECORD MISMATCH:", d.mismatched.map((t) => t.name).join(", "));
for (const t of d.teams) console.log(`${t.rank}. ${t.username.padEnd(16)} ${t.w}-${t.l}-${t.t} tie ${t.tieRecord ?? "-"} PF ${t.pf.toFixed(2)} PA ${t.pa.toFixed(2)} PP ${t.pp.toFixed(2)} AP ${t.aw}-${t.al} FAAB ${t.faab} ${t.streak}`);
for (const r of d.draft.rows) console.log(`Pick ${r.pick}: ${r.team.username} PP ${r.team.pp.toFixed(2)} held by ${r.holder.username}`);
for (const [a, b] of d.matchups) console.log(`${a.team.username} ${a.points} vs ${b?.team.username} ${b?.points}`);
process.exitCode = d.mismatched.length ? 1 : 0;
