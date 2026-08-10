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

const PORT =
  Number(process.env.PORT) || 10000;

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

const DB_FILE =
  path.join(DATA_DIR, "db.json");

const PUBLIC_DIR =
  process.env.PUBLIC_DIR ||
  path.join(__dirname, "public");

const ROBLOX_TIMEOUT_MS =
  Number(
    process.env.ROBLOX_TIMEOUT_MS
  ) || 15000;

const MAX_CHAT_MESSAGES = 200;
const MAX_COINFLIPS = 100;

const ROBLOX_CACHE_TTL =
  10 * 60 * 1000;

const AVATAR_CACHE_TTL =
  60 * 60 * 1000;

const ROBLOX_RATE_MAX = 20;
const ROBLOX_RATE_WINDOW =
  60 * 1000;

/*
 * VERY IMPORTANT:
 *
 * Set SESSION_SECRET in Railway.
 *
 * Do not allow Railway to generate a new
 * secret on every restart.
 */
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (() => {
    const generated =
      crypto
        .randomBytes(32)
        .toString("hex");

    console.warn(
      "[WARN] SESSION_SECRET is not set."
    );

    console.warn(
      "[WARN] Sessions will be invalidated after restart."
    );

    return generated;
  })();

/*
 * Access token lifetime.
 *
 * 15 minutes is intentional because
 * refresh tokens keep the user logged in.
 */
const ACCESS_TOKEN_TTL_MS =
  Number(
    process.env.ACCESS_TOKEN_TTL_MS
  ) ||
  15 * 60 * 1000;

/*
 * Refresh token lifetime.
 *
 * Default: 30 days.
 */
const REFRESH_TOKEN_TTL_MS =
  Number(
    process.env.REFRESH_TOKEN_TTL_MS
  ) ||
  30 * 24 * 60 * 60 * 1000;

const ADMIN_KEY =
  process.env.ADMIN_KEY || "";


/* =========================================================
   MIDDLEWARE
========================================================= */

app.set(
  "trust proxy",
  1
);

app.disable(
  "x-powered-by"
);

app.use(
  helmet({
    contentSecurityPolicy:
      false
  })
);

app.use(
  cors({
    origin:
      FRONTEND_ORIGIN,
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

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  (req, res, next) => {
    const start =
      Date.now();

    res.on(
      "finish",
      () => {
        console.log(
          `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`
        );
      }
    );

    next();
  }
);


/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(
    value ?? ""
  ).trim();
}

function numeric(value) {
  const n =
    Number(
      String(value ?? "")
        .replace(/,/g, "")
        .replace(
          /[^0-9.-]/g,
          ""
        )
    );

  return Number.isFinite(n)
    ? n
    : 0;
}

function safeUserId(value) {
  const s =
    String(
      value ?? ""
    ).trim();

  return /^\d+$/.test(s)
    ? s
    : null;
}

function safeEqual(a, b) {
  const ba =
    Buffer.from(
      String(a)
    );

  const bb =
    Buffer.from(
      String(b)
    );

  if (
    ba.length !==
    bb.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    ba,
    bb
  );
}

function makeId() {
  return randomUUID();
}

function petImage(name) {
  return (
    "https://amvgg.com/items/" +
    encodeURIComponent(
      String(name)
    ) +
    ".webp"
  );
}

function petKey(value) {
  return String(
    value?.name ??
    value ??
    ""
  )
    .trim()
    .toLowerCase();
}

function ownsPet(
  user,
  name
) {
  return (
    user.inventory || []
  ).some(
    (p) =>
      petKey(p) ===
      String(name)
        .toLowerCase()
  );
}

function removePet(
  user,
  name
) {
  const idx =
    (
      user.inventory ||
      []
    ).findIndex(
      (p) =>
        petKey(p) ===
        String(name)
          .toLowerCase()
    );

  if (idx === -1) {
    return null;
  }

  return user.inventory.splice(
    idx,
    1
  )[0];
}

function addPet(
  user,
  pet
) {
  if (
    !Array.isArray(
      user.inventory
    )
  ) {
    user.inventory = [];
  }

  user.inventory.push({
    name:
      pet.name,

    value:
      pet.value,

    image:
      pet.image
  });
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id:
      user.id,

    robloxId:
      user.robloxId,

    username:
      user.username,

    avatar:
      user.avatar,

    verified:
      Boolean(
        user.verified
      ),

    balance:
      numeric(
        user.balance
      ),

    wagered:
      numeric(
        user.wagered
      ),

    profit:
      numeric(
        user.profit
      ),

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
  };
}


