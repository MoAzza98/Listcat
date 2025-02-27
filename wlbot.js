require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB Connected"))
    .catch(err => {
        console.error("❌ MongoDB Connection Error:", err);
        process.exit(1);
    });

// Schema for Whitelist
const walletSchema = new mongoose.Schema({
    discordId: { type: String, required: true },
    walletAddress: { type: String, required: true },
    registeredViaCode: { type: Boolean, default: false },
    maxWhitelistEntries: { type: Number, default: 1 }
});
const Wallet = mongoose.model('Wallet', walletSchema);

// Express API Setup
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Middleware to check API key
const authenticate = (req, res, next) => {
    const providedApiKey = req.headers['api-key'];
    if (providedApiKey !== process.env.API_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
};

// API to get the full whitelist
app.get('/whitelist', authenticate, async (req, res) => {
    const wallets = await Wallet.find();
    res.json(wallets);
});

// API to add a wallet
app.post('/whitelist', authenticate, async (req, res) => {
    const { discordId, walletAddress } = req.body;
    const existing = await Wallet.findOne({ discordId, walletAddress });

    if (existing) {
        return res.status(400).json({ error: 'Wallet already registered' });
    }

    await Wallet.create({ discordId, walletAddress });
    res.json({ success: true, message: 'Wallet added' });
});

// API to replace a wallet
app.post('/replacewhitelist', authenticate, async (req, res) => {
    const { discordId, oldWallet, newWallet } = req.body;

    const existing = await Wallet.findOne({ discordId, walletAddress: oldWallet });
    if (!existing) {
        return res.status(404).json({ error: 'Old wallet not found' });
    }

    existing.walletAddress = newWallet;
    await existing.save();

    res.json({ success: true, message: 'Wallet replaced' });
});

// API to export whitelist as CSV
app.get('/exportwhitelist', authenticate, async (req, res) => {
    const wallets = await Wallet.find();

    let csv = "Discord ID,Wallet Address\n";
    wallets.forEach(({ discordId, walletAddress }) => {
        csv += `${discordId},${walletAddress}\n`;
    });

    res.setHeader('Content-Disposition', 'attachment; filename=whitelist.csv');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
});

// Start Express Server
app.listen(PORT, () => console.log(`🚀 API running on port ${PORT}`));

// Discord Bot Setup
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
});

// Discord Slash Command Setup
const commands = [
    new SlashCommandBuilder()
        .setName('checkwhitelist')
        .setDescription('Check if a wallet address is whitelisted.')
        .addStringOption(option =>
            option.setName('wallet')
                .setDescription('The wallet address to check')
                .setRequired(true)
        )
].map(command => command.toJSON());

// Register commands on startup
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.APPLICATION_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('✅ Slash commands registered.');
    } catch (error) {
        console.error('❌ Failed to register commands:', error);
    }
})();

// Handle command interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'checkwhitelist') {
        await interaction.deferReply();

        const wallet = interaction.options.getString('wallet');
        const found = await Wallet.findOne({ walletAddress: wallet });

        if (found) {
            await interaction.editReply(`✅ Wallet **${wallet}** is whitelisted!`);
        } else {
            await interaction.editReply(`❌ Wallet **${wallet}** is not whitelisted.`);
        }
    }
});

client.login(process.env.BOT_TOKEN);
