# Cricket Match Fees

**Open it:** https://pravesh-20.github.io/cricket-match-fees/

A free, no-sign-up web app for cricket captains who collect match fees on WhatsApp.

📄 **Easy guide (PDF):** https://pravesh-20.github.io/cricket-match-fees/guide.pdf

1. Type your team name once.
2. Paste the CricHeroes scorecard link and the match fee. The app reads who played.
3. It splits the fee: 11 players → ÷ 11, 12 players → ÷ 12.
4. Someone playing free? Tap them. Choose whether their share goes to **everyone** or **only some people**, e.g. the 4–5 regulars who always cover, even on days they did not play.
5. Tap **Send to WhatsApp**, pick your group, send. Players tick ✅ against their name as they pay.
6. When people tick, copy the group's latest list and tap **Update from WhatsApp**. Ticked players are marked paid; an old list from before the app becomes pending dues.
7. Add the next match and send the updated list. Each player's line stays short: `Gagan Verma – ₹25,782 (old ₹24,990 + 28 Oct)`. A match is shown by its date; amounts appear only where a player's share differs.

It also:

- adds up several unpaid matches into one list per player;
- lets you enter 2–3 matches in one go (**Save & add another**);
- reminds you after 48 hours with a ready message listing only the people who haven't paid;
- offers an "everyone has paid" message when the last tick comes in;
- lets you remove fully paid matches, or **Start fresh** (keeps team settings);
- rounds each share up to the next rupee;
- works on any phone; use **More → Add to home screen** to open it like an app.

## Where the data lives

Everything stays on your phone, in the browser's storage. Nothing is uploaded and there is no account.
To share with a co-captain, use **More → Send to co-captain**: it makes a link containing all matches and ticks. Opening it adds them to the other phone. Send it again after changes; the newest change wins, nothing else is lost.
Use **More → Backup and reset → Download backup file** now and then.

## Why it doesn't post in WhatsApp groups by itself

WhatsApp offers no official way for an app to post in a normal group. The unofficial bots need a server that is always on, and they put the captain's number at risk of a ban. So the app writes every message for you and opens WhatsApp. You only pick the group and press send.

## How it's built

- `index.html` + `app.js`: the whole app (plain HTML, CSS and JavaScript, no build step), hosted on GitHub Pages.
- `scorecard-api/`: a tiny Cloudflare Pages Function that reads a public CricHeroes scorecard and returns the two teams' players. It stores nothing. See its README to run your own copy.

If the link reader ever fails (for example, CricHeroes changes its page), the app still works: tick the players by hand.

See [SECURITY.md](SECURITY.md) for how data is kept safe. Contributions welcome. MIT licence.