/* =========================================================
   PET VALUES
========================================================= */

function loadPets() {
  if (
    !fs.existsSync(
      VALUES_FILE
    )
  ) {
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

    const lines =
      text
        .split(/\r?\n/)
        .map(
          (line) =>
            line.trim()
        )
        .filter(Boolean);

    const result = [];

    for (
      let i = 0;
      i < lines.length;
      i++
    ) {
      const name =
        lines[i];

      if (
        /^\[\d+\]$/.test(
          name
        )
      ) {
        continue;
      }

      let valueIndex =
        i + 1;

      while (
        valueIndex <
          lines.length &&
        /^\[\d+\]$/.test(
          lines[
            valueIndex
          ]
        )
      ) {
        valueIndex++;
      }

      if (
        valueIndex >=
        lines.length
      ) {
        continue;
      }

      const rawValue =
        lines[
          valueIndex
        ];

      if (
        !/^-?\d+(?:\.\d+)?$/.test(
          rawValue
        )
      ) {
        continue;
      }

      const value =
        Number(
          rawValue
        );

      if (
        !Number.isFinite(
          value
        )
      ) {
        continue;
      }

      result.push({
        id:
          name
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

        image:
          petImage(name)
      });

      i =
        valueIndex;
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
        mtime:
          stat.mtimeMs,

        pets:
          loadPets()
      };
    }
  } catch {}

  return petsCache.pets;
}


/* =========================================================
   DATABASE
========================================================= */

let db = {
  users:
    Object.create(null),

  coinflips: [],

  chatMessages: [],

  refreshTokens:
    Object.create(null)
};

