"use strict";

/* =========================================================
   ADMFLIP BACKEND — v2.1
   - Fresh (uncached) Roblox bio reads during verification
   - Env-based CORS allowlist
   - JSON-file persistence (survives restarts AND redeploys)
   - Roblox response caching + per-IP rate limiting
   - Optional static frontend serving (backend/public)
========================================================= */

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

/* ---------------------------------------------------------
   CONFIG
--------------------------------------------------------- */

const PORT = Number(process.env.PORT) || 10000;

const FRONTEND_ORIGIN = (
  process.env.FRONTEND_ORIGIN ||
  "https://admflip-beta.vyxlez.workers.dev"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const VALUES_FILE =
  process.env.VALUES_FILE ||
  path.join(__dirname, "values.txt");

const DATA_DIR =
  process.env.DATA_DIR ||
  path.join(__dirname, "data");

const DB_FILE = path.join(DATA_DIR, "db.json");

const PUBLIC_DIR =
  process.env.PUBLIC_DIR ||
  path.join(__dirname, "public");

const ROBLOX_TIMEOUT_MS =
  Number(process.env.ROBLOX_TIMEOUT_MS) || 10000;

const MAX_CHAT_MESSAGES = 200;
const MAX_COINFLIPS = 100;
const ROBLOX_CACHE_TTL = 10 * 60 * 1000;   // 10 min
const AVATAR_CACHE_TTL = 60 * 60 * 1000;   // 1 hour
const ROBLOX_RATE_MAX = 20;                // per IP per minute
const ROBLOX_RATE_WINDOW = 60 * 1000;

/* ---------------------------------------------------------
   MIDDLEWARE
--------------------------------------------------------- */

app.use(
  cors({
    // Pass the ARRAY directly. cors echoes back the exact
    // matching origin, which works with credentials: true.
    origin: FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization"
    ],
    maxAge: 86400
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* request log */
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`
    );
  });
  next();
});

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */

function clean(value) {
  return String(value ?? "").trim();
}

function numeric(value) {
  const n = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .replace(/[^0-9.-]/g, "")
  );
  return Number.isFinite(n) ? n : 0;
}

function makeId() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

function petImage(name) {
  return (
    "https://amvgg.com/items/" +
    encodeURIComponent(String(name)) +
    ".webp"
  );
}

/* ---------------------------------------------------------
   PET VALUES (values.txt)
--------------------------------------------------------- */

function loadPets() {
  if (!fs.existsSync(VALUES_FILE)) {
    console.error("values.txt not found:", VALUES_FILE);
    return [];
  }

  try {
    const text = fs.readFileSync(VALUES_FILE, "utf8");
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const name = lines[i];

      if (/^\[\d+\]$/.test(name)) continue;

      let valueIndex = i + 1;
      while (
        valueIndex < lines.length &&
        /^\[\d+\]$/.test(lines[valueIndex])
      ) {
        valueIndex++;
      }

      if (valueIndex >= lines.length) continue;

      const rawValue = lines[valueIndex];
      if (!/^-?\d+(?:\.\d+)?$/.test(rawValue)) continue;

      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;

      result.push({
        id: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        name,
        value,
        image: petImage(name)
      });

      i = valueIndex;
    }

    console.log(`Loaded ${result.length} pets from values.txt`);
    return result;
  } catch (error) {
    console.error("Could not read values.txt:", error);
    return [];
  }
}

/* reload only when the file actually changed */
let petsCache = { mtime: 0, pets: [] };

function getPets() {
  try {
    const stat = fs.statSync(VALUES_FILE);
    if (stat.mtimeMs !== petsCache.mtime) {
      petsCache = { mtime: stat.mtimeMs, pets: loadPets() };
    }
  } catch {
    /* keep last good cache */
  }
  return petsCache.pets;
}

/* ---------------------------------------------------------
   PERSISTENCE (JSON file, atomic writes)
--------------------------------------------------------- */

let db = {
  users: {},
  coinflips: [],
  chatMessages: []
};

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    db.users = parsed && typeof parsed.users === "object" ? parsed.users : {};
    db.coinflips = Array.isArray(parsed.coinflips) ? parsed.coinflips : [];
    db.chatMessages = Array.isArray(parsed.chatMessages)
      ? parsed.chatMessages
      : [];
    console.log(
      `Loaded db (${Object.keys(db.users).length} users, ` +
        `${db.coinflips.length} coinflips, ${db.chatMessages.length} chat msgs)`
    );
  } catch (error) {
    console.error("Could not load db, starting fresh:", error);
  }
}

function persistNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (error) {
    console.error("Could not save db:", error);
  }
}

let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 400);
}

function shutdown() {
  console.log("Shutting down, saving db...");
  persistNow();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

/* ---------------------------------------------------------
   RATE LIMITER (per IP)
--------------------------------------------------------- */

const rateBuckets = new Map();

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      rateBuckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please wait a minute and try again."
      });
    }

    next();
  };
}

/* clear stale buckets every 10 minutes */
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.reset) rateBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

/* ---------------------------------------------------------
   USER HELPERS
--------------------------------------------------------- */

function getUser(id) {
  return db.users[String(id)] || null;
}

function createOrUpdateUser(data) {
  const id = String(
    data.id ?? data.robloxId ?? data.userId ?? ""
  ).trim();

  if (!id) return null;

  let user = db.users[id];

  if (!user) {
    user = {
      id,
      robloxId: id,
      username: clean(data.username) || "User",
      avatar: clean(data.avatar),
      verified: Boolean(data.verified),
      balance: 0,
      wagered: 0,
      profit: 0,
      coinflips: 0,
      wins: 0,
      inventory: []
    };
    db.users[id] = user;
  }

  if (data.username) user.username = clean(data.username);
  if (data.avatar) user.avatar = clean(data.avatar);
  if (data.verified !== undefined) {
    user.verified = Boolean(data.verified);
  }

  return user;
}

/* ---------------------------------------------------------
   ROBLOX (cached + timed out, with fresh bypass)
--------------------------------------------------------- */

const robloxCache = new Map();

async function withCache(key, ttlMs, fetcher, fresh = false) {
  if (!fresh) {
    const hit = robloxCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
  }

  const value = await fetcher();
  robloxCache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

async function robloxFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ROBLOX_TIMEOUT_MS
  );

  try {
    return await fetch(url, {
      ...options,
      headers: {
        "User-Agent": "ADMFLIP/1.0",
        Accept: "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function findRobloxUser(username, fresh = false) {
  const cleanUsername = clean(username);
  if (!cleanUsername) return null;

  return withCache(
    "user:" + cleanUsername.toLowerCase(),
    ROBLOX_CACHE_TTL,
    async () => {
      const response = await robloxFetch(
        "https://users.roblox.com/v1/usernames/users",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usernames: [cleanUsername],
            excludeBannedUsers: true
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Roblox returned ${response.status}`);
      }

      const data = await response.json();
      const found = Array.isArray(data?.data) ? data.data : [];

      return (
        found.find(
          (user) =>
            String(user.name).toLowerCase() ===
            cleanUsername.toLowerCase()
        ) ||
        found[0] ||
        null
      );
    },
    fresh
  );
}

