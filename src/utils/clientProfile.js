/**
 * 🍌 clientProfile — make the bot look like a real Minecraft client to
 * LimboAPI / LimboFilter / GUARD and similar proxy anti-bots.
 *
 * These plugins verify:
 *   1. CLIENT SETTINGS — a native serverbound `settings` packet (locale,
 *      view distance, chat mode, skin parts, main hand). Missing or malformed
 *      values are an instant bot flag.
 *   2. CLIENT BRAND — a native `minecraft:brand` plugin channel message.
 *   3. FALLING CHECK / FREEZE — the player is spawned in limbo and movement
 *      is watched. We leave physics ON by default and rely on limboFreeze to
 *      suppress voluntary movement during verification.
 *
 * We let mineflayer send ONE native brand/settings packet. Values are written
 * into bot.settings using the exact types mineflayer expects (see
 * mineflayer/lib/plugins/settings.js).
 */

const Logger = require('./logger.js');

const DEFAULTS = {
    brand: 'vanilla',           // default vanilla brand; 'fabric' if server expects modded
    locale: 'en_us',
    viewDistance: 8,
    chat: 'enabled',            // 'enabled' | 'commandsOnly' | 'disabled'  (mineflayer format)
    chatColors: true,
    skinParts: {
        showCape: true,
        showJacket: true,
        showLeftSleeve: true,
        showRightSleeve: true,
        showLeftPants: true,
        showRightPants: true,
        showHat: true
    },
    mainHand: 'right',          // 'right' | 'left'
    enableTextFiltering: false,
    enableServerListing: true
};

function resolveProfile(config) {
    const cp = (config && config.clientProfile) || {};
    const p = { ...DEFAULTS, ...cp };

    // Accept legacy numeric mainHand (1=right, 0=left) from older configs.
    if (p.mainHand === 1 || p.mainHand === '1') p.mainHand = 'right';
    if (p.mainHand === 0 || p.mainHand === '0') p.mainHand = 'left';

    // Accept legacy numeric chatMode (0=enabled, 1=commandsOnly, 2=disabled).
    if (p.chatMode === 0 || p.chatMode === '0') p.chat = 'enabled';
    if (p.chatMode === 1 || p.chatMode === '1') p.chat = 'commandsOnly';
    if (p.chatMode === 2 || p.chatMode === '2') p.chat = 'disabled';

    // Accept legacy numeric skinParts bitmask.
    if (typeof p.skinParts === 'number') {
        const bits = p.skinParts;
        p.skinParts = {
            showCape: !!(bits & 0x01),
            showJacket: !!(bits & 0x02),
            showLeftSleeve: !!(bits & 0x04),
            showRightSleeve: !!(bits & 0x08),
            showLeftPants: !!(bits & 0x10),
            showRightPants: !!(bits & 0x20),
            showHat: !!(bits & 0x40)
        };
    }

    return p;
}

/**
 * Options merged into mineflayer.createBot().
 * This causes mineflayer to send the native brand packet once, cleanly.
 */
function clientOptions(config) {
    const p = resolveProfile(config);
    return {
        brand: p.brand,
        viewDistance: p.viewDistance,
        chat: p.chat,
        colorsEnabled: p.chatColors,
        skinParts: p.skinParts,
        mainHand: p.mainHand,
        enableTextFiltering: p.enableTextFiltering,
        enableServerListing: p.enableServerListing
    };
}

/**
 * Apply realistic client settings to a freshly created bot by mutating
 * bot.settings. mineflayer reads these values when it sends its single native
 * settings packet at login.
 *
 * Call synchronously right after mineflayer.createBot().
 */
function applyClientProfile(bot, config) {
    const p = resolveProfile(config);
    try {
        Object.assign(bot.settings, {
            locale: p.locale,
            viewDistance: p.viewDistance,
            chat: p.chat,
            colorsEnabled: p.chatColors,
            skinParts: p.skinParts,
            mainHand: p.mainHand,
            enableTextFiltering: p.enableTextFiltering,
            enableServerListing: p.enableServerListing
        });
    } catch (e) {
        Logger.error(`clientProfile: failed to apply settings: ${e.message}`);
    }
    Logger.verbose(`🧬 Client profile: brand="${p.brand}" locale=${p.locale} view=${p.viewDistance} chat=${p.chat} hand=${p.mainHand}`);
}

module.exports = { applyClientProfile, clientOptions, resolveProfile };
