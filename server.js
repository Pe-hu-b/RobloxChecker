const express = require("express");
const http = require("http");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");

const app = express();
const server = http.createServer(app);

const CLIENT_ID = "YOUR_CLIENT_ID";
const CLIENT_SECRET = "YOUR_CLIENT_SECRET";
const CALLBACK_URL = "https://roblox-api-x3xf.onrender.com/auth/discord/callback";

const ADMINS = [
    "123456789012345678",
    "987654321098765432"
];

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ["identify"]
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

app.use(session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(express.static(__dirname));

function isAdmin(req) {
    return req.user && ADMINS.includes(req.user.id);
}

app.get("/", (req, res) => {
    if (!req.user) {
        return res.sendFile(path.join(__dirname, "login.html"));
    }

    if (!isAdmin(req)) {
        return res.send("Access denied");
    }

    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/auth/discord",
    passport.authenticate("discord")
);

app.get("/auth/discord/callback",
    passport.authenticate("discord", { failureRedirect: "/" }),
    (req, res) => {
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

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running");
});