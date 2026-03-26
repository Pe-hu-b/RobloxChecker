module.exports = [
    {
        type: "refresh",
        label: "Refresh Character",
        style: "success-button",
        payload: {}
    },
    {
        type: "bring_to_spawn",
        label: "Bring To Spawn",
        style: "secondary-button",
        payload: {}
    },
    {
        type: "kill",
        label: "Kill Character",
        style: "warning-button",
        payload: {}
    },
    {
        type: "kick",
        label: "Kick Player",
        style: "danger-button",
        payload: {
            reason: "Removed by admin panel"
        }
    },
    {
        type: "ban",
        label: "Ban Player",
        style: "danger-button",
        payload: {
            reason: "Banned by admin panel"
        },
        fields: [
            {
                key: "duration",
                label: "Duration",
                type: "text",
                placeholder: "1d, 7d, permanent"
            }
        ]
    }
]
