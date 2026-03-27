const crypto = require("crypto")
const express = require("express")
const http = require("http")
const path = require("path")
const jwt = require("jsonwebtoken")
const { Server } = require("socket.io")
const commandDefinitions = require("./commands-config")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.set("trust proxy", 1)
app.use(express.json())
app.use(express.static(__dirname))

const JWT_SECRET = process.env.SESSION_SECRET || "secret"
const GAME_SHARED_KEY = process.env.ROBLOX_GAME_KEY || "change-this-key"
const ALLOWED_ROBLOX_IDS = new Set(["1280770559", "1479207099"])
const AUTH_PLACE_ID = String(process.env.ROBLOX_AUTH_PLACE_ID || "74772093792198")
const MANAGED_PLACE_ID = String(process.env.ROBLOX_MANAGED_PLACE_ID || "")
const AUTH_CODE_TTL_MS = 5 * 60 * 1000
const SERVER_TTL_MS = 10 * 1000

const pendingLogins = new Map()
const gameServers = new Map()
const commandQueues = new Map()
const availableCommands = new Map(commandDefinitions.map(command => [String(command.type), command]))

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

function ensureAdmin(req, res) {
    const user = getUser(req)
    if (!user || !ALLOWED_ROBLOX_IDS.has(String(user.id))) {
        res.status(403).json({ error: "forbidden" })
        return null
    }

    return user
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

function cleanupStaleServers() {
    const now = Date.now()
    for (const [jobId, serverState] of gameServers.entries()) {
        if (serverState.seenAt + SERVER_TTL_MS <= now) {
            gameServers.delete(jobId)
            commandQueues.delete(jobId)
        }
    }
}

function getLatestPlayersSnapshot() {
    const latestPlayers = new Map()

    for (const serverState of gameServers.values()) {
        for (const player of serverState.players) {
            const userId = String(player.userId)
            const existing = latestPlayers.get(userId)

            if (!existing || Number(player.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
                latestPlayers.set(userId, player)
            }
        }
    }

    return [...latestPlayers.values()]
}

function getPlayersSnapshot() {
    cleanupStaleServers()

    return getLatestPlayersSnapshot()
        .sort((left, right) => {
            const leftName = `${left.displayName || ""} ${left.username || ""}`.toLowerCase()
            const rightName = `${right.displayName || ""} ${right.username || ""}`.toLowerCase()
            return leftName.localeCompare(rightName)
        })
}

function emitPlayersUpdate() {
    io.emit("update", getPlayersSnapshot())
}

function validateGameRequest(req, res) {
    const { key, placeId, jobId } = req.body || {}

    if (key !== GAME_SHARED_KEY) {
        res.status(403).json({ error: "wrong key" })
        return null
    }

    if (!MANAGED_PLACE_ID) {
        res.status(500).json({ error: "managed place id not configured" })
        return null
    }

    if (String(placeId || "") !== MANAGED_PLACE_ID) {
        res.status(403).json({ error: "wrong place" })
        return null
    }

    if (!jobId) {
        res.status(400).json({ error: "missing jobId" })
        return null
    }

    return { jobId: String(jobId), placeId: String(placeId) }
}

function normalizeDisplayValues(values) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
        return {}
    }

    const normalized = {}
    for (const [key, value] of Object.entries(values)) {
        if (!key) continue
        normalized[String(key)] = value == null ? "" : String(value)
    }

    return normalized
}

function queueCommand(type, userId, payload = {}) {
    const target = getPlayersSnapshot().find(player => String(player.userId) === String(userId))
    if (!target) {
        return { error: "player not found" }
    }

    const command = {
        id: crypto.randomBytes(10).toString("hex"),
        type,
        userId: String(userId),
        payload,
        createdAt: Date.now()
    }

    const queue = commandQueues.get(target.jobId) || []
    queue.push(command)
    commandQueues.set(target.jobId, queue)
    io.emit("commandQueued", command)

    return { command, target }
}

setInterval(() => {
    cleanupExpiredLogins()
    cleanupStaleServers()
    emitPlayersUpdate()
}, 60 * 1000).unref()

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"))
})

app.get("/config", (req, res) => {
    res.json({
        authPlaceId: AUTH_PLACE_ID,
        managedPlaceId: MANAGED_PLACE_ID,
        commands: commandDefinitions
    })
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

app.post("/game/sync", (req, res) => {
    const context = validateGameRequest(req, res)
    if (!context) return

    const { players } = req.body || {}
    if (!Array.isArray(players)) {
        return res.status(400).json({ error: "players must be an array" })
    }

    const updatedAt = Date.now()
    const normalizedPlayers = players.map(player => ({
        userId: String(player.userId),
        username: String(player.username || "Unknown"),
        displayName: String(player.displayName || player.username || "Unknown"),
        accountAge: Number(player.accountAge || 0),
        membershipType: String(player.membershipType || "None"),
        displayValues: normalizeDisplayValues(player.displayValues),
        jobId: context.jobId,
        placeId: context.placeId,
        updatedAt
    }))

    gameServers.set(context.jobId, {
        jobId: context.jobId,
        placeId: context.placeId,
        seenAt: updatedAt,
        players: normalizedPlayers
    })

    emitPlayersUpdate()
    res.json({ ok: true, count: normalizedPlayers.length })
})

app.get("/game/commands/:jobId", (req, res) => {
    const key = req.headers["x-roblox-key"]
    const placeId = String(req.headers["x-roblox-place-id"] || "")
    const jobId = String(req.params.jobId || "")

    if (key !== GAME_SHARED_KEY) {
        return res.status(403).json({ error: "wrong key" })
    }

    if (!MANAGED_PLACE_ID || placeId !== MANAGED_PLACE_ID) {
        return res.status(403).json({ error: "wrong place" })
    }

    res.json({
        commands: commandQueues.get(jobId) || []
    })
})

app.post("/game/commands/ack", (req, res) => {
    const context = validateGameRequest(req, res)
    if (!context) return

    const { commandIds } = req.body || {}
    const queue = commandQueues.get(context.jobId) || []
    const acknowledged = new Set((commandIds || []).map(id => String(id)))
    commandQueues.set(
        context.jobId,
        queue.filter(command => !acknowledged.has(String(command.id)))
    )

    res.json({ ok: true })
})

app.get("/players", (req, res) => {
    if (!ensureAdmin(req, res)) return
    res.json({
        managedPlaceId: MANAGED_PLACE_ID,
        players: getPlayersSnapshot()
    })
})

app.post("/admin/commands", (req, res) => {
    if (!ensureAdmin(req, res)) return

    const { type, userId, payload } = req.body || {}
    const commandConfig = availableCommands.get(String(type))

    if (!commandConfig) {
        return res.status(400).json({ error: "invalid command" })
    }

    const mergedPayload = {
        ...(commandConfig.payload || {}),
        ...(payload || {})
    }

    const result = queueCommand(type, userId, mergedPayload)
    if (result.error) {
        return res.status(404).json({ error: result.error })
    }

    res.json({
        ok: true,
        command: result.command,
        target: result.target
    })
})

io.on("connection", socket => {
    socket.emit("update", getPlayersSnapshot())
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
    console.log("[SERVER] Running on port " + PORT)
    console.log("[SERVER] Roblox auth place:", AUTH_PLACE_ID)
    console.log("[SERVER] Managed place:", MANAGED_PLACE_ID || "NOT_SET")
    console.log("[SERVER] Roblox auth key set:", GAME_SHARED_KEY !== "change-this-key")
})