function loadDb() {
  try {
    if (
      !fs.existsSync(
        DB_FILE
      )
    ) {
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
      const [
        key,
        value
      ] of Object.entries(
        parsed.users || {}
      )
    ) {
      if (
        safeUserId(key)
      ) {
        users[key] =
          value;
      }
    }

    const refreshTokens =
      Object.create(null);

    for (
      const [
        tokenId,
        value
      ] of Object.entries(
        parsed.refreshTokens ||
          {}
      )
    ) {
      if (
        typeof tokenId ===
          "string" &&
        value &&
        safeUserId(
          value.userId
        )
      ) {
        refreshTokens[
          tokenId
        ] = value;
      }
    }

    db.users =
      users;

    db.refreshTokens =
      refreshTokens;

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

    console.log(
      `Loaded db (${Object.keys(db.users).length} users, ${db.coinflips.length} coinflips, ${db.chatMessages.length} chat msgs)`
    );
  } catch (error) {
    console.error(
      "Could not load db:",
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
      DB_FILE +
      ".tmp";

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

let saveTimer =
  null;

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
      req.socket
        .remoteAddress ||
      "unknown";

    const now =
      Date.now();

    let bucket =
      rateBuckets.get(
        key
      );

    if (
      !bucket ||
      now >
        bucket.reset
    ) {
      bucket = {
        count: 0,

        reset:
          now +
          windowMs
      };

      rateBuckets.set(
        key,
        bucket
      );
    }

    bucket.count++;

    if (
      bucket.count >
      max
    ) {
      return res
        .status(429)
        .json({
          success:
            false,

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
      const [
        key,
        bucket
      ] of rateBuckets
    ) {
      if (
        now >
        bucket.reset
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
   ACCESS TOKENS
========================================================= */

/*
 * Access token:
 *
 * userId.timestamp.signature
 */
function issueToken(
  userId
) {
  const body =
    `${userId}.${Date.now()}`;

  const signature =
    crypto
      .createHmac(
        "sha256",
        SESSION_SECRET
      )
      .update(body)
      .digest(
        "base64url"
      );

  return (
    `${body}.${signature}`
  );
}

function verifyAccessToken(
  token
) {
  if (
    !token
  ) {
    return null;
  }

  const parts =
    String(token)
      .split(".");

  if (
    parts.length !==
    3
  ) {
    return null;
  }

  const [
    userId,
    issuedAt,
    signature
  ] = parts;

  if (
    !/^\d+$/.test(
      userId
    )
  ) {
    return null;
  }

  const issued =
    Number(
      issuedAt
    );

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
      signature,
      expected
    )
  ) {
    return null;
  }

  if (
    Date.now() -
      issued >
    ACCESS_TOKEN_TTL_MS
  ) {
    return null;
  }

  return userId;
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
    header
      .slice(7)
      .trim()
  );
}


/* =========================================================
   REFRESH TOKENS
========================================================= */

/*
 * Refresh token format:
 *
 * randomId.secret
 *
 * Only the hash of the random secret is
 * stored in the database.
 */

function hashRefreshSecret(
  secret
) {
  return crypto
    .createHash("sha256")
    .update(
      String(secret)
    )
    .digest("hex");
}

function issueRefreshToken(
  userId
) {
  const tokenId =
    randomUUID();

  const secret =
    crypto
      .randomBytes(48)
      .toString("base64url");

  const token =
    `${tokenId}.${secret}`;

  db.refreshTokens[
    tokenId
  ] = {
    userId,

    secretHash:
      hashRefreshSecret(
        secret
      ),

    createdAt:
      Date.now(),

    expiresAt:
      Date.now() +
      REFRESH_TOKEN_TTL_MS
  };

  scheduleSave();

  return token;
}

function consumeRefreshToken(
  token
) {
  if (
    !token ||
    typeof token !==
      "string"
  ) {
    return null;
  }

  const dot =
    token.indexOf(
      "."
    );

  if (
    dot <= 0
  ) {
    return null;
  }

  const tokenId =
    token.slice(
      0,
      dot
    );

  const secret =
    token.slice(
      dot + 1
    );

  const record =
    db.refreshTokens[
      tokenId
    ];

  if (
    !record
  ) {
    return null;
  }

  if (
    Date.now() >
    Number(
      record.expiresAt
    )
  ) {
    delete db
      .refreshTokens[
        tokenId
      ];

    scheduleSave();

    return null;
  }

  const expected =
    hashRefreshSecret(
      secret
    );

  if (
    !safeEqual(
      expected,
      record.secretHash
    )
  ) {
    return null;
  }

  /*
   * Rotation:
   *
   * Delete the old refresh token immediately.
   * A new one is issued below.
   */
  delete db
    .refreshTokens[
      tokenId
    ];

  scheduleSave();

  return safeUserId(
    record.userId
  );
}


/* =========================================================
   USER HELPERS
========================================================= */

function getUser(id) {
  const safe =
    safeUserId(id);

  return safe
    ? db.users[
        safe
      ] || null
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

      robloxId:
        id,

      username:
        clean(
          data.username
        ) ||
        "User",

      avatar:
        clean(
          data.avatar
        ) ||
        "/logo.png",

      verified:
        false,

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
    data.verified ===
    true
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
      const [
        key,
        entry
      ] of robloxCache
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
            "Mozilla/5.0 (compatible; ADMFLIP/2.2)",

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


/* =========================================================
   ROBLOX USERNAME SEARCH
========================================================= */

async function findRobloxUser(
  username,
  fresh = false
) {
  const cleanUsername =
    clean(
      username
    );

  if (
    !cleanUsername
  ) {
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
            method:
              "POST",

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
          `Roblox returned HTTP ${response.status}`
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

      const exact =
        found.find(
          (user) =>
            String(
              user.name
            ).toLowerCase() ===
            cleanUsername.toLowerCase()
        );

      return (
        exact ||
        found[0] ||
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
  return withCache(
    "profile:" +
      String(id),

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

      if (
        !response.ok
      ) {
        throw new Error(
          `Roblox profile returned HTTP ${response.status}`
        );
      }

      try {
        return JSON.parse(
          body
        );
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

        const body =
          await response.text();

        if (
          !response.ok
        ) {
          return "";
        }

        try {
          const data =
            JSON.parse(
              body
            );

          return (
            data?.data?.[0]
              ?.imageUrl ||
            ""
          );
        } catch {
          return "";
        }
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
      success:
        true,

      server:
        "online",

      version:
        "2.3.0-auth-fixed",

      pets:
        getPets().length,

      cors:
        FRONTEND_ORIGIN,

      auth: {
        account:
          true,

        check:
          true,

        refresh:
          true,

        logout:
          true
      }
    });
  }
);


/* =========================================================
   PETS
========================================================= */

app.get(
  "/pets",
  (req, res) => {
    try {
      const loaded =
        getPets();

      res.set(
        "Cache-Control",
        "no-store"
      );

      res.json({
        success:
          true,

        pets:
          loaded
      });
    } catch {
      res.status(500).json({
        success:
          false,

        pets: [],

        error:
          "Unable to load pet values."
      });
    }
  }
);

app.get(
  "/api/pets",
  (req, res) => {
    res.json({
      success:
        true,

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
          success:
            false,

          error:
            "Pet not found."
        });
    }

    res.json({
      success:
        true,

      pet
    });
  }
);


/* =========================================================
   ROBLOX USER
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
        success:
          false,

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
          success:
            false,

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
      success:
        true,

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
  } catch {
    res.status(502).json({
      success:
        false,

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
      success:
        true,

      phrase:
        generatePhrase()
    });
  }
);

app.get(
  "/api/create",
  (req, res) => {
    res.json({
      success:
        true,

      phrase:
        generatePhrase()
    });
  }
);

async function verifyRobloxBio(
  req,
  res
) {
  try {
    const username =
      clean(
        req.body?.username
      );

    const phrase =
      clean(
        req.body?.phrase
      );

    if (
      !username ||
      !phrase
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

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
      return res
        .status(404)
        .json({
          success:
            false,

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
      clean(
        profile?.description
      );

    if (
      !description
        .toLowerCase()
        .includes(
          phrase.toLowerCase()
        )
    ) {
      return res.json({
        success:
          false,

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
        id:
          robloxUser.id,

        username:
          profile.name ||
          robloxUser.name,

        avatar,

        verified:
          true
      });

    scheduleSave();

    /*
     * Issue BOTH tokens.
     */
    const accessToken =
      issueToken(
        robloxUser.id
      );

    const refreshToken =
      issueRefreshToken(
        robloxUser.id
      );

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success:
        true,

      /*
       * Keep "token" for compatibility
       * with your existing app.js.
       */
      token:
        accessToken,

      accessToken,

      refreshToken,

      id:
        robloxUser.id,

      userId:
        robloxUser.id,

      username:
        profile.name ||
        robloxUser.name,

      avatar,

      user:
        publicUser(user)
    });
  } catch (error) {
    console.error(
      "BIO VERIFICATION FAILED:",
      error
    );

    res.status(502).json({
      success:
        false,

      message:
        "Roblox bio check failed."
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

function authenticatedAccount(
  req,
  res
) {
  const id =
    userIdFromRequest(
      req
    );

  if (!id) {
    return res
      .status(401)
      .json({
        success:
          false,

        message:
          "Not authenticated."
      });
  }

  const user =
    getUser(id);

  if (!user) {
    return res
      .status(401)
      .json({
        success:
          false,

        message:
          "Account not found."
      });
  }

  res.set(
    "Cache-Control",
    "no-store"
  );

  return res.json({
    success:
      true,

    user:
      publicUser(user)
  });
}

/*
 * THIS IS THE ROUTE YOUR FRONTEND
 * WAS GETTING 404 FOR.
 */
app.get(
  "/account",
  rateLimit(
    60,
    60000
  ),
  authenticatedAccount
);

app.get(
  "/api/account",
  rateLimit(
    60,
    60000
  ),
  authenticatedAccount
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
      safeUserId(
        req.params.robloxId
      );

    if (!id) {
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            "Invalid Roblox ID."
        });
    }

    let user =
      getUser(id);

    if (!user) {
      const profile =
        await findRobloxProfile(
          id
        );

      const avatar =
        await findRobloxAvatar(
          id
        );

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

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success:
        true,

      user:
        publicUser(user)
    });
  } catch (error) {
    console.error(
      "Account:",
      error
    );

    res.status(404).json({
      success:
        false,

      message:
        "Account could not be loaded."
    });
  }
}

app.get(
  "/account/:robloxId",
  rateLimit(
    60,
    60000
  ),
  accountHandler
);

app.get(
  "/api/account/:robloxId",
  rateLimit(
    60,
    60000
  ),
  accountHandler
);


/* =========================================================
   REFRESH TOKEN
========================================================= */

async function refreshHandler(
  req,
  res
) {
  try {
    const refreshToken =
      clean(
        req.body?.refreshToken
      );

    if (!refreshToken) {
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            "Refresh token required."
        });
    }

    const userId =
      consumeRefreshToken(
        refreshToken
      );

    if (!userId) {
      return res
        .status(401)
        .json({
          success:
            false,

          message:
            "Refresh token is invalid or expired."
        });
    }

    const user =
      getUser(userId);

    if (!user) {
      return res
        .status(401)
        .json({
          success:
            false,

          message:
            "Account not found."
        });
    }

    /*
     * Issue a fresh access token.
     */
    const accessToken =
      issueToken(
        userId
      );

    /*
     * Rotate refresh token.
     */
    const newRefreshToken =
      issueRefreshToken(
        userId
      );

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success:
        true,

      token:
        accessToken,

      accessToken,

      refreshToken:
        newRefreshToken,

      user:
        publicUser(user)
    });
  } catch (error) {
    console.error(
      "REFRESH ERROR:",
      error
    );

    res.status(500).json({
      success:
        false,

      message:
        "Unable to refresh session."
    });
  }
}

