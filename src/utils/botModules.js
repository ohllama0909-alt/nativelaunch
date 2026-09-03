'use strict';

/**
 * Module descriptors for BananaBot.
 *
 * Every module the bot owns is described exactly once, here. Each descriptor
 * READS live state off the module instance instead of caching a boolean, which
 * is what stops the panel and the bot from drifting apart.
 *
 * MODULE_CATALOG — the static half of the description — carries the labels,
 * the editable settings schema (fields) and where each setting lives in the
 * bot config (mirror). The panel and the bot both read this file, so a setting
 * added here appears in the panel's module editor with no other wiring.
 *
 * A note on start(): several modules take required arguments — MineAndSell and
 * BoxPvpMiner need a block name, Fight needs a player name, GoTo needs
 * coordinates, Follower needs a target. A plain on/off switch cannot invent
 * those, so they are registered as stop-only unless preconfigured opts are
 * supplied: start(opts) resolves the argument from the persisted settings.
 */

const MODULE_CATALOG = {
    boneCollector: {
        label: 'Bone Collector',
        group: 'Economy',
        describe: 'Walks the collect route and deposits bones',
        mirror: 'boneCollector',
        fields: [
            { key: 'collectSlot', label: 'Collect slot', type: 'number', min: 1, max: 36, step: 1, default: 13, info: 'Inventory slot the collected items are moved to' },
            { key: 'cycleDelay', label: 'Cycle delay (ms)', type: 'number', min: 1000, step: 500, default: 15000, info: 'Wait between collection cycles' },
        ],
    },
    boneDropper: {
        label: 'Bone Dropper',
        group: 'Economy',
        describe: 'Drops bones for a paired collector bot',
        fields: [],
    },
    mineAndSell: {
        label: 'Mine and Sell',
        group: 'Economy',
        describe: 'Mines a block type then sells — needs a block to mine',
        fields: [
            { key: 'block', label: 'Block to mine', type: 'text', required: true, placeholder: 'diamond_ore', info: 'Minecraft block name (e.g. diamond_ore, iron_ore, stone)' },
        ],
    },
    pvCandleDropper: {
        label: 'PV Candle Dropper',
        group: 'Economy',
        describe: 'Moves candles out of player vaults',
        mirror: 'pvCandleDropper',
        fields: [
            { key: 'pvs', label: 'Player vaults', type: 'list', default: '1', info: 'Comma-separated PV numbers, e.g. 1,2,3' },
            { key: 'interval', label: 'Check interval (ms)', type: 'number', min: 5000, step: 1000, default: 15000, info: 'How often each PV is checked' },
        ],
    },
    tpKiller: {
        label: 'TP Killer',
        group: 'Combat',
        describe: 'Accepts TPA requests and eliminates the sender',
        fields: [],
    },
    crystalTrap: {
        label: 'Crystal Trap',
        group: 'Combat',
        describe: 'Arms end crystals when players come close',
        mirror: 'crystal',
        fields: [
            { key: 'playerThreshold', label: 'Player threshold', type: 'number', min: 1, max: 50, step: 1, default: 10, info: 'Detonate when this many players are nearby' },
            { key: 'radius', label: 'Radius', type: 'number', min: 1, max: 32, step: 1, default: 6, info: '"Nearby" means within this many blocks of the crystal' },
            { key: 'minHealth', label: 'Min health (HP)', type: 'number', min: 1, max: 20, step: 1, default: 14, info: 'Below this, eat instead of crystalling' },
        ],
    },
    fight: {
        label: 'Fight',
        group: 'Combat',
        describe: 'Attacks a named player — needs a target',
        fields: [
            { key: 'target', label: 'Target player', type: 'text', required: true, placeholder: 'steve', info: 'Player to hunt and attack' },
        ],
    },
    boxPvpMiner: {
        label: 'BoxPVP Miner',
        group: 'Combat',
        describe: 'Mines inside the BoxPVP arena — needs a block',
        fields: [
            { key: 'block', label: 'Block to mine', type: 'text', required: true, placeholder: 'obsidian', info: 'Block name to mine inside the arena' },
        ],
    },
    follower: {
        label: 'Follower',
        group: 'Movement',
        describe: 'Follows a player — needs a target',
        fields: [
            { key: 'target', label: 'Target player', type: 'text', required: true, placeholder: 'steve', info: 'Player to follow' },
            { key: 'range', label: 'Follow range', type: 'number', min: 1, max: 16, step: 1, default: 2, info: 'How close to trail (blocks)' },
        ],
    },
    goTo: {
        label: 'Go To',
        group: 'Movement',
        describe: 'Pathfinds to coordinates — needs x/y/z',
        fields: [
            { key: 'x', label: 'X', type: 'number', required: true },
            { key: 'y', label: 'Y', type: 'number', required: true },
            { key: 'z', label: 'Z', type: 'number', required: true },
            { key: 'range', label: 'Arrive range', type: 'number', min: 0, max: 64, step: 1, default: 1, info: 'How close counts as "arrived"' },
        ],
    },
    autoHome: {
        label: 'Auto Home',
        group: 'Movement',
        describe: 'Returns home on a timer',
        mirror: 'autoHome',
        fields: [
            { key: 'homeCommand', label: 'Home command', type: 'text', default: '/home', info: 'Command /home sends' },
            { key: 'bedName', label: 'Bed name', type: 'text', default: 'light_blue_bed', info: 'Item name of the respawn bed' },
            { key: 'deathDelay', label: 'Re-home delay (ms)', type: 'number', min: 500, step: 500, default: 3000, info: 'Wait after death before /home again' },
        ],
    },
    invCleaner: {
        label: 'Inventory Cleaner',
        group: 'Maintenance',
        describe: 'Drops junk items on an interval',
        fields: [],
    },
    chatGames: {
        label: 'Chat Games',
        group: 'Maintenance',
        describe: 'Answers unscramble and quick-type events',
        mirror: 'chatGames',
        fields: [
            { key: 'startSec', label: 'Start delay (s)', type: 'number', min: 0.5, step: 0.1, default: 4.1, info: 'Answer delay before rounds begin' },
            { key: 'stepSec', label: 'Step (s)', type: 'number', min: 0.05, step: 0.05, default: 0.3, info: 'Wait between candidate answers' },
            { key: 'maxSec', label: 'Max (s)', type: 'number', min: 1, step: 0.1, default: 6, info: 'Give up answering after this long' },
            { key: 'jitterSec', label: 'Jitter (s)', type: 'number', min: 0, step: 0.01, default: 0.09, info: 'Randomness added to answer timing' },
            { key: 'longWordLetters', label: 'Long word letters', type: 'number', min: 3, step: 1, default: 10, info: 'Words at least this long get bonus time' },
            { key: 'longWordBonusSec', label: 'Long word bonus (s)', type: 'number', min: 0, step: 0.1, default: 1, info: 'Extra time granted to long words' },
            { key: 'spamGapMs', label: 'Spam gap (ms)', type: 'number', min: 100, step: 100, default: 1000, info: 'Gap between range-game spam messages' },
        ],
    },
    antiStuck: {
        label: 'Anti Stuck',
        group: 'Maintenance',
        describe: 'Pathfinder watchdog, self-gates while idle',
        fields: [],
    },
    autoAuth: {
        label: 'Auto Auth',
        group: 'Maintenance',
        describe: 'Answers the /login and /register prompts',
        readOnly: true,
        fields: [],
    },
    guiManager: {
        label: 'GUI Manager',
        group: 'Maintenance',
        describe: 'Handles server inventory menus',
        readOnly: true,
        fields: [],
    },
    discordBridge: {
        label: 'Discord Bridge',
        group: 'Integration',
        describe: 'Relays chat and commands to Discord',
        unavailable: 'Not configured',
        fields: [],
    },
    payoutBridge: {
        label: 'Payout Bridge',
        group: 'Integration',
        describe: 'Serves the payout panel and Discord claims',
        unavailable: 'Not configured',
        fields: [],
    },
    trashModule: {
        label: 'Trash Module',
        group: 'Maintenance',
        describe: 'Bulk item disposal',
        unavailable: 'Not wired into the bot',
        fields: [],
    },
};

