local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local BASE_URL = "https://robloxchecker-45zx.onrender.com"
local AUTH_KEY = "change-this-key"
local MANAGED_PLACE_ID = 0
local SYNC_INTERVAL = 10
local COMMAND_POLL_INTERVAL = 2

if not RunService:IsServer() then
    error("This script must run on the server.")
end

if MANAGED_PLACE_ID == 0 then
    warn("Set MANAGED_PLACE_ID before using this script.")
end

if game.PlaceId ~= MANAGED_PLACE_ID then
    warn("Managed place script is running in the wrong place. Expected " .. MANAGED_PLACE_ID .. ", got " .. game.PlaceId)
end

local function getMembershipLabel(player)
    local membershipType = tostring(player.MembershipType)
    return membershipType ~= "" and membershipType or "None"
end

local function buildPlayerSnapshot()
    local snapshot = {}

    for _, player in ipairs(Players:GetPlayers()) do
        table.insert(snapshot, {
            userId = player.UserId,
            username = player.Name,
            displayName = player.DisplayName,
            accountAge = player.AccountAge,
            membershipType = getMembershipLabel(player),
        })
    end

    return snapshot
end

local function postJson(url, payload)
    return HttpService:PostAsync(
        url,
        HttpService:JSONEncode(payload),
        Enum.HttpContentType.ApplicationJson,
        false
    )
end

local function syncPlayers()
    local payload = {
        key = AUTH_KEY,
        placeId = game.PlaceId,
        jobId = game.JobId,
        players = buildPlayerSnapshot(),
    }

    local success, response = pcall(function()
        return postJson(BASE_URL .. "/game/sync", payload)
    end)

    if not success then
        warn("Player sync failed: " .. tostring(response))
    end
end

local function fetchCommands()
    local success, response = pcall(function()
        return HttpService:RequestAsync({
            Url = BASE_URL .. "/game/commands/" .. HttpService:UrlEncode(game.JobId),
            Method = "GET",
            Headers = {
                ["x-roblox-key"] = AUTH_KEY,
                ["x-roblox-place-id"] = tostring(game.PlaceId),
            },
        })
    end)

    if not success then
        warn("Command poll failed: " .. tostring(response))
        return {}
    end

    if not response.Success then
        warn("Command poll returned " .. tostring(response.StatusCode))
        return {}
    end

    local decoded = HttpService:JSONDecode(response.Body)
    return decoded.commands or {}
end

local function acknowledgeCommands(commandIds)
    if #commandIds == 0 then
        return
    end

    local success, response = pcall(function()
        return postJson(BASE_URL .. "/game/commands/ack", {
            key = AUTH_KEY,
            placeId = game.PlaceId,
            jobId = game.JobId,
            commandIds = commandIds,
        })
    end)

    if not success then
        warn("Command ack failed: " .. tostring(response))
    end
end

local function findSpawnLocation()
    local spawnLocation = workspace:FindFirstChildWhichIsA("SpawnLocation", true)
    if spawnLocation then
        return spawnLocation.CFrame + Vector3.new(0, 5, 0)
    end

    return CFrame.new(0, 10, 0)
end

local function executeCommand(command)
    local player = Players:GetPlayerByUserId(tonumber(command.userId))
    if not player then
        return
    end

    if command.type == "refresh" then
        player:LoadCharacter()
        return
    end

    if command.type == "kill" then
        local character = player.Character
        local humanoid = character and character:FindFirstChildOfClass("Humanoid")
        if humanoid then
            humanoid.Health = 0
        end
        return
    end

    if command.type == "bring_to_spawn" then
        local character = player.Character
        local pivot = findSpawnLocation()
        if character then
            character:PivotTo(pivot)
        end
        return
    end

    if command.type == "kick" then
        local reason = command.payload and command.payload.reason or "Removed by admin panel"
        player:Kick(reason)
    end
end

Players.PlayerAdded:Connect(syncPlayers)
Players.PlayerRemoving:Connect(function()
    task.defer(syncPlayers)
end)

task.spawn(function()
    while true do
        syncPlayers()
        task.wait(SYNC_INTERVAL)
    end
end)

task.spawn(function()
    while true do
        local commands = fetchCommands()
        local commandIds = {}

        for _, command in ipairs(commands) do
            executeCommand(command)
            table.insert(commandIds, command.id)
        end

        acknowledgeCommands(commandIds)
        task.wait(COMMAND_POLL_INTERVAL)
    end
end)

syncPlayers()
