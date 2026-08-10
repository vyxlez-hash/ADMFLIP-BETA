"use strict";

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT) || 10000;

// IMPORTANT:
// server.js is inside /backend
// frontend is inside /public
const BACKEND_DIR = __dirname;
const PROJECT_DIR = path.resolve(BACKEND_DIR, "..");
const PUBLIC_DIR = path.join(PROJECT_DIR, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(BACKEND_DIR, "data");
const VALUES_FILE =
  process.env.VALUES_FILE || path.join(BACKEND_DIR, "values.txt");
const DB_FILE = path.join(DATA_DIR, "db.json");

const FRONTEND_ORIGINS = (
  process.env.FRONTEND_ORIGIN ||
  "https://admflip-beta.vyxlez.workers.dev,http://localhost:3000,http://localhost:5173"
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const ROBLOX_TIMEOUT_MS =
  Number(process.env.ROBLOX_TIMEOUT_MS) || 15000;

const SESSION_TTL_MS =
  Number(process.env.SESSION_TTL_MS) ||
  7 * 24 * 60 * 60 * 1000;

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString("hex");

if (!process.env.SESSION_SECRET) {
  console.warn(
    "[WARN] SESSION_SECRET is not set. Sessions will reset after restart."
  );
}

const ADMIN_KEY = process.env.ADMIN_KEY || "";

const MAX_CHAT_MESSAGES = 200;
const MAX_COINFLIPS = 100;

const ROBLOX_CACHE_TTL = 10 * 60 * 1000;
const AVATAR_CACHE_TTL = 60 * 60 * 1000;

const ROBLOX_RATE_MAX = 20;
const ROBLOX_RATE_WINDOW = 60 * 1000;

console.log("========================================");
console.log("ADMFLIP SERVER CONFIG");
console.log("Backend:", BACKEND_DIR);
console.log("Project:", PROJECT_DIR);
console.log("Public:", PUBLIC_DIR);
console.log("Values:", VALUES_FILE);
console.log("Data:", DATA_DIR);
console.log("========================================");

/* =========================================================
   APP
========================================================= */

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests without Origin such as curl/server-to-server.
      if (!origin) {
        return callback(null, true);
      }

      if (FRONTEND_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      console.warn("[CORS] Blocked origin:", origin);
      return callback(new Error("CORS blocked"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
    ],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "1mb" }));

/* =========================================================
   REQUEST LOGGER
========================================================= */

app.use((req, res, next) => {
  const started = Date.now();

  res.on("finish", () => {
    console.log(
      `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`
    );
  });

  next();
});

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value ?? "").trim();
}

function numeric(value) {
  const number = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .replace(/[^0-9.-]/g, "")
  );

  return Number.isFinite(number) ? number : 0;
}

function safeUserId(value) {
  const id = String(value ?? "").trim();

  return /^\d+$/.test(id) ? id : null;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
}

function makeId() {
  return crypto.randomUUID();
}

function petImage(name) {
  return (
    "https://amvgg.com/items/" +
    encodeURIComponent(String(name)) +
    ".webp"
  );
}

function petKey(value) {
  return String(value?.name ?? value ?? "")
    .trim()
    .toLowerCase();
}

function ownsPet(user, name) {
  return Array.isArray(user.inventory)
    ? user.inventory.some(
        (pet) => petKey(pet) === String(name).trim().toLowerCase()
      )
    : false;
}

function removePet(user, name) {
  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  const index = user.inventory.findIndex(
    (pet) => petKey(pet) === String(name).trim().toLowerCase()
  );

  if (index === -1) {
    return null;
  }

  return user.inventory.splice(index, 1)[0];
}

function addPet(user, pet) {
  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  user.inventory.push({
    name: pet.name,
    value: numeric(pet.value),
    image: pet.image || petImage(pet.name),
  });
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    robloxId: user.robloxId,
    username: user.username,
    avatar: user.avatar || "/logo.png",
    verified: Boolean(user.verified),
    balance: numeric(user.balance),
    wagered: numeric(user.wagered),
    profit: numeric(user.profit),
    coinflips: Number(user.coinflips || 0),
    wins: Number(user.wins || 0),
    inventory: Array.isArray(user.inventory)
      ? user.inventory
      : [],
  };
}

/* =========================================================
   PET VALUES
========================================================= */

