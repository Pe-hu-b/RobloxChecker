const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const chokidar = require("chokidar");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

const SECRET = "my_secret_key";

let players = [];

// serve files
app.use(express.static(__dirname));

// roblox endpoint
app.post("/roblox", (req, res) => {
    const { key, data } = req.body;

    if (key !== SECRET) {
        return res.status(403).send("wrong key");
    }

    players.push(data);

    io.emit("update", players);

    res.send("ok");
});

// socket
io.on("connection", (socket) => {
    socket.emit("update", players);
});

// 🔥 WATCH FILE CHANGES
chokidar.watch(__dirname).on("change", (file) => {
    console.log("File changed:", file);

    io.emit("reload"); // tell website to reload
});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});