async function findRobloxProfile(id, fresh = false) {
  return withCache(
    "profile:" + String(id),
    ROBLOX_CACHE_TTL,
    async () => {
      const response = await robloxFetch(
        "https://users.roblox.com/v1/users/" +
          encodeURIComponent(String(id))
      );
      if (!response.ok) {
        throw new Error(`Roblox profile returned ${response.status}`);
      }
      return response.json();
    },
    fresh
  );
}

async function findRobloxAvatar(id) {
  try {
    return await withCache(
      "avatar:" + String(id),
      AVATAR_CACHE_TTL,
      async () => {
        const response = await robloxFetch(
          "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
            encodeURIComponent(String(id)) +
            "&size=150x150&format=Png&isCircular=false"
        );
        if (!response.ok) return "";
        const data = await response.json();
        return data?.data?.[0]?.imageUrl || "";
      }
    );
  } catch {
    return "";
  }
}

/* ---------------------------------------------------------
   HEALTH / DEBUG
--------------------------------------------------------- */

app.get("/health", (req, res) => {
  res.json({
    success: true,
    server: "online",
    version: "2.1.0",
    pets: getPets().length,
    valuesFile: VALUES_FILE,
    dataFile: DB_FILE,
    cors: FRONTEND_ORIGIN
  });
});

