/**
 * 🍌 proxy — route a bot's connection through a SOCKS5 proxy.
 *
 * Each "player" (bot) can have its own proxy attached. A proxy is stored on the
 * bot config as `proxy`, accepted either as a string:
 *
 *     "socks5://user:pass@1.2.3.4:1080"
 *     "1.2.3.4:1080"
 *
 * or an object:
 *
 *     { host, port, username, password }
 *
 * `buildConnect(config)` returns a mineflayer `connect` function (or null if no
 * proxy), which opens the TCP socket through the SOCKS5 server and hands it to
 * the protocol client. Different bots can therefore each exit from a different
 * IP.
 */

const { SocksClient } = require('socks');
const net = require('net');
const dns = require('dns');
const Logger = require('./logger.js');

/**
 * Resolve a Minecraft host the same way minecraft-protocol does.
 *
 * mineflayer's SRV lookup lives *inside* its default `options.connect`, so
 * supplying our own connect function (which is how proxying works) skips it.
 * Servers that publish `_minecraft._tcp.<host>` on a non-standard port would
 * then be dialed on 25565 and the proxy would answer "HostUnreachable".
 *
 * Mirrors tcp_dns.js: only look up SRV when the port is the 25565 default and
 * the host is a real domain.
 *
 * @param {string} host
 * @param {number} port
 * @returns {Promise<{host:string,port:number,viaSrv:boolean}>}
 */
function resolveTarget(host, port) {
    return new Promise((resolve) => {
        if (port !== 25565 || net.isIP(host) !== 0 || host === 'localhost') {
            return resolve({ host, port, viaSrv: false });
        }
        dns.resolveSrv('_minecraft._tcp.' + host, (err, addresses) => {
            if (err || !addresses || !addresses.length) {
                return resolve({ host, port, viaSrv: false });
            }
            resolve({ host: addresses[0].name, port: addresses[0].port, viaSrv: true });
        });
    });
}

/**
 * Percent-decode a credential, falling back to the raw value when the string
 * isn't valid encoding (e.g. a password with a literal '%').
 * @param {string|undefined} v
 */
function decodeComponent(v) {
    if (v === undefined || v === null) return v;
    if (!String(v).includes('%')) return v;
    try { return decodeURIComponent(v); } catch (_) { return v; }
}

/**
 * Normalise whatever the config holds into { host, port, username?, password? }.
 * Returns null when there's no usable proxy.
 * @param {string|object|null|undefined} input
 */
function parseProxy(input) {
    if (!input) return null;

    // Object form.
    if (typeof input === 'object') {
        const host = input.host || input.hostname || input.ip;
        const port = parseInt(input.port);
        if (!host || !port || isNaN(port)) return null;
        const out = { host: String(host), port };
        if (input.username) out.username = String(input.username);
        if (input.password) out.password = String(input.password);
        return out;
    }

    if (typeof input !== 'string') return null;
    let s = input.trim();
    if (!s) return null;

    // Strip an optional scheme (socks5:// / socks:// / socks5h://).
    s = s.replace(/^socks(5h?|4)?:\/\//i, '');

    // Optional credentials before an '@'.
    let username, password;
    const at = s.lastIndexOf('@');
    if (at !== -1) {
        const creds = s.slice(0, at);
        s = s.slice(at + 1);
        const ci = creds.indexOf(':');
        if (ci !== -1) {
            username = creds.slice(0, ci);
            password = creds.slice(ci + 1);
        } else {
            username = creds;
        }
        // Credentials arrive percent-encoded from the proxy pool (a password
        // containing ':' or '@' would otherwise be re-split incorrectly here).
        username = decodeComponent(username);
        password = decodeComponent(password);
    }

    // host:port
    const ci = s.lastIndexOf(':');
    if (ci === -1) return null;
    const host = s.slice(0, ci);
    const port = parseInt(s.slice(ci + 1));
    if (!host || !port || isNaN(port)) return null;

    const out = { host, port };
    if (username) out.username = username;
    if (password) out.password = password;
    return out;
}

/** Human-readable proxy label that never leaks the password. */
function describeProxy(input) {
    const p = parseProxy(input);
    if (!p) return 'none';
    const auth = p.username ? `${p.username}@` : '';
    return `socks5://${auth}${p.host}:${p.port}`;
}

/**
 * Build a mineflayer `connect` function for the given bot config, or null when
 * no (valid) proxy is configured.
 * @param {object} config bot config with optional `config.proxy`
 */
function buildConnect(config) {
    const proxy = parseProxy(config.proxy);
    if (!proxy) return null;

    const requested = { host: config.host, port: config.port || 25565 };

    return function connect(client) {
        resolveTarget(requested.host, requested.port).then((dest) => {
            if (dest.viaSrv) {
                Logger.verbose(`🔎 SRV: ${requested.host} → ${dest.host}:${dest.port}`);
            }

            const socksOpts = {
                proxy: {
                    host: proxy.host,
                    port: proxy.port,
                    type: 5,
                    ...(proxy.username ? { userId: proxy.username } : {}),
                    ...(proxy.password ? { password: proxy.password } : {})
                },
                command: 'connect',
                destination: { host: dest.host, port: dest.port },
                // Fail fast on dead proxies instead of hanging the bot forever.
                timeout: 15000
            };

            SocksClient.createConnection(socksOpts, (err, info) => {
                if (err) {
                    Logger.error(`Proxy connect failed via ${describeProxy(config.proxy)} → ${dest.host}:${dest.port}: ${err.message}`);
                    client.emit('error', err);
                    return;
                }
                client.setSocket(info.socket);
                client.emit('connect');
            });
        });
    };
}

module.exports = { parseProxy, describeProxy, buildConnect, resolveTarget };
