"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

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
  Number(process.env.ROBLOX_TIMEOUT_MS) || 15000;

const MAX_CHAT_MESSAGES = 200;
const MAX_COINFLIPS = 100;

const ROBLOX_CACHE_TTL = 10 * 60 * 1000;
const AVATAR_CACHE_TTL = 60 * 60 * 1000;

const ROBLOX_RATE_MAX = 20;
const ROBLOX_RATE_WINDOW = 60 * 1000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],
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

/* =========================================================
   REQUEST LOGGER
========================================================= */

app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    console.log(
      `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`
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

/* =========================================================
   PET VALUES
========================================================= */

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

let petsCache = {
  mtime: 0,
  pets: []
};

function getPets() {
  try {
    const stat = fs.statSync(VALUES_FILE);

    if (stat.mtimeMs !== petsCache.mtime) {
      petsCache = {
        mtime: stat.mtimeMs,
        pets: loadPets()
      };
    }
  } catch (error) {
    // Keep last good cache.
  }

  return petsCache.pets;
}

/* =========================================================
   JSON DATABASE
========================================================= */

let db = {
  users: {},
  coinflips: [],
  chatMessages: []
};

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return;
    }

    const parsed = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    db.users =
      parsed && typeof parsed.users === "object"
        ? parsed.users
        : {};

    db.coinflips =
      Array.isArray(parsed.coinflips)
        ? parsed.coinflips
        : [];

    db.chatMessages =
      Array.isArray(parsed.chatMessages)
        ? parsed.chatMessages
        : [];

    console.log(
      `Loaded db (${Object.keys(db.users).length} users, ` +
      `${db.coinflips.length} coinflips, ` +
      `${db.chatMessages.length} chat msgs)`
    );
  } catch (error) {
    console.error(
      "Could not load db, starting fresh:",
      error
    );
  }
}

function persistNow() {
  try {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });

    const tmp = DB_FILE + ".tmp";

    fs.writeFileSync(
      tmp,
      JSON.stringify(db, null, 2),
      "utf8"
    );

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

/* =========================================================
   RATE LIMITER
========================================================= */

const rateBuckets = new Map();

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key =
      req.ip ||
      req.socket.remoteAddress ||
      "unknown";

    const now = Date.now();

    let bucket = rateBuckets.get(key);

    if (!bucket || now > bucket.reset) {
      bucket = {
        count: 0,
        reset: now + windowMs
      };

      rateBuckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        message:
          "Too many requests. Please wait a minute and try again."
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
   USER HELPERS
========================================================= */

function getUser(id) {
  return db.users[String(id)] || null;
}

function createOrUpdateUser(data) {
  const id = String(
    data.id ??
    data.robloxId ??
    data.userId ??
    ""
  ).trim();

  if (!id) {
    return null;
  }

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
      inventory: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    db.users[id] = user;
  }

  if (data.username) {
    user.username = clean(data.username);
  }

  if (data.avatar) {
    user.avatar = clean(data.avatar);
  }

  if (data.verified !== undefined) {
    user.verified = Boolean(data.verified);
  }

  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  user.updatedAt = Date.now();

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
    const hit = robloxCache.get(key);

    if (
      hit &&
      hit.expires > Date.now()
    ) {
      return hit.value;
    }
  }

  const value = await fetcher();

  robloxCache.set(key, {
    value,
    expires: Date.now() + ttlMs
  });

  return value;
}

/* =========================================================
   ROBLOX FETCH
========================================================= */

