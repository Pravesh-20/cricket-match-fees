// Scorecard reader for Cricket Match Fees (Cloudflare Pages Function).
// GET /api/scorecard?url=<CricHeroes or chshare.link scorecard link>
// Returns {matchId, title, date, ground, tournament, teams:[{name, players:[...]}]}
//
// Safety:
// - Stateless. It stores nothing and has no secrets, keys or database.
// - It only ever fetches cricheroes.com / chshare.link pages, never a URL of the caller's choosing.
// - Answers are cached for 10 minutes per match, and each visitor is limited to a few requests a minute.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const ALLOWED_ORIGINS = [
  "https://pravesh-20.github.io",
  "http://localhost:8777",
];
const PER_MINUTE = 20;

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "GET, OPTIONS", Vary: "Origin" };
}
const json = (body, status, origin, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...cors(origin), ...extra },
  });

export async function onRequest({ request, waitUntil }) {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (request.method !== "GET") return json({ error: "Only GET is allowed." }, 405, origin);

  const link = (new URL(request.url).searchParams.get("url") || "").trim().slice(0, 300);
  if (!link) return json({ error: "Pass ?url=<CricHeroes scorecard link>" }, 400, origin);

  // Rough per-visitor limit, kept in the edge cache (no database).
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const cache = caches.default;
  const minute = Math.floor(Date.now() / 60000);
  const rlKey = new Request(`https://rl.local/${encodeURIComponent(ip)}/${minute}`);
  const seen = Number((await (await cache.match(rlKey))?.text()) || 0);
  if (seen >= PER_MINUTE) return json({ error: "Too many requests. Wait a minute and try again." }, 429, origin);
  waitUntil(cache.put(rlKey, new Response(String(seen + 1), { headers: { "cache-control": "max-age=60" } })));

  let matchId;
  try { matchId = await resolveMatchId(link); }
  catch (e) { return json({ error: e.message }, 400, origin); }

  const key = new Request(`https://cache.local/match/${matchId}`);
  const hit = await cache.match(key);
  if (hit) return json(await hit.json(), 200, origin);

  try {
    const data = await readScorecard(matchId);
    waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { "cache-control": "max-age=600" } })));
    return json(data, 200, origin);
  } catch (e) {
    return json({ error: e.message, matchId }, 502, origin);
  }
}

async function resolveMatchId(link) {
  let url;
  try { url = new URL(link.startsWith("http") ? link : "https://" + link); } catch { throw new Error("That doesn't look like a link."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("That doesn't look like a link.");
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const direct = url.pathname.match(/\/scorecard\/(\d{1,12})/);
  if (/^cricheroes\.(in|com)$/.test(host) && direct) return direct[1];
  if (host === "chshare.link" || host === "crichero.es") {
    const r = await fetch(`https://${host}${url.pathname}`, { headers: { "user-agent": UA }, redirect: "follow" });
    const final = r.url.match(/cricheroes\.(?:in|com)\/scorecard\/(\d{1,12})/);
    if (final) return final[1];
    const html = (await r.text()).slice(0, 200000);
    const m = html.match(/cricheroes\.(?:in|com)\/scorecard\/(\d{1,12})/);
    if (m) return m[1];
    throw new Error("Couldn't find a match in that share link.");
  }
  throw new Error("Use a CricHeroes scorecard link (chshare.link/… or cricheroes.com/scorecard/…).");
}

async function readScorecard(matchId) {
  const r = await fetch(`https://cricheroes.com/scorecard/${matchId}/m/m/scorecard`, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!r.ok) throw new Error(`CricHeroes answered ${r.status}`);
  const html = await r.text();

  // Next.js streams page data as self.__next_f.push([1,"<chunk>"]) scripts.
  let stream = "";
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try { const a = JSON.parse(m[1]); if (typeof a[1] === "string") stream += a[1]; } catch {}
  }
  let props = null;
  for (const line of stream.split("\n")) {
    if (!line.includes("scoreCardData")) continue;
    try { props = findKeyOwner(JSON.parse(line.slice(line.indexOf(":") + 1)), "scoreCardData"); } catch {}
    if (props) break;
  }
  if (!props || !Array.isArray(props.scoreCardData) || !props.scoreCardData.length)
    throw new Error("This match has no scorecard yet. Add the players by hand.");

  const mini = props.miniScoreCardData || {};
  const teams = new Map();
  const add = (team, name) => {
    const n = clean(name); if (!team || !n) return;
    if (!teams.has(team)) teams.set(team, []);
    const list = teams.get(team);
    if (!list.some((x) => x.toLowerCase() === n.toLowerCase())) list.push(n);
  };
  let names = [mini.team_a?.name, mini.team_b?.name].filter(Boolean);
  if (names.length < 2) names = [...new Set(props.scoreCardData.map((i) => i.teamName).filter(Boolean))];
  for (const inn of props.scoreCardData) {
    for (const b of inn.batting || []) add(inn.teamName, b.name);
    for (const b of inn.to_be_bat || []) add(inn.teamName, b.name);
  }
  for (const inn of props.scoreCardData) {
    const other = names.find((n) => n && n !== inn.teamName);
    for (const b of inn.bowling || []) add(other, b.name);
  }
  return {
    matchId: Number(matchId),
    title: names.join(" vs "),
    date: String(mini.start_datetime || mini.match_start_time || "").slice(0, 10),
    ground: String(mini.ground_name || ""),
    tournament: String(mini.tournament_name || ""),
    teams: [...teams.entries()].map(([name, players]) => ({ name, players })),
  };
}

function clean(s) {
  return String(s || "").replace(/\((?:c|wk|c\s*&\s*wk|wk\s*&\s*c|vc)\)/gi, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function findKeyOwner(o, key, depth = 0) {
  if (!o || typeof o !== "object" || depth > 12) return null;
  if (!Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, key)) return o;
  for (const v of Object.values(o)) { const f = findKeyOwner(v, key, depth + 1); if (f) return f; }
  return null;
}