app.post(
  "/refresh",
  rateLimit(
    30,
    60000
  ),
  refreshHandler
);

app.post(
  "/api/refresh",
  rateLimit(
    30,
    60000
  ),
  refreshHandler
);


/* =========================================================
   LOGOUT
========================================================= */

function logoutHandler(
  req,
  res
) {
  /*
   * Access tokens are stateless.
   *
   * The browser removes its access token.
   *
   * For refresh-token logout, if the client
   * sends its refresh token, remove it.
   */
  const refreshToken =
    clean(
      req.body?.refreshToken
    );

  if (refreshToken) {
    const dot =
      refreshToken.indexOf(
        "."
      );

    if (dot > 0) {
      const tokenId =
        refreshToken.slice(
          0,
          dot
        );

      delete db
        .refreshTokens[
          tokenId
        ];

      scheduleSave();
    }
  }

  res.json({
    success:
      true
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
      success:
        true,

      messages:
        db.chatMessages.slice(
          -100
        )
    });
  }
);

app.get(
  "/api/chat/messages",
  (req, res) => {
    res.json({
      success:
        true,

      messages:
        db.chatMessages.slice(
          -100
        )
    });
  }
);

function createChatMessage(
  req,
  res
) {
  const userId =
    userIdFromRequest(
      req
    );

  if (!userId) {
    return res
      .status(401)
      .json({
        success:
          false,

        message:
          "Sign in to chat."
      });
  }

  const user =
    getUser(userId);

  if (!user) {
    return res
      .status(401)
      .json({
        success:
          false,

        message:
          "Sign in to chat."
      });
  }

  let message =
    clean(
      req.body?.message
    ).replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ""
    );

  if (!message) {
    return res
      .status(400)
      .json({
        success:
          false,

        message:
          "Message is empty."
      });
  }

  if (
    message.length >
    250
  ) {
    return res
      .status(400)
      .json({
        success:
          false,

        message:
          "Message is too long."
      });
  }

  if (
    hasLink(message)
  ) {
    return res
      .status(400)
      .json({
        success:
          false,

        message:
          "Links are not allowed in chat."
      });
  }

  const chatMessage =
    {
      id:
        makeId(),

      username:
        user.username,

      robloxId:
        user.id,

      avatar:
        user.avatar ||
        "/logo.png",

      message,

      type:
        "message",

      pinned:
        false,

      createdAt:
        Date.now()
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
    success:
      true,

    message:
      chatMessage
  });
}

