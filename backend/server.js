const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

/*
    Your structure:

    /
    ├── index.html
    ├── logo.png
    ├── roblox.png
    ├── login-banner.png
    ├── public/
    │   ├── style.css
    │   └── app.js
    │
    └── backend/
        ├── server.js
        ├── package.json
        └── values.txt
*/

const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const VALUES_FILE = path.join(__dirname, "values.txt");


/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));


/* =========================================================
   VALUES PARSER
   ========================================================= */

/*
    Your values.txt is formatted approximately like:

    Bat Dragon

    768.000

    Shadow Dragon

    572.000

    Mermicorn

    26.000

    etc.

    This parser does NOT depend on line numbers.
*/

function parseValuesFile() {

    if (!fs.existsSync(VALUES_FILE)) {

        console.error(
            "values.txt was not found:",
            VALUES_FILE
        );

        return [];
    }


    let text;

    try {

        text = fs.readFileSync(
            VALUES_FILE,
            "utf8"
        );

    } catch (error) {

        console.error(
            "Could not read values.txt:",
            error
        );

        return [];
    }


    const lines = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);


    const pets = [];


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        const name = lines[i];


        /*
            Ignore accidental line-number markers such as:

            [1]
            [23]

            if they exist in the file.
        */

        if (
            /^\[\d+\]$/.test(name)
        ) {
            continue;
        }


        /*
            Find the next line that looks like
            a numeric value.
        */

        let valueIndex = i + 1;

        while (
            valueIndex < lines.length &&
            /^\[\d+\]$/.test(
                lines[valueIndex]
            )
        ) {
            valueIndex++;
        }


        if (
            valueIndex >= lines.length
        ) {
            continue;
        }


        const rawValue =
            lines[valueIndex];


        /*
            Values look like:

            768.000
            135.523
            9.000
            1.075
        */

        if (
            !/^-?\d+(?:\.\d+)?$/.test(
                rawValue
            )
        ) {
            continue;
        }


        const value =
            Number(rawValue);


        if (
            !Number.isFinite(value)
        ) {
            continue;
        }


        pets.push({
            name: name,
            value: value
        });


        /*
            Skip over the value we just consumed.
        */

        i = valueIndex;
    }


    return pets;
}


/* =========================================================
   AMVGG IMAGE URL
   ========================================================= */

function getAmvggImageUrl(name) {

    /*
        AMVGG image examples:

        https://amvgg.com/items/Mermicorn.webp

        https://amvgg.com/items/Bat%20Dragon.webp
    */

    return (
        "https://amvgg.com/items/" +
        encodeURIComponent(name) +
        ".webp"
    );
}


/* =========================================================
   PET DATA
   ========================================================= */

function getPets() {

    const values =
        parseValuesFile();


    return values.map(pet => {

        return {
            name: pet.name,

            value: pet.value,

            image:
                getAmvggImageUrl(
                    pet.name
                )
        };

    });
}


/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get(
    "/health",
    (req, res) => {

        res.json({
            success: true,
            server: "online"
        });

    }
);


/* =========================================================
   DEBUG VALUES
   ========================================================= */

app.get(
    "/debug-values",
    (req, res) => {

        const pets =
            getPets();


        res.json({
            success: true,

            count: pets.length,

            valuesFile: VALUES_FILE,

            pets: pets.slice(0, 10)
        });

    }
);


/* =========================================================
   PETS API
   ========================================================= */

app.get(
    "/pets",
    (req, res) => {

        try {

            const pets =
                getPets();


            res.json({
                success: true,

                pets: pets
            });

        } catch (error) {

            console.error(
                "Error loading pets:",
                error
            );


            res.status(500).json({

                success: false,

                pets: [],

                error:
                    "Unable to load pet values."
            });

        }

    }
);


/* =========================================================
   SINGLE PET
   ========================================================= */

app.get(
    "/pets/:name",
    (req, res) => {

        const requestedName =
            req.params.name
                .trim()
                .toLowerCase();


        const pets =
            getPets();


        const pet =
            pets.find(
                item =>
                    item.name
                        .trim()
                        .toLowerCase() ===
                    requestedName
            );


        if (!pet) {

            return res.status(404).json({

                success: false,

                error: "Pet not found."

            });

        }


        res.json({

            success: true,

            pet: pet

        });

    }
);


