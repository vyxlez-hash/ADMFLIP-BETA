"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
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

const ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.disable("x-powered-by");

app.set("trust proxy", 1);

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
      "Authorization",
      "X-Admin-Key"
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
    crypto.randomBytes(6).toString("hex")
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

    console.log(
      `Loaded ${result.length} pets from values.txt`
    );

    return result;
  } catch (error) {
    console.error(
      "Could not read values.txt:",
      error
    );

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
    // Keep the last working cache.
  }

  return petsCache.pets;
}

/* =========================================================
   JSON DATABASE
========================================================= */

let db = {
  users: {},
  coinflips: [],
  chatMessages: [],
  secret: null
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
      parsed &&
      typeof parsed.users === "object" &&
      !Array.isArray(parsed.users)
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

    db.secret =
      typeof parsed.secret === "string"
        ? parsed.secret
        : null;

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
    console.error(
      "Could not save db:",
      error
    );
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
  console.log("Shutting down, saving db...");

  clearTimeout(saveTimer);

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

    bucket.count++;

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
   USERS
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
      username:
        clean(data.username) || "User",
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

function publicUser(user) {
  return {
    id: user.id,
    robloxId: user.robloxId,
    username: user.username,
    avatar: user.avatar || "/logo.png",
    verified: Boolean(user.verified),
    balance: numeric(user.balance),
    wagered: numeric(user.wagered),
    profit: numeric(user.profit),
    coinflips: numeric(user.coinflips),
    wins: numeric(user.wins),
    inventory: Array.isArray(user.inventory)
      ? user.inventory
      : []
  };
}

/* =========================================================
   SESSION TOKENS
========================================================= */

function sessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  if (!db.secret) {
    db.secret = crypto
      .randomBytes(32)
      .toString("hex");

    scheduleSave();
  }

  return db.secret;
}

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input) {
  return Buffer.from(
    String(input)
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

function signToken(payload, ttlMs) {
  const body = b64url(
    JSON.stringify({
      ...payload,
      iat: Date.now(),
      exp: Date.now() + ttlMs
    })
  );

  const signature = crypto
    .createHmac(
      "sha256",
      sessionSecret()
    )
    .update(body)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return body + "." + signature;
}

function verifyToken(token, type) {
  const raw = clean(token);

  if (!raw || !raw.includes(".")) {
    return null;
  }

  const parts = raw.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const body = parts[0];
  const signature = parts[1];

  const expected = crypto
    .createHmac(
      "sha256",
      sessionSecret()
    )
    .update(body)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (
    signature.length !==
    expected.length
  ) {
    return null;
  }

  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(
      fromB64url(body)
    );
  } catch {
    return null;
  }

  if (
    !payload ||
    payload.type !== type
  ) {
    return null;
  }

  if (
    !payload.exp ||
    Date.now() > Number(payload.exp)
  ) {
    return null;
  }

  return payload;
}

function issueSession(user) {
  const accessToken = signToken(
    {
      sub: String(user.id),
      type: "access"
    },
    ACCESS_TTL_MS
  );

  const refreshToken = signToken(
    {
      sub: String(user.id),
      type: "refresh"
    },
    REFRESH_TTL_MS
  );

  return {
    token: accessToken,
    accessToken,
    refreshToken,
    expiresIn: Math.floor(
      ACCESS_TTL_MS / 1000
    )
  };
}

function bearer(req) {
  const header = clean(
    req.headers?.authorization ||
      req.headers?.Authorization
  );

  if (
    !/^bearer\s+/i.test(header)
  ) {
    return "";
  }

  return header
    .replace(/^bearer\s+/i, "")
    .trim();
}

function sessionUser(req) {
  const payload = verifyToken(
    bearer(req),
    "access"
  );

  if (!payload) {
    return null;
  }

  return getUser(payload.sub);
}

/* =========================================================
   INVENTORY
========================================================= */

function findPetValue(name) {
  const wanted = clean(name).toLowerCase();

  return (
    getPets().find(
      (pet) =>
        pet.name
          .toLowerCase() === wanted
    ) || null
  );
}

function addInventoryPet(user, name) {
  const serverPet =
    findPetValue(name);

  if (!serverPet) {
    return null;
  }

  const itemId = makeId();

  const item = {
    id: itemId,
    itemId,
    name: serverPet.name,
    value: serverPet.value,
    image: serverPet.image,
    addedAt: Date.now()
  };

  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  user.inventory.push(item);
  user.updatedAt = Date.now();

  return item;
}

function takeInventoryPet(user, ref) {
  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  const id = clean(
    ref?.itemId || ref?.id
  );

  const name = clean(
    ref?.name
  ).toLowerCase();

  let index = -1;

  if (id) {
    index = user.inventory.findIndex(
      (item) =>
        String(item.id) === id ||
        String(item.itemId) === id
    );
  }

  if (index < 0 && name) {
    index = user.inventory.findIndex(
      (item) =>
        clean(item.name)
          .toLowerCase() === name
    );
  }

  if (index < 0) {
    return null;
  }

  const [item] =
    user.inventory.splice(index, 1);

  user.updatedAt = Date.now();

  return item;
}

function giveInventoryItem(user, item) {
  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  const id = makeId();

  const newItem = {
    ...item,
    id,
    itemId: id,
    addedAt: Date.now()
  };

  user.inventory.push(newItem);
  user.updatedAt = Date.now();

  return newItem;
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

async function robloxFetch(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, ROBLOX_TIMEOUT_MS);

  try {
    console.log(
      "ROBLOX REQUEST:",
      options.method || "GET",
      url
    );

    const response = await fetch(
      url,
      {
        ...options,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ADMFLIP/2.2)",
          Accept:
            "application/json",
          "Content-Type":
            "application/json",
          ...(options.headers || {})
        },
        signal: controller.signal
      }
    );

    console.log(
      "ROBLOX RESPONSE:",
      response.status,
      response.statusText
    );

    return response;
  } catch (error) {
    console.error(
      "ROBLOX FETCH ERROR:",
      error
    );

    throw error;
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
  const cleanUsername =
    clean(username);

  if (!cleanUsername) {
    return null;
  }

  return withCache(
    "user:" +
      cleanUsername.toLowerCase(),
    ROBLOX_CACHE_TTL,
    async () => {
      const response =
        await robloxFetch(
          "https://users.roblox.com/v1/usernames/users",
          {
            method: "POST",
            body: JSON.stringify({
              usernames: [
                cleanUsername
              ],
              excludeBannedUsers:
                true
            })
          }
        );

      const body =
        await response.text();

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
          "Roblox returned invalid JSON."
        );
      }

      const users =
        Array.isArray(data?.data)
          ? data.data
          : [];

      const exact =
        users.find(
          (user) =>
            String(
              user.name
            ).toLowerCase() ===
            cleanUsername.toLowerCase()
        );

      return exact || users[0] || null;
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
      const response =
        await robloxFetch(
          "https://users.roblox.com/v1/users/" +
            encodeURIComponent(
              String(id)
            )
        );

      const body =
        await response.text();

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
              encodeURIComponent(
                String(id)
              ) +
              "&size=150x150&format=Png&isCircular=false"
          );

        const body =
          await response.text();

        if (!response.ok) {
          return "";
        }

        try {
          const data =
            JSON.parse(body);

          return (
            data?.data?.[0]
              ?.imageUrl || ""
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
   ROBLOX TEST
========================================================= */

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
        status: response.status,
        ok: response.ok,
        response: text.slice(
          0,
          1000
        )
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        name: error.name,
        cause: error.cause
          ? String(error.cause)
          : null
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
    const username =
      clean(req.params.username);

    if (!username) {
      return res.status(400).json({
        success: false,
        message:
          "Username required."
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
          "Server successfully reached Roblox.",
        user
      });
    } catch (error) {
      res.status(502).json({
        success: false,
        message:
          "Could not query Roblox.",
        error: error.message,
        username
      });
    }
  }
);

