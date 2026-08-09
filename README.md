# AdmDuel

Original Roblox coinflip/duel site — built from scratch, no relation to ampduel.

## Features
- Roblox login via **bio phrase verification** (public profile check — no password/cookie handling)
- Create/join coinflip duels with provably fair results (commit-reveal: SHA-256 hash committed at creation, secret revealed at resolution)
- 5% house fee, demo faucet, session cookies (HttpOnly), per-IP rate limits
- JSON-file persistence — zero native dependencies

## Run on Termux
```bash
pkg update && pkg upgrade -y
pkg install nodejs   # needs Node >= 18 for fetch
cd ~/admduel
npm install express
node server.js
