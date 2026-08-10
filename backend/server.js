"use strict";

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");

const { randomUUID } = crypto;

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

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (() => {
    const generated = crypto.randomBytes(32).toString("hex");

    console.warn(
      "[WARN] SESSION_SECRET not set - using a random secret. " +
      "All sessions will be invalidated on every restart. " +
      "Set SESSION_SECRET in Railway env vars."
    );

    return generated;
  })();

const ADMIN_KEY = process.env.ADMIN_KEY || "";

/* =========================================================
   MIDDLEWARE
========================================================= */

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

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

function safeUserId(value) {
  const s = String(value ?? "").trim();

  return /^\d+$/.test(s) ? s : null;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));

  if (ba.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(ba, bb);
}

function makeId() {
  return randomUUID();
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
  return (user.inventory || []).some(
    (p) =>
      petKey(p) === String(name).toLowerCase()
  );
}

function removePet(user, name) {
  const idx = (user.inventory || []).findIndex(
    (p) =>
      petKey(p) === String(name).toLowerCase()
  );

  if (idx === -1) {
    return null;
  }

  return user.inventory.splice(idx, 1)[0];
}

function addPet(user, pet) {
  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  user.inventory.push({
    name: pet.name,
    value: pet.value,
    image: pet.image
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
    avatar: user.avatar,
    verified: Boolean(user.verified),
    balance: numeric(user.balance),
    wagered: numeric(user.wagered),
    profit: numeric(user.profit),
    coinflips: user.coinflips || 0,
    wins: user.wins || 0,
    inventory: Array.isArray(user.inventory)
      ? user.inventory
      : []
  };
}

/* =========================================================
   PET VALUES
========================================================= */

function loadPets() {
  if (!fs.existsSync(VALUES_FILE)) {
    console.error(
      "values.txt not found:",
      VALUES_FILE
    );

    return [];
  }

  try {
    const text =
      fs.readFileSync(
        VALUES_FILE,
        "utf8"
      );

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
        /^\[\d+\]$/.test(
          lines[valueIndex]
        )
      ) {
        valueIndex++;
      }

      if (valueIndex >= lines.length) {
        continue;
      }

      const rawValue =
        lines[valueIndex];

      if (
        !/^-?\d+(?:\.\d+)?$/.test(
          rawValue
        )
      ) {
        continue;
      }

      const value = Number(rawValue);

      if (!Number.isFinite(value)) {
        continue;
      }

      result.push({
        id: name
          .toLowerCase()
          .replace(
            /[^a-z0-9]+/g,
            "-"
          )
          .replace(
            /^-|-$/g,
            ""
          ),

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
    const stat =
      fs.statSync(
        VALUES_FILE
      );

    if (
      stat.mtimeMs !==
      petsCache.mtime
    ) {
      petsCache = {
        mtime: stat.mtimeMs,
        pets: loadPets()
      };
    }
  } catch {
    // Keep last good cache.
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
  refreshTokens: Object.create(null)
};

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return;
    }

    const parsed =
      JSON.parse(
        fs.readFileSync(
          DB_FILE,
          "utf8"
        )
      );

    const users =
      Object.create(null);

    for (
      const [key, value]
      of Object.entries(
        parsed.users || {}
      )
    ) {
      if (safeUserId(key)) {
        users[key] = value;
      }
    }

    db.users = users;

    db.coinflips =
      Array.isArray(
        parsed.coinflips
      )
        ? parsed.coinflips
        : [];

    db.chatMessages =
      Array.isArray(
        parsed.chatMessages
      )
        ? parsed.chatMessages
        : [];

    const refreshTokens =
      Object.create(null);

    for (
      const [hash, value]
      of Object.entries(
        parsed.refreshTokens || {}
      )
    ) {
      if (
        /^[a-f0-9]{64}$/i.test(
          hash
        ) &&
        value &&
        safeUserId(
          value.userId
        ) &&
        Number(
          value.expiresAt
        ) > Date.now()
      ) {
        refreshTokens[hash] = {
          userId:
            String(
              value.userId
            ),

          createdAt:
            Number(
              value.createdAt
            ) || Date.now(),

          expiresAt:
            Number(
              value.expiresAt
            )
        };
      }
    }

    db.refreshTokens =
      refreshTokens;

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
    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true
      }
    );

    const tmp =
      DB_FILE + ".tmp";

    fs.writeFileSync(
      tmp,
      JSON.stringify(
        db,
        null,
        2
      )
    );

    fs.renameSync(
      tmp,
      DB_FILE
    );
  } catch (error) {
    console.error(
      "Could not save db:",
      error
    );
  }
}

