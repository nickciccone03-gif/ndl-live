# NDL Central

Live scoreboard for The NDL: this week's matchups (tap one for both lineups), standings with the league's tiebreakers, and the next rookie draft's order race.

It's a static page. Everything comes from the public [Sleeper API](https://docs.sleeper.com/) in the visitor's browser and refreshes every minute; there's no server, key or build step.

- `index.html`: the page
- `standings.js`: Sleeper loading, standings, tiebreaks and the draft race (no DOM)
- `check.mjs`: `node check.mjs [leagueId]` prints the same numbers from live data

Another Sleeper league: add `?league=<id>` to the URL.

Standings rules: win %, then record among the tied teams, then points scored, then all-play win %. Draft order: potential points, lowest first; the runner-up picks 11th and the champion 12th.