/* =========================================================
   VALUES DEBUG
========================================================= */

app.get(
  "/debug-values",
  (req, res) => {
    const loaded = getPets();

    res.json({
      success: true,
      count: loaded.length,
      valuesFile: VALUES_FILE,
      firstPets:
        loaded.slice(0, 10)
    });
  }
);

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

app.get(
  "/api/pets",
  (req, res) => {
    res.json({
      success: true,
      pets: getPets()
    });
  }
);

app.get(
  "/pets/:name",
  (req, res) => {
    const requested =
      decodeURIComponent(
        req.params.name
      )
        .trim()
        .toLowerCase();

    const pet =
      getPets().find(
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
  }
);

/* =========================================================
   ROBLOX USER LOOKUP
========================================================= */

async function userLookup(
  req,
  res
) {
  const username =
    clean(req.params.username);

  if (!username) {
    return res.status(400).json({
      success: false,
      message:
        "Username required."
    });
  }

  try {
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

    const avatar =
      await findRobloxAvatar(
        robloxUser.id
      );

    createOrUpdateUser({
      id: robloxUser.id,
      username: robloxUser.name,
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
      "ROBLOX LOOKUP FAILED:",
      error
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

app.get(
  "/api/create",
  (req, res) => {
    res.json({
      success: true,
      phrase: generatePhrase()
    });
  }
);

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

    const session =
      issueSession(user);

    res.json({
      success: true,
      id: robloxUser.id,
      userId: robloxUser.id,
      username:
        profile.name ||
        robloxUser.name,
      avatar,
      user: publicUser(user),
      token: session.token,
      accessToken:
        session.accessToken,
      refreshToken:
        session.refreshToken,
      expiresIn:
        session.expiresIn
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
   REFRESH / ACCOUNT SESSION
========================================================= */

function refreshHandler(
  req,
  res
) {
  const payload =
    verifyToken(
      clean(
        req.body?.refreshToken ||
          req.body?.refresh_token ||
          bearer(req)
      ),
      "refresh"
    );

  if (!payload) {
    return res.status(401).json({
      success: false,
      message:
        "Session expired. Verify again."
    });
  }

  const user =
    getUser(payload.sub);

  if (!user) {
    return res.status(401).json({
      success: false,
      message:
        "Account no longer exists."
    });
  }

  const session =
    issueSession(user);

  res.json({
    success: true,
    token: session.token,
    accessToken:
      session.accessToken,
    refreshToken:
      session.refreshToken,
    expiresIn:
      session.expiresIn,
    user: publicUser(user)
  });
}

app.post(
  "/refresh",
  refreshHandler
);

app.post(
  "/api/refresh",
  refreshHandler
);

function meHandler(req, res) {
  const user =
    sessionUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message:
        "Not signed in."
    });
  }

  res.json({
    success: true,
    user: publicUser(user)
  });
}

app.get("/account", meHandler);
app.get("/api/account", meHandler);
app.get("/me", meHandler);
app.get("/api/me", meHandler);

function logoutHandler(
  req,
  res
) {
  res.json({
    success: true
  });
}

app.post(
  "/logout",
  logoutHandler
);

app.post(
  "/api/logout",
  logoutHandler
);

/* =========================================================
   ACCOUNT BY ROBLOX ID
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
      user: publicUser(user)
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
  const sessionAccount =
    sessionUser(req);

  const robloxId =
    sessionAccount
      ? String(
          sessionAccount.id
        )
      : clean(
          req.body?.robloxId ||
            req.body?.userId
        );

  const username =
    sessionAccount
      ? sessionAccount.username
      : clean(req.body?.username);

  const avatar =
    sessionAccount
      ? clean(
          sessionAccount.avatar
        )
      : clean(req.body?.avatar);

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

function activeCoinflips() {
  return db.coinflips.filter(
    (flip) =>
      flip.status === "active"
  );
}

app.get(
  "/coinflips",
  (req, res) => {
    const active =
      activeCoinflips();

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
    res.json({
      success: true,
      coinflips:
        activeCoinflips()
    });
  }
);

function createCoinflip(
  req,
  res
) {
  const user =
    sessionUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message:
        "Verify your Roblox account first."
    });
  }

  const side =
    clean(req.body?.side)
      .toLowerCase();

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

  const ref = {
    itemId: clean(
      req.body?.itemId ||
        req.body?.inventoryId ||
        inputPet.itemId ||
        inputPet.id
    ),
    name: clean(
      req.body?.petName ||
        inputPet.name
    )
  };

  if (!ref.itemId && !ref.name) {
    return res.status(400).json({
      success: false,
      message:
        "Select a pet."
    });
  }

  const item =
    takeInventoryPet(
      user,
      ref
    );

  if (!item) {
    return res.status(400).json({
      success: false,
      message:
        "That pet is not in your inventory."
    });
  }

  const serverPet =
    findPetValue(item.name);

  const value = serverPet
    ? serverPet.value
    : numeric(item.value);

  user.wagered =
    numeric(user.wagered) +
    value;

  user.coinflips =
    numeric(user.coinflips) + 1;

  user.updatedAt =
    Date.now();

  const flip = {
    id: makeId(),
    username: user.username,
    userId: user.id,
    robloxId: user.id,
    avatar:
      user.avatar ||
      "/logo.png",
    petName: item.name,
    petValue: value,
    value,
    image:
      item.image ||
      (serverPet &&
        serverPet.image) ||
      petImage(item.name),
    petItem: item,
    side,
    status: "active",
    createdAt: Date.now()
  };

  db.coinflips.unshift(flip);

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
    user: publicUser(user)
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
            numeric(
              user.wagered
            ),
          profit:
            numeric(
              user.profit
            )
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
    activeCoinflips();

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
   ADMIN
========================================================= */

const ADMIN_KEY =
  process.env.ADMIN_KEY || "";

function requireAdmin(
  req,
  res,
  next
) {
  if (!ADMIN_KEY) {
    return res.status(503).json({
      success: false,
      message:
        "ADMIN_KEY is not configured on the server."
    });
  }

  const provided =
    bearer(req) ||
    clean(
      req.headers?.[
        "x-admin-key"
      ]
    );

  const a =
    Buffer.from(provided);

  const b =
    Buffer.from(ADMIN_KEY);

  if (
    a.length !== b.length
  ) {
    return res.status(401).json({
      success: false,
      message:
        "Invalid admin key."
    });
  }

  if (
    !crypto.timingSafeEqual(
      a,
      b
    )
  ) {
    return res.status(401).json({
      success: false,
      message:
        "Invalid admin key."
    });
  }

  next();
}

function adminUser(body) {
  const id = clean(
    body?.robloxId ||
      body?.userId ||
      body?.id
  );

  if (!/^\d+$/.test(id)) {
    return null;
  }

  return (
    getUser(id) ||
    createOrUpdateUser({
      id,
      username:
        clean(
          body?.username
        ) || "User",
      verified: true
    })
  );
}

const adminRouter =
  express.Router();

adminRouter.use(
  requireAdmin
);

/* Grant pets/balance */

adminRouter.post(
  "/grant",
  (req, res) => {
    const user =
      adminUser(req.body);

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Roblox ID."
      });
    }

    const requested =
      Array.isArray(
        req.body?.pets
      )
        ? req.body.pets
        : [];

    const addedPets = [];
    const missing = [];

    requested.forEach(
      (entry) => {
        const name = clean(
          typeof entry ===
            "string"
            ? entry
            : entry?.name
        );

        const item =
          addInventoryPet(
            user,
            name
          );

        if (item) {
          addedPets.push(item);
        } else {
          missing.push(name);
        }
      }
    );

    const delta =
      numeric(
        req.body?.balance
      );

    if (delta) {
      user.balance =
        Math.max(
          0,
          numeric(
            user.balance
          ) + delta
        );

      user.updatedAt =
        Date.now();
    }

    scheduleSave();

    if (
      requested.length &&
      !addedPets.length
    ) {
      return res.status(400).json({
        success: false,
        message:
          "None of those pets exist in values.txt.",
        missing
      });
    }

    res.json({
      success: true,
      addedPets:
        addedPets.length
          ? addedPets
          : null,
      missing,
      user: publicUser(user)
    });
  }
);

/* Remove pet */

adminRouter.post(
  "/remove-pet",
  (req, res) => {
    const user =
      adminUser(req.body);

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Roblox ID."
      });
    }

    const removedPet =
      takeInventoryPet(
        user,
        {
          itemId: clean(
            req.body?.itemId
          ),
          name: clean(
            req.body?.petName ||
              req.body?.name
          )
        }
      );

    if (!removedPet) {
      return res.status(404).json({
        success: false,
        message:
          "That pet is not in the user's inventory."
      });
    }

    scheduleSave();

    res.json({
      success: true,
      removedPet,
      user: publicUser(user)
    });
  }
);