async function robloxFetch(url, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    console.error(
      "ROBLOX REQUEST TIMED OUT:",
      url
    );

    controller.abort();
  }, ROBLOX_TIMEOUT_MS);

  try {
    console.log("========================================");
    console.log("ROBLOX REQUEST");
    console.log("URL:", url);
    console.log("METHOD:", options.method || "GET");
    console.log("========================================");

    const response = await fetch(url, {
      ...options,

      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ADMFLIP/2.1)",
        "Accept": "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      },

      signal: controller.signal
    });

    console.log("========================================");
    console.log("ROBLOX RESPONSE");
    console.log("STATUS:", response.status);
    console.log(
      "STATUS TEXT:",
      response.statusText
    );
    console.log("URL:", url);
    console.log("========================================");

    return response;
  } catch (error) {
    console.error("========================================");
    console.error("ROBLOX FETCH ERROR");
    console.error("NAME:", error.name);
    console.error("MESSAGE:", error.message);
    console.error("CAUSE:", error.cause);
    console.error("========================================");

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   ROBLOX USERNAME SEARCH
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

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            usernames: [cleanUsername],
            excludeBannedUsers: true
          })
        }
      );

      const body = await response.text();

      console.log(
        "ROBLOX USERNAME STATUS:",
        response.status
      );

      console.log(
        "ROBLOX USERNAME BODY:",
        body.slice(0, 2000)
      );

      if (!response.ok) {
        throw new Error(
          `Roblox returned HTTP ${response.status}: ${body.slice(
            0,
            500
          )}`
        );
      }

      let data;

      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(
          "Roblox returned invalid JSON: " +
          body.slice(0, 500)
        );
      }

      const found =
        Array.isArray(data?.data)
          ? data.data
          : [];

      const exact = found.find(
        (user) =>
          String(user.name).toLowerCase() ===
          cleanUsername.toLowerCase()
      );

      return exact || found[0] || null;
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
  return withCache(
    "profile:" + String(id),
    ROBLOX_CACHE_TTL,
    async () => {
      const response = await robloxFetch(
        "https://users.roblox.com/v1/users/" +
        encodeURIComponent(String(id))
      );

      const body = await response.text();

      console.log(
        "ROBLOX PROFILE STATUS:",
        response.status
      );

      console.log(
        "ROBLOX PROFILE BODY:",
        body.slice(0, 2000)
      );

      if (!response.ok) {
        throw new Error(
          `Roblox profile returned HTTP ${response.status}: ${body.slice(
            0,
            500
          )}`
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
  try {
    return await withCache(
      "avatar:" + String(id),
      AVATAR_CACHE_TTL,
      async () => {
        const response =
          await robloxFetch(
            "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
            encodeURIComponent(String(id)) +
            "&size=150x150&format=Png&isCircular=false"
          );

        const body = await response.text();

        console.log(
          "ROBLOX AVATAR STATUS:",
          response.status
        );

        console.log(
          "ROBLOX AVATAR BODY:",
          body.slice(0, 1000)
        );

        if (!response.ok) {
          return "";
        }

        try {
          const data = JSON.parse(body);

          return (
            data?.data?.[0]?.imageUrl ||
            ""
          );
        } catch {
          return "";
        }
      }
    );
  } catch (error) {
    console.error(
      "Avatar lookup failed:",
      error.message
    );

    return "";
  }
}

/* =========================================================
   TEST ROBLOX
========================================================= */

app.get("/test-roblox", async (req, res) => {
  try {
    const response = await fetch(
      "https://users.roblox.com/v1/users/1",
      {
        headers: {
          "User-Agent": "ADMFLIP/1.0",
          "Accept": "application/json"
        }
      }
    );

    const text = await response.text();

    res.json({
      success: true,
      status: response.status,
      ok: response.ok,
      response: text.slice(0, 1000)
    });
  } catch (error) {
    console.error(
      "ROBLOX TEST ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message,
      name: error.name,
      cause: error.cause
        ? String(error.cause)
        : null
    });
  }
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    success: true,
    server: "online",
    version: "2.2.0",
    pets: getPets().length,
    valuesFile: VALUES_FILE,
    dataFile: DB_FILE,
    cors: FRONTEND_ORIGIN
  });
});

/* =========================================================
   ROBLOX DIRECT TEST
========================================================= */

app.get(
  "/test-roblox/:username",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  async (req, res) => {
    const username =
      clean(req.params.username);

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username required."
      });
    }

    try {
      const user =
        await findRobloxUser(
          username,
          true
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "Roblox returned no user.",
          username
        });
      }

      res.json({
        success: true,
        message:
          "Railway successfully reached Roblox.",
        user
      });
    } catch (error) {
      console.error(
        "DIRECT ROBLOX TEST FAILED:",
        error
      );

      res.status(502).json({
        success: false,
        message:
          "Railway could not successfully query Roblox.",
        error:
          error.message ||
          String(error),
        username
      });
    }
  }
);