let saveTimer = null;

function scheduleSave() {
  clearTimeout(
    saveTimer
  );

  saveTimer =
    setTimeout(
      persistNow,
      400
    );
}

function shutdown() {
  console.log(
    "Shutting down, saving db..."
  );

  persistNow();

  process.exit(0);
}

process.on(
  "SIGTERM",
  shutdown
);

process.on(
  "SIGINT",
  shutdown
);

/* =========================================================
   RATE LIMITER
========================================================= */

const rateBuckets =
  new Map();

function rateLimit(
  max,
  windowMs
) {
  return (
    req,
    res,
    next
  ) => {
    const key =
      req.ip ||
      req.socket.remoteAddress ||
      "unknown";

    const now =
      Date.now();

    let bucket =
      rateBuckets.get(
        key
      );

    if (
      !bucket ||
      now > bucket.reset
    ) {
      bucket = {
        count: 0,
        reset:
          now + windowMs
      };

      rateBuckets.set(
        key,
        bucket
      );
    }

    bucket.count += 1;

    if (
      bucket.count > max
    ) {
      return res
        .status(429)
        .json({
          success: false,
          message:
            "Too many requests. Please wait a minute and try again."
        });
    }

    next();
  };
}

setInterval(
  () => {
    const now =
      Date.now();

    for (
      const [key, bucket]
      of rateBuckets
    ) {
      if (
        now > bucket.reset
      ) {
        rateBuckets.delete(
          key
        );
      }
    }
  },
  10 * 60 * 1000
).unref();

/* =========================================================
   AUTH TOKENS
========================================================= */

const ACCESS_TOKEN_TTL_MS =
  Number(
    process.env.ACCESS_TOKEN_TTL_MS
  ) ||
  15 * 60 * 1000;

const REFRESH_TOKEN_TTL_MS =
  Number(
    process.env.REFRESH_TOKEN_TTL_MS
  ) ||
  30 * 24 * 60 * 60 * 1000;

const MAX_REFRESH_TOKENS_PER_USER = 5;

if (
  !db.refreshTokens ||
  typeof db.refreshTokens !==
    "object"
) {
  db.refreshTokens =
    Object.create(null);
}

function hashRefreshToken(
  token
) {
  return crypto
    .createHash("sha256")
    .update(
      String(token)
    )
    .digest("hex");
}

function issueAccessToken(
  userId
) {
  const body =
    `${userId}.${Date.now()}`;

  const sig =
    crypto
      .createHmac(
        "sha256",
        SESSION_SECRET
      )
      .update(body)
      .digest(
        "base64url"
      );

  return `${body}.${sig}`;
}

function verifyAccessToken(
  token
) {
  const parts =
    String(token || "")
      .split(".");

  if (
    parts.length !== 3
  ) {
    return null;
  }

  const [
    userId,
    issuedAt,
    sig
  ] = parts;

  if (
    !/^\d+$/.test(
      userId
    )
  ) {
    return null;
  }

  const issued =
    Number(issuedAt);

  if (
    !Number.isFinite(
      issued
    )
  ) {
    return null;
  }

  const expected =
    crypto
      .createHmac(
        "sha256",
        SESSION_SECRET
      )
      .update(
        `${userId}.${issuedAt}`
      )
      .digest(
        "base64url"
      );

  if (
    !safeEqual(
      sig,
      expected
    )
  ) {
    return null;
  }

  const age =
    Date.now() -
    issued;

  if (
    age < 0 ||
    age >
      ACCESS_TOKEN_TTL_MS
  ) {
    return null;
  }

  return userId;
}

