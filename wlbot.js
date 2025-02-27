// Required Dependencies:
// Run: npm install discord.js mongoose dotenv express cors csv-writer fs

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const cors = require('cors');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const { Readable } = require('stream');
require('dotenv').config();

// --- Validation for Environment Variables ---
if (!process.env.BOT_TOKEN || !process.env.APPLICATION_ID || !process.env.GUILD_ID || !process.env.MONGO_URI || !process.env.WHITELIST_ROLE_ID || !process.env.FREE_MINT_ROLE_ID || !process.env.API_KEY) {
    console.error('❌ Missing required environment variables. Ensure BOT_TOKEN, APPLICATION_ID, GUILD_ID, MONGO_URI, WHITELIST_ROLE_ID, FREE_MINT_ROLE_ID, and API_KEY are set.');
    process.exit(1);
}

// --- MongoDB Setup ---
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// --- Database Schemas ---
const walletSchema = new mongoose.Schema({
    discordId: { type: String, required: true },
    walletAddress: { type: String, required: true },
    registeredViaCode: { type: Boolean, default: false },
    maxWhitelistEntries: { type: Number, default: 1 }
});
const Wallet = mongoose.model('Wallet', walletSchema);

const freeMintSchema = new mongoose.Schema({
    discordId: { type: String, required: true },
    walletAddress: { type: String, required: true }
});
const FreeMint = mongoose.model('FreeMint', freeMintSchema);

// --- Express API Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// Middleware to check API key
const authenticate = (req, res, next) => {
    const providedApiKey = req.headers['api-key'];
    if (!providedApiKey || providedApiKey !== process.env.API_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
};

// 📌 Get All Whitelisted Wallets
app.get('/whitelist', authenticate, async (req, res) => {
    const wallets = await Wallet.find();
    res.json(wallets);
});

// 📌 Check if a User Has Free Mint Role
app.get('/freemint/check/:discordId', authenticate, async (req, res) => {
    const { discordId } = req.params;
    const userEntry = await FreeMint.findOne({ discordId });
    res.json({ hasFreeMint: !!userEntry });
});

// 📌 Add a Wallet to the Whitelist
app.post('/whitelist', authenticate, async (req, res) => {
    const { discordId, walletAddress } = req.body;

    if (!discordId || !walletAddress) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingEntry = await Wallet.findOne({ discordId, walletAddress });
    if (existingEntry) {
        return res.status(400).json({ error: 'Wallet already whitelisted' });
    }

    await new Wallet({ discordId, walletAddress }).save();
    res.json({ success: true, message: 'Wallet added to whitelist' });
});

// 📌 Replace a Whitelisted Wallet
app.post('/replacewhitelist', authenticate, async (req, res) => {
    const { discordId, oldWallet, newWallet } = req.body;

    if (!discordId || !oldWallet || !newWallet) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingEntry = await Wallet.findOne({ discordId, walletAddress: oldWallet });
    if (!existingEntry) {
        return res.status(400).json({ error: 'Old wallet not found in whitelist' });
    }

    existingEntry.walletAddress = newWallet;
    await existingEntry.save();

    res.json({ success: true, message: 'Wallet successfully replaced' });
});

// 📌 Export Whitelist as CSV and Provide Download Link
app.get('/exportwhitelist', authenticate, async (req, res) => {
    const whitelistData = await Wallet.find();

    if (whitelistData.length === 0) {
        return res.status(404).json({ error: 'No whitelist entries found' });
    }

    const csvHeaders = ['Discord ID', 'Wallet Address', 'Registered Via Code', 'Max Whitelist Entries'];
    const csvRows = whitelistData.map(entry => [
        entry.discordId,
        entry.walletAddress,
        entry.registeredViaCode ? 'Yes' : 'No',
        entry.maxWhitelistEntries
    ]);

    const csvContent = [csvHeaders.join(','), ...csvRows.map(row => row.join(','))].join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename=whitelist.csv');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvContent);
});

// Start API Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));

// --- Discord Bot Setup ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
});

// --- Slash Command Registration ---
const registerCommands = async () => {
    const commands = [
        new SlashCommandBuilder()
            .setName('exportwhitelist')
            .setDescription('Export the whitelist data as a CSV file (Admin only).')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

    try {
        console.log('🔄 Registering slash commands...');
        const commandRoute = Routes.applicationGuildCommands(process.env.APPLICATION_ID, process.env.GUILD_ID);
        await rest.put(commandRoute, { body: commands.map(cmd => cmd.toJSON()) });
        console.log('✅ Slash commands registered.');
    } catch (err) {
        console.error('❌ Error registering commands:', err);
    }
};

registerCommands();

client.login(process.env.BOT_TOKEN);
