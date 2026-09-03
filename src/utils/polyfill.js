/**
 * Polyfill for modern Node.js versions
 */

// Node v25+ removes SlowBuffer, but some older deps (buffer-equal-constant-time) still use it.
if (typeof global.SlowBuffer === 'undefined') {
    global.SlowBuffer = Buffer;
}
