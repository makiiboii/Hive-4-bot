const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus
} = require('@discordjs/voice');

const express = require('express');
const path = require('path');
const fs = require('fs');

// ======================
// Web server to keep Railway alive
// ======================
const app = express();

app.get('/', (req, res) => {
    res.send('AFK Bot is alive!');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

// ======================
// Error handling
// ======================
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', err => {
    console.error('Uncaught Exception:', err);
});

// ======================
// Bot owners
// ======================
const OWNER_IDS = [
    '451647372628459520', // maki
    '238275197772365826'  // gab
];

// ======================
// Discord client
// ======================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ======================
// Bot ready
// ======================
client.once('clientReady', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// ======================
// Command: !joinhive4confirm
// ======================
client.on('messageCreate', async (message) => {

    // Ignore bots
    if (message.author.bot) return;

    if (message.content === '!joinhive4confirm') {

        // Check owners
        if (!OWNER_IDS.includes(message.author.id)) {
            return message.reply('❌ Only bot owners can use this command.');
        }

        // Check voice channel
        const channel = message.member.voice.channel;

        if (!channel) {
            return message.reply('❌ Join a voice channel first!');
        }

        try {

            // Join VC
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false
            });

            // Create audio player
            const player = createAudioPlayer();

            // Path to silence.mp3
            const silencePath = path.join(__dirname, 'silence.mp3');

            // Check if file exists
            if (!fs.existsSync(silencePath)) {
                return message.reply(
                    '❌ silence.mp3 not found! Put silence.mp3 in the bot folder.'
                );
            }

            // Play silent audio forever
            const playLoop = () => {
                const resource = createAudioResource(silencePath);
                player.play(resource);
            };

            // Start playing
            playLoop();

            // Subscribe player
            connection.subscribe(player);

            // Loop forever
            player.on(AudioPlayerStatus.Idle, () => {
                playLoop();
            });

            // Success message
            message.reply('✅ Bot joined VC and is staying AFK 24/7');

            console.log(`Joined VC: ${channel.name}`);

        } catch (err) {

            console.error('Error joining VC:', err);

            message.reply(
                '❌ Failed to join VC. Check Railway logs.'
            );
        }
    }
});

// ======================
// Login
// ======================
console.log(
    'TOKEN exists?',
    process.env.TOKEN ? 'Yes' : 'No'
);

client.login(process.env.TOKEN);