app.get("/debug-values", (req, res) => {
  const loaded = getPets();
  res.json({
    success: true,
    count: loaded.length,
    valuesFile: VALUES_FILE,
    firstPets: loaded.slice(0, 10)
  });
});

/* ---------------------------------------------------------
   PETS
--------------------------------------------------------- */

app.get("/pets", (req, res) => {
  try {
    const loaded = getPets();
    res.set("Cache-Control", "no-store");
    res.json({ success: true, pets: loaded });
  } catch (error) {
    console.error("GET /pets:", error);
    res.status(500).json({
      success: false,
      pets: [],
      error: "Unable to load pet values."
    });
  }
});

app.get("/api/pets", (req, res) => {
  res.json({ success: true, pets: getPets() });
});

app.get("/pets/:name", (req, res) => {
  const requested = decodeURIComponent(req.params.name)
    .trim()
    .toLowerCase();

  const pet = getPets().find(
    (item) => item.name.trim().toLowerCase() === requested
  );

  if (!pet) {
    return res.status(404).json({
      success: false,
      error: "Pet not found."
    });
  }

  res.json({ success: true, pet });
});

/* ---------------------------------------------------------
   ROBLOX USER SEARCH
--------------------------------------------------------- */

async function userLookup(req, res) {
  try {
    const username = clean(req.params.username);
    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username required."
      });
    }

    const robloxUser = await findRobloxUser(username);
    if (!robloxUser) {
      return res.status(404).json({
        success: false,
        message: "Roblox username not found."
      });
    }

    const avatar = await findRobloxAvatar(robloxUser.id);

    createOrUpdateUser({
      id: robloxUser.id,
      username: robloxUser.name,
      avatar
    });

    res.json({
      success: true,
      user: {
        id: robloxUser.id,
        username: robloxUser.name,
        displayName: robloxUser.displayName || robloxUser.name,
        avatar
      }
    });
  } catch (error) {
    console.error("Roblox lookup:", error);
    res.status(502).json({
      success: false,
      message: "The server could not reach Roblox right now."
    });
  }
}

app.get(
  "/user/:username",
  rateLimit(ROBLOX_RATE_MAX, ROBLOX_RATE_WINDOW),
  userLookup
);

app.get(
  "/api/user/:username",
  rateLimit(ROBLOX_RATE_MAX, ROBLOX_RATE_WINDOW),
  userLookup
);

/* ---------------------------------------------------------
   VERIFICATION
--------------------------------------------------------- */

function generatePhrase() {
  const words = [
    "silver", "tiger", "nova", "pixel", "shadow", "comet",
    "ember", "frost", "orbit", "rocket", "storm", "velvet",
    "lunar", "cobalt", "sunset", "raven", "blaze"
  ];

  const first = words[Math.floor(Math.random() * words.length)];
  const second = words[Math.floor(Math.random() * words.length)];
  const number = Math.floor(1000 + Math.random() * 9000);

  return "ADMFLIP-" + first + "-" + second + "-" + number;
}

app.get("/create", (req, res) => {
  res.json({ success: true, phrase: generatePhrase() });
});

