/**
 * 🍌 Shared pathfinder tuning.
 *
 * One place that builds a well-tuned `Movements` object so every module gets
 * the same fast, robust navigation instead of each rolling its own. Tweak the
 * pathfinder's "feel" here and it changes everywhere.
 *
 * mineflayer-pathfinder 2.4.5 reads block data from `bot.registry`, so the
 * second `mcData` arg is optional — kept for call-site compatibility.
 */

const { Movements } = require('mineflayer-pathfinder');

/**
 * @param {import('mineflayer').Bot} bot
 * @param {object} [mcData]            ignored on 2.4.5, accepted for compat
 * @param {object} [opts]
 * @param {boolean} [opts.canDig=true] allow tunnelling/breaking to reach goal
 * @param {boolean} [opts.parkour=true]
 * @param {boolean} [opts.sprint=true]
 * @param {number}  [opts.maxDropDown=4] max safe fall (blocks)
 */
function createBestMovements(bot, mcData, opts = {}) {
    const m = new Movements(bot);

    const {
        canDig = true,
        parkour = true,
        sprint = true,
        maxDropDown = 4
    } = opts;

    // ── Speed: sprint + parkour + smooth direct motion ──────────────────
    m.allowSprinting = sprint;
    m.allowParkour = parkour;
    m.allowFreeMotion = true;        // walk straight to in-sight targets
    m.allow1by1towers = true;        // pillar up when it's the only way

    // ── Reachability vs. tidiness ───────────────────────────────────────
    m.canDig = canDig;
    m.digCost = 1;
    m.placeCost = 1;
    m.maxDropDown = maxDropDown;
    m.dontMineUnderFallingBlock = true;
    m.dontCreateFlow = true;         // don't break blocks holding back liquids

    // ── Hazards: make lava/fire/cobweb very expensive instead of routing
    //    blindly through them. liquidCost is the per-block water penalty. ─
    m.liquidCost = 8;

    return m;
}

module.exports = { createBestMovements };
