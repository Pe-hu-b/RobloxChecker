local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local AUTH_URL = "https://robloxchecker-45zx.onrender.com/auth/roblox/complete"
local AUTH_KEY = "change-this-key"
local AUTH_PLACE_ID = 74772093792198

local ALLOWED_IDS = {
    [1280770559] = true,
    [1479207099] = true,
}

if not RunService:IsServer() then
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
        return true
    else
        warn("Auth request failed for " .. player.Name .. ": " .. tostring(response))
        return false
    end
end

local function waitForTextBox(player)
    local playerGui = player:WaitForChild("PlayerGui")
    local authorizationUi = playerGui:WaitForChild("AuthorizationUI")
    local frame = authorizationUi:FindFirstChild("frame") or authorizationUi:WaitForChild("Frame")
    return frame:WaitForChild("TextBox")
end

local function showStatus(textBox, message)
    textBox.Text = message
end

local function submitCode(player, textBox)
    if not ALLOWED_IDS[player.UserId] then
        warn("Blocked website auth attempt from " .. player.Name)
        showStatus(textBox, "This account is not allowed.")
        return
    end

    local code = string.match(textBox.Text, "^(%d+)$")
    if not code then
        warn("Bad auth code from " .. player.Name .. ": " .. textBox.Text)
        showStatus(textBox, "Enter the 6-digit code.")
        return
    end

    local approved = completeWebsiteAuth(player, code)
    if not approved then
        showStatus(textBox, "That code was rejected.")
        return
    end

    showStatus(textBox, "You've submitted the code.")
    task.delay(3, function()
        if player.Parent then
            player:Kick("Authorization complete. Return to the website.")
        end
    end)
end

Players.PlayerAdded:Connect(function(player)
    print("Authorization player joined: " .. player.Name)
    local textBox = waitForTextBox(player)

    textBox.FocusLost:Connect(function(enterPressed)
        if not enterPressed then
            return
        end

        submitCode(player, textBox)
    end)
end)