app.get("/api/create", (req, res) => {
  res.json({ success: true, phrase: generatePhrase() });
});

async function verifyRobloxBio(req, res) {
  try {
    const username = clean(req.body?.username);
    const phrase = clean(req.body?.phrase);

    if (!username || !phrase) {
      return res.status(400).json({
        success: false,
        message: "Username and phrase are required."
      });
    }

    // fresh=true -> ALWAYS hit Roblox, never serve a 10-min-old cached bio
    const robloxUser = await findRobloxUser(username, true);
    if (!robloxUser) {
      return res.status(404).json({
        success: false,
        message: "Roblox username not found."
      });
    }

    const profile = await findRobloxProfile(robloxUser.id, true);
    const description = clean(profile?.description);

    // Log what Roblox actually returned, so you can debug in Deploy Logs
    console.log(
      `Verification check for ${robloxUser.name}: ` +
        `bio length ${description.length} | ` +
        JSON.stringify(description.slice(0, 120))
    );

    if (!description.toLowerCase().includes(phrase.toLowerCase())) {
      return res.json({
        success: false,
        message:
          "Verification phrase was not found in your Roblox About/Bio. Add it exactly, save your profile, then try again."
      });
    }

    const avatar = await findRobloxAvatar(robloxUser.id);

    const user = createOrUpdateUser({
      id: robloxUser.id,
      username: profile.name || robloxUser.name,
      avatar,
      verified: true
    });

    scheduleSave();

    res.json({
      success: true,
      id: robloxUser.id,
      userId: robloxUser.id,
      username: profile.name || robloxUser.name,
      avatar,
      user
    });
  } catch (error) {
    console.error("Bio verification:", error);
    res.status(502).json({
      success: false,
      message: "The server could not check Roblox right now."
    });
  }
}

app.post(
  "/check",
  rateLimit(ROBLOX_RATE_MAX, ROBLOX_RATE_WINDOW),
  verifyRobloxBio
);

app.post(
  "/api/check",
  rateLimit(ROBLOX_RATE_MAX, ROBLOX_RATE_WINDOW),
  verifyRobloxBio
);

/* ---------------------------------------------------------
   ACCOUNT
--------------------------------------------------------- */

async function accountHandler(req, res) {
  try {
    const id = clean(req.params.robloxId);

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Roblox ID."
      });
    }

    let user = getUser(id);

    if (!user) {
      const profile = await findRobloxProfile(id);
      const avatar = await findRobloxAvatar(id);

      user = createOrUpdateUser({
        id,
        username: profile?.name || "User",
        avatar
      });

      scheduleSave();
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        robloxId: user.robloxId,
        username: user.username,
        avatar: user.avatar,
        balance: user.balance || 0,
        wagered: user.wagered || 0,
        profit: user.profit || 0,
        coinflips: user.coinflips || 0,
        wins: user.wins || 0,
        inventory: Array.isArray(user.inventory) ? user.inventory : []
      }
    });
  } catch (error) {
    console.error("Account:", error);
    res.status(404).json({
      success: false,
      message: "Account could not be loaded."
    });
  }
}

app.get(
  "/account/:robloxId",
  rateLimit(60, 60000),
  accountHandler
);

app.get(
  "/api/account/:robloxId",
  rateLimit(60, 60000),
  accountHandler
);

/* ---------------------------------------------------------
   CHAT
--------------------------------------------------------- */

function hasLink(text) {
  return /(?:https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/)/i.test(
    text
  );
}

app.get("/chat/messages", (req, res) => {
  res.json({ success: true, messages: db.chatMessages.slice(-100) });
});

app.get("/api/chat/messages", (req, res) => {
  res.json({ success: true, messages: db.chatMessages.slice(-100) });
});