/* =========================================================
   ROBLOX USER LOOKUP
   ========================================================= */

app.get(
    "/user/:username",
    async (req, res) => {

        const username =
            req.params.username.trim();


        if (!username) {

            return res.status(400).json({

                success: false,

                error:
                    "Username is required."

            });

        }


        try {

            /*
                Roblox's public Users API.

                This only looks up public Roblox
                profile information.
            */

            const response =
                await fetch(
                    "https://users.roblox.com/v1/users/search?keyword=" +
                    encodeURIComponent(username) +
                    "&limit=10"
                );


            if (!response.ok) {

                throw new Error(
                    "Roblox API returned " +
                    response.status
                );

            }


            const data =
                await response.json();


            const users =
                Array.isArray(
                    data.data
                )
                    ? data.data
                    : [];


            const exactUser =
                users.find(
                    user =>
                        String(
                            user.name
                        ).toLowerCase() ===
                        username.toLowerCase()
                );


            const user =
                exactUser ||
                users[0];


            if (!user) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Roblox user not found."

                });

            }


            res.json({

                success: true,

                user: {

                    id: user.id,

                    name: user.name,

                    displayName:
                        user.displayName,

                    username:
                        user.name

                }

            });


        } catch (error) {

            console.error(
                "Roblox lookup error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    "Unable to search Roblox right now."

            });

        }

    }
);


/* =========================================================
   ROBLOX AVATAR
   ========================================================= */

app.get(
    "/roblox-avatar/:id",
    async (req, res) => {

        const id =
            req.params.id;


        if (!/^\d+$/.test(id)) {

            return res.status(400).json({

                success: false,

                error:
                    "Invalid Roblox user ID."

            });

        }


        try {

            const response =
                await fetch(
                    "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
                    encodeURIComponent(id) +
                    "&size=150x150&format=Png&isCircular=true"
                );


            if (!response.ok) {

                throw new Error(
                    "Roblox thumbnail API returned " +
                    response.status
                );

            }


            const data =
                await response.json();


            const image =
                data &&
                Array.isArray(
                    data.data
                )
                    ? data.data[0]
                    : null;


            if (
                !image ||
                !image.imageUrl
            ) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Avatar not found."

                });

            }


            res.json({

                success: true,

                imageUrl:
                    image.imageUrl

            });


        } catch (error) {

            console.error(
                "Roblox avatar error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    "Unable to load Roblox avatar."

            });

        }

    }
);


/* =========================================================
   SERVE FRONTEND
   ========================================================= */

/*
    IMPORTANT:

    index.html is in the ROOT.

    CSS and app.js are inside /public.

    This serves:

        /
        /index.html
        /public/style.css
        /public/app.js

    Your logo files in the root are also accessible:

        /logo.png
        /roblox.png
        /login-banner.png
*/


app.use(
    "/public",
    express.static(PUBLIC_DIR)
);


app.use(
    express.static(ROOT_DIR)
);


/* =========================================================
   ROOT ROUTE
   ========================================================= */

app.get(
    "/",
    (req, res) => {

        const indexPath =
            path.join(
                ROOT_DIR,
                "index.html"
            );


        if (
            !fs.existsSync(indexPath)
        ) {

            return res.status(404).send(
                "index.html not found in repository root."
            );

        }


        res.sendFile(indexPath);

    }
);


/* =========================================================
   404
   ========================================================= */

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error: "Route not found.",

            path: req.path

        });

    }
);


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================="
        );

        console.log(
            "ADMFLIP backend started"
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "Root:",
            ROOT_DIR
        );

        console.log(
            "Values:",
            VALUES_FILE
        );

        const pets =
            getPets();


        console.log(
            "Pets loaded:",
            pets.length
        );


        if (pets.length > 0) {

            console.log(
                "First pet:",
                pets[0]
            );

        } else {

            console.warn(
                "WARNING: No pets were loaded from values.txt"
            );

        }

        console.log(
            "================================="
        );

    }
);
