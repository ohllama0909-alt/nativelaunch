/**
 * 🍌 notify — fire-and-forget webhook alerts.
 *
 * Posts a JSON `{ message }` payload to an external endpoint, mirroring:
 *   curl -X POST https://wp.ikie-cli.xyz/send \
 *        -H 'Content-Type: application/json' \
 *        -d '{"message":"hello"}'
 *
 * Used to alert when a bot is kicked or its SOCKS5 proxy drops.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const Logger = require('./logger.js');

const NOTIFY_URL = process.env.NOTIFY_URL || 'https://wp.ikie-cli.xyz/send';

function sendMessage(message, url = NOTIFY_URL) {
    try {
        const u = new URL(url);
        const body = JSON.stringify({ message: String(message) });
        const lib = u.protocol === 'http:' ? http : https;
        const req = lib.request({
            method: 'POST',
            hostname: u.hostname,
            port: u.port || (u.protocol === 'http:' ? 80 : 443),
            path: u.pathname + u.search,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 8000
        }, (res) => { res.on('data', () => {}); res.on('end', () => {}); });
        req.on('error', (e) => Logger.error(`notify: send failed: ${e.message}`));
        req.on('timeout', () => { try { req.destroy(); } catch (_) {} });
        req.write(body);
        req.end();
    } catch (e) {
        Logger.error(`notify: bad URL/payload: ${e.message}`);
    }
}

module.exports = { sendMessage, NOTIFY_URL };
