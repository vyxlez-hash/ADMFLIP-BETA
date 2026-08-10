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

app.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    success: true,
    server: "online",
    version: "3.0.0-fixed",
    pets: getPets().length,
    publicDir: PUBLIC_DIR,
    publicExists: fs.existsSync(PUBLIC_DIR),
    indexExists: fs.existsSync(
      path.join(PUBLIC_DIR, "index.html")
    ),
  });
});

/* =========================================================
   API INFO
========================================================= */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "ADMFLIP API",
    version: "3.0.0-fixed",
    frontend: true,
    publicDir: PUBLIC_DIR,
  });
});

/* =========================================================
   PETS
========================================================= */

app.get("/pets", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    success: true,
    pets: getPets(),
  });
});

app.get("/api/pets", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    success: true,
    pets: getPets(),
  });
});

app.get("/pets/:name", (req, res) => {
  const requested = clean(
    req.params.name
  ).toLowerCase();

  const pet = getPets().find(
    (item) =>
      item.name.trim().toLowerCase() === requested
  );

  if (!pet) {
    return res.status(404).json({
      success: false,
      error: "Pet not found.",
    });
  }

  res.json({
    success: true,
    pet,
  });
});

/* =========================================================
   USER LOOKUP
========================================================= */

async function userLookup(req, res) {
  const username = clean(
    req.params.username
  );

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username required.",
    });
  }

  try {
    const robloxUser =
      await findRobloxUser(username, true);

    if (!robloxUser) {
      return res.status(404).json({
        success: false,
        message: "Roblox username not found.",
      });
    }

    const avatar =
      await findRobloxAvatar(robloxUser.id);

    createOrUpdateUser({
      id: robloxUser.id,
      username: robloxUser.name,
      avatar,
    });

    scheduleSave();

    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      user: {
        id: robloxUser.id,
        username: robloxUser.name,
        displayName:
          robloxUser.displayName ||
          robloxUser.name,
        avatar,
      },
    });
  } catch (error) {
    console.error(
      "[ROBLOX LOOKUP]",
      error
    );

    res.status(502).json({
      success: false,
      message: "Roblox lookup failed.",
    });
  }
}

app.get(
  "/user/:username",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  userLookup
);

app.get(
  "/api/user/:username",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  userLookup
);

/* =========================================================
   VERIFICATION
========================================================= */

function generatePhrase() {
  const words = [
    "silver",
    "tiger",
    "nova",
    "pixel",
    "shadow",
    "comet",
    "ember",
    "frost",
    "orbit",
    "rocket",
    "storm",
    "velvet",
    "lunar",
    "cobalt",
    "sunset",
    "raven",
    "blaze",
  ];

  const first =
    words[crypto.randomInt(words.length)];

  const second =
    words[crypto.randomInt(words.length)];

  const number =
    crypto.randomInt(1000, 10000);

  return `ADMFLIP-${first}-${second}-${number}`;
}

app.get("/create", (req, res) => {
  res.json({
    success: true,
    phrase: generatePhrase(),
  });
});

app.get("/api/create", (req, res) => {
  res.json({
    success: true,
    phrase: generatePhrase(),
  });
});

async function verifyRobloxBio(req, res) {
  try {
    const username = clean(
      req.body?.username
    );

    const phrase = clean(
      req.body?.phrase
    );

    if (!username || !phrase) {
      return res.status(400).json({
        success: false,
        message:
          "Username and phrase are required.",
      });
    }

    const robloxUser =
      await findRobloxUser(username, true);

    if (!robloxUser) {
      return res.status(404).json({
        success: false,
        message:
          "Roblox username not found.",
      });
    }

    const profile =
      await findRobloxProfile(
        robloxUser.id,
        true
      );

    const description = clean(
      profile?.description
    );

    if (
      !description
        .toLowerCase()
        .includes(phrase.toLowerCase())
    ) {
      return res.json({
        success: false,
        message:
          "Verification phrase was not found in your Roblox About/Bio.",
      });
    }

    const avatar =
      await findRobloxAvatar(
        robloxUser.id
      );

    const user =
      createOrUpdateUser({
        id: robloxUser.id,
        username:
          profile?.name ||
          robloxUser.name,
        avatar,
        verified: true,
      });

    scheduleSave();

    const token =
      issueToken(robloxUser.id);

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success: true,
      token,
      id: robloxUser.id,
      userId: robloxUser.id,
      username:
        profile?.name ||
        robloxUser.name,
      avatar,
      user: publicUser(user),
    });
  } catch (error) {
    console.error(
      "[VERIFICATION]",
      error
    );

    res.status(502).json({
      success: false,
      message:
        "Roblox bio check failed.",
    });
  }
}