app.post(
  "/chat/messages",
  rateLimit(
    10,
    60000
  ),
  createChatMessage
);

app.post(
  "/api/chat/messages",
  rateLimit(
    10,
    60000
  ),
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
            message.type !==
              "announcement" &&
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
      success:
        true,

      online,

      count:
        online,

      onlineCount:
        online
    });
  }
);

app.get(
  "/api/chat/online",
  (req, res) => {
    const online =
      getOnlineCount();

    res.json({
      success:
        true,

      online,

      count:
        online,

      onlineCount:
        online
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
          flip.status ===
          "active"
      );

    const totalValue =
      active.reduce(
        (
          sum,
          flip
        ) =>
          sum +
          numeric(
            flip.petValue
          ),
        0
      );

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success:
        true,

      coinflips:
        active,

      total:
        active.length,

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
          flip.status ===
          "active"
      );

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success:
        true,

      coinflips:
        active
    });
  }
);

function findServerPet(
  name
) {
  return getPets().find(
    (pet) =>
      pet.name.toLowerCase() ===
      String(name)
        .toLowerCase()
  );
}

function createCoinflip(
  req,
  res
) {
  const userId =
    userIdFromRequest(
      req
    );

  if (!userId) {
    return res
      .status(401)
      .json({
        success:
          false,

        message:
          "Sign in first."
      });
  }

  const user =
    getUser(userId);

  if (!user) {
    return res
      .status(401)
      .json({
        success:
          false,

        message:
          "Sign in first."
      });
  }

  if (!user.verified) {
    return res
      .status(403)
      .json({
        success:
          false,

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
    return res
      .status(400)
      .json({
        success:
          false,

        message:
          "Choose heads or tails."
      });
  }

  const name =
    clean(
      req.body?.pet?.name ??
      req.body?.petName
    );

  if (!name) {
    return res
      .status(400)
      .json({
        success:
          false,

        message:
          "Select a pet."
      });
  }

  const serverPet =
    findServerPet(name);

  if (!serverPet) {
    return res
      .status(400)
      .json({
        success:
          false,

        message:
          "That pet is not in the current value list."
      });
  }

  if (
    !ownsPet(
      user,
      serverPet.name
    )
  ) {
    return res
      .status(403)
      .json({
        success:
          false,

        message:
          "You don't own this pet."
      });
  }

  removePet(
    user,
    serverPet.name
  );

  user.wagered =
    numeric(
      user.wagered
    ) +
    serverPet.value;

  user.coinflips =
    (user.coinflips ||
      0) +
    1;

  const flip = {
    id:
      makeId(),

    username:
      user.username,

    userId:
      user.id,

    robloxId:
      user.id,

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

    status:
      "active",

    createdAt:
      Date.now(),

    acceptedBy:
      null,

    challengerPetName:
      null,

    challengerPetValue:
      null,

    toss:
      null,

    winnerUserId:
      null,

    loserUserId:
      null,

    resolvedAt:
      null,

    cancelledAt:
      null
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

  res
    .status(201)
    .json({
      success:
        true,

      coinflip:
        flip
    });
}

app.post(
  "/coinflips",
  rateLimit(
    10,
    60000
  ),
  createCoinflip
);

app.post(
  "/api/coinflips",
  rateLimit(
    10,
    60000
  ),
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
    Object.values(
      db.users
    )
      .sort(
        (a, b) =>
          numeric(
            b.wagered
          ) -
          numeric(
            a.wagered
          )
      )
      .slice(
        0,
        10
      )
      .map(
        (
          user,
          index
        ) => ({
          place:
            index + 1,

          username:
            user.username,

          avatar:
            user.avatar ||
            "/logo.png",

          wagered:
            user.wagered ||
            0,

          profit:
            user.profit ||
            0
        })
      );

  res.set(
    "Cache-Control",
    "no-store"
  );

  res.json({
    success:
      true,

    users:
      leaderboard
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
        flip.status ===
        "active"
    );

  res.set(
    "Cache-Control",
    "no-store"
  );

  res.json({
    success:
      true,

    online:
      true,

    announcement:
      "",

    activeCoinflips:
      active.length,

    totalCoinflipValue:
      active.reduce(
        (
          sum,
          flip
        ) =>
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

app.get(
  "/api",
  (req, res) => {
    res.json({
      success:
        true,

      name:
        "ADMFLIP API",

      version:
        "2.3.0-auth-fixed",

      cors:
        FRONTEND_ORIGIN,

      endpoints: [
        "GET /health",
        "GET /pets",
        "GET /pets/:name",
        "GET /user/:username",
        "GET /create",

        "POST /check",

        "GET /account",

        "GET /account/:robloxId",

        "POST /refresh",

        "POST /logout",

        "GET /coinflips",
        "POST /coinflips",

        "GET /chat/messages",
        "POST /chat/messages",

        "GET /chat/online",

        "GET /leaderboard",

        "GET /status"
      ]
    });
  }
);


/* =========================================================
   OPTIONAL STATIC FRONTEND
========================================================= */

if (
  fs.existsSync(
    PUBLIC_DIR
  )
) {
  app.use(
    express.static(
      PUBLIC_DIR,
      {
        index:
          false,

        maxAge:
          "1h"
      }
    )
  );
}

app.get(
  "/",
  (req, res) => {
    const index =
      path.join(
        PUBLIC_DIR,
        "index.html"
      );

    if (
      fs.existsSync(
        index
      )
    ) {
      return res.sendFile(
        index
      );
    }

    res.json({
      success:
        true,

      server:
        "online",

      message:
        "ADMFLIP API - frontend is hosted separately."
    });
  }
);


/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      success:
        false,

      error:
        "API route not found.",

      path:
        req.originalUrl
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

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    if (
      error.type ===
      "entity.too.large"
    ) {
      return res
        .status(413)
        .json({
          success:
            false,

          message:
            "Request body too large."
        });
    }

    if (
      error.type ===
      "entity.parse.failed"
    ) {
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            "Invalid JSON body."
        });
    }

    res.status(500).json({
      success:
        false,

      message:
        "Internal server error."
    });
  }
);


/* =========================================================
   START
========================================================= */

loadDb();

if (
  !db.chatMessages.some(
    (m) =>
      m.id ===
      "welcome"
  )
) {
  db.chatMessages.unshift({
    id:
      "welcome",

    username:
      "ADMFLIP",

    robloxId:
      null,

    avatar:
      "/logo.png",

    message:
      "Welcome to ADMFLIP.",

    type:
      "announcement",

    pinned:
      true,

    createdAt:
      Date.now()
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
      "ADMFLIP backend v2.3.0-auth-fixed started"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Pets loaded:",
      getPets().length
    );

    console.log(
      "CORS origins:",
      FRONTEND_ORIGIN.join(
        ", "
      )
    );

    console.log(
      "Access token TTL:",
      ACCESS_TOKEN_TTL_MS
    );

    console.log(
      "Refresh token TTL:",
      REFRESH_TOKEN_TTL_MS
    );

    console.log(
      "========================================"
    );
  }
);


/* =========================================================
   OPTIONAL TELEGRAM BOT
========================================================= */

try {
  require("./bot");

  console.log(
    "[TELEGRAM] bot.js loaded successfully"
  );
} catch (error) {
  console.error(
    "[TELEGRAM] Failed to load bot.js:",
    error
  );
}
