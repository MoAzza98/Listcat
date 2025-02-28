require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder
} = require('discord.js');

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// If you're on Node 18+, fetch is built-in. Otherwise:
// const fetch = require('node-fetch');

// =============================
// 1. MongoDB Connection
// =============================
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => {
  console.error("❌ MongoDB Connection Error:", err);
  process.exit(1);
});

// =============================
// 2. Mongoose Schema & Model
// =============================
const walletSchema = new mongoose.Schema({
  discordId: { type: String, required: true },
  walletAddress: { type: String, required: true },
  listType: { type: String, enum: ['whitelist', 'freemint'], required: true },
  registeredViaCode: { type: Boolean, default: false },
  maxWhitelistEntries: { type: Number, default: 1 } // For slot logic
});
const Wallet = mongoose.model('Wallet', walletSchema);

// =============================
// 3. Express Server Setup
// (Optional if you already have it)
// =============================
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

// Minimal route example
app.listen(PORT, () => console.log(`🚀 API running on port ${PORT}`));

// =============================
// 4. Discord Bot Setup
// =============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// -----------------------------
// 4a. Define Slash Commands
// -----------------------------
const commands = [
  // ================
  //  A) WHITELIST
  // ================

  // /addwhitelist
  new SlashCommandBuilder()
    .setName('addwhitelist')
    .setDescription('Add your wallet address to the Whitelist.')
    .addStringOption(option =>
      option
        .setName('wallet')
        .setDescription('The wallet address to add')
        .setRequired(true)
    ),

  // /checkwhitelist
  new SlashCommandBuilder()
    .setName('checkwhitelist')
    .setDescription('Check if a wallet address is on the Whitelist.')
    .addStringOption(option =>
      option
        .setName('wallet')
        .setDescription('The wallet address to check')
        .setRequired(true)
    ),

  // /increasewhiteslots (already existed)
  new SlashCommandBuilder()
    .setName('increasewhiteslots')
    .setDescription('Admin command: Give a user more whitelist slots.')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to grant more slots to.')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('slots')
        .setDescription('How many additional slots to add?')
        .setRequired(true)
    ),

  // /replacewhitelist
  new SlashCommandBuilder()
    .setName('replacewhitelist')
    .setDescription('Replace a wallet you have already whitelisted.')
    .addStringOption(option =>
      option
        .setName('old_wallet')
        .setDescription('The wallet address you want to replace')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('new_wallet')
        .setDescription('The new wallet address')
        .setRequired(true)
    ),

  // /exportwhitelist
  new SlashCommandBuilder()
    .setName('exportwhitelist')
    .setDescription('Admin only: Export the Whitelist CSV.'),

  // ================
  //  B) FREE MINT
  // ================

  // /addfreemint
  new SlashCommandBuilder()
    .setName('addfreemint')
    .setDescription('Add your wallet address to the Free Mint list.')
    .addStringOption(option =>
      option
        .setName('wallet')
        .setDescription('The wallet address to add')
        .setRequired(true)
    ),

  // /checkfreemint
  new SlashCommandBuilder()
    .setName('checkfreemint')
    .setDescription('Check if a wallet address is on the Free Mint list.')
    .addStringOption(option =>
      option
        .setName('wallet')
        .setDescription('The wallet address to check')
        .setRequired(true)
    ),

  // /replacefreemint
  new SlashCommandBuilder()
    .setName('replacefreemint')
    .setDescription('Replace a wallet you have on the Free Mint list.')
    .addStringOption(option =>
      option
        .setName('old_wallet')
        .setDescription('The wallet address you want to replace')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('new_wallet')
        .setDescription('The new wallet address')
        .setRequired(true)
    ),

  // /exportfreemint
  new SlashCommandBuilder()
    .setName('exportfreemint')
    .setDescription('Admin only: Export the Free Mint CSV.')
]
.map(cmd => cmd.toJSON());

// -----------------------------
// 4b. Register Slash Commands
// -----------------------------
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

