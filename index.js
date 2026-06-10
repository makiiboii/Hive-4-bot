const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState
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
// Voice channel state (persisted across reconnects)
// ======================
let activeChannelId = null;
let activeGuildId = null;
let activeConnection = null;
let activePlayer = null;
let isReconnecting = false;

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
// Silence playback loop
// ======================
const silencePath = path.join(__dirname, 'silence.mp3');

function startPlayLoop(player) {
    const playLoop = () => {
        try {
            const resource = createAudioResource(silencePath);
            player.play(resource);
        } catch (err) {
            console.error('Error creating audio resource:', err);
        }
    };

    // Only register the Idle listener once per player instance
    player.removeAllListeners(AudioPlayerStatus.Idle);
    player.on(AudioPlayerStatus.Idle, () => {
        playLoop();
    });

    playLoop();
}

// ======================
// Join voice channel and wire up connection
// ======================
function joinAndPlay(channelId, guildId, adapterCreator) {
    const connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator,
        selfDeaf: false
    });

    activeConnection = connection;

    // Handle unexpected disconnects on the voice connection itself.
    // Give Discord 5 s to self-heal (Signalling/Connecting); if it
    // cannot recover, destroy the stale connection so the shard-resume
    // handler can rebuild it cleanly.
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
            ]);
            // Connection recovered on its own — nothing to do
        } catch {
            console.warn('⚠️  Voice connection could not self-recover — destroying stale connection.');
            try { connection.destroy(); } catch (_) {}
            activeConnection = null;
        }
    });

    if (!activePlayer) {
        activePlayer = createAudioPlayer();
    }

    connection.subscribe(activePlayer);
    startPlayLoop(activePlayer);

    return connection;
}

// ======================
// Exponential-backoff reconnect to voice channel
// ======================
async function reconnectWithBackoff() {
    if (isReconnecting) return;
    isReconnecting = true;

    const MAX_DELAY_MS = 60_000;
    let attempt = 0;

    while (true) {
        const delayMs = Math.min(1_000 * Math.pow(2, attempt), MAX_DELAY_MS);
        console.log(`🔄 Reconnect attempt ${attempt + 1} — waiting ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        try {
            // Ensure the Discord client is fully ready before trying to fetch guilds
            if (!client.isReady()) {
                console.log('⏳ Discord client not ready yet, retrying...');
                attempt++;
                continue;
            }

            // Re-fetch the guild so the voiceAdapterCreator is fresh
            const guild = await client.guilds.fetch(activeGuildId);

            console.log(`🔊 Rejoining voice channel ${activeChannelId} in guild ${activeGuildId}...`);
            joinAndPlay(activeChannelId, activeGuildId, guild.voiceAdapterCreator);

            console.log('✅ Successfully rejoined voice channel after reconnect.');
            isReconnecting = false;
            return;
        } catch (err) {
            console.error(`❌ Reconnect attempt ${attempt + 1} failed:`, err);
            attempt++;
        }
    }
}

// ======================
// Bot ready
// ======================
client.once('clientReady', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// ======================
// Shard disconnect — triggered when the Discord WebSocket drops
// ======================
client.on('shardDisconnect', (event, shardId) => {
    console.warn(`⚠️  Shard ${shardId} disconnected (code ${event.code}). Waiting for reconnect before rejoining voice channel.`);
});

// ======================
// Shard reconnecting — WebSocket is being re-established
// ======================
client.on('shardReconnecting', (shardId) => {
    console.log(`🔁 Shard ${shardId} is reconnecting to Discord...`);
});

// ======================
// Shard resume — WebSocket is back; safe to rejoin voice channel
// ======================
client.on('shardResume', (shardId) => {
    console.log(`✅ Shard ${shardId} resumed.`);

    if (activeChannelId && activeGuildId) {
        console.log('🔊 Shard resumed — scheduling voice channel rejoin...');
        reconnectWithBackoff();
    }
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

        // Validate silence.mp3 exists before attempting to join
        if (!fs.existsSync(silencePath)) {
            return message.reply(
                '❌ silence.mp3 not found! Put silence.mp3 in the bot folder.'
            );
        }

        try {

            // Persist voice channel state so reconnect logic can restore it
            activeChannelId = channel.id;
            activeGuildId = channel.guild.id;

            // Reset player so a fresh one is created for this session
            activePlayer = null;

            joinAndPlay(activeChannelId, activeGuildId, channel.guild.voiceAdapterCreator);

            message.reply('✅ Bot joined VC and is staying AFK 24/7');

            console.log(`Joined VC: ${channel.name} (${channel.id})`);

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
