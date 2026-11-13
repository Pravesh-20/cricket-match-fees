# Scorecard reader

A tiny Cloudflare Pages Function used by Cricket Match Fees to read who played from a public CricHeroes scorecard (browsers can't read CricHeroes pages directly).

- `GET /api/scorecard?url=<chshare.link or cricheroes.com scorecard link>`
- Stores nothing, has no secrets, and only ever fetches cricheroes.com / chshare.link.
- Cached 10 minutes per match; about 20 requests a minute per visitor.

Deploy your own copy: `npx wrangler pages deploy public --project-name <your-name>`, then set `SCORECARD_API` at the top of `app.js` and `connect-src` in `index.html`.