function issueRefreshToken(
  userId
) {
  const raw =
    crypto
      .randomBytes(48)
      .toString(
        "base64url"
      );

  const tokenHash =
    hashRefreshToken(
      raw
    );

  const now =
    Date.now();

  db.refreshTokens[
    tokenHash
  ] = {
    userId:
      String(userId),

    createdAt:
      now,

    expiresAt:
      now +
      REFRESH_TOKEN_TTL_MS
  };

  const entries =
    Object.entries(
      db.refreshTokens
    )
      .filter(
        ([, item]) =>
          item &&
          String(
            item.userId
          ) ===
            String(userId)
      )
      .sort(
        (a, b) =>
          Number(
            b[1].createdAt ||
              0
          ) -
          Number(
            a[1].createdAt ||
              0
          )
      );

  for (
    let i =
      MAX_REFRESH_TOKENS_PER_USER;
    i < entries.length;
    i++
  ) {
    delete db.refreshTokens[
      entries[i][0]
    ];
  }

  scheduleSave();

  return raw;
}

function rotateRefreshToken(
  rawRefreshToken
) {
  const token =
    clean(
      rawRefreshToken
    );

  if (!token) {
    return null;
  }

  const oldHash =
    hashRefreshToken(
      token
    );

  const record =
    db.refreshTokens[
      oldHash
    ];

  if (!record) {
    return null;
  }

  if (
    !record.expiresAt ||
    Number(
      record.expiresAt
    ) <= Date.now() ||
    !safeUserId(
      record.userId
    ) ||
    !getUser(
      record.userId
    )
  ) {
    delete db.refreshTokens[
      oldHash
    ];

    scheduleSave();

    return null;
  }

  delete db.refreshTokens[
    oldHash
  ];

  const newRefreshToken =
    issueRefreshToken(
      record.userId
    );

  const accessToken =
    issueAccessToken(
      record.userId
    );

  return {
    userId:
      record.userId,

    accessToken,

    refreshToken:
      newRefreshToken
  };
}

function userIdFromRequest(
  req
) {
  const header =
    req.get(
      "authorization"
    ) || "";

  if (
    !header.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  return verifyAccessToken(
    header.slice(7).trim()
  );
}

/* =========================================================
   USER HELPERS
========================================================= */

function getUser(id) {
  const safe =
    safeUserId(id);

  return safe
    ? db.users[safe] ||
        null
    : null;
}

function createOrUpdateUser(
  data
) {
  const id =
    safeUserId(
      data.id ??
        data.robloxId ??
        data.userId
    );

  if (!id) {
    return null;
  }

  let user =
    db.users[id];

  if (!user) {
    user = {
      id,
      robloxId: id,
      username:
        clean(
          data.username
        ) || "User",

      avatar:
        clean(
          data.avatar
        ) || "/logo.png",

      verified: false,
      balance: 0,
      wagered: 0,
      profit: 0,
      coinflips: 0,
      wins: 0,
      inventory: []
    };

    db.users[id] =
      user;
  }

  if (
    data.username
  ) {
    user.username =
      clean(
        data.username
      );
  }

  if (
    data.avatar
  ) {
    user.avatar =
      clean(
        data.avatar
      );
  }

  if (
    data.verified === true
  ) {
    user.verified =
      true;
  }

  if (
    !Array.isArray(
      user.inventory
    )
  ) {
    user.inventory =
      [];
  }

  user.balance =
    numeric(
      user.balance
    );

  user.wagered =
    numeric(
      user.wagered
    );

  user.profit =
    numeric(
      user.profit
    );

  return user;
}

/* =========================================================
   ROBLOX CACHE
========================================================= */

const robloxCache =
  new Map();

async function withCache(
  key,
  ttlMs,
  fetcher,
  fresh = false
) {
  if (!fresh) {
    const hit =
      robloxCache.get(
        key
      );

    if (
      hit &&
      hit.expires >
        Date.now()
    ) {
      return hit.value;
    }
  }

  const value =
    await fetcher();

  robloxCache.set(
    key,
    {
      value,
      expires:
        Date.now() +
        ttlMs
    }
  );

  return value;
}

setInterval(
  () => {
    const now =
      Date.now();

    for (
      const [key, entry]
      of robloxCache
    ) {
      if (
        entry.expires <=
        now
      ) {
        robloxCache.delete(
          key
        );
      }
    }
  },
  10 * 60 * 1000
).unref();

setInterval(
  () => {
    const now =
      Date.now();

    if (
      !db.refreshTokens
    ) {
      return;
    }

    for (
      const [
        hash,
        entry
      ] of Object.entries(
        db.refreshTokens
      )
    ) {
      if (
        !entry ||
        Number(
          entry.expiresAt
        ) <= now ||
        !safeUserId(
          entry.userId
        )
      ) {
        delete db
          .refreshTokens[
            hash
          ];
      }
    }
  },
  60 * 60 * 1000
).unref();

/* =========================================================
   ROBLOX FETCH
========================================================= */

async function robloxFetch(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      ROBLOX_TIMEOUT_MS
    );

  try {
    return await fetch(
      url,
      {
        ...options,

        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ADMFLIP/2.1)",

          Accept:
            "application/json",

          "Content-Type":
            "application/json",

          ...(options.headers ||
            {})
        },

        signal:
          controller.signal
      }
    );
  } finally {
    clearTimeout(
      timeout
    );
  }
}