/* =========================================================
   DEBUG VALUES
========================================================= */

app.get("/debug-values", (req, res) => {
  const loaded = getPets();

  res.json({
    success: true,
    count: loaded.length,
    valuesFile: VALUES_FILE,
    firstPets: loaded.slice(0, 10)
  });
});

/* =========================================================
   PETS
========================================================= */

app.get("/pets", (req, res) => {
  try {
    const loaded = getPets();

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success: true,
      pets: loaded
    });
  } catch (error) {
    console.error(
      "GET /pets:",
      error
    );

    res.status(500).json({
      success: false,
      pets: [],
      error:
        "Unable to load pet values."
    });
  }
});

app.get("/api/pets", (req, res) => {
  res.json({
    success: true,
    pets: getPets()
  });
});

app.get("/pets/:name", (req, res) => {
  const requested =
    decodeURIComponent(req.params.name)
      .trim()
      .toLowerCase();

  const pet = getPets().find(
    (item) =>
      item.name
        .trim()
        .toLowerCase() ===
      requested
  );

  if (!pet) {
    return res.status(404).json({
      success: false,
      error: "Pet not found."
    });
  }

  res.json({
    success: true,
    pet
  });
});

/* =========================================================
   ROBLOX USER SEARCH
========================================================= */

async function userLookup(req, res) {
  const username =
    clean(req.params.username);

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username required."
    });
  }

  try {
    console.log(
      "USER LOOKUP START:",
      username
    );

    const robloxUser =
      await findRobloxUser(
        username,
        true
      );

    if (!robloxUser) {
      return res.status(404).json({
        success: false,
        message:
          "Roblox username not found."
      });
    }

    console.log(
      "ROBLOX USER FOUND:",
      JSON.stringify(
        robloxUser,
        null,
        2
      )
    );

    const avatar =
      await findRobloxAvatar(
        robloxUser.id
      );

    createOrUpdateUser({
      id: robloxUser.id,
      username:
        robloxUser.name,
      avatar
    });

    scheduleSave();

    res.json({
      success: true,

      user: {
        id: robloxUser.id,

        username:
          robloxUser.name,

        displayName:
          robloxUser.displayName ||
          robloxUser.name,

        avatar
      }
    });
  } catch (error) {
    console.error(
      "========================================"
    );

    console.error(
      "ROBLOX LOOKUP FAILED"
    );

    console.error(
      "MESSAGE:",
      error.message
    );

    console.error(
      "STACK:",
      error.stack
    );

    console.error(
      "========================================"
    );

    res.status(502).json({
      success: false,

      message:
        "Roblox lookup failed.",

      error:
        error.message ||
        String(error)
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
    "blaze"
  ];

  const first =
    words[
      Math.floor(
        Math.random() *
        words.length
      )
    ];

  const second =
    words[
      Math.floor(
        Math.random() *
        words.length
      )
    ];

  const number =
    Math.floor(
      1000 +
      Math.random() * 9000
    );

  return (
    "ADMFLIP-" +
    first +
    "-" +
    second +
    "-" +
    number
  );
}

app.get("/create", (req, res) => {
  res.json({
    success: true,
    phrase: generatePhrase()
  });
});

app.get("/api/create", (req, res) => {
  res.json({
    success: true,
    phrase: generatePhrase()
  });
});

async function verifyRobloxBio(
  req,
  res
) {
  try {
    const username =
      clean(req.body?.username);

    const phrase =
      clean(req.body?.phrase);

    if (!username || !phrase) {
      return res.status(400).json({
        success: false,
        message:
          "Username and phrase are required."
      });
    }

    const robloxUser =
      await findRobloxUser(
        username,
        true
      );

    if (!robloxUser) {
      return res.status(404).json({
        success: false,
        message:
          "Roblox username not found."
      });
    }

    const profile =
      await findRobloxProfile(
        robloxUser.id,
        true
      );

    const description =
      clean(profile?.description);

    console.log(
      `Verification check for ${robloxUser.name}: ` +
      `bio length ${description.length} | ` +
      JSON.stringify(
        description.slice(0, 120)
      )
    );

    if (
      !description
        .toLowerCase()
        .includes(
          phrase.toLowerCase()
        )
    ) {
      return res.json({
        success: false,
        message:
          "Verification phrase was not found in your Roblox About/Bio. Add it exactly, save your profile, then try again."
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
          profile.name ||
          robloxUser.name,
        avatar,
        verified: true
      });

    scheduleSave();

    res.json({
      success: true,
      id: robloxUser.id,
      userId: robloxUser.id,
      username:
        profile.name ||
        robloxUser.name,
      avatar,
      user
    });
  } catch (error) {
    console.error(
      "BIO VERIFICATION FAILED:",
      error
    );

    res.status(502).json({
      success: false,
      message:
        "Roblox bio check failed.",
      error:
        error.message ||
        String(error)
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

async function accountHandler(
  req,
  res
) {
  try {
    const id =
      clean(req.params.robloxId);

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Roblox ID."
      });
    }

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
            profile?.name ||
            "User",
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
        verified:
          Boolean(user.verified),
        balance:
          user.balance || 0,
        wagered:
          user.wagered || 0,
        profit:
          user.profit || 0,
        coinflips:
          user.coinflips || 0,
        wins:
          user.wins || 0,
        inventory:
          Array.isArray(
            user.inventory
          )
            ? user.inventory
            : []
      }
    });
  } catch (error) {
    console.error(
      "Account:",
      error
    );

    res.status(404).json({
      success: false,
      message:
        "Account could not be loaded.",
      error:
        error.message ||
        String(error)
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

/* =========================================================
   CHAT
========================================================= */

function hasLink(text) {
  return /(?:https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/)/i.test(
    text
  );
}

app.get(
  "/chat/messages",
  (req, res) => {
    res.json({
      success: true,
      messages:
        db.chatMessages.slice(-100)
    });
  }
);

app.get(
  "/api/chat/messages",
  (req, res) => {
    res.json({
      success: true,
      messages:
        db.chatMessages.slice(-100)
    });
  }
);

function createChatMessage(
  req,
  res
) {
  const robloxId =
    clean(
      req.body?.robloxId ||
      req.body?.userId
    );

  const username =
    clean(req.body?.username);

  const avatar =
    clean(req.body?.avatar);

  const message =
    clean(req.body?.message);

  if (!robloxId || !username) {
    return res.status(401).json({
      success: false,
      message:
        "Sign in to chat."
    });
  }

  if (!message) {
    return res.status(400).json({
      success: false,
      message:
        "Message is empty."
    });
  }

  if (message.length > 250) {
    return res.status(400).json({
      success: false,
      message:
        "Message is too long."
    });
  }

  if (hasLink(message)) {
    return res.status(400).json({
      success: false,
      message:
        "Links are not allowed in chat."
    });
  }

  const chatMessage = {
    id: makeId(),
    username,
    robloxId,
    avatar:
      avatar || "/logo.png",
    message,
    type: "message",
    pinned: false,
    createdAt: Date.now()
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
    message: chatMessage
  });
}

app.post(
  "/chat/messages",
  createChatMessage
);

app.post(
  "/api/chat/messages",
  createChatMessage
);

function getOnlineCount() {
  const cutoff =
    Date.now() -
    5 * 60 * 1000;

  const online =
    new Set(
      db.chatMessages
        .filter(
          (message) =>
            Number(
              message.createdAt
            ) >= cutoff
        )
        .map(
          (message) =>
            message.robloxId ||
            message.username
        )
    );

  return online.size;
}

app.get(
  "/chat/online",
  (req, res) => {
    const online =
      getOnlineCount();

    res.json({
      success: true,
      online,
      count: online,
      onlineCount: online
    });
  }
);

app.get(
  "/api/chat/online",
  (req, res) => {
    const online =
      getOnlineCount();

    res.json({
      success: true,
      online,
      count: online,
      onlineCount: online
    });
  }
);

/* =========================================================
   COINFLIPS
========================================================= */

app.get(
  "/coinflips",
  (req, res) => {
    const active =
      db.coinflips.filter(
        (flip) =>
          flip.status === "active"
      );

    const totalValue =
      active.reduce(
        (sum, flip) =>
          sum +
          numeric(
            flip.petValue
          ),
        0
      );

    res.json({
      success: true,
      coinflips: active,
      total: active.length,
      totalValue
    });
  }
);

app.get(
  "/api/coinflips",
  (req, res) => {
    const active =
      db.coinflips.filter(
        (flip) =>
          flip.status === "active"
      );

    res.json({
      success: true,
      coinflips: active
    });
  }
);

function createCoinflip(
  req,
  res
) {
  const username =
    clean(req.body?.username);

  const userId =
    clean(
      req.body?.userId ||
      req.body?.robloxId
    );

  if (!username || !userId) {
    return res.status(401).json({
      success: false,
      message:
        "Verify your Roblox account first."
    });
  }

  const side =
    clean(
      req.body?.side
    ).toLowerCase();

  if (
    side !== "heads" &&
    side !== "tails"
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Choose heads or tails."
    });
  }

  const inputPet =
    req.body?.pet || {};

  const name =
    clean(
      inputPet.name ||
      req.body?.petName
    );

  if (!name) {
    return res.status(400).json({
      success: false,
      message:
        "Select a pet."
    });
  }

  const serverPet =
    getPets().find(
      (pet) =>
        pet.name.toLowerCase() ===
        name.toLowerCase()
    );

  if (!serverPet) {
    return res.status(400).json({
      success: false,
      message:
        "That pet is not in the current value list."
    });
  }

  const user =
    createOrUpdateUser({
      id: userId,
      username,
      avatar:
        clean(req.body?.avatar),
      verified: true
    });

  user.wagered +=
    serverPet.value;

  user.coinflips += 1;

  user.updatedAt = Date.now();

  const flip = {
    id: makeId(),
    username:
      user.username,
    userId: user.id,
    robloxId: user.id,
    avatar:
      user.avatar ||
      "/logo.png",
    petName:
      serverPet.name,
    petValue:
      serverPet.value,
    value:
      serverPet.value,
    image:
      serverPet.image,
    side,
    status: "active",
    createdAt: Date.now()
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
    coinflip: flip
  });
}