function createChatMessage(req, res) {
  const robloxId = clean(req.body?.robloxId || req.body?.userId);
  const username = clean(req.body?.username);
  const avatar = clean(req.body?.avatar);
  const message = clean(req.body?.message);

  if (!robloxId || !username) {
    return res.status(401).json({
      success: false,
      message: "Sign in to chat."
    });
  }

  if (!message) {
    return res.status(400).json({
      success: false,
      message: "Message is empty."
    });
  }

  if (message.length > 250) {
    return res.status(400).json({
      success: false,
      message: "Message is too long."
    });
  }

  if (hasLink(message)) {
    return res.status(400).json({
      success: false,
      message: "Links are not allowed in chat."
    });
  }

  const chatMessage = {
    id: makeId(),
    username,
    robloxId,
    avatar: avatar || "/logo.png",
    message,
    type: "message",
    pinned: false,
    createdAt: Date.now()
  };

  db.chatMessages.push(chatMessage);

  if (db.chatMessages.length > MAX_CHAT_MESSAGES) {
    db.chatMessages.shift();
  }

  scheduleSave();

  res.json({ success: true, message: chatMessage });
}

app.post("/chat/messages", createChatMessage);
app.post("/api/chat/messages", createChatMessage);

function getOnlineCount() {
  const cutoff = Date.now() - 5 * 60 * 1000;

  const online = new Set(
    db.chatMessages
      .filter((message) => Number(message.createdAt) >= cutoff)
      .map((message) => message.robloxId || message.username)
  );

  return online.size;
}

app.get("/chat/online", (req, res) => {
  const online = getOnlineCount();
  res.json({ success: true, online, count: online, onlineCount: online });
});

app.get("/api/chat/online", (req, res) => {
  const online = getOnlineCount();
  res.json({ success: true, online, count: online, onlineCount: online });
});

/* ---------------------------------------------------------
   COINFLIPS
--------------------------------------------------------- */

app.get("/coinflips", (req, res) => {
  const active = db.coinflips.filter((flip) => flip.status === "active");
  const totalValue = active.reduce(
    (sum, flip) => sum + numeric(flip.petValue),
    0
  );

  res.json({
    success: true,
    coinflips: active,
    total: active.length,
    totalValue
  });
});

app.get("/api/coinflips", (req, res) => {
  const active = db.coinflips.filter((flip) => flip.status === "active");
  res.json({ success: true, coinflips: active });
});

function createCoinflip(req, res) {
  const username = clean(req.body?.username);
  const userId = clean(req.body?.userId || req.body?.robloxId);

  if (!username || !userId) {
    return res.status(401).json({
      success: false,
      message: "Verify your Roblox account first."
    });
  }

  const side = clean(req.body?.side).toLowerCase();
  if (side !== "heads" && side !== "tails") {
    return res.status(400).json({
      success: false,
      message: "Choose heads or tails."
    });
  }

  const inputPet = req.body?.pet || {};
  const name = clean(inputPet.name || req.body?.petName);

  if (!name) {
    return res.status(400).json({
      success: false,
      message: "Select a pet."
    });
  }

  const serverPet = getPets().find(
    (pet) => pet.name.toLowerCase() === name.toLowerCase()
  );

  if (!serverPet) {
    return res.status(400).json({
      success: false,
      message: "That pet is not in the current value list."
    });
  }

  const user = createOrUpdateUser({
    id: userId,
    username,
    avatar: clean(req.body?.avatar),
    verified: true
  });

  user.wagered += serverPet.value;
  user.coinflips += 1;

  const flip = {
    id: makeId(),
    username: user.username,
    userId: user.id,
    robloxId: user.id,
    avatar: user.avatar || "/logo.png",
    petName: serverPet.name,
    petValue: serverPet.value,
    value: serverPet.value,
    image: serverPet.image,
    side,
    status: "active",
    createdAt: Date.now()
  };

  db.coinflips.unshift(flip);

  if (db.coinflips.length > MAX_COINFLIPS) {
    db.coinflips.pop();
  }

  scheduleSave();

  res.status(201).json({ success: true, coinflip: flip });
}