/* Transfer pet */

adminRouter.post(
  "/transfer-pet",
  (req, res) => {
    const from =
      adminUser({
        robloxId:
          req.body?.fromRobloxId
      });

    const to =
      adminUser({
        robloxId:
          req.body?.toRobloxId
      });

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message:
          "Both Roblox IDs must be valid."
      });
    }

    const pet =
      takeInventoryPet(
        from,
        {
          name: clean(
            req.body?.petName
          ),
          itemId: clean(
            req.body?.itemId
          )
        }
      );

    if (!pet) {
      return res.status(404).json({
        success: false,
        message:
          "The sender does not own that pet."
      });
    }

    const given =
      giveInventoryItem(
        to,
        pet
      );

    scheduleSave();

    res.json({
      success: true,
      pet: given,
      from: publicUser(from),
      to: publicUser(to)
    });
  }
);

/* Set balance */

adminRouter.post(
  "/set-balance",
  (req, res) => {
    const user =
      adminUser(req.body);

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Roblox ID."
      });
    }

    const balance =
      numeric(
        req.body?.balance
      );

    if (balance < 0) {
      return res.status(400).json({
        success: false,
        message:
          "Balance cannot be negative."
      });
    }

    user.balance = balance;
    user.updatedAt =
      Date.now();

    scheduleSave();

    res.json({
      success: true,
      user: publicUser(user)
    });
  }
);