app.post(
  "/check",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  verifyRobloxBio
);

app.post(
  "/api/check",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  verifyRobloxBio
);

/* =========================================================
   ACCOUNT
========================================================= */

function authenticatedUser(req) {
  const id = userIdFromRequest(req);

  if (!id) {
    return null;
  }

  return getUser(id);
}

app.get("/account", (req, res) => {
  const user = authenticatedUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Not authenticated.",
    });
  }

  res.set("Cache-Control", "no-store");

  res.json({
    success: true,
    user: publicUser(user),
  });
});

app.get("/api/account", (req, res) => {
  const user = authenticatedUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Not authenticated.",
    });
  }

  res.set("Cache-Control", "no-store");

  res.json({
    success: true,
    user: publicUser(user),
  });
});

async function accountById(req, res) {
  const id = safeUserId(
    req.params.robloxId
  );

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid Roblox ID.",
    });
  }

  try {
    let user = getUser(id);

    if (!user) {
      const profile =
        await findRobloxProfile(id);

      const avatar =
        await findRobloxAvatar(id);

      user =
        createOrUpdateUser({
          id,
          username:
            profile?.name || "User",
          avatar,
        });

      scheduleSave();
    }

    res.json({
      success: true,
      user: publicUser(user),
    });
  } catch (error) {
    console.error(
      "[ACCOUNT]",
      error
    );

    res.status(404).json({
      success: false,
      message:
        "Account could not be loaded.",
    });
  }
}

app.get(
  "/account/:robloxId",
  accountById
);

app.get(
  "/api/account/:robloxId",
  accountById
);

app.post("/logout", (req, res) => {
  res.json({
    success: true,
  });
});

app.post("/api/logout", (req, res) => {
  res.json({
    success: true,
  });
});

/* =========================================================
   CHAT
========================================================= */

function hasLink(text) {
  return /(?:https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/)/i.test(
    text
  );
}

app.get("/chat/messages", (req, res) => {
  res.json({
    success: true,
    messages:
      db.chatMessages.slice(-100),
  });
});

app.get("/api/chat/messages", (req, res) => {
  res.json({
    success: true,
    messages:
      db.chatMessages.slice(-100),
  });
});

function createChatMessage(req, res) {
  const userId =
    userIdFromRequest(req);

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Sign in to chat.",
    });
  }

  const user = getUser(userId);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Sign in to chat.",
    });
  }

  let message = clean(
    req.body?.message
  ).replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    ""
  );

  if (!message) {
    return res.status(400).json({
      success: false,
      message: "Message is empty.",
    });
  }

  if (message.length > 250) {
    return res.status(400).json({
      success: false,
      message: "Message is too long.",
    });
  }

  if (hasLink(message)) {
    return res.status(400).json({
      success: false,
      message:
        "Links are not allowed in chat.",
    });
  }

  const chatMessage = {
    id: makeId(),
    username: user.username,
    robloxId: user.id,
    avatar:
      user.avatar || "/logo.png",
    message,
    type: "message",
    pinned: false,
    createdAt: Date.now(),
  };

  db.chatMessages.push(
    chatMessage
  );

  if (
    db.chatMessages.length >
    MAX_CHAT_MESSAGES
  ) {
    db.chatMessages.shift();
  }

  scheduleSave();

  res.json({
    success: true,
    message: chatMessage,
  });
}

app.post(
  "/chat/messages",
  rateLimit(10, 60000),
  createChatMessage
);

app.post(
  "/api/chat/messages",
  rateLimit(10, 60000),
  createChatMessage
);

function getOnlineCount() {
  const cutoff =
    Date.now() - 5 * 60 * 1000;

  const online = new Set(
    db.chatMessages
      .filter(
        (message) =>
          message.type !==
            "announcement" &&
          Number(message.createdAt) >=
            cutoff
      )
      .map(
        (message) =>
          message.robloxId ||
          message.username
      )
  );

  return online.size;
}

app.get("/chat/online", (req, res) => {
  const online =
    getOnlineCount();

  res.json({
    success: true,
    online,
    count: online,
    onlineCount: online,
  });
});

app.get(
  "/api/chat/online",
  (req, res) => {
    const online =
      getOnlineCount();

    res.json({
      success: true,
      online,
      count: online,
      onlineCount: online,
    });
  }
);

