local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local AUTH_URL = "https://robloxchecker-45zx.onrender.com/auth/roblox/complete"
local AUTH_KEY = "change-this-key"
local AUTH_PLACE_ID = 74772093792198

local ALLOWED_IDS = {
    [1280770559] = true,
    [1479207099] = true,
}

if not game:GetService("RunService"):IsServer() then
    error("This script must run on the server.")
end

if game.PlaceId ~= AUTH_PLACE_ID then
    warn("Roblox auth script is running in the wrong place. Expected PlaceId " .. AUTH_PLACE_ID)
end

local function completeWebsiteAuth(player, code)
    local payload = {
        key = AUTH_KEY,
        code = tostring(code),
        userId = player.UserId,
        username = player.Name,
        displayName = player.DisplayName,
        placeId = game.PlaceId,
    }

    local success, response = pcall(function()
        return HttpService:PostAsync(
            AUTH_URL,
            HttpService:JSONEncode(payload),
            Enum.HttpContentType.ApplicationJson,
            false
        )
    end)

    if success then
        print("Website login approved for " .. player.Name)
    else
        warn("Auth request failed for " .. player.Name .. ": " .. tostring(response))
    end
end

Players.PlayerAdded:Connect(function(player)
    print("Authorization player joined: " .. player.Name .. ". Use !auth 123456 in chat.")

    player.Chatted:Connect(function(message)
        local lower = string.lower(message)
        if string.sub(lower, 1, 6) ~= "!auth " then
            return
        end

        if not ALLOWED_IDS[player.UserId] then
            warn("Blocked website auth attempt from " .. player.Name)
            return
        end

        local code = string.match(message, "^!auth%s+(%d+)$")
        if not code then
            warn("Bad auth command from " .. player.Name .. ": " .. message)
            return
        end

        completeWebsiteAuth(player, code)
    end)
end)