async function findRobloxUser(
  username,
  fresh = false
) {
  const cleanUsername =
    clean(username);

  if (
    !cleanUsername
  ) {
    return null;
  }

  return withCache(
    "user:" +
      cleanUsername.toLowerCase(),

    10 * 60 * 1000,

    async () => {
      const response =
        await robloxFetch(
          "https://users.roblox.com/v1/usernames/users",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
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

      if (
        !response.ok
      ) {
        throw new Error(
          `Roblox returned HTTP ${response.status}: ${body.slice(
            0,
            500
          )}`
        );
      }

      let data;

      try {
        data =
          JSON.parse(
            body
          );
      } catch {
        throw new Error(
          "Roblox returned invalid JSON."
        );
      }

      const found =
        Array.isArray(
          data?.data
        )
          ? data.data
          : [];

      return (
        found.find(
          (user) =>
            String(
              user.name
            ).toLowerCase() ===
            cleanUsername.toLowerCase()
        ) ||
        found[0] ||
        null
      );
    },

    fresh
  );
}

async function findRobloxProfile(
  id,
  fresh = false
) {
  return withCache(
    "profile:" +
      String(id),

    10 * 60 * 1000,

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

      if (
        !response.ok
      ) {
        throw new Error(
          `Roblox profile returned HTTP ${response.status}`
        );
      }

      return JSON.parse(
        body
      );
    },

    fresh
  );
}

async function findRobloxAvatar(
  id
) {
  try {
    return await withCache(
      "avatar:" +
        String(id),

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

        if (
          !response.ok
        ) {
          return "";
        }

        const data =
          await response.json();

        return (
          data?.data?.[0]
            ?.imageUrl || ""
        );
      }
    );
  } catch {
    return "";
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      success: true,
      server: "online",
      version:
        "2.3.0-refresh-fixed",
      pets:
        getPets().length,
      cors:
        FRONTEND_ORIGIN
    });
  }
);

/* =========================================================
   PETS
========================================================= */

app.get(
  "/pets",
  (req, res) => {
    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success: true,
      pets:
        getPets()
    });
  }
);

app.get(
  "/api/pets",
  (req, res) => {
    res.json({
      success: true,
      pets:
        getPets()
    });
  }
);

app.get(
  "/pets/:name",
  (req, res) => {
    const requested =
      clean(
        req.params.name
      ).toLowerCase();

    const pet =
      getPets().find(
        (item) =>
          item.name
            .trim()
            .toLowerCase() ===
          requested
      );

    if (!pet) {
      return res
        .status(404)
        .json({
          success: false,
          error:
            "Pet not found."
        });
    }

    res.json({
      success: true,
      pet
    });
  }
);

/* =========================================================
   USER SEARCH
========================================================= */

