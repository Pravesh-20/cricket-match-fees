# Security

- The app is a static page. There are no accounts, passwords, servers or databases.
- Each captain's data stays in their own phone's browser storage. Nothing is uploaded.
- "Send to co-captain" puts the data inside the link itself. Anyone with that link can see that team's list, so share it only with your co-captain.
- Everything pasted, shared or restored is treated as untrusted: it is checked, size-limited and shown as plain text. A strict Content-Security-Policy blocks any injected script.
- The only online helper is the scorecard reader in `scorecard-api/`. It stores nothing and can only read CricHeroes scorecards.

Found a problem? Please open an issue without posting anyone's personal details.
