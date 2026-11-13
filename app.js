(() => {
  "use strict";
  const SCORECARD_API = "https://cricket-fees-api.pages.dev/api/scorecard";
  const STORE = "cmf.v1";
  const APP_URL = location.origin + location.pathname;

  // ---------- small helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
  const now = () => Date.now();
  const uid = () => Math.random().toString(36).slice(2, 8) + now().toString(36).slice(-4);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const fmtDate = (d) => { if (!d) return ""; const x = new Date(d + "T00:00:00"); return isNaN(x) ? d : x.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }); };
  const cleanName = (s) => String(s || "").replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u00A0]/g, " ")
    .replace(/\((?:c|wk|c\s*&\s*wk|wk\s*&\s*c|vc|capt?)\)/gi, "")
    .replace(/[*†✅✔☑✓]/g, "").replace(/^\s*\d+[.)\-:]?\s+/, "").replace(/\s+/g, " ").trim();
  const keyOf = (name) => cleanName(name).toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, "_").replace(/^_+|_+$/g, "") || "player";
  const initials = (t) => (t || "XI").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "XI";
  const listNames = (arr) => arr.length <= 1 ? (arr[0] || "") : arr.slice(0, -1).join(", ") + " & " + arr[arr.length - 1];

  // ---------- state ----------
  const blank = () => ({ v: 1, team: "", defaultFee: 0, roundTo: 1, payNote: "", coverGroup: [], updatedAt: 0, items: [] });
  let S = blank(); // filled by load() at start-up, once every helper below exists
  let tab = "matches";
  const excluded = new Set(), touched = new Set();

  function load() {
    try { const raw = localStorage.getItem(STORE); if (raw) return { ...blank(), ...sanitize(JSON.parse(raw)) }; } catch {}
    return blank();
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { toast("Couldn't save on this phone. Is private browsing on?"); }
  }
  const live = () => S.items.filter((it) => !it.deleted);
  const isPaid = (it, key) => !!(it.paid && it.paid[key] && it.paid[key].v);

  function coverGroupList() {
    const names = new Map(roster().map((p) => [p.key, p.name]));
    return (S.coverGroup || []).map((g) => typeof g === "string" ? { key: g, name: names.get(g) || g } : g).filter((g) => g && g.key);
  }

  // ---------- fee maths ----------
  // fee ÷ everyone who played; free players' shares go to the cover group (or all payers)
  function computeSplit(fee, players, coverKeys, step, contribs = []) {
    const n = players.length;
    if (!n || !fee) return { ok: false, why: n ? "Enter the total fee." : "Pick who played." };
    const base = fee / n;
    const free = players.filter((p) => p.free);
    const payers = players.filter((p) => !p.free);
    if (!payers.length) return { ok: false, why: "At least one player has to pay." };
    const playedKeys = new Set(players.map((p) => p.key));
    const helpers = coverKeys && free.length ? contribs.filter((c) => coverKeys.includes(c.key) && !playedKeys.has(c.key)) : [];
    let cover = coverKeys ? [...payers.filter((p) => coverKeys.includes(p.key)), ...helpers] : payers;
    const fallback = !cover.length;
    if (fallback) cover = payers;
    const freeTotal = base * free.length;
    const extra = free.length ? freeTotal / cover.length : 0;
    const coverSet = new Set(cover.map((p) => p.key));
    const r = (x) => Math.ceil(x / step - 1e-9) * step;
    const out = players.map((p) => ({ key: p.key, name: p.name, free: !!p.free, cover: coverSet.has(p.key) && free.length > 0, amount: p.free ? 0 : r(base + (coverSet.has(p.key) ? extra : 0)) }));
    for (const h of helpers) if (coverSet.has(h.key)) out.push({ key: h.key, name: h.name, free: false, cover: true, contrib: true, amount: r(extra) });
    const total = out.reduce((s, p) => s + p.amount, 0);
    return { ok: true, base, played: n, freeTotal, freeCount: free.length, coverCount: cover.length, helperCount: helpers.length, fallback, coverAll: !coverKeys || (!helpers.length && cover.length === payers.length), extra, total, over: total - fee, players: out };
  }

  // ---------- derived ----------
  const itemTotals = (it) => {
    const payers = (it.players || []).filter((p) => !p.free);
    let total = 0, got = 0, paidN = 0;
    for (const p of payers) { total += p.amount; if (isPaid(it, p.key)) { got += p.amount; paidN++; } }
    return { total, got, paidN, n: payers.length, settled: payers.length > 0 && paidN === payers.length };
  };
  const byDateAsc = (a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0);
  function labelMap(list) {
    setShortLabels(live());
    const m = {}; for (const it of list) m[it.id] = it.kind === "dues" ? "Old dues" : (SHORT[it.id] || dayMon(it.date) || "Match");
    return m;
  }

  // what a player sees in WhatsApp for each fee: "vs Liberty Lions 11 Nov" or "old dues"
  const dayMon = (d) => { if (!d) return ""; const x = new Date(d + "T00:00:00"); return isNaN(x) ? "" : x.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); };
  // Short tags for WhatsApp: a match is its date ("28 Oct"); two matches on one day add the opponent's initials.
  let SHORT = {};
  function setShortLabels(list) {
    SHORT = {};
    const byDay = {};
    for (const it of list) if (it.kind !== "dues") (byDay[dayMon(it.date) || "?"] ||= []).push(it);
    for (const [day, its] of Object.entries(byDay)) for (const it of its) SHORT[it.id] = its.length > 1 ? `${day} ${initials(it.opponent || "")}` : day;
  }
  const forWhat = (it) => it.kind === "dues" ? "old" : (SHORT[it.id] || dayMon(it.date) || "match");
  const usualShare = (it) => { const c = {}; for (const p of it.players || []) if (!p.free && !p.contrib) c[p.amount] = (c[p.amount] || 0) + 1; return Number(Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 0); };
  // "old ₹24,990 + 28 Oct + 11 Nov ₹1,037": amounts shown only where they differ from that match's usual share
  const breakdown = (rows) => rows.length === 1 && rows[0].it.kind === "dues" ? "old dues" : rows.map((d) => d.it.kind === "dues" ? `old ${inr(d.amount)}` : forWhat(d.it) + (d.amount !== usualShare(d.it) ? ` ${inr(d.amount)}` : "")).join(" + ");
  const itemTitle = (it) => it.kind === "dues" ? (it.title && !/@|^old dues$/i.test(it.title) ? it.title : "") : ("vs " + (it.opponent || "TBC"));
  function playersAcross(list) {
    const map = new Map();
    for (const it of [...list].sort(byDateAsc)) for (const p of it.players || []) {
      if (p.free) continue;
      if (!map.has(p.key)) map.set(p.key, { key: p.key, name: p.name, due: 0, paid: 0, dueItems: [], paidItems: [] });
      const r = map.get(p.key);
      if (isPaid(it, p.key)) { r.paid += p.amount; r.paidItems.push({ it, amount: p.amount }); }
      else { r.due += p.amount; r.dueItems.push({ it, amount: p.amount }); }
    }
    return [...map.values()];
  }
  function roster() {
    const count = new Map();
    for (const it of live()) for (const p of it.players || []) {
      const c = count.get(p.key) || { name: p.name, n: 0 }; c.n++; count.set(p.key, c);
    }
    return [...count.entries()].sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name)).map(([key, v]) => ({ key, name: v.name }));
  }

  // ---------- mutations ----------
  function touch(it) { it.updatedAt = now(); S.updatedAt = Math.max(S.updatedAt, it.updatedAt); }
  function setPaid(it, keys, value) {
    it.paid = it.paid || {};
    for (const k of keys) it.paid[k] = { v: !!value, t: now() };
    touch(it); save(); render();
  }
  function upsertItem(data) {
    const i = S.items.findIndex((x) => x.id === data.id);
    if (i >= 0) S.items[i] = data; else S.items.push(data);
    touch(data); save(); render();
  }
  function deleteItem(it) { it.deleted = true; it.players = []; it.paid = {}; touch(it); save(); render(); }

  // ---------- message ----------
  function buildMessage() {
    const list = live().filter((it) => !excluded.has(it.id) && (it.players || []).length).sort(byDateAsc);
    if (!list.length) return "Add a match first, or tick one above.";
    const labels = labelMap(list);
    setShortLabels(list);
    const L = [`🏏 *${S.team || "Team"} · Match Fees*`, ""];
    for (const it of list) {
      const t = itemTotals(it);
      if (it.kind === "dues") {
        const ms = it.matches || [];
        L.push(`📒 *Old dues* · ${inr(t.total - t.got)} from ${t.n - t.paidN} player${t.n - t.paidN === 1 ? "" : "s"}${ms.length ? ` (${ms.length} earlier match${ms.length === 1 ? "" : "es"})` : ""}`);
      } else {
        const all = it.players || [];
        const playedN = all.filter((p) => !p.contrib).length;
        const free = all.filter((p) => p.free), payers = all.filter((p) => !p.free);
        L.push(`🏟️ *${forWhat(it)}* vs ${it.opponent || "TBC"} · ${inr(it.fee)} ÷ ${playedN} = *${inr(usualShare(it))}*`);
        if (free.length) {
          const cover = payers.filter((p) => p.cover);
          L.push(`   Free: ${listNames(free.map((p) => p.name))} · covered by ${cover.length === payers.length ? "everyone" : cover.length + " players"}`);
        }
      }
      L.push("");
    }
    const ps = playersAcross(list);
    L.push("*Pay and tick ✅ next to your name* 👇");
    ps.forEach((p, i) => {
      const nm = `${i + 1}. ${p.name}`;
      if (!p.due) { L.push(`${nm} – ${inr(p.paid)} ✅`); return; }
      const what = breakdown(p.dueItems);
      const paidBit = p.paidItems.length ? ` · paid ${p.paidItems.map((d) => forWhat(d.it)).join(", ")}` : "";
      L.push(`${nm} – ${inr(p.due)} (${what})${paidBit}`);
    });
    const due = ps.reduce((s, p) => s + p.due, 0), owing = ps.filter((p) => p.due).length;
    L.push("");
    L.push(due ? `Pending: *${inr(due)}* from ${owing} player${owing === 1 ? "" : "s"}` : "All paid. Thank you! 🙌");
    if (S.payNote && S.payNote.trim()) L.push(`Pay to: ${S.payNote.trim()}`);
    return L.join("\n");
  }

  // ---------- render ----------
  function render() {
    $("teamName").textContent = S.team || "Your team";
    $("badge").textContent = initials(S.team);
    document.title = (S.team ? S.team + " · " : "") + "Match Fees";
    const items = live();
    const ps = playersAcross(items);
    $("sDue").textContent = inr(ps.reduce((s, p) => s + p.due, 0));
    $("sPlayers").textContent = ps.filter((p) => p.due).length;
    $("sOpen").textContent = items.filter((it) => !itemTotals(it).settled).length;

    for (const it of items) if (!touched.has(it.id)) itemTotals(it).settled ? excluded.add(it.id) : excluded.delete(it.id);
    const labels = labelMap(items);
    $("include").innerHTML = items.length ? [...items].sort(byDateAsc).map((it) => {
      const on = !excluded.has(it.id);
      return `<label class="chip ${on ? "on" : ""}"><input type="checkbox" data-inc="${esc(it.id)}" ${on ? "checked" : ""}> ${esc([labels[it.id], itemTitle(it)].filter(Boolean).join(" · "))}${itemTotals(it).settled ? " ✓" : ""}</label>`;
    }).join("") : `<span class="muted small">Your matches will show here.</span>`;
    const text = buildMessage();
    $("msg").value = text;
    const wa = "https://wa.me/?text=" + encodeURIComponent(text);
    $("btnWa").href = wa; $("bbSend").href = wa;
    $("bubble").innerHTML = esc(text).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/_([^_\n]+)_/g, "<i>$1</i>");
    const lines = text.split("\n").length;
    $("chatMore").hidden = lines < 16; if (lines < 16) $("chat").classList.add("open");

    renderNudges(items, labels);
    $("tabMatches").setAttribute("aria-selected", tab === "matches");
    $("tabPlayers").setAttribute("aria-selected", tab === "players");
    const v = $("view");
    if (!items.length) {
      v.innerHTML = `<div class="empty"><svg viewBox="0 0 84 84" aria-hidden="true"><rect x="0" y="74" width="84" height="6" rx="3" fill="var(--accent-soft)"/><rect x="22" y="22" width="7" height="54" rx="3" fill="var(--accent)"/><rect x="38.5" y="22" width="7" height="54" rx="3" fill="var(--accent)"/><rect x="55" y="22" width="7" height="54" rx="3" fill="var(--accent)"/><rect x="20" y="16" width="22" height="5" rx="2.5" fill="var(--gold)"/><rect x="42" y="16" width="22" height="5" rx="2.5" fill="var(--gold)"/><circle cx="70" cy="62" r="7" fill="var(--ball)"/><path d="M65.5 57.5c3 3 3 6 0 9M74.5 57.5c-3 3-3 6 0 9" stroke="#fff" stroke-width="1" fill="none" stroke-dasharray="1.5 1.5"/></svg><h3>No matches yet</h3><p>Paste your CricHeroes link and the fee. The app splits it and writes the WhatsApp message.</p><button class="primary" type="button" data-act="add-match">+ Add your first match</button><button type="button" data-act="import">Already have a fees list in WhatsApp? Paste it</button></div>`;
      return;
    }
    v.innerHTML = tab === "matches" ? renderMatches(items, labels) : renderPlayers(items, labels);
  }

  // ---------- follow-ups: reminder after 48 h, thank-you when everyone has paid ----------
  const DAY = 864e5;
  function reminderText(list, labels) {
    const ps = playersAcross(list).filter((p) => p.due);
    setShortLabels(live());
    const L = [`⏰ *Reminder · ${S.team || "Team"} match fees*`, ""];
    L.push(...list.map((it) => it.kind === "dues" ? `📒 Old dues` : `🏟️ *${forWhat(it)}* vs ${it.opponent || "TBC"}`), "");
    L.push("Still pending 👇");
    ps.forEach((p, i) => L.push(`${i + 1}. ${p.name} – ${inr(p.due)} (${breakdown(p.dueItems)})`));
    L.push("", "Please pay today and tick ✅ on the fees message. Thank you! 🙏");
    if (S.payNote && S.payNote.trim()) L.push(`Pay to: ${S.payNote.trim()}`);
    return L.join("\n");
  }
  function thanksText(it, labels) {
    const t = itemTotals(it);
    return `✅ *${S.team || "Team"}* · All fees received for ${itemTitle(it)} (${fmtDate(it.date)}): ${inr(t.got)} from ${t.n} players.\nThanks everyone! 🏏🙌`;
  }
  function renderNudges(items, labels) {
    const box = $("nudges"), out = [];
    const late = items.filter((it) => !itemTotals(it).settled && it.postedAt && now() - Math.max(it.postedAt, it.remindedAt || 0) >= 2 * DAY);
    if (late.length) {
      const owing = playersAcross(late).filter((p) => p.due);
      const days = Math.floor((now() - Math.min(...late.map((it) => it.remindedAt || it.postedAt))) / DAY);
      out.push(`<div class="nudge warn"><p><b>Time to follow up.</b> ${owing.length} player${owing.length === 1 ? "" : "s"} still owe ${inr(owing.reduce((s, p) => s + p.due, 0))}, ${days} days after you posted.</p>
        <a class="btn primary" data-remind="${late.map((it) => it.id).join(",")}" href="https://wa.me/?text=${encodeURIComponent(reminderText(late, labels))}" target="_blank" rel="noopener">Send reminder</a></div>`);
    }
    for (const it of items) if (itemTotals(it).settled && !it.thankedAt && it.kind !== "dues") {
      out.push(`<div class="nudge good"><p><b>Everyone has paid for ${esc(labels[it.id])} ${esc(itemTitle(it))}.</b> Let the group know.</p>
        <a class="btn primary" data-thank="${esc(it.id)}" href="https://wa.me/?text=${encodeURIComponent(thanksText(it, labels))}" target="_blank" rel="noopener">Post "all paid"</a>
        <button type="button" class="ghost" data-thankskip="${esc(it.id)}">Skip</button></div>`);
    }
    box.innerHTML = out.join(""); box.hidden = !out.length;
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-remind],[data-thank],[data-thankskip]"); if (!a) return;
    const ids = (a.dataset.remind || a.dataset.thank || a.dataset.thankskip).split(",");
    for (const id of ids) { const it = S.items.find((x) => x.id === id); if (!it) continue; if (a.dataset.remind) it.remindedAt = now(); else it.thankedAt = now(); touch(it); }
    save(); setTimeout(render, 300);
  });

  function renderItem(it, labels) {
    const t = itemTotals(it);
    const pct = t.total ? Math.round(t.got / t.total * 100) : 0;
    const all = it.players || [];
    const freeN = all.filter((p) => p.free).length;
    const playedN = all.filter((p) => !p.contrib).length;
    const d = it.date ? new Date(it.date + "T00:00:00") : null;
    const okDate = d && !isNaN(d);
    const stub = it.kind === "dues"
      ? `<div class="stub old"><span class="d">OLD</span><span class="m">dues</span>${(it.matches || []).length ? `<span class="w">${it.matches.length} match${it.matches.length === 1 ? "" : "es"}</span>` : ""}</div>`
      : `<div class="stub"><span class="d">${okDate ? d.getDate() : "–"}</span><span class="m">${okDate ? d.toLocaleDateString("en-IN", { month: "short" }) : ""}</span><span class="w">${okDate ? d.toLocaleDateString("en-IN", { weekday: "short" }) : ""}</span></div>`;
    const title = it.kind === "dues"
      ? `<div class="fx-title"><h3>Old dues</h3>${itemTitle(it) ? `<span class="vs">${esc(itemTitle(it))}</span>` : ""}</div>`
      : `<div class="fx-title"><span class="vs">vs</span><h3>${esc(it.opponent || "TBC")}</h3></div>`;
    const math = it.kind === "dues"
      ? `<div class="fx-math"><span class="pill">${t.n} players</span><span class="pill">${inr(t.total)} total</span></div>`
      : `<div class="fx-math"><span class="pill">${inr(it.fee)}</span><span>÷</span><span class="pill">${playedN} players</span><span>=</span><span class="pill share">${inr(usualShare(it))} each</span>${freeN ? `<span class="pill" style="color:var(--free)">${freeN} free</span>` : ""}${it.ground ? `<span class="muted" style="flex-basis:100%">${esc(it.ground)}</span>` : ""}</div>`;
    const players = all.map((p) => {
      if (p.free) return `<div class="prow2 isfree"><span class="nm">${esc(p.name)}</span><span class="am"></span><span class="st">Free</span></div>`;
      const paid = isPaid(it, p.key);
      return `<button type="button" class="prow2 ${paid ? "paid" : ""}" data-toggle="${esc(it.id)}" data-key="${esc(p.key)}" aria-pressed="${paid}" aria-label="${esc(p.name)} ${inr(p.amount)} ${paid ? "paid, tap to undo" : "tap to mark paid"}">
        <span class="nm" title="${esc(p.name)}">${esc(p.name)}${p.contrib ? '<span class="chipin">chip-in</span>' : ""}</span><span class="am">${inr(p.amount)}</span><span class="st">${paid ? "Paid" : "Due"}</span></button>`;
    }).join("");
    const link = /^https:\/\/[^\s"<>]+$/i.test(it.link || "") ? `<a class="small" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">Scorecard ↗</a>` : "";
    return `<article class="card fixture">
      ${stub}
      <div class="fx-body">
        <div class="item-head">
          <div style="display:grid;gap:6px">${title}${math}</div>
          <div class="row"><button type="button" class="ghost" data-edit="${esc(it.id)}">Edit</button><button type="button" class="ghost danger" data-del="${esc(it.id)}">Delete</button></div>
        </div>
        <div id="confirm-${esc(it.id)}"></div>
        <div class="progress">
          <div class="top num"><span><b>${t.paidN} of ${t.n} paid</b> · ${inr(t.got)} of ${inr(t.total)}</span>${t.settled ? '<span class="stamp">All paid</span>' : `<span style="color:var(--ball);font-weight:700">${inr(t.total - t.got)} due</span>`}</div>
          <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
        </div>
        <div class="hint">👆 Tap a name when they pay${link ? " · " + link : ""}</div>
        <div class="sheetlist">${players}</div>
        ${t.settled ? "" : `<div class="row"><a class="btn" href="https://wa.me/?text=${encodeURIComponent(reminderText([it], labels))}" target="_blank" rel="noopener" data-remind="${esc(it.id)}">⏰ Send reminder</a><button type="button" class="ghost" data-allpaid="${esc(it.id)}">Mark everyone paid</button></div>`}
      </div>
    </article>`;
  }
  function renderMatches(items, labels) {
    const sorted = [...items].sort(byDateAsc).reverse();
    const open = sorted.filter((it) => !itemTotals(it).settled), done = sorted.filter((it) => itemTotals(it).settled);
    let html = `<div class="list">${open.map((it) => renderItem(it, labels)).join("") || `<div class="empty">Everyone has paid for every match. 🎉</div>`}</div>`;
    if (done.length) html += `<details><summary>Fully paid (${done.length})</summary><div class="list">
      <div class="row"><button type="button" data-act="clear-paid">Remove fully paid from the app</button></div><div id="clearBox"></div>
      ${done.map((it) => renderItem(it, labels)).join("")}</div></details>`;
    return html;
  }
  function renderPlayers(items, labels) {
    const ps = playersAcross(items).sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
    return `<div>${ps.map((p) => `<div class="prow">
      <div class="top"><div><b>${esc(p.name)}</b><div class="muted small num">${p.paid ? "Paid " + inr(p.paid) : "Nothing paid yet"}</div></div>
        <div class="row"><span class="amt num ${p.due ? "" : "zero"}">${p.due ? inr(p.due) : "Clear ✓"}</span>
        ${p.due ? `<button type="button" data-payall="${esc(p.key)}">Mark all paid</button>` : ""}</div></div>
      <div class="chips">${[...p.dueItems.map((d) => ({ ...d, paid: false })), ...p.paidItems.map((d) => ({ ...d, paid: true }))].sort((a, b) => byDateAsc(a.it, b.it)).map((d) =>
        `<button type="button" class="toggle ${d.paid ? "paid" : ""}" data-toggle="${esc(d.it.id)}" data-key="${esc(p.key)}" aria-pressed="${d.paid}">${esc(labels[d.it.id])} · ${inr(d.amount)}${d.paid ? " ✓" : ""}</button>`).join("")}</div>
    </div>`).join("")}</div>`;
  }

  // ---------- events ----------
  $("tabMatches").addEventListener("click", () => { tab = "matches"; render(); });
  $("tabPlayers").addEventListener("click", () => { tab = "players"; render(); });
  $("include").addEventListener("change", (e) => {
    const id = e.target.dataset.inc; if (!id) return; touched.add(id);
    e.target.checked ? excluded.delete(id) : excluded.add(id); render();
  });
  function markPosted() {
    let changed = false;
    for (const it of live()) if (!excluded.has(it.id) && !itemTotals(it).settled) { it.postedAt = now(); it.remindedAt = null; changed = true; }
    if (changed) { save(); setTimeout(render, 300); }
  }
  $("btnWa").addEventListener("click", markPosted);
  $("bbSend").addEventListener("click", markPosted);
  $("chatMore").addEventListener("click", () => { const o = $("chat").classList.toggle("open"); $("chatMore").textContent = o ? "Show less" : "Show full message"; });
  $("btnCopy").addEventListener("click", () => { copyText($("msg").value, "Copied. Paste it in the group."); markPosted(); });
  $("btnAddMatch").addEventListener("click", () => openMatch());
  $("btnTicks").addEventListener("click", () => openPaste());
  $("btnMore").addEventListener("click", () => openMore());
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !b.dataset) return;
    const d = b.dataset;
    const find = (id) => S.items.find((x) => x.id === id);
    if (d.toggle) { const it = find(d.toggle); if (it) setPaid(it, [d.key], !isPaid(it, d.key)); }
    else if (d.allpaid) { const it = find(d.allpaid); if (it) setPaid(it, it.players.filter((p) => !p.free && !isPaid(it, p.key)).map((p) => p.key), true); }
    else if (d.payall) { for (const it of live()) if ((it.players || []).some((p) => p.key === d.payall && !p.free) && !isPaid(it, d.payall)) setPaid(it, [d.payall], true); toast("Marked all paid"); }
    else if (d.edit) { const it = find(d.edit); if (it) (it.kind === "dues" ? openDues(it) : openMatch(it)); }
    else if (d.del) {
      const it = find(d.del); const box = $("confirm-" + d.del); if (!it || !box) return;
      box.innerHTML = `<div class="confirm"><span>Delete <b>${esc(itemTitle(it))}</b> and its payment ticks?</span><button type="button" class="danger" data-delyes="${esc(it.id)}">Delete</button><button type="button" data-delno="${esc(it.id)}">Keep</button></div>`;
    }
    else if (d.delyes) { const it = find(d.delyes); if (it) { deleteItem(it); toast("Deleted"); } }
    else if (d.delno) { const box = $("confirm-" + d.delno); if (box) box.innerHTML = ""; }
    else if (d.act === "add-match") openMatch();
    else if (d.act === "add-dues") openDues();
    else if (d.act === "import") openPaste();
    else if (d.act === "clear-paid") {
      const box = $("clearBox"); if (!box) return;
      box.innerHTML = `<div class="confirm"><span>Remove all fully paid matches from the app? Nobody owes anything on them.</span><button type="button" class="danger" data-act="clear-paid-yes">Remove</button><button type="button" data-act="clear-paid-no">Keep</button></div>`;
    }
    else if (d.act === "clear-paid-yes") { const done = live().filter((it) => itemTotals(it).settled); done.forEach(deleteItem); toast(`Removed ${done.length} fully paid`); }
    else if (d.act === "clear-paid-no") { const box = $("clearBox"); if (box) box.innerHTML = ""; }
  });

  function copyText(text, ok) {
    const fallback = () => { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); toast(ok); } catch { toast("Select the text and copy it."); } t.remove(); };
    try { navigator.clipboard.writeText(text).then(() => toast(ok), fallback); } catch { fallback(); }
  }

  // ---------- sheets ----------
  const overlay = $("overlay");
  function openSheet(html) { overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`; overlay.hidden = false; document.body.style.overflow = "hidden"; }
  function closeSheet() { overlay.hidden = true; overlay.innerHTML = ""; document.body.style.overflow = ""; }
  overlay.addEventListener("click", (e) => { if (e.target === overlay || (e.target.dataset && e.target.dataset.close !== undefined)) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeSheet(); });

  const parseNames = (text) => String(text || "").split(/[\n,;]+/).map(cleanName).filter((s) => s.length > 1);
  const sameTeam = (a, b) => { const n = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return n(a) && n(a) === n(b); };

  // ---- match form ----
  function openMatch(it) {
    if (!S.team) return openSetup(() => openMatch(it));
    const editing = !!it;
    // played: key -> {key,name,free}
    const played = new Map((it?.players || []).filter((p) => !p.contrib).map((p) => [p.key, { key: p.key, name: p.name, free: !!p.free }]));
    const group = coverGroupList();
    let coverMode = it ? (it.coverKeys ? "some" : "all") : (group.length ? "some" : "all");
    const cover = new Set(it?.coverKeys || group.map((g) => g.key));
    const pool = new Map(roster().map((p) => [p.key, p.name]));
    for (const p of played.values()) pool.set(p.key, p.name);
    // people who can chip in for free players without playing: the saved group, past chip-ins, anyone added here
    const helpers = new Map(group.map((g) => [g.key, g.name]));
    for (const p of it?.players || []) if (p.contrib) helpers.set(p.key, p.name);

    openSheet(`
      <div class="row" style="justify-content:space-between"><h2>${editing ? "Edit match" : "Add match"}</h2><button type="button" class="ghost" data-close aria-label="Close">✕</button></div>
      <div style="display:grid;gap:8px">
        <label class="f">CricHeroes scorecard link<input id="fLink" type="url" inputmode="url" placeholder="https://chshare.link/scorecard/…" value="${esc(it?.link || "")}"></label>
        <div class="row"><button type="button" class="primary" id="fFetch">Get players from link</button><span id="fFetchMsg" class="small muted"></span></div>
      </div>
      <div class="grid2">
        <label class="f">Total match fee (₹)<input id="fFee" type="number" inputmode="numeric" min="0" step="1" value="${esc(it?.fee ?? (S.defaultFee || ""))}"></label>
        <label class="f">Opponent<input id="fOpp" placeholder="e.g. Thunder Kings" value="${esc(it?.opponent || "")}"></label>
        <label class="f">Match date<input id="fDate" type="date" value="${esc(it?.date || today())}"></label>
      </div>
      <div class="step">
        <div class="lbl">1 · Who played? <span class="muted small" id="fCount"></span></div>
        <div class="chips" id="fPlayed"></div>
        <div class="row"><input id="fNew" placeholder="Add a name (or several, comma separated)" style="flex:1;min-width:180px"><button type="button" id="fAdd">Add</button></div>
      </div>
      <div class="step">
        <div class="lbl">2 · Anyone playing free? <span class="muted small">Tap players who don't pay</span></div>
        <div class="chips" id="fFree"></div>
      </div>
      <div class="step" id="fCoverStep" hidden>
        <div class="lbl">3 · Who pays the free players' share?</div>
        <div class="chips">
          <label class="chip" id="cmAllL"><input type="radio" name="cm" value="all" id="cmAll"> Everyone who pays</label>
          <label class="chip" id="cmSomeL"><input type="radio" name="cm" value="some" id="cmSome"> Only some people</label>
        </div>
        <div id="fCoverPick" hidden style="display:grid;gap:8px">
          <span class="muted small">Tick who shares it. They can be today's players or regulars who didn't play. This group is remembered for next time.</span>
          <div class="small" style="font-weight:600">Played today</div>
          <div class="chips" id="fCover"></div>
          <div class="small" style="font-weight:600">Didn't play, but chip in</div>
          <div class="chips" id="fHelp"></div>
          <div class="row"><input id="fHelpNew" placeholder="Add someone who chips in" style="flex:1;min-width:160px"><button type="button" id="fHelpAdd">Add</button></div>
        </div>
      </div>
      <div class="preview num" id="fPrev"></div>
      <div class="row end"><button type="button" data-close>Cancel</button>${editing ? "" : `<button type="button" id="fSaveMore">Save &amp; add another</button>`}<button type="button" class="primary" id="fSave">${editing ? "Save changes" : "Add match"}</button></div>`);

    const getPlayers = () => [...played.values()];
    const step = () => 1; // shares are rounded up to the next whole rupee
    const fee = () => Number($("fFee").value) || 0;
    const coverKeys = () => coverMode === "some" ? [...cover] : null;
    const helperList = () => [...helpers.entries()].filter(([k]) => !played.has(k)).map(([key, name]) => ({ key, name }));

    function draw() {
      const chosen = [...pool.entries()];
      $("fPlayed").innerHTML = chosen.length ? chosen.map(([k, n]) => `<label class="chip ${played.has(k) ? "on" : ""}"><input type="checkbox" data-pk="${esc(k)}" ${played.has(k) ? "checked" : ""}> ${esc(n)}</label>`).join("") +
        `<button type="button" class="ghost small" data-pall>All</button><button type="button" class="ghost small" data-pnone>None</button>`
        : `<span class="muted small">Paste the CricHeroes link above, or add names below.</span>`;
      $("fCount").textContent = played.size ? `${played.size} ticked` : "";
      const ps = getPlayers();
      $("fFree").innerHTML = ps.length ? ps.map((p) => `<button type="button" class="chip ${p.free ? "free" : ""}" data-fk="${esc(p.key)}" aria-pressed="${p.free}">${p.free ? "Free · " : ""}${esc(p.name)}</button>`).join("") : `<span class="muted small">Pick who played first.</span>`;
      const anyFree = ps.some((p) => p.free);
      $("fCoverStep").hidden = !anyFree;
      $("cmAll").checked = coverMode === "all"; $("cmSome").checked = coverMode === "some";
      $("cmAllL").classList.toggle("on", coverMode === "all"); $("cmSomeL").classList.toggle("on", coverMode === "some");
      $("fCoverPick").hidden = coverMode !== "some";
      const payers = ps.filter((p) => !p.free);
      const chip = (p) => `<button type="button" class="chip ${cover.has(p.key) ? "cover" : ""}" data-ck="${esc(p.key)}" aria-pressed="${cover.has(p.key)}">${cover.has(p.key) ? "✓ " : ""}${esc(p.name)}</button>`;
      $("fCover").innerHTML = payers.map(chip).join("");
      const hl = helperList();
      $("fHelp").innerHTML = hl.length ? hl.map(chip).join("") : `<span class="muted small">Nobody yet. Add your regulars below.</span>`;
      preview();
    }
    function preview() {
      const sp = computeSplit(fee(), getPlayers(), coverKeys(), step(), helperList());
      if (!sp.ok) { $("fPrev").innerHTML = `<span>${esc(sp.why)}</span>`; return sp; }
      let head = `<div><b>${inr(fee())} ÷ ${sp.played} players = ${inr(sp.base)}</b> each before rounding</div>`;
      if (sp.freeCount) head += sp.fallback
        ? `<div style="color:var(--warn)">Tick who shares the free players' ${inr(sp.freeTotal)}. Until you do, everyone who pays shares it (+${inr(sp.extra)} each).</div>`
        : `<div>${sp.freeCount} free → ${inr(sp.freeTotal)} shared by ${sp.coverAll ? "all " + sp.coverCount + " paying players" : sp.coverCount + " people"}${sp.helperCount ? ` (${sp.helperCount} didn't play)` : ""} · +${inr(sp.extra)} each</div>`;
      head += `<div class="muted small">Collects ${inr(sp.total)}${sp.over > 0 ? ` (${inr(sp.over)} extra from rounding)` : ""}</div>`;
      const rows = [...sp.players].sort((a, b) => b.amount - a.amount).map((p) => `<tr class="${p.free ? "free" : ""}"><td>${esc(p.name)}${p.contrib ? " <span class='muted small'>chips in, didn't play</span>" : p.cover ? " <span class='muted small'>covers</span>" : ""}</td><td>${p.free ? "Free" : inr(p.amount)}</td></tr>`).join("");
      $("fPrev").innerHTML = head + `<table class="ptable">${rows}</table>`;
      return sp;
    }
    function addNames(text) {
      for (const n of parseNames(text)) { const k = keyOf(n); if (!pool.has(k)) pool.set(k, n); if (!played.has(k)) played.set(k, { key: k, name: pool.get(k), free: false }); }
    }

    $("fPlayed").addEventListener("click", (e) => {
      if (e.target.dataset.pall !== undefined) { for (const [k, n] of pool) if (!played.has(k)) played.set(k, { key: k, name: n, free: false }); draw(); }
      if (e.target.dataset.pnone !== undefined) { played.clear(); draw(); }
    });
    $("fPlayed").addEventListener("change", (e) => {
      const k = e.target.dataset.pk; if (!k) return;
      e.target.checked ? played.set(k, { key: k, name: pool.get(k), free: false }) : played.delete(k); draw();
    });
    $("fFree").addEventListener("click", (e) => { const b = e.target.closest("[data-fk]"); if (!b) return; const p = played.get(b.dataset.fk); p.free = !p.free; if (p.free) cover.delete(p.key); draw(); });
    $("fCoverStep").addEventListener("change", (e) => { if (e.target.name === "cm") { coverMode = e.target.value; draw(); } });
    $("fCoverPick").addEventListener("click", (e) => { const b = e.target.closest("[data-ck]"); if (!b) return; const k = b.dataset.ck; cover.has(k) ? cover.delete(k) : cover.add(k); draw(); });
    $("fHelpAdd").addEventListener("click", () => {
      for (const n of parseNames($("fHelpNew").value)) { const k = keyOf(n); if (!helpers.has(k) && !played.has(k)) helpers.set(k, pool.get(k) || n); cover.add(k); }
      $("fHelpNew").value = ""; draw();
    });
    $("fHelpNew").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("fHelpAdd").click(); } });
    $("fAdd").addEventListener("click", () => { addNames($("fNew").value); $("fNew").value = ""; draw(); });
    $("fNew").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("fAdd").click(); } });
    $("fFee").addEventListener("input", preview);

    $("fFetch").addEventListener("click", async () => {
      const link = $("fLink").value.trim();
      const msg = $("fFetchMsg");
      if (!link) { msg.textContent = "Paste the scorecard link first."; return; }
      msg.textContent = "Reading the scorecard…"; $("fFetch").disabled = true;
      try {
        const r = await fetch(SCORECARD_API + "?url=" + encodeURIComponent(link));
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || "Couldn't read that scorecard.");
        const apply = (team) => {
          const other = d.teams.find((t) => t !== team);
          played.clear();
          addNames(team.players.join("\n"));
          if (other && !$("fOpp").value) $("fOpp").value = other.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
          if (d.date) $("fDate").value = d.date;
          if (d.ground) $("fOpp").dataset.ground = d.ground;
          msg.innerHTML = `<span style="color:var(--good)">Got ${team.players.length} players for ${esc(team.name)}.</span> Untick anyone who didn't play, or add extras.`;
          draw();
        };
        const mine = d.teams.find((t) => sameTeam(t.name, S.team)) || d.teams.find((t) => t.name.toLowerCase().includes(S.team.toLowerCase()) || S.team.toLowerCase().includes(t.name.toLowerCase()));
        if (mine) apply(mine);
        else {
          msg.innerHTML = `Which one is your team? ` + d.teams.map((t, i) => `<button type="button" class="chip" data-team="${i}">${esc(t.name)}</button>`).join(" ");
          msg.onclick = (e) => { const b = e.target.closest("[data-team]"); if (!b) return; const t = d.teams[Number(b.dataset.team)]; S.team = t.name.replace(/\b\w/g, (c) => c.toUpperCase()); save(); render(); apply(t); msg.onclick = null; };
        }
      } catch (err) {
        msg.innerHTML = `<span style="color:var(--bad)">${esc(err.message || "Couldn't read that scorecard.")}</span> Tick the players below instead.`;
      } finally { $("fFetch").disabled = false; }
    });

    const doSave = (again) => {
      const sp = preview();
      if (!sp.ok) return;
      const keys = new Set(sp.players.filter((p) => !p.free).map((p) => p.key));
      const paid = {}; for (const [k, v] of Object.entries(it?.paid || {})) if (keys.has(k)) paid[k] = v;
      const ck = coverKeys();
      if (sp.freeCount && ck && ck.length) {
        const nameOf = (k) => played.get(k)?.name || helpers.get(k) || pool.get(k) || k;
        S.coverGroup = ck.map((k) => ({ key: k, name: nameOf(k) }));
      }
      upsertItem({
        id: it?.id || uid(), kind: "match", opponent: $("fOpp").value.trim(), date: $("fDate").value || today(),
        ground: $("fOpp").dataset.ground || it?.ground || "", link: $("fLink").value.trim(), fee: fee(), roundTo: step(),
        coverKeys: sp.freeCount ? ck : null, players: sp.players, paid, createdAt: it?.createdAt || now(),
      });
      if (again) { openMatch(); toast("Saved. Now add the next match."); return; }
      closeSheet(); toast(editing ? "Match updated" : "Match added. Send the message to the group.");
    };
    $("fSave").addEventListener("click", () => doSave(false));
    if ($("fSaveMore")) $("fSaveMore").addEventListener("click", () => doSave(true));
    draw();
  }

  // ---- import an old WhatsApp fees post ----
  function parseOldPost(text) {
    const matches = [], players = [], skipped = [];
    for (const raw of String(text || "").split("\n")) {
      const line = raw.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u00A0]/g, " ").replace(/^\s*\[[^\]]*\]\s*[^:]{1,40}:\s*/, "").trim(); if (!line || /^[━─=_\-–—]{3,}$/.test(line)) continue;
      if (/^(→|free:|₹|📒|\d+ of \d+ players|all paid|all fees)/i.test(line)) { skipped.push(line); continue; }
      const mm = line.match(/\bvs\.?\s+\*?([^*—–\-]+?)\*?\s*[—–-]\s*(.*)$/i);
      if (mm && !/^\d+\.\s/.test(line) && /🏟|vs/i.test(line) && !/–\s*₹?\d/.test(line.split(/vs/i)[0])) {
        const fee = (mm[2].match(/₹\s?([\d,]+)/) || [])[1];
        matches.push({ opponent: mm[1].trim(), info: mm[2].replace(/\s+/g, " ").trim(), fee: fee ? Number(fee.replace(/,/g, "")) : 0 });
        continue;
      }
      if (/match fee|^🏏|pending:|pay to|please pay|^\*.*\*$/i.test(line)) continue;
      const pm = line.replace(/^\s*\d+[.)]\s*/, "").match(/^(.+?)\s*[–—:-]\s*₹?\s*([\d,]+(?:\.\d+)?)(.*)$/);
      if (!pm) { skipped.push(line); continue; }
      const name = cleanName(pm[1]); if (!name) { skipped.push(line); continue; }
      const amount = Math.round(Number(pm[2].replace(/,/g, "")));
      const rest = pm[3] || "";
      const paid = /[✅✔☑✓]/.test(line);
      const note = (rest.match(/\(([^)]*)\)/) || [])[1] || "";
      const app = /\((?:old\b|vs |\d{1,2} [A-Za-z]{3})/i.test(rest);
      const k = keyOf(name); const ex = players.find((x) => x.key === k);
      if (ex) { ex.amount += amount; ex.paid = ex.paid && paid; } else players.push({ key: k, name, amount, paid, note, app });
    }
    return { matches, players, skipped };
  }
  // One box for everything pasted from WhatsApp:
  //  - lines for people the app already tracks (same amount, or an app list with M1/D1 labels) only update ✅
  //  - anything else (an old list from before the app, or new names) is added as earlier dues
  function openPaste() {
    if (!S.team) return openSetup(() => openPaste());
    openSheet(`
      <div class="row" style="justify-content:space-between"><h2>Update from WhatsApp</h2><button type="button" class="ghost" data-close aria-label="Close">✕</button></div>
      <p class="muted small">In the group, long-press the latest fees list (with everyone's ✅), copy it and paste it here. It can be this app's list or your old one.</p>
      <textarea id="iText" rows="9" placeholder="1. Pravesh Sharma – ₹870 (M1) ✅&#10;Gagan Verma – ₹21420&#10;Shashank Sharma – ₹2873 ✅"></textarea>
      <div class="preview num" id="iPrev">Paste the message to see what will change.</div>
      <div id="iDuesBox" hidden style="display:grid;gap:8px">
        <label class="chip on" style="justify-self:start"><input type="checkbox" id="iAddDues" checked> Add the amounts above as earlier dues</label>
        <label class="f">Name for these dues (optional)<input id="iTitle" autocomplete="off" placeholder="e.g. Pending till 4 Oct"></label>
      </div>
      <div class="row end"><button type="button" data-close>Cancel</button><button type="button" class="primary" id="iSave" disabled>Update</button></div>`);
    let plan = null;
    const norm = (x) => cleanName(x).toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();
    const run = () => {
      const text = $("iText").value;
      const parsed = parseOldPost(text);
      const people = playersAcross(live());
      const appList = /pay and tick/i.test(text);
      const find = (name) => { const n = norm(name); return people.find((p) => norm(p.name) === n) || people.find((p) => { const pn = norm(p.name); return n.length >= 3 && (pn.startsWith(n) || n.startsWith(pn)); }); };
      plan = { pay: [], dues: [], already: [], pending: 0, matches: parsed.matches };
      for (const line of parsed.players) {
        const hit = find(line.name);
        // the same amount already sits on one of their entries (e.g. this old list was pasted before)
        const sameEntry = hit && [...hit.dueItems, ...hit.paidItems].find((d) => Math.abs(d.amount - line.amount) <= 1);
        const known = hit && (sameEntry || appList || line.app || Math.abs(line.amount - hit.due) <= 5 || Math.abs(line.amount - (hit.due + hit.paid)) <= 5);
        if (known) {
          const items = sameEntry && !appList && !line.app ? (hit.dueItems.includes(sameEntry) ? [sameEntry] : []) : hit.dueItems;
          if (line.paid) { if (items.length) { if (!plan.pay.some((x) => x.p === hit)) plan.pay.push({ p: hit, items, amount: items.reduce((s, d) => s + d.amount, 0) }); } else plan.already.push(hit.name); }
          else plan.pending++;
        } else plan.dues.push(hit ? { ...line, key: hit.key, name: hit.name, existed: true } : line);
      }
      const dueOwed = plan.dues.filter((p) => !p.paid);
      if (!$("iTitle").dataset.touched) $("iTitle").value = plan.matches.length ? `Pending from ${plan.matches.length} earlier match${plan.matches.length === 1 ? "" : "es"}` : "Earlier dues";
      const parts = [];
      if (plan.pay.length) parts.push(`<div><b>✅ Mark paid (${inr(plan.pay.reduce((s, x) => s + x.amount, 0))}):</b> ${plan.pay.map((x) => esc(x.p.name)).join(", ")}</div>`);
      if (plan.dues.length) parts.push(`<div><b>New dues:</b> ${dueOwed.length} player${dueOwed.length === 1 ? "" : "s"} owe ${inr(dueOwed.reduce((s, p) => s + p.amount, 0))}${plan.dues.length > dueOwed.length ? ` · ${plan.dues.length - dueOwed.length} already ✅` : ""}${plan.matches.length ? ` · from ${plan.matches.map((m) => esc("vs " + m.opponent)).join(", ")}` : ""}</div>
        <table class="ptable">${plan.dues.map((p) => `<tr><td>${esc(p.name)}${p.existed ? ' <span class="muted small">adds to what they owe now</span>' : ""}${p.note ? ` <span class="muted small">(${esc(p.note)})</span>` : ""}</td><td>${inr(p.amount)}${p.paid ? " ✅" : ""}</td></tr>`).join("")}</table>`);
      if (plan.pending) parts.push(`<div class="muted small">${plan.pending} still pending, no change.</div>`);
      if (plan.already.length) parts.push(`<div class="muted small">Already paid: ${plan.already.map(esc).join(", ")}</div>`);
      if (!parts.length) parts.push(parsed.players.length ? "<div>Nothing new to update.</div>" : "<div>No player lines found yet. Each line should look like <b>Name – ₹870</b>.</div>");
      $("iPrev").innerHTML = parts.join("");
      $("iDuesBox").hidden = !plan.dues.length;
      $("iSave").disabled = !(plan.pay.length || plan.dues.length);
    };
    $("iText").addEventListener("input", run);
    $("iTitle").addEventListener("input", () => ($("iTitle").dataset.touched = "1"));
    $("iSave").addEventListener("click", () => {
      if (!plan) return;
      const t = now();
      for (const x of plan.pay) for (const d of x.items) { d.it.paid = d.it.paid || {}; d.it.paid[x.p.key] = { v: true, t }; touch(d.it); }
      const addDues = plan.dues.length && $("iAddDues").checked;
      if (addDues) {
        const paid = {}; for (const p of plan.dues) if (p.paid) paid[p.key] = { v: true, t };
        S.items.push({
          id: uid(), kind: "dues", title: $("iTitle").value.trim() || "Earlier dues", date: "",
          matches: plan.matches, players: plan.dues.map((p) => ({ key: p.key, name: p.name, amount: p.amount, free: false })),
          paid, postedAt: t, createdAt: t, updatedAt: t,
        });
        S.updatedAt = t;
      }
      save(); render(); closeSheet();
      const bits = [];
      if (plan.pay.length) bits.push(`${plan.pay.length} marked paid`);
      if (addDues) bits.push(`${plan.dues.length} dues added`);
      toast((bits.join(" · ") || "Updated") + ". Add the next match, then send the updated list.");
    });
  }

  // ---- earlier dues ----
  function openDues(it) {
    if (!S.team) return openSetup(() => openDues(it));
    const editing = !!it;
    const lines = (it?.players || []).map((p) => `${p.name} ${p.amount}`).join("\n");
    openSheet(`
      <div class="row" style="justify-content:space-between"><h2>${editing ? "Edit earlier dues" : "Fees owed from before"}</h2><button type="button" class="ghost" data-close aria-label="Close">✕</button></div>
      <p class="muted small">For money still pending from earlier matches. One player per line with the amount they owe.</p>
      <div class="grid2">
        <label class="f">What it's for<input id="dTitle" autocomplete="off" placeholder="e.g. Pending from October" value="${esc(it?.title || "Earlier dues")}"></label>
        <label class="f">Date<input id="dDate" type="date" value="${esc(it?.date || today())}"></label>
      </div>
      <label class="f">Who owes what<textarea id="dLines" rows="7" placeholder="Rishabh 870&#10;Abhishek - 1740&#10;Aman Singh: ₹500">${esc(lines)}</textarea></label>
      <div class="preview num" id="dPrev"></div>
      <div class="row end"><button type="button" data-close>Cancel</button><button type="button" class="primary" id="dSave">${editing ? "Save changes" : "Add dues"}</button></div>`);
    const parse = () => {
      const out = [], bad = [];
      for (const raw of $("dLines").value.split("\n")) {
        const line = raw.trim(); if (!line) continue;
        const m = line.match(/^(.*?)[\s:\-–=]*(?:rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)\s*(?:rs\.?|₹|\/-)?\s*$/i);
        if (!m || !cleanName(m[1])) { bad.push(line); continue; }
        const name = cleanName(m[1]), amount = Math.round(Number(m[2].replace(/,/g, "")));
        const k = keyOf(name); const ex = out.find((x) => x.key === k);
        ex ? (ex.amount += amount) : out.push({ key: k, name, amount, free: false });
      }
      return { out, bad };
    };
    const prev = () => {
      const { out, bad } = parse();
      $("dPrev").innerHTML = (out.length ? `<div><b>${out.length} players</b> · ${inr(out.reduce((s, p) => s + p.amount, 0))} total</div>` : "<div>Type a name and an amount on each line.</div>") +
        (bad.length ? `<div style="color:var(--bad)">Couldn't read: ${bad.map(esc).join(" · ")}</div>` : "");
    };
    $("dLines").addEventListener("input", prev); prev();
    $("dSave").addEventListener("click", () => {
      const { out, bad } = parse();
      if (!out.length || bad.length) { prev(); return; }
      const keys = new Set(out.map((p) => p.key));
      const paid = {}; for (const [k, v] of Object.entries(it?.paid || {})) if (keys.has(k)) paid[k] = v;
      upsertItem({ id: it?.id || uid(), kind: "dues", title: $("dTitle").value.trim() || "Earlier dues", date: $("dDate").value || "", matches: it?.matches || [], postedAt: it?.postedAt, players: out, paid, createdAt: it?.createdAt || now() });
      closeSheet(); toast(editing ? "Dues updated" : "Dues added");
    });
  }

  // ---- setup / settings ----
  function openSetup(then) {
    openSheet(`
      <h2>${S.team ? "Team settings" : "Set up your team"}</h2>
      <label class="f">Team name (as on CricHeroes)<input id="sTeam" placeholder="e.g. Royal Strikers XI" value="${esc(S.team)}"></label>
      <label class="f">Usual match fee (₹)<input id="sFee" type="number" inputmode="numeric" placeholder="e.g. 9000" value="${S.defaultFee ? esc(S.defaultFee) : ""}"></label>
      <label class="f">Payment details for the message (optional)<input id="sPay" placeholder="e.g. UPI: captain@okicici" value="${esc(S.payNote)}"></label>
      <div class="row end">${S.team ? `<button type="button" data-close>Cancel</button>` : ""}<button type="button" class="primary" id="sSave">${S.team ? "Save" : "Start"}</button></div>`);
    $("sSave").addEventListener("click", () => {
      const t = $("sTeam").value.trim(); if (!t) { $("sTeam").focus(); return; }
      S.team = t; S.defaultFee = Number($("sFee").value) || 0; S.roundTo = 1; S.payNote = $("sPay").value.trim(); S.updatedAt = now();
      save(); render(); closeSheet(); if (then) then();
    });
  }

  function openMore() {
    openSheet(`
      <div class="row" style="justify-content:space-between"><h2>More</h2><button type="button" class="ghost" data-close aria-label="Close">✕</button></div>
      <button type="button" class="primary" id="mShare">Send to co-captain</button>
      <p class="muted small" style="margin-top:-6px">Makes a link with all matches and ticks. When they open it, it's added to their phone. Send it again after changes; nothing is lost, the newest change wins.</p>
      <button type="button" id="mImport2">Update from WhatsApp</button>
      <button type="button" id="mDues">+ Type fees owed by hand</button>
      <button type="button" id="mSettings">Team name, fee and payment details</button>
      <button type="button" id="mInstall">Add to home screen</button>
      <a class="btn" href="guide.pdf" target="_blank" rel="noopener">How to use (PDF guide)</a>
      <div id="mFreshBox" style="display:grid"><button type="button" class="danger" id="mFresh">Start fresh</button></div>
      <p class="muted small" style="margin-top:-6px">Removes every match and payment. Keeps your team name, fee and the regulars who cover free players.</p>
      <details><summary>Backup and reset</summary>
        <div style="display:grid;gap:8px;padding-top:6px">
          <button type="button" id="mExport">Download backup file</button>
          <label class="btn" for="mImport">Restore from backup file</label><input type="file" id="mImport" accept="application/json,.json" hidden>
          <div id="mResetBox"><button type="button" class="danger" id="mReset">Delete everything on this phone</button></div>
        </div>
      </details>`);
    $("mShare").addEventListener("click", shareToCaptain);
    $("mDues").addEventListener("click", () => openDues());
    $("mImport2").addEventListener("click", () => openPaste());
    $("mSettings").addEventListener("click", () => openSetup());
    $("mInstall").addEventListener("click", () => {
      if (window.__installPrompt) { window.__installPrompt.prompt(); closeSheet(); return; }
      toast(/iphone|ipad/i.test(navigator.userAgent) ? "In Safari: Share button → Add to Home Screen" : "Browser menu (⋮) → Add to Home screen");
    });
    $("mExport").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `match-fees-${(S.team || "team").replace(/\W+/g, "-").toLowerCase()}-${today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    $("mImport").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const incoming = JSON.parse(await f.text()); mergeIn(incoming); closeSheet(); toast("Backup restored"); } catch { toast("That file isn't a Match Fees backup."); }
    });
    $("mFresh").addEventListener("click", () => {
      $("mFreshBox").innerHTML = `<div class="confirm"><span>Remove all matches and payments? This can't be undone. (Tip: download a backup first.)</span><button type="button" class="danger" id="mFreshYes">Start fresh</button><button type="button" data-close>Keep</button></div>`;
      $("mFreshYes").addEventListener("click", () => { live().forEach(deleteItem); excluded.clear(); touched.clear(); closeSheet(); toast("Started fresh"); });
    });
    $("mReset").addEventListener("click", () => {
      $("mResetBox").innerHTML = `<div class="confirm"><span>Delete all matches and ticks on this phone?</span><button type="button" class="danger" id="mResetYes">Delete</button><button type="button" data-close>Keep</button></div>`;
      $("mResetYes").addEventListener("click", () => { S = blank(); save(); render(); closeSheet(); openSetup(); });
    });
  }

  // ---------- co-captain link (state in the URL, compressed) ----------
  const b64u = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64u = (str) => { const s = atob(str.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  async function pack(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === "function") {
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
      return "z" + b64u(new Uint8Array(out));
    }
    return "j" + b64u(bytes);
  }
  async function unpack(str) {
    const kind = str[0], bytes = unb64u(str.slice(1));
    if (kind === "z") {
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(out));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function shareToCaptain() {
    const code = await pack(S);
    const url = `${APP_URL}#d=${code}`;
    const text = `${S.team || "Team"} match fees – open this to get the latest list on your phone:\n${url}`;
    closeSheet();
    openSheet(`
      <h2>Send to co-captain</h2>
      <p class="muted small">Send this link to the other captain on WhatsApp. Opening it adds everything to their phone. They can send theirs back the same way.</p>
      <div class="row"><a class="btn primary" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a><button type="button" id="cCopy">Copy link</button></div>
      <p class="muted small">Link size: ${url.length.toLocaleString()} characters.</p>
      <div class="row end"><button type="button" data-close>Done</button></div>`);
    $("cCopy").addEventListener("click", () => copyText(url, "Link copied"));
  }

  // Everything from a shared link, a backup file or storage is untrusted: keep only known fields, with sane types and sizes.
  const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const str = (v, n = 80) => typeof v === "string" ? v.slice(0, n) : "";
  const num = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x < 1e13 ? x : 0; }; // fits money and millisecond timestamps
  const okKey = (k) => typeof k === "string" && k.length <= 80 && !BAD_KEYS.has(k);
  function sanitize(inc) {
    if (!inc || typeof inc !== "object" || !Array.isArray(inc.items)) throw new Error("bad data");
    const person = (p) => ({ key: okKey(p?.key) ? p.key : keyOf(str(p?.name)), name: str(p?.name, 60), amount: num(p?.amount), free: !!p?.free, cover: !!p?.cover, contrib: !!p?.contrib });
    const paidMap = (m) => { const o = {}; if (m && typeof m === "object") for (const [k, v] of Object.entries(m).slice(0, 300)) if (okKey(k) && v && typeof v === "object") o[k] = { v: !!v.v, t: num(v.t) }; return o; };
    return {
      v: 1, team: str(inc.team, 60), defaultFee: num(inc.defaultFee), roundTo: 1, payNote: str(inc.payNote, 120), updatedAt: num(inc.updatedAt),
      coverGroup: (Array.isArray(inc.coverGroup) ? inc.coverGroup : []).slice(0, 40).map((g) => typeof g === "string" ? g.slice(0, 80) : { key: okKey(g?.key) ? g.key : keyOf(str(g?.name)), name: str(g?.name, 60) }),
      items: inc.items.slice(0, 300).filter((it) => it && typeof it === "object" && okKey(it.id)).map((it) => ({
        id: it.id, kind: it.kind === "dues" ? "dues" : "match", deleted: !!it.deleted,
        opponent: str(it.opponent, 60), title: str(it.title, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(it.date || "") ? it.date : "",
        ground: str(it.ground, 100), link: /^https:\/\/[^\s"<>]+$/i.test(it.link || "") ? str(it.link, 300) : "",
        fee: num(it.fee), roundTo: 1, coverKeys: Array.isArray(it.coverKeys) ? it.coverKeys.filter(okKey).slice(0, 60) : null,
        matches: (Array.isArray(it.matches) ? it.matches : []).slice(0, 30).map((m) => ({ opponent: str(m?.opponent, 60), info: str(m?.info, 120), fee: num(m?.fee) })),
        players: (Array.isArray(it.players) ? it.players : []).slice(0, 120).map(person),
        paid: paidMap(it.paid), postedAt: num(it.postedAt) || undefined, remindedAt: num(it.remindedAt) || undefined, thankedAt: num(it.thankedAt) || undefined,
        createdAt: num(it.createdAt), updatedAt: num(it.updatedAt),
      })),
    };
  }

  // newest change wins per match and per payment tick, so two captains never wipe each other's work
  function mergeIn(raw) {
    const inc = sanitize(raw);
    const before = live().length;
    if (!S.team || (inc.updatedAt || 0) > (S.updatedAt || 0)) {
      S.team = inc.team || S.team; S.defaultFee = inc.defaultFee ?? S.defaultFee; S.roundTo = inc.roundTo ?? S.roundTo;
      S.payNote = inc.payNote ?? S.payNote; S.coverGroup = inc.coverGroup || S.coverGroup;
    }
    for (const it of inc.items) {
      const mine = S.items.find((x) => x.id === it.id);
      if (!mine) { S.items.push(it); continue; }
      const paid = { ...(mine.paid || {}) };
      for (const [k, v] of Object.entries(it.paid || {})) if (!paid[k] || (v && v.t > paid[k].t)) paid[k] = v;
      if ((it.updatedAt || 0) > (mine.updatedAt || 0)) Object.assign(mine, it);
      mine.paid = paid;
      mine.updatedAt = Math.max(mine.updatedAt || 0, it.updatedAt || 0);
    }
    S.updatedAt = Math.max(S.updatedAt || 0, inc.updatedAt || 0);
    save(); render();
    return live().length - before;
  }

  async function readLink() {
    const m = location.hash.match(/^#d=(.+)$/);
    if (!m) return false;
    history.replaceState(null, "", APP_URL);
    let inc;
    try { inc = await unpack(m[1]); } catch { showBanner("note", "This link is damaged. Ask for it again."); return true; }
    const n = (inc.items || []).filter((x) => !x.deleted).length;
    if (!S.team && !S.items.length) { mergeIn(inc); showBanner("note good", `Loaded ${inc.team || "the team"}'s fees: ${n} match${n === 1 ? "" : "es"}.`); return true; }
    showBanner("note info", `<div style="display:grid;gap:8px"><span>This link has <b>${esc(inc.team || "a team")}</b>'s fees (${n} item${n === 1 ? "" : "s"}). Add it to what's on this phone? Newer changes win, nothing else is removed.</span><div class="row"><button type="button" class="primary" id="bMerge">Add to this phone</button><button type="button" id="bSkip">Ignore</button></div></div>`, true);
    $("bMerge").addEventListener("click", () => { mergeIn(inc); showBanner("note good", "Updated with the latest from the link."); });
    $("bSkip").addEventListener("click", () => ($("banner").hidden = true));
    return true;
  }
  function showBanner(cls, html, raw) { const b = $("banner"); b.className = cls; b[raw ? "innerHTML" : "textContent"] = html; if (raw) b.innerHTML = html; b.hidden = false; if (!raw) setTimeout(() => (b.hidden = true), 6000); }

  let toastT = null;
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 2800); }

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__installPrompt = e; });
  window.addEventListener("hashchange", () => readLink());
  window.addEventListener("storage", (e) => { if (e.key === STORE) { S = load(); render(); } });

  S = load();
  render();
  readLink().then((had) => { if (!had && !S.team) openSetup(); });
})();