async function userLookup(
  req,
  res
) {
  const username =
    clean(
      req.params.username
    );

  if (!username) {
    return res
      .status(400)
      .json({
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
      return res
        .status(404)
        .json({
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
      id:
        robloxUser.id,

      username:
        robloxUser.name,

      avatar
    });

    scheduleSave();

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success: true,

      user: {
        id:
          robloxUser.id,

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

    res
      .status(502)
      .json({
        success: false,
        message:
          "Roblox lookup failed."
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
      crypto.randomInt(
        words.length
      )
    ];

  const second =
    words[
      crypto.randomInt(
        words.length
      )
    ];

  const number =
    crypto.randomInt(
      1000,
      10000
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

app.get(
  "/create",
  (req, res) => {
    res.json({
      success: true,
      phrase:
        generatePhrase()
    });
  }
);

app.get(
  "/api/create",
  (req, res) => {
    res.json({
      success: true,
      phrase:
        generatePhrase()
    });
  }
);
"use strict";

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");

const { randomUUID } = crypto;

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

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (() => {
    const generated = crypto.randomBytes(32).toString("hex");

    console.warn(
      "[WARN] SESSION_SECRET not set - using a random secret. " +
      "All sessions will be invalidated on every restart. " +
      "Set SESSION_SECRET in Railway env vars."
    );

    return generated;
  })();

const ADMIN_KEY = process.env.ADMIN_KEY || "";

/* =========================================================
   MIDDLEWARE
========================================================= */

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

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

function safeUserId(value) {
  const s = String(value ?? "").trim();

  return /^\d+$/.test(s) ? s : null;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));

  if (ba.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(ba, bb);
}

function makeId() {
  return randomUUID();
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
  return (user.inventory || []).some(
    (p) =>
      petKey(p) === String(name).toLowerCase()
  );
}

function removePet(user, name) {
  const idx = (user.inventory || []).findIndex(
    (p) =>
      petKey(p) === String(name).toLowerCase()
  );

  if (idx === -1) {
    return null;
  }

  return user.inventory.splice(idx, 1)[0];
}

function addPet(user, pet) {
  if (!Array.isArray(user.inventory)) {
    user.inventory = [];
  }

  user.inventory.push({
    name: pet.name,
    value: pet.value,
    image: pet.image
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
    avatar: user.avatar,
    verified: Boolean(user.verified),
    balance: numeric(user.balance),
    wagered: numeric(user.wagered),
    profit: numeric(user.profit),
    coinflips: user.coinflips || 0,
    wins: user.wins || 0,
    inventory: Array.isArray(user.inventory)
      ? user.inventory
      : []
  };
}

/* =========================================================
   PET VALUES
========================================================= */

function loadPets() {
  if (!fs.existsSync(VALUES_FILE)) {
    console.error(
      "values.txt not found:",
      VALUES_FILE
    );

    return [];
  }

  try {
    const text =
      fs.readFileSync(
        VALUES_FILE,
        "utf8"
      );

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
        /^\[\d+\]$/.test(
          lines[valueIndex]
        )
      ) {
        valueIndex++;
      }

      if (valueIndex >= lines.length) {
        continue;
      }

      const rawValue =
        lines[valueIndex];

      if (
        !/^-?\d+(?:\.\d+)?$/.test(
          rawValue
        )
      ) {
        continue;
      }

      const value = Number(rawValue);

      if (!Number.isFinite(value)) {
        continue;
      }

      result.push({
        id: name
          .toLowerCase()
          .replace(
            /[^a-z0-9]+/g,
            "-"
          )
          .replace(
            /^-|-$/g,
            ""
          ),

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
    const stat =
      fs.statSync(
        VALUES_FILE
      );

    if (
      stat.mtimeMs !==
      petsCache.mtime
    ) {
      petsCache = {
        mtime: stat.mtimeMs,
        pets: loadPets()
      };
    }
  } catch {
    // Keep last good cache.
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
  refreshTokens: Object.create(null)
};

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return;
    }

    const parsed =
      JSON.parse(
        fs.readFileSync(
          DB_FILE,
          "utf8"
        )
      );

    const users =
      Object.create(null);

    for (
      const [key, value]
      of Object.entries(
        parsed.users || {}
      )
    ) {
      if (safeUserId(key)) {
        users[key] = value;
      }
    }

    db.users = users;

    db.coinflips =
      Array.isArray(
        parsed.coinflips
      )
        ? parsed.coinflips
        : [];

    db.chatMessages =
      Array.isArray(
        parsed.chatMessages
      )
        ? parsed.chatMessages
        : [];

    const refreshTokens =
      Object.create(null);

    for (
      const [hash, value]
      of Object.entries(
        parsed.refreshTokens || {}
      )
    ) {
      if (
        /^[a-f0-9]{64}$/i.test(
          hash
        ) &&
        value &&
        safeUserId(
          value.userId
        ) &&
        Number(
          value.expiresAt
        ) > Date.now()
      ) {
        refreshTokens[hash] = {
          userId:
            String(
              value.userId
            ),

          createdAt:
            Number(
              value.createdAt
            ) || Date.now(),

          expiresAt:
            Number(
              value.expiresAt
            )
        };
      }
    }

    db.refreshTokens =
      refreshTokens;

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
    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true
      }
    );

    const tmp =
      DB_FILE + ".tmp";

    fs.writeFileSync(
      tmp,
      JSON.stringify(
        db,
        null,
        2
      )
    );

    fs.renameSync(
      tmp,
      DB_FILE
    );
  } catch (error) {
    console.error(
      "Could not save db:",
      error
    );
  }
}

let saveTimer = null;

function scheduleSave() {
  clearTimeout(
    saveTimer
  );

  saveTimer =
    setTimeout(
      persistNow,
      400
    );
}

function shutdown() {
  console.log(
    "Shutting down, saving db..."
  );

  persistNow();

  process.exit(0);
}

process.on(
  "SIGTERM",
  shutdown
);

process.on(
  "SIGINT",
  shutdown
);

/* =========================================================
   RATE LIMITER
========================================================= */

const rateBuckets =
  new Map();

function rateLimit(
  max,
  windowMs
) {
  return (
    req,
    res,
    next
  ) => {
    const key =
      req.ip ||
      req.socket.remoteAddress ||
      "unknown";

    const now =
      Date.now();

    let bucket =
      rateBuckets.get(
        key
      );

    if (
      !bucket ||
      now > bucket.reset
    ) {
      bucket = {
        count: 0,
        reset:
          now + windowMs
      };

      rateBuckets.set(
        key,
        bucket
      );
    }

    bucket.count += 1;

    if (
      bucket.count > max
    ) {
      return res
        .status(429)
        .json({
          success: false,
          message:
            "Too many requests. Please wait a minute and try again."
        });
    }

    next();
  };
}

setInterval(
  () => {
    const now =
      Date.now();

    for (
      const [key, bucket]
      of rateBuckets
    ) {
      if (
        now > bucket.reset
      ) {
        rateBuckets.delete(
          key
        );
      }
    }
  },
  10 * 60 * 1000
).unref();

/* =========================================================
   AUTH TOKENS
========================================================= */

const ACCESS_TOKEN_TTL_MS =
  Number(
    process.env.ACCESS_TOKEN_TTL_MS
  ) ||
  15 * 60 * 1000;

const REFRESH_TOKEN_TTL_MS =
  Number(
    process.env.REFRESH_TOKEN_TTL_MS
  ) ||
  30 * 24 * 60 * 60 * 1000;

const MAX_REFRESH_TOKENS_PER_USER = 5;

if (
  !db.refreshTokens ||
  typeof db.refreshTokens !==
    "object"
) {
  db.refreshTokens =
    Object.create(null);
}

function hashRefreshToken(
  token
) {
  return crypto
    .createHash("sha256")
    .update(
      String(token)
    )
    .digest("hex");
}

function issueAccessToken(
  userId
) {
  const body =
    `${userId}.${Date.now()}`;

  const sig =
    crypto
      .createHmac(
        "sha256",
        SESSION_SECRET
      )
      .update(body)
      .digest(
        "base64url"
      );

  return `${body}.${sig}`;
}

function verifyAccessToken(
  token
) {
  const parts =
    String(token || "")
      .split(".");

  if (
    parts.length !== 3
  ) {
    return null;
  }

  const [
    userId,
    issuedAt,
    sig
  ] = parts;

  if (
    !/^\d+$/.test(
      userId
    )
  ) {
    return null;
  }

  const issued =
    Number(issuedAt);

  if (
    !Number.isFinite(
      issued
    )
  ) {
    return null;
  }

  const expected =
    crypto
      .createHmac(
        "sha256",
        SESSION_SECRET
      )
      .update(
        `${userId}.${issuedAt}`
      )
      .digest(
        "base64url"
      );

  if (
    !safeEqual(
      sig,
      expected
    )
  ) {
    return null;
  }

  const age =
    Date.now() -
    issued;

  if (
    age < 0 ||
    age >
      ACCESS_TOKEN_TTL_MS
  ) {
    return null;
  }

  return userId;
}

function issueRefreshToken(
  userId
) {
  const raw =
    crypto
      .randomBytes(48)
      .toString(
        "base64url"
      );

  const tokenHash =
    hashRefreshToken(
      raw
    );

  const now =
    Date.now();

  db.refreshTokens[
    tokenHash
  ] = {
    userId:
      String(userId),

    createdAt:
      now,

    expiresAt:
      now +
      REFRESH_TOKEN_TTL_MS
  };

  const entries =
    Object.entries(
      db.refreshTokens
    )
      .filter(
        ([, item]) =>
          item &&
          String(
            item.userId
          ) ===
            String(userId)
      )
      .sort(
        (a, b) =>
          Number(
            b[1].createdAt ||
              0
          ) -
          Number(
            a[1].createdAt ||
              0
          )
      );

  for (
    let i =
      MAX_REFRESH_TOKENS_PER_USER;
    i < entries.length;
    i++
  ) {
    delete db.refreshTokens[
      entries[i][0]
    ];
  }

  scheduleSave();

  return raw;
}

function rotateRefreshToken(
  rawRefreshToken
) {
  const token =
    clean(
      rawRefreshToken
    );

  if (!token) {
    return null;
  }

  const oldHash =
    hashRefreshToken(
      token
    );

  const record =
    db.refreshTokens[
      oldHash
    ];

  if (!record) {
    return null;
  }

  if (
    !record.expiresAt ||
    Number(
      record.expiresAt
    ) <= Date.now() ||
    !safeUserId(
      record.userId
    ) ||
    !getUser(
      record.userId
    )
  ) {
    delete db.refreshTokens[
      oldHash
    ];

    scheduleSave();

    return null;
  }

  delete db.refreshTokens[
    oldHash
  ];

  const newRefreshToken =
    issueRefreshToken(
      record.userId
    );

  const accessToken =
    issueAccessToken(
      record.userId
    );

  return {
    userId:
      record.userId,

    accessToken,

    refreshToken:
      newRefreshToken
  };
}

function userIdFromRequest(
  req
) {
  const header =
    req.get(
      "authorization"
    ) || "";

  if (
    !header.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  return verifyAccessToken(
    header.slice(7).trim()
  );
}

/* =========================================================
   USER HELPERS
========================================================= */

function getUser(id) {
  const safe =
    safeUserId(id);

  return safe
    ? db.users[safe] ||
        null
    : null;
}

function createOrUpdateUser(
  data
) {
  const id =
    safeUserId(
      data.id ??
        data.robloxId ??
        data.userId
    );

  if (!id) {
    return null;
  }

  let user =
    db.users[id];

  if (!user) {
    user = {
      id,
      robloxId: id,
      username:
        clean(
          data.username
        ) || "User",

      avatar:
        clean(
          data.avatar
        ) || "/logo.png",

      verified: false,
      balance: 0,
      wagered: 0,
      profit: 0,
      coinflips: 0,
      wins: 0,
      inventory: []
    };

    db.users[id] =
      user;
  }

  if (
    data.username
  ) {
    user.username =
      clean(
        data.username
      );
  }

  if (
    data.avatar
  ) {
    user.avatar =
      clean(
        data.avatar
      );
  }

  if (
    data.verified === true
  ) {
    user.verified =
      true;
  }

  if (
    !Array.isArray(
      user.inventory
    )
  ) {
    user.inventory =
      [];
  }

  user.balance =
    numeric(
      user.balance
    );

  user.wagered =
    numeric(
      user.wagered
    );

  user.profit =
    numeric(
      user.profit
    );

  return user;
}

/* =========================================================
   ROBLOX CACHE
========================================================= */

const robloxCache =
  new Map();

async function withCache(
  key,
  ttlMs,
  fetcher,
  fresh = false
) {
  if (!fresh) {
    const hit =
      robloxCache.get(
        key
      );

    if (
      hit &&
      hit.expires >
        Date.now()
    ) {
      return hit.value;
    }
  }

  const value =
    await fetcher();

  robloxCache.set(
    key,
    {
      value,
      expires:
        Date.now() +
        ttlMs
    }
  );

  return value;
}

setInterval(
  () => {
    const now =
      Date.now();

    for (
      const [key, entry]
      of robloxCache
    ) {
      if (
        entry.expires <=
        now
      ) {
        robloxCache.delete(
          key
        );
      }
    }
  },
  10 * 60 * 1000
).unref();

setInterval(
  () => {
    const now =
      Date.now();

    if (
      !db.refreshTokens
    ) {
      return;
    }

    for (
      const [
        hash,
        entry
      ] of Object.entries(
        db.refreshTokens
      )
    ) {
      if (
        !entry ||
        Number(
          entry.expiresAt
        ) <= now ||
        !safeUserId(
          entry.userId
        )
      ) {
        delete db
          .refreshTokens[
            hash
          ];
      }
    }
  },
  60 * 60 * 1000
).unref();

/* =========================================================
   ROBLOX FETCH
========================================================= */

async function robloxFetch(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      ROBLOX_TIMEOUT_MS
    );

  try {
    return await fetch(
      url,
      {
        ...options,

        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ADMFLIP/2.1)",

          Accept:
            "application/json",

          "Content-Type":
            "application/json",

          ...(options.headers ||
            {})
        },

        signal:
          controller.signal
      }
    );
  } finally {
    clearTimeout(
      timeout
    );
  }
}

async function findRobloxUser(
  username,
  fresh = false
) {
  const cleanUsername =
    clean(username);

  if (
    !cleanUsername
  ) {
    return null;
  }

  return withCache(
    "user:" +
      cleanUsername.toLowerCase(),

    10 * 60 * 1000,

    async () => {
      const response =
        await robloxFetch(
          "https://users.roblox.com/v1/usernames/users",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
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

      if (
        !response.ok
      ) {
        throw new Error(
          `Roblox returned HTTP ${response.status}: ${body.slice(
            0,
            500
          )}`
        );
      }

      let data;

      try {
        data =
          JSON.parse(
            body
          );
      } catch {
        throw new Error(
          "Roblox returned invalid JSON."
        );
      }

      const found =
        Array.isArray(
          data?.data
        )
          ? data.data
          : [];

      return (
        found.find(
          (user) =>
            String(
              user.name
            ).toLowerCase() ===
            cleanUsername.toLowerCase()
        ) ||
        found[0] ||
        null
      );
    },

    fresh
  );
}

async function findRobloxProfile(
  id,
  fresh = false
) {
  return withCache(
    "profile:" +
      String(id),

    10 * 60 * 1000,

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

      if (
        !response.ok
      ) {
        throw new Error(
          `Roblox profile returned HTTP ${response.status}`
        );
      }

      return JSON.parse(
        body
      );
    },

    fresh
  );
}

async function findRobloxAvatar(
  id
) {
  try {
    return await withCache(
      "avatar:" +
        String(id),

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

        if (
          !response.ok
        ) {
          return "";
        }

        const data =
          await response.json();

        return (
          data?.data?.[0]
            ?.imageUrl || ""
        );
      }
    );
  } catch {
    return "";
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      success: true,
      server: "online",
      version:
        "2.3.0-refresh-fixed",
      pets:
        getPets().length,
      cors:
        FRONTEND_ORIGIN
    });
  }
);