function loadPets() {
  if (!fs.existsSync(VALUES_FILE)) {
    console.warn("[PETS] values.txt not found:", VALUES_FILE);
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

      // Ignore section numbers such as [1], [2], etc.
      if (/^\[\d+\]$/.test(name)) {
        continue;
      }

      let valueIndex = i + 1;

      while (
        valueIndex < lines.length &&
        /^\[\d+\]$/.test(lines[valueIndex])
      ) {
        valueIndex++;
      }

      if (valueIndex >= lines.length) {
        continue;
      }

      const rawValue = lines[valueIndex];

      if (!/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
        continue;
      }

      const value = Number(rawValue);

      if (!Number.isFinite(value)) {
        continue;
      }

      result.push({
        id: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        name,
        value,
        image: petImage(name),
      });

      i = valueIndex;
    }

    console.log(`[PETS] Loaded ${result.length} pets`);

    return result;
  } catch (error) {
    console.error("[PETS] Failed to load values.txt:", error);
    return [];
  }
}

let petsCache = {
  mtime: 0,
  pets: [],
};

function getPets() {
  try {
    const stat = fs.statSync(VALUES_FILE);

    if (stat.mtimeMs !== petsCache.mtime) {
      petsCache = {
        mtime: stat.mtimeMs,
        pets: loadPets(),
      };
    }
  } catch {
    // Keep previous cache if values.txt temporarily disappears.
  }

  return petsCache.pets;
}

/* =========================================================
   DATABASE
========================================================= */

let db = {
  users: Object.create(null),
  coinflips: [],
  chatMessages: [],
};

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      console.log("[DB] No database found. Starting fresh.");
      return;
    }

    const parsed = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    const users = Object.create(null);

    for (const [key, value] of Object.entries(parsed.users || {})) {
      if (safeUserId(key)) {
        users[key] = value;
      }
    }

    db.users = users;

    db.coinflips = Array.isArray(parsed.coinflips)
      ? parsed.coinflips
      : [];

    db.chatMessages = Array.isArray(parsed.chatMessages)
      ? parsed.chatMessages
      : [];

    console.log(
      `[DB] Loaded ${Object.keys(db.users).length} users, ` +
        `${db.coinflips.length} coinflips, ` +
        `${db.chatMessages.length} messages`
    );
  } catch (error) {
    console.error("[DB] Failed to load database:", error);

    db = {
      users: Object.create(null),
      coinflips: [],
      chatMessages: [],
    };
  }
}

function persistNow() {
  try {
    fs.mkdirSync(DATA_DIR, {
      recursive: true,
    });

    const temporaryFile = DB_FILE + ".tmp";

    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(db, null, 2),
      "utf8"
    );

    fs.renameSync(temporaryFile, DB_FILE);
  } catch (error) {
    console.error("[DB] Failed to save database:", error);
  }
}

let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    persistNow();
  }, 400);
}