// =============================
// 5. Interaction Handling
// =============================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // You can store these role IDs in your .env
  const WHITELIST_ROLE_ID = process.env.WHITELIST_ROLE_ID || '111111111111111111';
  const FREEMINT_ROLE_ID  = process.env.FREEMINT_ROLE_ID  || '222222222222222222';
  const ADMIN_ROLE_ID     = process.env.ADMIN_ROLE_ID     || '333333333333333333';

  // Helper function: role check
  const hasRole = (member, roleId) => member.roles.cache.has(roleId);

  // Helper for adding a new doc with optional max
  async function addWallet(interaction, listType, roleId) {
    await interaction.deferReply({ ephemeral: true });

    // 1) Check if user has the correct role
    if (!hasRole(interaction.member, roleId)) {
      return interaction.editReply(`❌ You need the **${listType}** role to use this command.`);
    }

    const wallet = interaction.options.getString('wallet');
    // 2) Fetch all existing docs
    const existingDocs = await Wallet.find({
      discordId: interaction.user.id,
      listType
    });

    // 3) Determine current max from the first doc or default 1
    let currentMax = existingDocs.length ? existingDocs[0].maxWhitelistEntries : 1;

    // 4) Check for duplicates
    const alreadyUsed = existingDocs.find(d => d.walletAddress === wallet);
    if (alreadyUsed) {
      return interaction.editReply(`❌ You already added **${wallet}** to the ${listType} list.`);
    }

    // 5) Check if user is at max (only for 'whitelist' if you want slot logic for free mint, you can adapt)
    if (listType === 'whitelist') {
      if (existingDocs.length >= currentMax) {
        return interaction.editReply(
          `❌ You've reached your limit of **${currentMax}** addresses on the ${listType}.`
        );
      }
    }

    // 6) Create the doc
    await Wallet.create({
      discordId: interaction.user.id,
      walletAddress: wallet,
      listType,
      maxWhitelistEntries: currentMax
    });

    await interaction.editReply(
      `✅ **${wallet}** added to the **${listType}** list!`
    );
  }

  // Helper for check commands
  async function checkWallet(interaction, listType) {
    await interaction.deferReply({ ephemeral: true });
    const wallet = interaction.options.getString('wallet');

    const found = await Wallet.findOne({ walletAddress: wallet, listType });
    if (found) {
      await interaction.editReply(`✅ **${wallet}** is on the **${listType}** list.`);
    } else {
      await interaction.editReply(`❌ **${wallet}** is NOT on the **${listType}** list.`);
    }
  }

  // Helper for replace commands
  async function replaceWallet(interaction, listType, roleId) {
    await interaction.deferReply({ ephemeral: true });

    // 1) Check if user has the correct role
    if (!hasRole(interaction.member, roleId)) {
      return interaction.editReply(`❌ You need the **${listType}** role to use this command.`);
    }

    const oldWallet = interaction.options.getString('old_wallet');
    const newWallet = interaction.options.getString('new_wallet');

    // 2) Find the doc that matches user + old wallet
    const doc = await Wallet.findOne({
      discordId: interaction.user.id,
      walletAddress: oldWallet,
      listType
    });

    if (!doc) {
      return interaction.editReply(
        `❌ You don't have **${oldWallet}** registered on the ${listType} list.`
      );
    }

    // 3) Check if new wallet is already used by the user
    const duplicate = await Wallet.findOne({
      discordId: interaction.user.id,
      walletAddress: newWallet,
      listType
    });
    if (duplicate) {
      return interaction.editReply(
        `❌ You already have **${newWallet}** on the ${listType} list.`
      );
    }

    // 4) Replace
    doc.walletAddress = newWallet;
    await doc.save();

    await interaction.editReply(
      `✅ Replaced **${oldWallet}** with **${newWallet}** on the ${listType} list.`
    );
  }

  // Helper for export commands (admin only)
  async function exportList(interaction, endpoint) {
    // We can't do ephemeral if we want to attach a file
    await interaction.deferReply({ ephemeral: false });

    if (!hasRole(interaction.member, ADMIN_ROLE_ID)) {
      return interaction.editReply('❌ You do not have permission to use this command.');
    }

    try {
      // Example fetch from your Express server
      const res = await fetch(`${process.env.API_BASE_URL}/${endpoint}`, {
        headers: { 'api-key': API_KEY }
      });
      if (!res.ok) {
        return interaction.editReply(`❌ Failed to fetch CSV from /${endpoint}`);
      }
      const csvData = await res.text();
      // Attach the CSV as a file
      const file = new AttachmentBuilder(Buffer.from(csvData, 'utf-8'), {
        name: `${endpoint}.csv`
      });
      await interaction.editReply({
        content: `✅ Here is the \`${endpoint}\` CSV:`,
        files: [file]
      });
    } catch (err) {
      console.error(`Error exporting ${endpoint}:`, err);
      await interaction.editReply(`❌ Error exporting ${endpoint}. Check logs.`);
    }
  }

  // =========================================
  // COMMAND ROUTES
  // =========================================

  try {
    // =========== WHITELIST Commands ===========
    if (commandName === 'addwhitelist') {
      // call our helper for "whitelist"
      await addWallet(interaction, 'whitelist', WHITELIST_ROLE_ID);
    }
    else if (commandName === 'checkwhitelist') {
      await checkWallet(interaction, 'whitelist');
    }
    else if (commandName === 'increasewhiteslots') {
      // (Existing logic from previous examples)
      await interaction.deferReply({ ephemeral: true });

      if (!hasRole(interaction.member, ADMIN_ROLE_ID)) {
        return interaction.editReply('❌ You do not have permission to use this command.');
      }
      const targetUser = interaction.options.getUser('user');
      const slotsToAdd = interaction.options.getInteger('slots');

      if (slotsToAdd <= 0) {
        return interaction.editReply('❌ Slots to add must be a positive integer.');
      }
      // Fetch all docs for that user & whitelist
      let userDocs = await Wallet.find({
        discordId: targetUser.id,
        listType: 'whitelist'
      });

      if (userDocs.length === 0) {
        // Create new doc with the updated max
        const newMax = 1 + slotsToAdd;
        await Wallet.create({
          discordId: targetUser.id,
          walletAddress: 'NONE',
          listType: 'whitelist',
          maxWhitelistEntries: newMax
        });
        return interaction.editReply(
          `✅ Created a new Whitelist doc for <@${targetUser.id}> with **${newMax}** total slots.`
        );
      } else {
        let oldMax = userDocs[0].maxWhitelistEntries;
        let newMax = oldMax + slotsToAdd;
        for (const doc of userDocs) {
          doc.maxWhitelistEntries = newMax;
          await doc.save();
        }
        return interaction.editReply(
          `✅ Updated <@${targetUser.id}>'s whitelist slots from **${oldMax}** to **${newMax}**.`
        );
      }
    }
    else if (commandName === 'replacewhitelist') {
      // Replaces an old wallet with new
      await replaceWallet(interaction, 'whitelist', WHITELIST_ROLE_ID);
    }
    else if (commandName === 'exportwhitelist') {
      // Admin-only fetch from /exportwhitelist
      await exportList(interaction, 'exportwhitelist');
    }

    // =========== FREEMINT Commands ===========
    else if (commandName === 'addfreemint') {
      await addWallet(interaction, 'freemint', FREEMINT_ROLE_ID);
    }
    else if (commandName === 'checkfreemint') {
      await checkWallet(interaction, 'freemint');
    }
    else if (commandName === 'replacefreemint') {
      await replaceWallet(interaction, 'freemint', FREEMINT_ROLE_ID);
    }
    else if (commandName === 'exportfreemint') {
      // Admin-only fetch from /exportfreemint
      await exportList(interaction, 'exportfreemint');
    }

    // (Else: unknown command fallback)
    else {
      // Not strictly necessary, but helpful if there's any mismatch
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Unknown command!', ephemeral: true });
      }
    }

  } catch (error) {
    console.error(`Error handling /${commandName}:`, error);
    // If not replied yet, send error
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Internal error. Check logs.', ephemeral: true });
    } else {
      await interaction.followUp({ content: '❌ Internal error. Check logs.', ephemeral: true });
    }
  }
});

// =============================
// 6. Log in the Bot
// =============================
client.login(process.env.BOT_TOKEN);