app.post(
  "/coinflips",
  createCoinflip
);

app.post(
  "/api/coinflips",
  createCoinflip
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
            user.wagered || 0,
          profit:
            user.profit || 0
        })
      );

  res.json({
    success: true,
    users: leaderboard
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
      )
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
   API INDEX
========================================================= */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "ADMFLIP API",
    version: "2.2.0",

    cors:
      FRONTEND_ORIGIN,

    endpoints: [
      "GET /health",
      "GET /test-roblox",
      "GET /test-roblox/:username",
      "GET /pets",
      "GET /pets/:name",
      "GET /user/:username",
      "GET /create",
      "POST /check",
      "GET /account/:robloxId",
      "GET /coinflips",
      "POST /coinflips",
      "GET /chat/messages",
      "POST /chat/messages",
      "GET /chat/online",
      "GET /leaderboard",
      "GET /status"
    ]
  });
});

/* =========================================================
   OPTIONAL STATIC FRONTEND
========================================================= */

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(
      PUBLIC_DIR,
      {
        index: false,
        maxAge: "1h"
      }
    )
  );
}

app.get("/", (req, res) => {
  const index =
    path.join(
      PUBLIC_DIR,
      "index.html"
    );

  if (fs.existsSync(index)) {
    return res.sendFile(index);
  }

  res.json({
    success: true,
    server: "online",
    message:
      "ADMFLIP API — frontend is hosted separately."
  });
});

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,
      error:
        "API route not found.",
      path: req.path
    });
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "ADMFLIP SERVER ERROR:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      success: false,
      message:
        "Internal server error.",
      error:
        error.message ||
        String(error)
    });
  }
);

/* =========================================================
   START
========================================================= */

loadDb();

if (
  !db.chatMessages.some(
    (m) => m.id === "welcome"
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
    createdAt: Date.now()
  });
}

persistNow();

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "========================================"
    );

    console.log(
      "ADMFLIP backend v2.2 started"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Values:",
      VALUES_FILE
    );

    console.log(
      "Pets loaded:",
      getPets().length
    );

    console.log(
      "CORS origins:",
      FRONTEND_ORIGIN.join(", ")
    );

    console.log(
      "Data file:",
      DB_FILE
    );

    console.log(
      "========================================"
    );
  }
);