/* =========================================================
   COINFLIPS
========================================================= */

app.get("/coinflips", (req, res) => {
  const active =
    db.coinflips.filter(
      (flip) =>
        flip.status === "active"
    );

  const totalValue =
    active.reduce(
      (sum, flip) =>
        sum + numeric(
          flip.petValue
        ),
      0
    );

  res.set(
    "Cache-Control",
    "no-store"
  );

  res.json({
    success: true,
    coinflips: active,
    total: active.length,
    totalValue,
  });
});

app.get("/api/coinflips", (req, res) => {
  const active =
    db.coinflips.filter(
      (flip) =>
        flip.status === "active"
    );

  res.set(
    "Cache-Control",
    "no-store"
  );

  res.json({
    success: true,
    coinflips: active,
  });
});

function findServerPet(name) {
  const target = String(name)
    .trim()
    .toLowerCase();

  return getPets().find(
    (pet) =>
      pet.name.trim().toLowerCase() ===
      target
  );
}

function createCoinflip(req, res) {
  const userId =
    userIdFromRequest(req);

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Sign in first.",
    });
  }

  const user = getUser(userId);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Sign in first.",
    });
  }

  if (!user.verified) {
    return res.status(403).json({
      success: false,
      message:
        "Verify your Roblox account first.",
    });
  }

  const side = clean(
    req.body?.side
  ).toLowerCase();

  if (
    side !== "heads" &&
    side !== "tails"
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Choose heads or tails.",
    });
  }

  const name = clean(
    req.body?.pet?.name ??
      req.body?.petName
  );

  if (!name) {
    return res.status(400).json({
      success: false,
      message: "Select a pet.",
    });
  }

  const serverPet =
    findServerPet(name);

  if (!serverPet) {
    return res.status(400).json({
      success: false,
      message:
        "That pet is not in the current value list.",
    });
  }

  if (
    !ownsPet(
      user,
      serverPet.name
    )
  ) {
    return res.status(403).json({
      success: false,
      message:
        "You don't own this pet.",
    });
  }

  removePet(
    user,
    serverPet.name
  );

  user.wagered =
    numeric(user.wagered) +
    serverPet.value;

  user.coinflips =
    Number(user.coinflips || 0) +
    1;

  const flip = {
    id: makeId(),
    username: user.username,
    userId: user.id,
    robloxId: user.id,
    avatar:
      user.avatar || "/logo.png",
    petName: serverPet.name,
    petValue: serverPet.value,
    value: serverPet.value,
    image: serverPet.image,
    side,
    status: "active",
    createdAt: Date.now(),
    acceptedBy: null,
    challengerPetName: null,
    challengerPetValue: null,
    toss: null,
    winnerUserId: null,
    loserUserId: null,
    resolvedAt: null,
    cancelledAt: null,
  };

  db.coinflips.unshift(
    flip
  );

  if (
    db.coinflips.length >
    MAX_COINFLIPS
  ) {
    db.coinflips.pop();
  }

  scheduleSave();

  res.status(201).json({
    success: true,
    coinflip: flip,
  });
}

app.post(
  "/coinflips",
  rateLimit(10, 60000),
  createCoinflip
);

app.post(
  "/api/coinflips",
  rateLimit(10, 60000),
  createCoinflip
);

