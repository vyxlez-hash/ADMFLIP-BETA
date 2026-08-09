const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOUSE_EDGE = 0.05;              // 5% house cut from the pot
const FAUCET_AMOUNT = 100;            // demo coins per account
const CODE_TTL_MS = 10 * 60 * 1000;   // bio code lifetime
const ROUND_TTL_MS = 30 * 60 * 1000;  // open round lifetime
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { users: {}, pendingCodes: {}, rounds: [], history: [], faucetUsed: {} };
let saveTimer = null;

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = Object.assign(db, parsed);
  } catch (_) { /* first boot: use defaults */ }
}

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }, 150);
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function randCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/* ---------- Roblox public API helpers (bio verification) ---------- */

async function fetchJson(url, opts = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429) { await sleep(1100); continue; } // be polite to rate limits
      return await res.json();
    } catch (e) { lastErr = e; await sleep(500); }
  }
  throw lastErr || new Error('request failed');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function robloxIdForUsername(username) {
  const json = await fetchJson('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
  });
  const m = json.data && json.data[0];
  return m ? m.id : null;
}

async function robloxBioForId(id) {
  const json = await fetchJson(`https://users.roblox.com/v1/users/${id}`);
  return json.description || '';
}

/* ---------- sessions / middleware ---------- */

function sessionToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'admsession') return v.join('=');
  }
  return null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `admsession=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
}

function currentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const u = db.users[token];
  if (!u) return null;
  if (Date.now() - u.createdAt > SESSION_TTL_MS) { delete db.users[token]; persist(); return null; }
  return { token, ...u };
}

function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  req.user = u;
  next();
}

/* ---------- simple per-IP rate limiter ---------- */

const rateMap = {};
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = rateMap[key] || [];
  const fresh = entry.filter(t => now - t < windowMs);
  rateMap[key] = fresh;
  if (fresh.length >= max) return true;
  fresh.push(now);
  rateMap[key] = fresh;
  return false;
}

/* ---------- app ---------- */

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.json({ authed: false });
  res.json({ authed: true, username: u.username, robloxId: u.robloxId, balance: u.balance });
});

/* --- login flow: step 1, request a bio code --- */
app.post('/api/auth/request', async (req, res) => {
  if (rateLimit(`req:${req.ip}`, 10, 60 * 60 * 1000))
    return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const username = String(req.body.username || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Invalid Roblox username.' });

  const id = await robloxIdForUsername(username);
  if (!id) return res.status(404).json({ error: 'No Roblox account with that username.' });

  // one pending code per username
  for (const [code, p] of Object.entries(db.pendingCodes)) {
    if (p.username.toLowerCase() === username.toLowerCase() || p.robloxId === id) {
      delete db.pendingCodes[code];
    }
  }

  const code = randCode();
  db.pendingCodes[code] = { username, robloxId: id, createdAt: Date.now() };
  persist();
  res.json({ code, robloxId: id });
});

/* --- login flow: step 2, check that the code is in the bio --- */
app.post('/api/auth/verify', async (req, res) => {
  if (rateLimit(`verify:${req.ip}`, 40, 60 * 60 * 1000))
    return res.status(429).json({ error: 'Too many attempts.' });

  const code = String(req.body.code || '').trim().toUpperCase();
  const pending = db.pendingCodes[code];
  if (!pending) return res.status(400).json({ error: 'Unknown or expired code. Request a new one.' });
  if (Date.now() - pending.createdAt > CODE_TTL_MS) {
    delete db.pendingCodes[code]; persist();
    return res.status(400).json({ error: 'Code expired. Request a new one.' });
  }

  const bio = await robloxBioForId(pending.robloxId);
  if (!bio || !bio.toUpperCase().includes(code))
    return res.json({ success: false, message: 'Code not found in your bio yet.' });

  delete db.pendingCodes[code];

  // create/replace session
  const token = crypto.randomBytes(32).toString('hex');
  db.users[token] = {
    robloxId: pending.robloxId,
    username: pending.username,
    balance: db.users[token] ? db.users[token].balance : 0,
    createdAt: Date.now()
  };
  setSessionCookie(res, token);
  persist();
  res.json({ success: true, username: pending.username, balance: db.users[token].balance });
});

app.post('/api/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) { delete db.users[token]; persist(); }
  res.setHeader('Set-Cookie', 'admsession=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

/* --- demo faucet: once per account --- */
app.post('/api/faucet', requireAuth, (req, res) => {
  if (db.faucetUsed[req.user.robloxId])
    return res.status(400).json({ error: 'Faucet already claimed.' });
  db.faucetUsed[req.user.robloxId] = true;
  req.user.balance += FAUCET_AMOUNT;
  db.users[req.user.token].balance = req.user.balance;
  persist();
  res.json({ balance: req.user.balance });
});

/* --- coinflip: create --- */
app.post('/api/coinflip', requireAuth, (req, res) => {
  const amount = Math.floor(Number(req.body.amount));
  const side = String(req.body.side || '').toUpperCase();
  if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({ error: 'Invalid amount.' });
  if (!['HEADS', 'TAILS'].includes(side)) return res.status(400).json({ error: 'Pick HEADS or TAILS.' });
  if (req.user.balance < amount) return res.status(400).json({ error: 'Not enough coins.' });

  const secret = crypto.randomBytes(32).toString('hex');
  const round = {
    id: crypto.randomBytes(4).toString('hex'),
    creator: { robloxId: req.user.robloxId, username: req.user.username, side },
    amount,
    secretHash: sha256(secret),
    secret: null,
    joiner: null,
    winner: null,
    status: 'open',
    createdAt: Date.now()
  };
  // keep secret only in memory until reveal
  round._secret = secret;

  req.user.balance -= amount;
  db.users[req.user.token].balance = req.user.balance;
  db.rounds.push(round);
  persist();
  res.json({ round: publicRound(round) });
});

app.get('/api/coinflips', (req, res) => {
  const now = Date.now();
  db.rounds = db.rounds.filter(r => r.status !== 'open' || now - r.createdAt < ROUND_TTL_MS);
  res.json({ rounds: db.rounds.filter(r => r.status === 'open').map(publicRound) });
});

/* --- coinflip: join --- */
app.post('/api/coinflip/:id/join', requireAuth, (req, res) => {
  const round = db.rounds.find(r => r.id === req.params.id);
  if (!round || round.status !== 'open') return res.status(404).json({ error: 'Round not found.' });
  if (round.creator.robloxId === req.user.robloxId) return res.status(400).json({ error: 'Cannot join your own round.' });
  if (Date.now() - round.createdAt > ROUND_TTL_MS) {
    round.status = 'expired';
    db.users[round.creator.robloxId] // refund creator
    persist();
    return res.status(404).json({ error: 'Round expired.' });
  }
  if (req.user.balance < round.amount) return res.status(400).json({ error: 'Not enough coins.' });

  const joinerSide = round.creator.side === 'HEADS' ? 'TAILS' : 'HEADS';
  round.joiner = { robloxId: req.user.robloxId, username: req.user.username, side: joinerSide };
  req.user.balance -= round.amount;
  db.users[req.user.token].balance = req.user.balance;

  // provably fair: reveal secret, derive winner from sha256(secret + joinerId + roundId)
  const secret = round._secret || crypto.randomBytes(32).toString('hex');
  round.secret = secret;
  const roll = sha256(secret + req.user.robloxId + round.id);
  const creatorWins = parseInt(roll.slice(0, 2), 16) % 2 === 0;
  const winner = creatorWins ? round.creator : round.joiner;

  const pot = round.amount * 2;
  const prize = Math.floor(pot * (1 - HOUSE_EDGE));
  const fee = pot - prize;

  // credit winner
  const winnerToken = Object.keys(db.users).find(t => db.users[t].robloxId === winner.robloxId);
  if (winnerToken) {
    db.users[winnerToken].balance += prize;
  }

  round.winner = { robloxId: winner.robloxId, username: winner.username, side: winner.side, prize, fee };
  round.status = 'finished';
  round.finishedAt = Date.now();
  db.history.push({
    id: round.id, amount: round.amount, creator: round.creator, joiner: round.joiner,
    winner: round.winner, secret: round.secret, finishedAt: round.finishedAt
  });
  persist();
  res.json({ round: publicRound(round) });
});

app.get('/api/history', requireAuth, (req, res) => {
  const mine = db.history
    .filter(h => h.creator.robloxId === req.user.robloxId || (h.joiner && h.joiner.robloxId === req.user.robloxId))
    .slice(-20).reverse();
  res.json({ history: mine });
});

function publicRound(r) {
  const { _secret, ...rest } = r;
  return rest;
}

/* ---------- boot ---------- */

loadDb();

// cleanup on shutdown
process.on('SIGINT', () => {
  persist();
  setTimeout(() => process.exit(0), 200);
});

app.listen(PORT, () => {
  console.log(`AdmDuel running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
