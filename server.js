const crypto = require("crypto")
const express = require("express")
const http = require("http")
const path = require("path")
const jwt = require("jsonwebtoken")
const { Server } = require("socket.io")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.set("trust proxy", 1)
app.use(express.json())
app.use(express.static(__dirname))

const JWT_SECRET = process.env.SESSION_SECRET || "secret"
const GAME_SHARED_KEY = process.env.ROBLOX_GAME_KEY || "change-this-key"
const ALLOWED_ROBLOX_IDS = new Set(["1280770559", "1479207099"])
const AUTH_PLACE_ID = "74772093792198"
const AUTH_CODE_TTL_MS = 5 * 60 * 1000

let players = []
let selectedPlayer = null

const pendingLogins = new Map()

function parseCookies(req) {
    const cookieHeader = req.headers.cookie || ""
    return cookieHeader.split(";").reduce((acc, part) => {
        const [rawName, ...rest] = part.trim().split("=")
        if (!rawName) return acc
        acc[rawName] = decodeURIComponent(rest.join("="))
        return acc
    }, {})
}

function createSessionCookie(name, value, maxAgeSeconds, req) {
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https"
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAgeSeconds}`
    ]

    if (secure) {
        parts.push("Secure")
    }

    return parts.join("; ")
}

function getUser(req) {
    try {
        const cookies = parseCookies(req)
        const token = cookies.token
        if (!token) return null
        return jwt.verify(token, JWT_SECRET)
    } catch (error) {
        return null
    }
}

function isAdmin(req) {
    const user = getUser(req)
    return !!user && ALLOWED_ROBLOX_IDS.has(String(user.id))
}

function createRequestId() {
    return crypto.randomBytes(18).toString("hex")
}

function createAuthCode() {
    let code = ""

    do {
        code = crypto.randomInt(100000, 1000000).toString()
    } while ([...pendingLogins.values()].some(session => session.code === code))

    return code
}

function cleanupExpiredLogins() {
    const now = Date.now()
    for (const [requestId, session] of pendingLogins.entries()) {
        if (session.expiresAt <= now) {
            pendingLogins.delete(requestId)
        }
    }
}

setInterval(cleanupExpiredLogins, 60 * 1000).unref()

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"))
})

app.post("/auth/roblox/request", (req, res) => {
    cleanupExpiredLogins()

    const requestId = createRequestId()
    const code = createAuthCode()
    const expiresAt = Date.now() + AUTH_CODE_TTL_MS

    pendingLogins.set(requestId, {
        requestId,
        code,
        expiresAt,
        status: "pending",
        userId: null,
        username: null,
        displayName: null
    })

    res.json({
        requestId,
        code,
        expiresAt,
        placeId: AUTH_PLACE_ID
    })
})

app.get("/auth/roblox/status/:requestId", (req, res) => {
    cleanupExpiredLogins()

    const session = pendingLogins.get(req.params.requestId)
    if (!session) {
        return res.status(404).json({ status: "expired" })
    }

    res.json({
        status: session.status,
        expiresAt: session.expiresAt,
        userId: session.userId,
        username: session.username,
        displayName: session.displayName
    })
})

app.post("/auth/roblox/complete", (req, res) => {
    cleanupExpiredLogins()

    const { key, code, userId, username, displayName, placeId } = req.body || {}

    if (key !== GAME_SHARED_KEY) {
        return res.status(403).json({ error: "wrong key" })
    }

    const normalizedUserId = String(userId || "")
    if (!ALLOWED_ROBLOX_IDS.has(normalizedUserId)) {
        return res.status(403).json({ error: "user not allowed" })
    }

    if (String(placeId || "") !== AUTH_PLACE_ID) {
        return res.status(403).json({ error: "wrong place" })
    }

    const session = [...pendingLogins.values()].find(entry => entry.code === String(code))
    if (!session) {
        return res.status(404).json({ error: "invalid code" })
    }

    if (session.expiresAt <= Date.now()) {
        pendingLogins.delete(session.requestId)
        return res.status(410).json({ error: "expired code" })
    }

    session.status = "approved"
    session.userId = normalizedUserId
    session.username = String(username || "Unknown")
    session.displayName = String(displayName || username || "Unknown")

    res.json({ ok: true })
})

app.post("/auth/roblox/finalize", (req, res) => {
    cleanupExpiredLogins()

    const { requestId } = req.body || {}
    const session = pendingLogins.get(String(requestId || ""))

    if (!session) {
        return res.status(404).json({ error: "expired request" })
    }

    if (session.status !== "approved" || !session.userId) {
        return res.status(409).json({ error: "request not approved" })
    }

    const token = jwt.sign(
        {
            id: session.userId,
            username: session.username,
            displayName: session.displayName
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    )

    res.setHeader("Set-Cookie", createSessionCookie("token", token, 7 * 24 * 60 * 60, req))
    pendingLogins.delete(session.requestId)
    res.json({
        ok: true,
        user: {
            id: session.userId,
            username: session.username,
            displayName: session.displayName,
            admin: true
        }
    })
})

app.get("/logout", (req, res) => {
    res.setHeader("Set-Cookie", createSessionCookie("token", "", 0, req))
    res.send(`<script>window.location.href="/"</script>`)
})

app.get("/me", (req, res) => {
    const user = getUser(req)
    if (!user) {
        return res.json(null)
    }

    res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        admin: ALLOWED_ROBLOX_IDS.has(String(user.id))
    })
})

app.post("/roblox", (req, res) => {
    const { key, data } = req.body || {}

    if (key !== GAME_SHARED_KEY) {
        return res.status(403).send("wrong key")
    }

    players = players.filter(player => player.userId !== data.userId)
    players.push(data)
    io.emit("update", players)
    res.send("ok")
})

app.post("/select-player", (req, res) => {
    if (!isAdmin(req)) {
        return res.status(403).send("forbidden")
    }

    selectedPlayer = req.body.userId
    io.emit("select", selectedPlayer)
    res.send("ok")
})

app.get("/selected", (req, res) => {
    res.json(selectedPlayer)
})

app.post("/camera", (req, res) => {
    const { userId, cframe } = req.body || {}
    io.emit("camera", { userId, cframe })
    res.send("ok")
})

io.on("connection", socket => {
    socket.emit("update", players)
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
    console.log("[SERVER] Running on port " + PORT)
    console.log("[SERVER] Roblox auth place:", AUTH_PLACE_ID)
    console.log("[SERVER] Roblox auth key set:", GAME_SHARED_KEY !== "change-this-key")
})
