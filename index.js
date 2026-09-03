/**
 * 🍌 BananaMoney Lite - Entry Point
 *
 * Modes:
 *   1. Default (interactive)   → single-bot CLI setup then start.
 *   2. Multibot panel          → asks at launch; if yes, starts web panel
 *                                on port 3001 and does NOT run any bot here.
 *   3. Child bot (BOT_CHILD=1) → config comes from BOT_CONFIG_JSON +
 *                                BOT_DATA_DIR env vars (spawned by the
 *                                MultiBotServer).  Skips prompts entirely.
 */

require('./src/utils/polyfill.js');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const readline = require('readline');

// ─── Child-bot mode (spawned by MultiBotServer) ────────────────────────
if (process.env.BOT_CHILD === '1') {
  try {
    const cfg = JSON.parse(process.env.BOT_CONFIG_JSON || '{}');
    const { BananaBot } = require('./src/BananaBot.js');
    const bot = new BananaBot(cfg);
    bot.init();
  } catch (err) {
    console.error('CHILD_FATAL ' + err.message);
    process.exit(1);
  }
  return;
}

// ─── Standalone interactive mode ───────────────────────────────────────
const config = JSON.parse(readFileSync('./config/config.json', 'utf-8'));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question, defaultValue) {
  return new Promise((resolve) => {
    const defaultText = defaultValue ? ` (default: ${defaultValue})` : '';
    rl.question(`${question}${defaultText}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function main() {
  console.log('');
  console.log('🍌 BananaMoney Lite');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // ─── Multibot panel prompt ──────────────────────────────────────────
  const runPanel = await prompt('Run multibot panel instead of a bot? (y/n)', 'n');
  if (runPanel.toLowerCase() === 'y' || runPanel.toLowerCase() === 'yes') {
    rl.close();
    const { start } = require('./src/MultiBotServer.js');
    await start(3123);
    return; // Do NOT start any bot in this process.
  }

  console.log('');
  console.log('🍌 Single-Bot Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Username
  const username = await prompt('Enter username', config.username);
  if (username) config.username = username;

  // Server IP
  const host = await prompt('Enter server IP', config.host);
  if (host) config.host = host;

  // Discord bot
  console.log('');
  const discordChoice = await prompt(
    'Enable Discord bridge? (y/n)',
    config.discord?.enabled ? 'y' : 'n'
  );
  const discordEnabled =
    discordChoice.toLowerCase() === 'y' || discordChoice.toLowerCase() === 'yes';

  if (!config.discord) config.discord = { enabled: false, token: '', guildId: '' };
  config.discord.enabled = discordEnabled;

  if (discordEnabled) {
    if (!config.discord.token) {
      const token = await prompt('Enter Discord bot token', '');
      if (token) config.discord.token = token;
    } else {
      console.log('  ✓ Discord token found in config');
    }

    const guildId = await prompt('Enter Discord guild/server ID', config.discord.guildId || '');
    if (guildId) config.discord.guildId = guildId;

    if (!config.discord.token || !config.discord.guildId) {
      console.log('  ⚠ Missing Discord token or guild ID - bot will not connect to Discord');
      config.discord.enabled = false;
    } else {
      console.log('  ✓ Discord will create/use channel with bot name');
    }
  }

  console.log('');

  try {
    writeFileSync('./config/config.json', JSON.stringify(config, null, 4));
  } catch (err) {
    console.log('  ⚠ Could not save config');
  }

  rl.close();

  const { BananaBot } = require('./src/BananaBot.js');
  const bot = new BananaBot(config);
  bot.init();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n🍌 Exiting...');
  process.exit(0);
});