/* Cancel coinflip */

adminRouter.post(
  "/cancel-coinflip",
  (req, res) => {
    const flipId = clean(
      req.body?.flipId ||
        req.body?.id
    );

    const flip =
      db.coinflips.find(
        (entry) =>
          String(entry.id) ===
            flipId &&
          entry.status ===
            "active"
      );

    if (!flip) {
      return res.status(404).json({
        success: false,
        message:
          "No active coinflip with that ID."
      });
    }

    flip.status =
      "cancelled";

    flip.cancelledAt =
      Date.now();

    const owner =
      getUser(flip.userId);

    if (owner) {
      giveInventoryItem(
        owner,
        flip.petItem || {
          name: flip.petName,
          value: flip.petValue,
          image: flip.image
        }
      );

      owner.wagered =
        Math.max(
          0,
          numeric(
            owner.wagered
          ) -
            numeric(
              flip.petValue
            )
        );

      owner.coinflips =
        Math.max(
          0,
          numeric(
            owner.coinflips
          ) - 1
        );
    }

    scheduleSave();

    res.json({
      success: true,
      flip
    });
  }
);

/* Join coinflip */

adminRouter.post(
  "/join-coinflip",
  (req, res) => {
    const flipId = clean(
      req.body?.flipId ||
        req.body?.id
    );

    const flip =
      db.coinflips.find(
        (entry) =>
          String(entry.id) ===
            flipId &&
          entry.status ===
            "active"
      );

    if (!flip) {
      return res.status(404).json({
        success: false,
        message:
          "No active coinflip with that ID."
      });
    }

    const joiner =
      adminUser(req.body);

    if (!joiner) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Roblox ID."
      });
    }

    if (
      String(joiner.id) ===
      String(flip.userId)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "The creator cannot join their own coinflip."
      });
    }

    const joinerPet =
      takeInventoryPet(
        joiner,
        {
          name: flip.petName
        }
      );

    if (!joinerPet) {
      return res.status(400).json({
        success: false,
        message:
          `${joiner.username} does not own a ${flip.petName}.`
      });
    }

    const toss =
      crypto.randomInt(2) === 0
        ? "heads"
        : "tails";

    const creator =
      getUser(flip.userId);

    const creatorWon =
      flip.side === toss;

    const winner =
      creatorWon
        ? creator
        : joiner;

    const loser =
      creatorWon
        ? joiner
        : creator;

    const pot =
      numeric(
        flip.petValue
      ) * 2;

    if (winner) {
      giveInventoryItem(
        winner,
        flip.petItem || {
          name: flip.petName,
          value: flip.petValue,
          image: flip.image
        }
      );

      giveInventoryItem(
        winner,
        joinerPet
      );

      winner.wins =
        numeric(
          winner.wins
        ) + 1;

      winner.profit =
        numeric(
          winner.profit
        ) +
        numeric(
          flip.petValue
        );
    }

    if (loser) {
      loser.profit =
        numeric(
          loser.profit
        ) -
        numeric(
          flip.petValue
        );
    }

    joiner.wagered =
      numeric(
        joiner.wagered
      ) +
      numeric(
        flip.petValue
      );

    joiner.coinflips =
      numeric(
        joiner.coinflips
      ) + 1;

    flip.status =
      "completed";

    flip.toss = toss;
    flip.completedAt =
      Date.now();

    flip.opponent = {
      username:
        joiner.username,
      userId: joiner.id,
      robloxId: joiner.id,
      avatar:
        joiner.avatar ||
        "/logo.png",
      petName:
        joinerPet.name,
      petValue:
        numeric(
          joinerPet.value
        )
    };

    flip.winner =
      winner
        ? {
            username:
              winner.username,
            userId: winner.id
          }
        : null;

    scheduleSave();

    res.json({
      success: true,
      flip,
      toss,
      pot,
      petName:
        joinerPet.name,
      winner:
        flip.winner || {
          username: "Unknown"
        }
    });
  }
);