function registerBotModules(registry, bot) {
    const has = (name) => !!bot[name];
    const run = (name) => () => !!(bot[name] && bot[name].running);
    const cat = (key) => MODULE_CATALOG[key] || {};

    /* ─── Economy ─────────────────────────────────────────────────────── */

    registry.register({
        key: 'boneCollector',
        ...cat('boneCollector'),
        isRunning: run('boneCollector'),
        start: () => bot.boneCollector.start(),
        stop: () => bot.boneCollector.stop(),
        detail: () => {
            const c = bot.config?.boneCollector;
            return c ? `slot ${c.collectSlot} · ${Math.round((c.cycleDelay || 0) / 1000)}s cycle` : null;
        },
    });

    registry.register({
        key: 'boneDropper',
        ...cat('boneDropper'),
        isRunning: run('boneDropper'),
        start: () => bot.boneDropper.start(),
        stop: () => bot.boneDropper.stop(),
    });

    registry.register({
        key: 'mineAndSell',
        ...cat('mineAndSell'),
        isRunning: run('mineAndSell'),
        start: (opts) => {
            const block = opts && opts.block;
            if (!block) throw new Error('Block is required — set it in module settings');
            return bot.mineAndSell.start(block);
        },
        stop: () => bot.mineAndSell.stop(),
    });

    registry.register({
        key: 'pvCandleDropper',
        ...cat('pvCandleDropper'),
        isRunning: run('pvCandleDropper'),
        start: () => bot.pvCandleDropper.start(),
        stop: () => bot.pvCandleDropper.stop(),
    });

    /* ─── Combat ──────────────────────────────────────────────────────── */

    registry.register({
        key: 'tpKiller',
        ...cat('tpKiller'),
        isRunning: run('tpKiller'),
        start: () => bot.tpKiller.startMain(),
        stop: () => bot.tpKiller.stop(),
        detail: () => {
            const s = bot.tpKiller.getStatus?.();
            if (!s) return null;
            return typeof s === 'string' ? s : (s.kills != null ? `${s.kills} kills` : null);
        },
    });

    registry.register({
        key: 'crystalTrap',
        ...cat('crystalTrap'),
        isRunning: run('crystalTrap'),
        start: () => bot.crystalTrap.start(),
        stop: () => bot.crystalTrap.stop(),
    });

    registry.register({
        key: 'fight',
        ...cat('fight'),
        isRunning: run('fight'),
        start: (opts) => {
            const target = opts && opts.target;
            if (!target) throw new Error('Target player is required — set it in module settings');
            return bot.fight.start(target);
        },
        stop: () => bot.fight.stop(),
    });

    registry.register({
        key: 'boxPvpMiner',
        ...cat('boxPvpMiner'),
        isRunning: run('boxPvpMiner'),
        start: (opts) => {
            const block = opts && opts.block;
            if (!block) throw new Error('Block is required — set it in module settings');
            return bot.boxPvpMiner.start(block);
        },
        stop: () => bot.boxPvpMiner.stop(),
    });

    /* ─── Movement ──────────────────────────────────────────────────── */

    registry.register({
        key: 'follower',
        ...cat('follower'),
        isRunning: run('follower'),
        start: (opts) => {
            const target = opts && opts.target;
            if (!target) throw new Error('Target player is required — set it in module settings');
            return bot.follower.follow(target, opts.range);
        },
        stop: () => bot.follower.unfollow(),
    });

    registry.register({
        key: 'goTo',
        ...cat('goTo'),
        isRunning: run('goTo'),
        // gotoSaved() needs no arguments, but ops can carry exact coordinates.
        start: (opts) => {
            if (opts && opts.x != null && opts.y != null && opts.z != null) {
                bot.goTo.goto(opts.x, opts.y, opts.z, opts.range);
            } else {
                bot.goTo.gotoSaved();
            }
        },
        stop: () => bot.goTo.stop(),
    });

    registry.register({
        key: 'autoHome',
        ...cat('autoHome'),
        isRunning: run('autoHome'),
        start: () => bot.autoHome.start(),
        stop: () => bot.autoHome.stop(),
    });

    /* ─── Maintenance ────────────────────────────────────────────────── */

    registry.register({
        key: 'invCleaner',
        ...cat('invCleaner'),
        isRunning: run('invCleaner'),
        start: () => bot.invCleaner.start(),
        stop: () => bot.invCleaner.stop(),
    });

    registry.register({
        key: 'chatGames',
        ...cat('chatGames'),
        isRunning: run('chatGames'),
        start: () => bot.chatGames.start(),
        stop: () => bot.chatGames.stop(),
        // NEVER call status() here. It PRINTS 13 lines and returns undefined.
        // detail() runs on every registry poll, so it must be a pure read with
        // no side effects — see the warning at the top of this file.
        detail: () => {
            const w = bot.chatGames.wins;
            if (!w || !w.total) return null;
            return `${w.total} wins`;
        },
    });

    registry.register({
        key: 'antiStuck',
        ...cat('antiStuck'),
        isRunning: () => !!(bot.antiStuck && bot.antiStuck.running),
        start: () => bot.antiStuck.start(),
        stop: () => bot.antiStuck.stop(),
    });

    // AutoAuth has no start/stop — it is a passive chat listener that is either
    // armed or not. Report it read-only rather than faking a switch.
    registry.register({
        key: 'autoAuth',
        ...cat('autoAuth'),
        isRunning: () => !!bot.autoAuth && (bot.autoLoginEnabled || bot.autoRegisterEnabled),
        detail: () => {
            if (!bot.autoAuth) return null;
            if (bot.autoAuth.busy) return 'authenticating…';
            const parts = [];
            if (bot.autoLoginEnabled) parts.push('login');
            if (bot.autoRegisterEnabled) parts.push('register');
            return parts.length ? parts.join(' + ') : 'disarmed';
        },
    });

    registry.register({
        key: 'guiManager',
        ...cat('guiManager'),
        isRunning: () => has('guiManager'),
    });

    /* ─── Integration ────────────────────────────────────────────────── */

    registry.register({
        key: 'discordBridge',
        ...cat('discordBridge'),
        unavailable: bot.discordBridge ? null : 'Not configured',
        isRunning: () => !!(bot.discordBridge && bot.discordBridge.running),
        stop: () => bot.discordBridge.destroy(),
    });

    registry.register({
        key: 'payoutBridge',
        ...cat('payoutBridge'),
        unavailable: bot.payoutBridge ? null : 'Not configured',
        isRunning: () => !!(bot.payoutBridge && bot.payoutBridge.running),
        start: () => bot.payoutBridge.start(),
        stop: () => bot.payoutBridge.stop(),
    });

    /* TrashModule ships in modules/ but BananaBot never instantiates it. Surface
       that honestly instead of silently omitting it. */
    registry.register({
        key: 'trashModule',
        ...cat('trashModule'),
        isRunning: () => false,
    });

    return registry;
}

module.exports = { registerBotModules, MODULE_CATALOG };