function shutdown() {
  console.log("[SERVER] Saving database before shutdown...");
  persistNow();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

/* =========================================================
   RATE LIMITER
========================================================= */

const rateBuckets = new Map();

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key =
      req.ip ||
      req.socket?.remoteAddress ||
      "unknown";

    const now = Date.now();

    let bucket = rateBuckets.get(key);

    if (!bucket || now > bucket.reset) {
      bucket = {
        count: 0,
        reset: now + windowMs,
      };

      rateBuckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please wait a minute.",
      });
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();

  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.reset) {
      rateBuckets.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

/* =========================================================
   SESSIONS
========================================================= */

function issueToken(userId) {
  const issuedAt = Date.now();

  const body = `${userId}.${issuedAt}`;

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function userIdFromRequest(req) {
  const authorization =
    req.get("authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [userId, issuedAtString, signature] = parts;

  if (!/^\d+$/.test(userId)) {
    return null;
  }

  const issuedAt = Number(issuedAtString);

  if (!Number.isFinite(issuedAt)) {
    return null;
  }

  if (Date.now() - issuedAt > SESSION_TTL_MS) {
    return null;
  }

  if (issuedAt > Date.now() + 60 * 1000) {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(`${userId}.${issuedAtString}`)
    .digest("base64url");

  if (!safeEqual(signature, expected)) {
    return null;
  }

  return userId;
}

/* =========================================================
   USER HELPERS
========================================================= */

function getUser(id) {
  const safeId = safeUserId(id);

  if (!safeId) {
    return null;
  }

  return db.users[safeId] || null;
}

function createOrUpdateUser(data) {
  const id = safeUserId(
    data.id ??
      data.robloxId ??
      data.userId
  );

  if (!id) {
    return null;
  }

  let user = db.users[id];

  if (!user) {
    user = {
      id,
      robloxId: id,
      username: clean(data.username) || "User",
      avatar: clean(data.avatar) || "/logo.png",
      verified: false,
      balance: 0,
      wagered: 0,
      profit: 0,
      coinflips: 0,
      wins: 0,
      inventory: [],
    };

    db.users[id] = user;
  }

  if (data.username) {
    user.username = clean(data.username);
  }

  if (data.avatar) {
    user.avatar = clean(data.avatar);
  }

  if (data.verified === true) {
    user.verified = true;
  }

  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  user.balance = numeric(user.balance);
  user.wagered = numeric(user.wagered);
  user.profit = numeric(user.profit);

  return user;
}

/* =========================================================
   ROBLOX CACHE
========================================================= */

const robloxCache = new Map();

async function withCache(
  key,
  ttlMs,
  fetcher,
  fresh = false
) {
  if (!fresh) {
    const cached = robloxCache.get(key);

    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }
  }

  const value = await fetcher();

  robloxCache.set(key, {
    value,
    expires: Date.now() + ttlMs,
  });

  return value;
}

setInterval(() => {
  const now = Date.now();

  for (const [key, entry] of robloxCache) {
    if (entry.expires <= now) {
      robloxCache.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

/* =========================================================
   ROBLOX HTTP
========================================================= */

async function robloxFetch(url, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, ROBLOX_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ADMFLIP/3.0)",
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   ROBLOX USER SEARCH
========================================================= */

async function findRobloxUser(
  username,
  fresh = false
) {
  const cleanUsername = clean(username);

  if (!cleanUsername) {
    return null;
  }

  return withCache(
    "user:" + cleanUsername.toLowerCase(),
    ROBLOX_CACHE_TTL,
    async () => {
      const response = await robloxFetch(
        "https://users.roblox.com/v1/usernames/users",
        {
          method: "POST",
          body: JSON.stringify({
            usernames: [cleanUsername],
            excludeBannedUsers: true,
          }),
        }
      );

      const body = await response.text();

      if (!response.ok) {
        throw new Error(
          `Roblox HTTP ${response.status}: ${body.slice(
            0,
            300
          )}`
        );
      }

      let data;

      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(
          "Roblox returned invalid JSON."
        );
      }

      const users = Array.isArray(data?.data)
        ? data.data
        : [];

      return (
        users.find(
          (user) =>
            String(user.name).toLowerCase() ===
            cleanUsername.toLowerCase()
        ) ||
        users[0] ||
        null
      );
    },
    fresh
  );
}

/* =========================================================
   ROBLOX PROFILE
========================================================= */

async function findRobloxProfile(
  id,
  fresh = false
) {
  const safeId = safeUserId(id);

  if (!safeId) {
    return null;
  }

  return withCache(
    "profile:" + safeId,
    ROBLOX_CACHE_TTL,
    async () => {
      const response = await robloxFetch(
        `https://users.roblox.com/v1/users/${encodeURIComponent(
          safeId
        )}`
      );

      const body = await response.text();

      if (!response.ok) {
        throw new Error(
          `Roblox profile HTTP ${response.status}`
        );
      }

      try {
        return JSON.parse(body);
      } catch {
        throw new Error(
          "Roblox profile returned invalid JSON."
        );
      }
    },
    fresh
  );
}

/* =========================================================
   ROBLOX AVATAR
========================================================= */

async function findRobloxAvatar(id) {
  const safeId = safeUserId(id);

  if (!safeId) {
    return "";
  }

  try {
    return await withCache(
      "avatar:" + safeId,
      AVATAR_CACHE_TTL,
      async () => {
        const response = await robloxFetch(
          "https://thumbnails.roblox.com/v1/users/avatar-headshot" +
            `?userIds=${encodeURIComponent(
              safeId
            )}` +
            "&size=150x150&format=Png&isCircular=false"
        );

        if (!response.ok) {
          return "";
        }

        const body = await response.text();

        try {
          const data = JSON.parse(body);

          return (
            data?.data?.[0]?.imageUrl || ""
          );
        } catch {
          return "";
        }
      }
    );
  } catch (error) {
    console.error(
      "[ROBLOX] Avatar error:",
      error.message
    );

    return "";
  }
}

/* =========================================================
   HEALTH
========================================================= */

app
$$
