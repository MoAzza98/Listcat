// Required Dependencies:
// Run: npm install discord.js mongoose dotenv csv-writer

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
const { createObjectCsvWriter } = require('csv-writer');
require('dotenv').config();

// --- Validation for Environment Variables ---
if (!process.env.BOT_TOKEN || !process.env.APPLICATION_ID || !process.env.GUILD_ID || !process.env.MONGO_URI) {
    console.error('❌ Missing required environment variables. Ensure BOT_TOKEN, APPLICATION_ID, GUILD_ID, and MONGO_URI are set in the .env file.');
    process.exit(1);
}

// --- MongoDB Setup ---
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

const walletSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    walletAddress: { type: String, required: true }
});
const Wallet = mongoose.model('Wallet', walletSchema);

// --- Discord Bot Setup ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('whitelist')
            .setDescription('Submit your wallet address if you have the whitelist role.')
            .addStringOption(option => 
                option.setName('wallet').setDescription('Your EVM wallet address').setRequired(true)),

        new SlashCommandBuilder()
            .setName('exportwhitelist')
            .setDescription('Export the whitelist data as a CSV file (Admin only).')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

    try {
        console.log('🔄 Registering slash commands...');
        
        if (!process.env.APPLICATION_ID || !process.env.GUILD_ID) {
            throw new Error('APPLICATION_ID or GUILD_ID is missing in the .env file.');
        }

        await rest.put(
            Routes.applicationGuildCommands(process.env.APPLICATION_ID, process.env.GUILD_ID),
            { body: commands.map(command => command.toJSON()) }
        );

        console.log('✅ Slash commands registered successfully (guild-specific).');
    } catch (err) {
        console.error('❌ Error registering commands:', err);
        console.error('⚠️ Possible Causes:\n - APPLICATION_ID or GUILD_ID is undefined.\n - The bot is not in the specified server.\n - Insufficient permissions.\n - Incorrect environment variable names.');
    }
});

// Command Handling
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'whitelist') {
        const whitelistRoleName = 'whitelist';
        const walletAddress = interaction.options.getString('wallet');
        const user = interaction.member;

        if (!user.roles.cache.some(role => role.name.toLowerCase() === whitelistRoleName)) {
            return interaction.reply({ content: '🚫 You do not have the required whitelist role.', ephemeral: true });
        }

        const existingEntry = await Wallet.findOne({ discordId: user.id });
        if (existingEntry) {
            return interaction.reply({ content: '🚫 You have already submitted a wallet address.', ephemeral: true });
        }

        if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
            return interaction.reply({ content: '⚠️ Invalid EVM wallet address format.', ephemeral: true });
        }

        try {
            await new Wallet({ discordId: user.id, walletAddress }).save();
            interaction.reply({ content: '✅ Wallet address submitted successfully!', ephemeral: true });
        } catch (err) {
            console.error('❌ Database error:', err);
            interaction.reply({ content: '❌ An error occurred. Please try again later.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'exportwhitelist') {
        try {
            const whitelistData = await Wallet.find();

            if (whitelistData.length === 0) {
                return interaction.reply({ content: 'ℹ️ No whitelist entries found.', ephemeral: true });
            }

            const csvWriter = createObjectCsvWriter({
                path: 'whitelist_export.csv',
                header: [
                    { id: 'walletAddress', title: 'Wallet Address' }
                ]
            });

            await csvWriter.writeRecords(whitelistData);

            await interaction.reply({
                content: '📄 Whitelist exported successfully.',
                files: ['whitelist_export.csv'],
                ephemeral: true
            });
        } catch (err) {
            console.error('❌ Export error:', err);
            interaction.reply({ content: '❌ Failed to export the whitelist.', ephemeral: true });
        }
    }
});

client.login(process.env.BOT_TOKEN);

// --- .env File Setup ---
// BOT_TOKEN=your_discord_bot_token (Found under the Bot section of your Discord application)
// APPLICATION_ID=your_discord_application_id (Found under General Information in Discord Developer Portal)
// GUILD_ID=your_discord_server_id (Right-click your server name -> Copy ID with Developer Mode enabled)
// MONGO_URI=your_mongodb_connection_uri

// --- Troubleshooting Slash Commands Not Showing ---
// ✅ Verify .env variables are correctly named and populated.
// ✅ Ensure the bot is invited to your server with "applications.commands" scope.
// ✅ Use GUILD_ID for instant command registration during development.
// ✅ Restart the bot after making changes to commands.
// ✅ Check bot permissions: View Channels, Send Messages, Use Slash Commands.
// ✅ Re-invite the bot if permissions were incorrect initially.
// ✅ Confirm no extra spaces or typos exist in your .env file.

// --- Invite Link Generator ---
// Use this URL template (replace YOUR_CLIENT_ID with your APPLICATION_ID):
// https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274877990912&scope=bot%20applications.commands

// ✅ Follow these steps, and your slash commands should appear instantly when using GUILD_ID!