function acceptCoinflip(req, res) {
  const userId =
    userIdFromRequest(req);

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Sign in first.",
    });
  }

  const challenger =
    getUser(userId);

  if (!challenger) {
    return res.status(401).json({
      success: false,
      message: "Sign in first.",
    });
  }

  if (!challenger.verified) {
    return res.status(403).json({
      success: false,
      message:
        "Verify your Roblox account first.",
    });
  }

  const flip =
    db.coinflips.find(
      (item) =>
        item.id ===
          clean(req.params.id) &&
        item.status === "active"
    );

  if (!flip) {
    return res.status(404).json({
      success: false,
      message: "Coinflip not found.",
    });
  }

  if (
    flip.userId === userId
  ) {
    return res.status(400).json({
      success: false,
      message:
        "You can't accept your own flip.",
    });
  }

  const name = clean(
    req.body?.pet?.name ??
      req.body?.petName
  );

  if (!name) {
    return res.status(400).json({
      success: false,
      message: "Select a pet.",
    });
  }

  const serverPet =
    findServerPet(name);

  if (!serverPet) {
    return res.status(400).json({
      success: false,
      message:
        "That pet is not in the current value list.",
    });
  }

  if (
    !ownsPet(
      challenger,
      serverPet.name
    )
  ) {
    return res.status(403).json({
      success: false,
      message:
        "You don't own this pet.",
    });
  }

  const creator =
    getUser(flip.userId);

  if (!creator) {
    return res.status(409).json({
      success: false,
      message:
        "Coinflip creator no longer exists.",
    });
  }

  removePet(
    challenger,
    serverPet.name
  );

  const creatorValue =
    numeric(flip.petValue);

  const challengerValue =
    numeric(serverPet.value);

  challenger.wagered =
    numeric(
      challenger.wagered
    ) + challengerValue;

  challenger.coinflips =
    Number(
      challenger.coinflips || 0
    ) + 1;

  const toss =
    crypto.randomInt(2) === 0
      ? "heads"
      : "tails";

  const creatorWins =
    toss === flip.side;

  const winner =
    creatorWins
      ? creator
      : challenger;

  const loser =
    creatorWins
      ? challenger
      : creator;

  const opponentValue =
    creatorWins
      ? challengerValue
      : creatorValue;

  addPet(winner, {
    name: flip.petName,
    value: creatorValue,
    image: flip.image,
  });

  addPet(winner, {
    name: serverPet.name,
    value: challengerValue,
    image: serverPet.image,
  });

  winner.wins =
    Number(winner.wins || 0) +
    1;

  winner.profit =
    numeric(winner.profit) +
    opponentValue;

  loser.profit =
    numeric(loser.profit) -
    opponentValue;

  flip.status = "completed";
  flip.acceptedBy = challenger.id;
  flip.challengerPetName =
    serverPet.name;
  flip.challengerPetValue =
    challengerValue;
  flip.toss = toss;
  flip.winnerUserId =
    winner.id;
  flip.loserUserId =
    loser.id;
  flip.resolvedAt =
    Date.now();

  scheduleSave();

  res.json({
    success: true,
    toss,
    winner: {
      id: winner.id,
      username: winner.username,
    },
    flip,
  });
}

app.post(
  "/coinflips/:id/accept",
  rateLimit(30, 60000),
  acceptCoinflip
);

app.post(
  "/api/coinflips/:id/accept",
  rateLimit(30, 60000),
  acceptCoinflip
);

function cancelCoinflip(req, res) {
  const userId =
    userIdFromRequest(req);

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Sign in first.",
    });
  }

  const flip =
    db.coinflips.find(
      (item) =>
        item.id ===
          clean(req.params.id) &&
        item.status === "active"
    );

  if (!flip) {
    return res.status(404).json({
      success: false,
      message: "Coinflip not found.",
    });
  }

  if (
    flip.userId !== userId
  ) {
    return res.status(403).json({
      success: false,
      message:
        "Only the creator can cancel this coinflip.",
    });
  }

  const creator =
    getUser(userId);

  if (!creator) {
    return res.status(409).json({
      success: false,
      message:
        "Creator no longer exists.",
    });
  }

  addPet(creator, {
    name: flip.petName,
    value: flip.petValue,
    image: flip.image,
  });

  creator.wagered =
    Math.max(
      0,
      numeric(creator.wagered) -
        numeric(flip.petValue)
    );

  creator.coinflips =
    Math.max(
      0,
      Number(
        creator.coinflips || 0
      ) - 1
    );

  flip.status = "cancelled";
  flip.cancelledAt =
    Date.now();

  scheduleSave();

  res.json({
    success: true,
    flip,
  });
}

app.post(
  "/coinflips/:id/cancel",
  rateLimit(30, 60000),
  cancelCoinflip
);

app.post(
  "/api/coinflips/:id/cancel",
  rateLimit(30, 60000),
  cancelCoinflip
);

/* =========================================================
   LEADERBOARD
========================================================= */

function leaderboardHandler(
  req,
  res
) {
  const leaderboard =
    Object.values(db.users)
      .sort(
        (a, b) =>
          numeric(b.wagered) -
          numeric(a.wagered)
      )
      .slice(0, 10)
      .map(
        (user, index) => ({
          place: index + 1,
          username:
            user.username,
          avatar:
            user.avatar ||
            "/logo.png",
          wagered:
            numeric(user.wagered),
          profit:
            numeric(user.profit),
        })
      );

  res.set(
    "Cache-Control",
    "no-store"
  );

  res.json({
    success: true,
    users: leaderboard,
  });
}

