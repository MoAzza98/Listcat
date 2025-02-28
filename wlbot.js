require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

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
  listType: {
    type: String,
    enum: ['whitelist', 'freemint'],
    required: true
  },
  // Additional fields
  registeredViaCode: { type: Boolean, default: false },

  // The maximum number of entries the user can have on this list.
  // All docs for the same user & same listType should ideally share the same value.
  maxWhitelistEntries: { type: Number, default: 1 }
});

const Wallet = mongoose.model('Wallet', walletSchema);

// =============================
// 3. Express Server Setup
// =============================
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Simple middleware for API key-based auth
const authenticate = (req, res, next) => {
  const providedApiKey = req.headers['api-key'];
  if (providedApiKey !== process.env.API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
};

// ---------- Example Routes for your API ----------
app.get('/whitelist', authenticate, async (req, res) => {
  const wallets = await Wallet.find();
  res.json(wallets);
});

// ... (Other routes like /exportwhitelist, /replacewhitelist, etc.)

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
  // /addwhitelist
  new SlashCommandBuilder()
    .setName('addwhitelist')
    .setDescription('Add your wallet address to the Whitelist (role restricted).')
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

  // /increasewhiteslots (admin only)
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

  // (Optional) You may have freemint commands, etc.
]
.map(command => command.toJSON());

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

  // Replace these with your real role IDs
  const WHITELIST_ROLE_ID = '123456789012345678';
  const ADMIN_ROLE_ID     = '234567890123456789';

  // =========================
  // /addwhitelist
  // =========================
  if (commandName === 'addwhitelist') {
    try {
      await interaction.deferReply({ ephemeral: true });

      // 1) Check if user has the Whitelist role
      if (!interaction.member.roles.cache.has(WHITELIST_ROLE_ID)) {
        return interaction.editReply('❌ You need the **Whitelist** role to use this command.');
      }

      const wallet = interaction.options.getString('wallet');

      // 2) Fetch all existing docs for this user & listType=whitelist
      let userWhitelistEntries = await Wallet.find({
        discordId: interaction.user.id,
        listType: 'whitelist'
      });

      // 3) Determine the user's current max slots
      //    If no docs exist yet, we will create the first doc with default = 1
      let currentMax = 1;
      if (userWhitelistEntries.length > 0) {
        // Grab the max from the first doc (they should all match)
        currentMax = userWhitelistEntries[0].maxWhitelistEntries;
      }

      // 4) Check if user already registered this same wallet
      const alreadyUsed = userWhitelistEntries.find(
        (doc) => doc.walletAddress === wallet
      );
      if (alreadyUsed) {
        return interaction.editReply(`❌ You already added **${wallet}** to the Whitelist.`);
      }

      // 5) Check if user is at their max
      if (userWhitelistEntries.length >= currentMax) {
        return interaction.editReply(
          `❌ You've reached your limit of **${currentMax}** whitelist slots.`
        );
      }

      // 6) Create a new doc for this wallet
      const newDoc = await Wallet.create({
        discordId: interaction.user.id,
        walletAddress: wallet,
        listType: 'whitelist',
        // Make sure new doc has the same max as the others
        maxWhitelistEntries: currentMax
      });

      await interaction.editReply(
        `✅ Your wallet **${wallet}** is now on the Whitelist! (You have used ${
          userWhitelistEntries.length + 1
        } of ${currentMax} slots).`
      );
    } catch (err) {
      console.error('Error in /addwhitelist:', err);
      await interaction.editReply('❌ An error occurred. Please try again.');
    }
  }

  // =========================
  // /checkwhitelist
  // =========================
  else if (commandName === 'checkwhitelist') {
    try {
      await interaction.deferReply({ ephemeral: true });

      const wallet = interaction.options.getString('wallet');
      const found = await Wallet.findOne({
        walletAddress: wallet,
        listType: 'whitelist'
      });

      if (found) {
        await interaction.editReply(`✅ **${wallet}** is on the Whitelist!`);
      } else {
        await interaction.editReply(`❌ **${wallet}** is NOT on the Whitelist.`);
      }
    } catch (err) {
      console.error('Error in /checkwhitelist:', err);
      await interaction.editReply('❌ An error occurred. Please try again.');
    }
  }

  // =========================
  // /increasewhiteslots
  // =========================
  else if (commandName === 'increasewhiteslots') {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Ensure only admins can use this command
      if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
        return interaction.editReply(
          '❌ You do not have permission to use this command.'
        );
      }

      // The user we are granting slots to
      const targetUser = interaction.options.getUser('user');
      const slotsToAdd = interaction.options.getInteger('slots');
      if (slotsToAdd <= 0) {
        return interaction.editReply('❌ Slots to add must be a positive integer.');
      }

      // Fetch all docs for that user & listType=whitelist
      let userDocs = await Wallet.find({
        discordId: targetUser.id,
        listType: 'whitelist'
      });

      if (userDocs.length === 0) {
        // The user has no docs yet; create one with new max
        const newMax = 1 + slotsToAdd; // default = 1, plus whatever we add
        await Wallet.create({
          discordId: targetUser.id,
          walletAddress: 'NONE', // or you can leave it blank or store a placeholder
          listType: 'whitelist',
          maxWhitelistEntries: newMax
        });

        return interaction.editReply(
          `✅ Created a new Whitelist doc for <@${targetUser.id}> with **${newMax}** total slots.`
        );
      } else {
        // They already have docs. Update *all* docs to keep maxWhitelistEntries consistent
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
    } catch (err) {
      console.error('Error in /increasewhiteslots:', err);
      await interaction.editReply('❌ An error occurred while updating slots.');
    }
  }
});

// =============================
// 6. Log in the Bot
// =============================
client.login(process.env.BOT_TOKEN);