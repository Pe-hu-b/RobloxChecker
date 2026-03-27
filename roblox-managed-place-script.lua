local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local BASE_URL = "https://robloxchecker-45zx.onrender.com"
local AUTH_KEY = "change-this-key"
local MANAGED_PLACE_ID = 0
local SYNC_INTERVAL = 5
local COMMAND_POLL_INTERVAL = 2
local banRegistry = {}

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

local function collectDisplayValues(player)
    local values = {}

    local displayFolder = player:FindFirstChild("DisplayValues")
    if displayFolder then
        for _, child in ipairs(displayFolder:GetChildren()) do
            if child:IsA("ValueBase") then
                values[child.Name] = tostring(child.Value)
            end
        end
    end

    for key, value in pairs(player:GetAttributes()) do
        if string.sub(key, 1, 13) == "DisplayValue_" then
            values[string.sub(key, 14)] = tostring(value)
        end
    end

    return values
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
            displayValues = collectDisplayValues(player),
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
        return
    end

    if command.type == "ban" then
        local duration = command.payload and command.payload.duration or "unspecified"
        local reason = command.payload and command.payload.reason or "Banned by admin panel"
        banRegistry[player.UserId] = {
            reason = tostring(reason),
            duration = tostring(duration),
            createdAt = os.time(),
        }
        player:Kick(reason .. " | Duration: " .. tostring(duration))
        return
    end

    if command.type == "unban" then
        banRegistry[player.UserId] = nil
        return
    end

    if command.type == "give_leaderstat" then
        local payload = command.payload or {}
        local statName = tostring(payload.statName or "")
        local value = tonumber(payload.value)

        if statName == "" or value == nil then
            warn("Invalid give_leaderstat payload for " .. player.Name)
            return
        end

        local leaderstats = player:FindFirstChild("leaderstats")
        if not leaderstats then
            warn("leaderstats folder not found for " .. player.Name)
            return
        end

        local stat = leaderstats:FindFirstChild(statName)
        if not stat or not stat:IsA("ValueBase") then
            warn("Leaderstat " .. statName .. " not found for " .. player.Name)
            return
        end

        if stat:IsA("IntValue") then
            stat.Value += math.floor(value)
            return
        end

        if stat:IsA("NumberValue") then
            stat.Value += value
            return
        end

        if stat:IsA("StringValue") then
            stat.Value = tostring(value)
            return
        end

        warn("Unsupported leaderstat type for " .. statName)
    end
end

local function watchDisplayFolder(folder)
    local function attachValueWatcher(child)
        if child:IsA("ValueBase") then
            child:GetPropertyChangedSignal("Value"):Connect(function()
                task.defer(syncPlayers)
            end)
        end
    end

    folder.ChildAdded:Connect(function(child)
        attachValueWatcher(child)
        task.defer(syncPlayers)
    end)

    folder.ChildRemoved:Connect(function()
        task.defer(syncPlayers)
    end)

    for _, child in ipairs(folder:GetChildren()) do
        attachValueWatcher(child)
    end
end

local function watchPlayer(player)
    player.AttributeChanged:Connect(function(attributeName)
        if string.sub(attributeName, 1, 13) == "DisplayValue_" then
            task.defer(syncPlayers)
        end
    end)

    local existingFolder = player:FindFirstChild("DisplayValues")
    if existingFolder then
        watchDisplayFolder(existingFolder)
    end

    player.ChildAdded:Connect(function(child)
        if child.Name == "DisplayValues" then
            watchDisplayFolder(child)
            task.defer(syncPlayers)
        end
    end)
end

Players.PlayerAdded:Connect(function(player)
    local existingBan = banRegistry[player.UserId]
    if existingBan then
        player:Kick(existingBan.reason .. " | Duration: " .. existingBan.duration)
        return
    end

    watchPlayer(player)
    syncPlayers()
end)

Players.PlayerRemoving:Connect(function()
    task.defer(syncPlayers)
end)

for _, player in ipairs(Players:GetPlayers()) do
    watchPlayer(player)
end

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
