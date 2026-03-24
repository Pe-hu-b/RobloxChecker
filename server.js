const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// 🔐 SECRET KEY
const SECRET = "my_super_secret_key";

let players = [];
let selectedPlayer = null;

// 🛡️ Rate limit
const limiter = rateLimit({
    windowMs: 1000,
    max: 10
});
app.use("/roblox", limiter);

// serve site
app.use(express.static(__dirname));

// homepage
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// 🎮 ROBLOX SENDS DATA
app.post("/roblox", (req, res) => {
    const { key, data } = req.body;

    if (key !== SECRET) {
        return res.status(403).send("wrong key");
    }

    players = players.filter(p => p.userId !== data.userId);
    players.push(data);

    console.log("PLAYER:", data);

    io.emit("update", players);

    res.send("ok");
});

// 🖱️ WEBSITE SELECTS PLAYER
app.post("/select-player", (req, res) => {
    selectedPlayer = req.body.userId;

    console.log("SELECTED:", selectedPlayer);

    io.emit("select", selectedPlayer);

    res.send("ok");
});

// 📡 ROBLOX POLLS SELECTED PLAYER
app.get("/selected", (req, res) => {
    res.json(selectedPlayer);
});

// 🔌 SOCKET
io.on("connection", (socket) => {
    socket.emit("update", players);
});

// REQUIRED FOR RENDER
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});