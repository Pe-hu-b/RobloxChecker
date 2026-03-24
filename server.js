const express = require("express")
const http = require("http")
const session = require("express-session")
const axios = require("axios")
const path = require("path")
const { Server } = require("socket.io")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.json())
app.use(express.static(__dirname))

const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const CALLBACK_URL = "https://roblox-api-x3xf.onrender.com/auth/discord/callback"
const ENCODED_CALLBACK = encodeURIComponent(CALLBACK_URL)

const ADMINS = [
    "1058895788962484294",
    "814570564546068520"
]

let players = []
let selectedPlayer = null

app.set("trust proxy", 1)

app.use(session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: true,
        sameSite: "none"
    }
}))

function isAdmin(req) {
    return req.session.user && ADMINS.includes(req.session.user.id)
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"))
})

app.get("/auth/discord", (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${ENCODED_CALLBACK}&scope=identify`
    res.redirect(url)
})

app.get("/auth/discord/callback", async (req, res) => {
    const code = req.query.code
    if (!code) return res.send("No code")

    try {
        const params = new URLSearchParams()
        params.append("client_id", CLIENT_ID)
        params.append("client_secret", CLIENT_SECRET)
        params.append("grant_type", "authorization_code")
        params.append("code", code)
        params.append("redirect_uri", CALLBACK_URL)

        const tokenRes = await axios.post(
            "https://discord.com/api/oauth2/token",
            params.toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        )

        const access_token = tokenRes.data.access_token

        const userRes = await axios.get("https://discord.com/api/users/@me", {
            headers: {
                Authorization: `Bearer ${access_token}`
            }
        })

        const user = userRes.data

        req.session.user = {
            id: user.id,
            username: user.username
        }

        res.redirect("/")
    } catch (err) {
        console.error("DATA:", err.response?.data)
        console.error("STATUS:", err.response?.status)
        console.error("MESSAGE:", err.message)
        res.send("OAuth failed")
    }
})

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/")
    })
})

app.get("/me", (req, res) => {
    if (!req.session.user) return res.json(null)

    res.json({
        ...req.session.user,
        admin: ADMINS.includes(req.session.user.id)
    })
})

app.post("/roblox", (req, res) => {
    const { key, data } = req.body

    if (key !== "my_super_secret_key") {
        return res.status(403).send("wrong key")
    }

    players = players.filter(p => p.userId !== data.userId)
    players.push(data)

    io.emit("update", players)

    res.send("ok")
})

app.post("/select-player", (req, res) => {
    if (!isAdmin(req)) return res.status(403).send("forbidden")

    selectedPlayer = req.body.userId

    io.emit("select", selectedPlayer)

    res.send("ok")
})

app.get("/selected", (req, res) => {
    res.json(selectedPlayer)
})

app.post("/camera", (req, res) => {
    const { userId, cframe } = req.body

    io.emit("camera", { userId, cframe })

    res.send("ok")
})

io.on("connection", (socket) => {
    socket.emit("update", players)
})

const PORT = process.env.PORT || 3000

server.listen(PORT, () => {
    console.log("Server running on port " + PORT)
})