app.get(
  "/leaderboard",
  leaderboardHandler
);

app.get(
  "/api/leaderboard",
  leaderboardHandler
);

/* =========================================================
   STATUS
========================================================= */

function statusHandler(
  req,
  res
) {
  const active =
    db.coinflips.filter(
      (flip) =>
        flip.status === "active"
    );

  res.set(
    "Cache-Control",
    "no-store"
  );

  res.json({
    success: true,
    online: true,
    announcement: "",
    activeCoinflips:
      active.length,
    totalCoinflipValue:
      active.reduce(
        (sum, flip) =>
          sum +
          numeric(
            flip.petValue
          ),
        0
      ),
  });
}

app.get(
  "/status",
  statusHandler
);

app.get(
  "/api/status",
  statusHandler
);

/* =========================================================
   ADMIN
========================================================= */

function requireAdmin(
  req,
  res,
  next
) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      success: false,
      message:
        "Admin API is not configured.",
    });
  }

  const authorization =
    req.get("authorization") ||
    "";

  const key =
    authorization.startsWith(
      "Bearer "
    )
      ? authorization.slice(7).trim()
      : "";

  if (
    !key ||
    !safeEqual(
      key,
      ADMIN_KEY
    )
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  next();
}

app.post(
  "/admin/grant",
  rateLimit(30, 60000),
  requireAdmin,
  (req, res) => {
    const robloxId =
      safeUserId(
        req.body?.robloxId ??
          req.body?.userId
      );

    if (!robloxId) {
      return res.status(400).json({
        success: false,
        message:
          "Valid Roblox ID required.",
      });
    }

    let user =
      getUser(robloxId);

    if (!user) {
      user =
        createOrUpdateUser({
          id: robloxId,
          username:
            clean(
              req.body?.username
            ) || "User",
        });
    }

    const balance =
      numeric(
        req.body?.balance
      );

    if (balance !== 0) {
      user.balance =
        numeric(user.balance) +
        balance;
    }

    const pets =
      Array.isArray(
        req.body?.pets
      )
        ? req.body.pets
        : [];

    let addedPets = 0;

    for (const raw of pets) {
      const name = clean(
        raw?.name ?? raw
      );

      if (!name) {
        continue;
      }

      const serverPet =
        findServerPet(name);

      if (serverPet) {
        addPet(
          user,
          serverPet
        );

        addedPets++;
      }
    }

    scheduleSave();

    res.json({
      success: true,
      addedPets,
      user: publicUser(user),
    });
  }
);

/* =========================================================
   DEBUG / TEST
========================================================= */

if (
  process.env.NODE_ENV !==
  "production"
) {
  app.get(
    "/test-roblox",
    async (req, res) => {
      try {
        const response =
          await robloxFetch(
            "https://users.roblox.com/v1/users/1"
          );

        const text =
          await response.text();

        res.json({
          success: true,
          status:
            response.status,
          ok: response.ok,
          response:
            text.slice(0, 1000),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error:
            error.message,
        });
      }
    }
  );

  app.get(
    "/test-roblox/:username",
    rateLimit(
      ROBLOX_RATE_MAX,
      ROBLOX_RATE_WINDOW
    ),
    async (req, res) => {
      try {
        const user =
          await findRobloxUser(
            req.params.username,
            true
          );

        if (!user) {
          return res.status(404).json({
            success: false,
            message:
              "Roblox user not found.",
          });
        }

        res.json({
          success: true,
          user,
        });
      } catch (error) {
        res.status(502).json({
          success: false,
          error:
            error.message,
        });
      }
    }
  );

  app.get(
    "/debug-values",
    (req, res) => {
      res.json({
        success: true,
        count:
          getPets().length,
        firstPets:
          getPets().slice(0, 10),
      });
    }
  );
}

/* =========================================================
   STATIC FRONTEND
========================================================= */

// THIS IS THE IMPORTANT FIX.
//
// backend/server.js
//       |
//       └── ../public
//
// Therefore:
// path.join(__dirname, "..", "public")

if (fs.existsSync(PUBLIC_DIR)) {
  console.log(
    "[STATIC] Serving frontend from:",
    PUBLIC_DIR
  );

  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      maxAge:
        process.env.NODE_ENV ===
        "production"
          ? "1h"
          : 0,
    })
  );
} else {
  console.error(
    "[STATIC] PUBLIC DIRECTORY NOT FOUND:",
    PUBLIC_DIR
  );
}

