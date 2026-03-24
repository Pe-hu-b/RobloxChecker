const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

const SECRET = "my_secret_key";

let players = [];

// serve static files (html, css, js)
app.use(express.static(__dirname));

// homepage route (fixes "Cannot GET /")
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// roblox endpoint
app.post("/roblox", (req, res) => {
    const { key, data } = req.body;

    if (key !== SECRET) {
        return res.status(403).send("wrong key");
    }

    // remove duplicates (same user)
    players = players.filter(p => p.userId !== data.userId);

    players.push(data);

    console.log("NEW PLAYER:", data);

    // send update to all connected websites
    io.emit("update", players);

    res.send("ok");
});

// websocket connection
io.on("connection", (socket) => {
    console.log("Website connected");

    // send current data instantly
    socket.emit("update", players);
});

// REQUIRED for Render
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});