/* =========================================================
   PETS
========================================================= */

app.get(
  "/pets",
  (req, res) => {
    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success: true,
      pets:
        getPets()
    });
  }
);

app.get(
  "/api/pets",
  (req, res) => {
    res.json({
      success: true,
      pets:
        getPets()
    });
  }
);

app.get(
  "/pets/:name",
  (req, res) => {
    const requested =
      clean(
        req.params.name
      ).toLowerCase();

    const pet =
      getPets().find(
        (item) =>
          item.name
            .trim()
            .toLowerCase() ===
          requested
      );

    if (!pet) {
      return res
        .status(404)
        .json({
          success: false,
          error:
            "Pet not found."
        });
    }

    res.json({
      success: true,
      pet
    });
  }
);

/* =========================================================
   USER SEARCH
========================================================= */

async function userLookup(
  req,
  res
) {
  const username =
    clean(
      req.params.username
    );

  if (!username) {
    return res
      .status(400)
      .json({
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
      return res
        .status(404)
        .json({
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
      id:
        robloxUser.id,

      username:
        robloxUser.name,

      avatar
    });

    scheduleSave();

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success: true,

      user: {
        id:
          robloxUser.id,

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

    res
      .status(502)
      .json({
        success: false,
        message:
          "Roblox lookup failed."
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
      crypto.randomInt(
        words.length
      )
    ];

  const second =
    words[
      crypto.randomInt(
        words.length
      )
    ];

  const number =
    crypto.randomInt(
      1000,
      10000
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

app.get(
  "/create",
  (req, res) => {
    res.json({
      success: true,
      phrase:
        generatePhrase()
    });
  }
);

app.get(
  "/api/create",
  (req, res) => {
    res.json({
      success: true,
      phrase:
        generatePhrase()
    });
  }
);
