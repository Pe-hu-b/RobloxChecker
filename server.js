const express = require("express")
const http = require("http")
const axios = require("axios")
const path = require("path")
const jwt = require("jsonwebtoken")
const { Server } = require("socket.io")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.json())
app.use(express.static(__dirname))

const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const JWT_SECRET = process.env.SESSION_SECRET || "secret"
const CALLBACK_URL = "https://robloxchecker-45zx.onrender.com/auth/discord/callback"
const ENCODED_CALLBACK = encodeURIComponent(CALLBACK_URL)
const ADMINS = ["1058895788962484294", "814570564546068520"]
const usedCodes = new Set()

let players = []
let selectedPlayer = null

function getUser(req) {
    try {
        const cookieHeader = req.headers.cookie || ""
        const tokenCookie = cookieHeader.split(";").find(c => c.trim().startsWith("token="))
        if (!tokenCookie) return null
        const token = tokenCookie.split("=")[1]
        return jwt.verify(token, JWT_SECRET)
    } catch (e) {
        return null
    }
}

function isAdmin(req) {
    const user = getUser(req)
    return user && ADMINS.includes(user.id)
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
    console.log("[CALLBACK] Hit. Code:", code ? code.substring(0, 10) + "..." : "MISSING")
    if (!code) return res.redirect("/")
    if (usedCodes.has(code)) return res.send(`<script>window.location.href="/"</script>`)
    usedCodes.add(code)
    setTimeout(() => usedCodes.delete(code), 60000)
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
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        )
        console.log("[CALLBACK] Token exchange success")
        const userRes = await axios.get("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        })
        const user = userRes.data
        console.log("[CALLBACK] Got user:", user.id, user.username)
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" })
        res.setHeader("Set-Cookie", `token=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=604800`)
        return res.send(`<script>window.location.href="/"</script>`)
    } catch (err) {
        const status = err.response?.status
        const headers = err.response?.headers
        console.error("[CALLBACK] Failed. Status:", status)
        console.error("[CALLBACK] Error body:", JSON.stringify(err.response?.data))
        console.error("[CALLBACK] Retry-After:", headers?.["retry-after"])
        console.error("[CALLBACK] RateLimit-Scope:", headers?.["x-ratelimit-scope"])
        console.error("[CALLBACK] RateLimit-Global:", headers?.["x-ratelimit-global"])
        return res.send(`
            <h2>Auth Failed</h2>
            <p>Status: ${status}</p>
            <p>Error: ${err.response?.data?.error ?? "N/A"}</p>
            <p>Description: ${err.response?.data?.error_description ?? err.message}</p>
            <p>Retry-After: ${headers?.["retry-after"] ?? "N/A"}</p>
            <p>Scope: ${headers?.["x-ratelimit-scope"] ?? "N/A"}</p>
            <a href="/">Go back</a>
        `)
    }
})

app.get("/logout", (req, res) => {
    res.setHeader("Set-Cookie", "token=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0")
    res.send(`<script>window.location.href="/"</script>`)
})

app.get("/me", (req, res) => {
    const user = getUser(req)
    if (!user) return res.json(null)
    res.json({ id: user.id, username: user.username, admin: ADMINS.includes(user.id) })
})

app.post("/roblox", (req, res) => {
    const { key, data } = req.body
    if (key !== "my_super_secret_key") return res.status(403).send("wrong key")
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
    console.log("[SERVER] Running on port " + PORT)
    console.log("[SERVER] CLIENT_ID set:", !!CLIENT_ID)
    console.log("[SERVER] CLIENT_SECRET set:", !!CLIENT_SECRET)
})