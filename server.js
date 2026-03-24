const express = require("express");
const http = require("http");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const CALLBACK_URL = "https://roblox-api-x3xf.onrender.com/auth/discord/callback";

console.log("CLIENT_ID:", CLIENT_ID);
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "SET" : "MISSING");
console.log("CALLBACK_URL:", CALLBACK_URL);

const ADMINS = [
    "1058895788962484294",
    "814570564546068520"
];

let players = [];
let selectedPlayer = null;

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ["identify"]
}, (accessToken, refreshToken, profile, done) => {
    console.log("ACCESS TOKEN RECEIVED:", !!accessToken);
    console.log("USER:", profile?.username);
    return done(null, profile);
}));

app.set("trust proxy", 1);

app.use(session({
    secret: process.env.SESSION_SECRET || "fallback_secret",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: true,
        sameSite: "none"
    }
}));

app.use((req, res, next) => {
    console.log("SESSION:", req.sessionID);
    next();
});

app.use(passport.initialize());
app.use(passport.session());

function isAdmin(req) {
    return req.user && ADMINS.includes(req.user.id);
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/auth/discord",
    (req, res, next) => {
        console.log("STARTING DISCORD AUTH");
        next();
    },
    passport.authenticate("discord", {
        scope: ["identify"],
        prompt: "consent"
    })
);

app.get("/auth/discord/callback",
    (req, res, next) => {
        console.log("CALLBACK QUERY:", req.query);
        next();
    },
    passport.authenticate("discord", {
        failureRedirect: "/"
    }),
    (req, res) => {
        console.log("LOGIN SUCCESS:", req.user?.username);
        res.redirect("/");
    }
);

app.get("/logout", (req, res) => {
    req.logout(() => {
        res.redirect("/");
    });
});

app.get("/me", (req, res) => {
    if (!req.user) return res.json(null);

    res.json({
        id: req.user.id,
        username: req.user.username,
        admin: ADMINS.includes(req.user.id)
    });
});

app.post("/roblox", (req, res) => {
    const { key, data } = req.body;

    if (key !== "my_super_secret_key") {
        return res.status(403).send("wrong key");
    }

    players = players.filter(p => p.userId !== data.userId);
    players.push(data);

    io.emit("update", players);

    res.send("ok");
});

app.post("/select-player", (req, res) => {
    if (!isAdmin(req)) return res.status(403).send("forbidden");

    selectedPlayer = req.body.userId;

    io.emit("select", selectedPlayer);

    res.send("ok");
});

app.get("/selected", (req, res) => {
    res.json(selectedPlayer);
});

app.post("/camera", (req, res) => {
    const { userId, cframe } = req.body;

    io.emit("camera", { userId, cframe });

    res.send("ok");
});

io.on("connection", (socket) => {
    console.log("Website connected");
    socket.emit("update", players);
});

app.use((err, req, res, next) => {
    console.error("FULL ERROR:", err);
    res.status(500).send(err.message || "Internal Server Error");
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});