/* =========================================================
   FRONTEND ROUTES
========================================================= */

app.get("/", (req, res) => {
  const indexFile =
    path.join(
      PUBLIC_DIR,
      "index.html"
    );

  if (
    fs.existsSync(indexFile)
  ) {
    return res.sendFile(
      indexFile
    );
  }

  return res.status(500).send(
    `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ADMFLIP</title>
</head>
<body style="font-family:Arial;background:#111;color:white;padding:40px">
<h1>ADMFLIP backend is online</h1>
<p>But public/index.html was not found.</p>
<p>Expected:</p>
<code>${indexFile}</code>
</body>
</html>
`
  );
});

/*
  Useful direct frontend test.

  /__static-test
*/
app.get(
  "/__static-test",
  (req, res) => {
    res.json({
      success: true,
      publicDirectory:
        PUBLIC_DIR,
      publicExists:
        fs.existsSync(
          PUBLIC_DIR
        ),
      files: {
        index:
          fs.existsSync(
            path.join(
              PUBLIC_DIR,
              "index.html"
            )
          ),
        css:
          fs.existsSync(
            path.join(
              PUBLIC_DIR,
              "style.css"
            )
          ),
        script:
          fs.existsSync(
            path.join(
              PUBLIC_DIR,
              "script.js"
            )
          ),
        logo:
          fs.existsSync(
            path.join(
              PUBLIC_DIR,
              "logo.png"
            )
          ),
      },
    });
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    // API requests should remain JSON.
    if (
      req.path.startsWith(
        "/api/"
      ) ||
      [
        "/pets",
        "/coinflips",
        "/chat",
        "/account",
        "/user",
        "/leaderboard",
        "/status",
        "/health",
      ].some(
        (prefix) =>
          req.path === prefix ||
          req.path.startsWith(
            prefix + "/"
          )
      )
    ) {
      return res.status(404).json({
        success: false,
        error:
          "API route not found.",
      });
    }

    // Frontend asset that doesn't exist.
    return res.status(404).send(
      `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>404 - ADMFLIP</title>
</head>
<body style="font-family:Arial;background:#111;color:#fff;padding:40px">
<h1>404</h1>
<p>File or page not found:</p>
<code>${clean(
        req.path
      )}</code>
</body>
</html>
`
    );
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "[SERVER ERROR]",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    if (
      error.type ===
      "entity.too.large"
    ) {
      return res.status(413).json({
        success: false,
        message:
          "Request body too large.",
      });
    }

    if (
      error.type ===
      "entity.parse.failed"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid JSON body.",
      });
    }

    if (
      error.message ===
      "CORS blocked"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "CORS origin blocked.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Internal server error.",
    });
  }
);

/* =========================================================
   START
========================================================= */

loadDb();

if (
  !db.chatMessages.some(
    (message) =>
      message.id === "welcome"
  )
) {
  db.chatMessages.unshift({
    id: "welcome",
    username: "ADMFLIP",
    robloxId: null,
    avatar: "/logo.png",
    message:
      "Welcome to ADMFLIP.",
    type: "announcement",
    pinned: true,
    createdAt: Date.now(),
  });
}

persistNow();

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "========================================"
    );
    console.log(
      "ADMFLIP SERVER v3.0.0 FIXED"
    );
    console.log(
      "========================================"
    );
    console.log(
      "Port:",
      PORT
    );
    console.log(
      "Frontend:",
      PUBLIC_DIR
    );
    console.log(
      "index.html:",
      fs.existsSync(
        path.join(
          PUBLIC_DIR,
          "index.html"
        )
      )
    );
    console.log(
      "style.css:",
      fs.existsSync(
        path.join(
          PUBLIC_DIR,
          "style.css"
        )
      )
    );
    console.log(
      "script.js:",
      fs.existsSync(
        path.join(
          PUBLIC_DIR,
          "script.js"
        )
      )
    );
    console.log(
      "logo.png:",
      fs.existsSync(
        path.join(
          PUBLIC_DIR,
          "logo.png"
        )
      )
    );
    console.log(
      "Pets:",
      getPets().length
    );
    console.log(
      "========================================"
    );
  }
);

/* =========================================================
   TELEGRAM BOT
========================================================= */

try {
  require("./bot");

  console.log(
    "[TELEGRAM] bot.js loaded successfully"
  );
} catch (error) {
  console.error(
    "[TELEGRAM] Failed to load bot.js:",
    error.message
  );
}
