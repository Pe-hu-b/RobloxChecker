local Players = game:GetService("Players")

local function ensureDisplayValue(player, name, initialValue)
    local folder = player:FindFirstChild("DisplayValues")
    if not folder then
        folder = Instance.new("Folder")
        folder.Name = "DisplayValues"
        folder.Parent = player
    end

    local valueObject = folder:FindFirstChild(name)
    if not valueObject then
        valueObject = Instance.new("StringValue")
        valueObject.Name = name
        valueObject.Value = initialValue
        valueObject.Parent = folder
    end

    return valueObject
end

local function setupPlayer(player)
    local rankValue = ensureDisplayValue(player, "Rank", "Member")
    local coinsValue = ensureDisplayValue(player, "Coins", "0")
    local zoneValue = ensureDisplayValue(player, "Zone", "Spawn")

    task.spawn(function()
        while player.Parent do
            rankValue.Value = player.MembershipType == Enum.MembershipType.Premium and "Premium" or "Member"
            coinsValue.Value = tostring(math.floor(os.clock()) % 1000)
            zoneValue.Value = player.Team and player.Team.Name or "No Team"
            task.wait(5)
        end
    end)
end

Players.PlayerAdded:Connect(setupPlayer)

for _, player in ipairs(Players:GetPlayers()) do
    setupPlayer(player)
end