app.post("/coinflips", createCoinflip);
app.post("/api/coinflips", createCoinflip);

/* ---------------------------------------------------------
   LEADERBOARD
--------------------------------------------------------- */

function leaderboardHandler(req, res) {
  const leaderboard = Object.values(db.users)
    .sort((a, b) => numeric(b.wagered) - numeric(a.wagered))
    .slice(0, 10)
    .map((user, index) => ({
      place: index + 1,
      username: user.username,
      avatar: user.avatar || "/logo.png",
      wagered: user.wagered || 0,
      profit: user.profit || 0
    }));

  res.json({ success: true, users: leaderboard });
}

app.get("/leaderboard", leaderboardHandler);
app.get("/api/leaderboard", leaderboardHandler);

/* ---------------------------------------------------------
   STATUS
--------------------------------------------------------- */

function statusHandler(req, res) {
  const active = db.coinflips.filter((flip) => flip.status === "active");

  res.json({
    success: true,
    online: true,
    announcement: "",
    activeCoinflips: active.length,
    totalCoinflipValue: active.reduce(
      (sum, flip) => sum + numeric(flip.petValue),
      0
    )
  });
}

app.get("/status", statusHandler);
app.get("/api/status", statusHandler);

/* ---------------------------------------------------------
   API INDEX
--------------------------------------------------------- */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "ADMFLIP API",
    version: "2.1.0",
    cors: FRONTEND_ORIGIN,
    endpoints: [
      "GET  /health",
      "GET  /pets",
      "GET  /pets/:name",
      "GET  /user/:username",
      "GET  /create",
      "POST /check",
      "GET  /account/:robloxId",
      "GET  /coinflips",
      "POST /coinflips",
      "GET  /chat/messages",
      "POST /chat/messages",
      "GET  /chat/online",
      "GET  /leaderboard",
      "GET  /status"
    ]
  });
});

/* ---------------------------------------------------------
   STATIC FRONTEND (optional — only if backend/public exists)
--------------------------------------------------------- */

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: "1h" }));
}

app.get("/", (req, res) => {
  const index = path.join(PUBLIC_DIR, "index.html");
  if (fs.existsSync(index)) {
    return res.sendFile(index);
  }
  res.json({
    success: true,
    server: "online",
    message: "ADMFLIP API — frontend is hosted separately."
  });
});

/* ---------------------------------------------------------
   API 404
--------------------------------------------------------- */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "API route not found.",
    path: req.path
  });
});

/* ---------------------------------------------------------
   ERROR HANDLER
--------------------------------------------------------- */

app.use((error, req, res, next) => {
  console.error("ADMFLIP SERVER ERROR:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({
    success: false,
    message: "Internal server error."
  });
});

/* ---------------------------------------------------------
   START
--------------------------------------------------------- */

loadDb();

if (!db.chatMessages.some((m) => m.id === "welcome")) {
  db.chatMessages.unshift({
    id: "welcome",
    username: "ADMFLIP",
    robloxId: null,
    avatar: "/logo.png",
    message: "Welcome to ADMFLIP.",
    type: "announcement",
    pinned: true,
    createdAt: Date.now()
  });
}

persistNow(); // ensure data dir exists on first boot

app.listen(PORT, "0.0.0.0", () => {
  console.log("========================================");
  console.log("ADMFLIP backend v2.1 started");
  console.log("Port:", PORT);
  console.log("Values:", VALUES_FILE);
  console.log("Pets loaded:", getPets().length);
  console.log("CORS origins:", FRONTEND_ORIGIN.join(", "));
  console.log("Data file:", DB_FILE);
  console.log(
    "Public dir:",
    PUBLIC_DIR,
    fs.existsSync(PUBLIC_DIR) ? "(served)" : "(not present)"
  );
  console.log("========================================");
});