/* Delete chat */

adminRouter.post(
  "/chat/delete",
  (req, res) => {
    const id = clean(
      req.body?.messageId ||
        req.body?.id
    );

    const before =
      db.chatMessages.length;

    db.chatMessages =
      db.chatMessages.filter(
        (message) =>
          String(message.id) !==
          id
      );

    scheduleSave();

    res.json({
      success: true,
      deleted:
        before -
        db.chatMessages.length
    });
  }
);

/* Clear chat */

adminRouter.post(
  "/chat/clear",
  (req, res) => {
    const cleared =
      db.chatMessages.length;

    db.chatMessages = [];

    scheduleSave();

    res.json({
      success: true,
      cleared
    });
  }
);

/* Announcement */

adminRouter.post(
  "/announce",
  (req, res) => {
    const message =
      clean(
        req.body?.message
      );

    if (!message) {
      return res.status(400).json({
        success: false,
        message:
          "Message is empty."
      });
    }

    const announcement = {
      id: makeId(),
      username: "ADMFLIP",
      robloxId: "0",
      avatar: "/logo.png",
      message,
      type: "announcement",
      pinned: true,
      createdAt: Date.now()
    };

    db.chatMessages.push(
      announcement
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
      message:
        announcement
    });
  }
);

app.use(
  "/admin",
  adminRouter
);

app.use(
  "/api/admin",
  adminRouter
);

/* =========================================================
   API INDEX
========================================================= */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "ADMFLIP API",
    version: "2.2.0",
    cors: FRONTEND_ORIGIN,
    endpoints: [
      "GET /health",
      "GET /test-roblox",
      "GET /test-roblox/:username",
      "GET /pets",
      "GET /pets/:name",
      "GET /user/:username",
      "GET /create",
      "POST /check",
      "POST /refresh",
      "GET /account",
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
