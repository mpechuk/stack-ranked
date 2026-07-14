/* =============================================================================
 * STACK RANKED — networked play (PeerJS, host-authoritative)
 * -----------------------------------------------------------------------------
 * Transport + protocol for online play, kept OUT of the rules engine. The game
 * stays host-authoritative: one peer (the host) runs SR.play() and every remote
 * human answers its turn/decision hooks over a WebRTC DataConnection. Clients
 * are thin renderers of the pushed snapshot and send intents back.
 *
 * PeerJS (window.Peer, a CDN global) uses its free public broker for SIGNALLING
 * ONLY (peer discovery); once a DataConnection opens, data flows peer-to-peer.
 * The host's broker id IS the room code (namespaced). We use PeerJS's DEFAULT
 * serialization and send plain envelope objects — `serialization:'none'` does
 * NOT complete the handshake in PeerJS 1.5.x. Per-client snapshot dedup keeps an
 * idle table cheap. This module never touches the DOM; the pure pieces (state
 * codec, protocol, identity, QR) run headlessly in Node — only the transport
 * (hostRoom/joinRoom) needs a browser + window.Peer.
 *
 * Public surface (window.SRNet / module.exports):
 *   serializeState(s)/reviveState(j)     snapshot codec (card refs -> {__ref}; log/_hooks dropped)
 *   redactFor(state, viewerId) -> string per-viewer snapshot (perfect-info: trim only)
 *   MSG / msg(type,payload) / isValid(m) versioned wire envelope + guard
 *   sanitizeId / deriveRoomCode / deriveClientId / roomPeerId   identity
 *   iceServers() -> Promise<[...]>       STUN always + TURN when TURN_CONFIG set
 *   hostRoom(opts) / joinRoom(opts) -> Promise<api>   PeerJS transport
 *   qr.encode(text) -> {size, modules}   dependency-free QR (room-link QR)
 *
 * The QR encoder is adapted from Project Nayuki's "QR Code generator library"
 * (MIT License) — algorithm/tables canonical; folded inline.
 * ========================================================================== */
(function () {
  'use strict';

  var STUN = 'stun:stun.l.google.com:19302';

  function getSR() {
    if (typeof SR !== 'undefined' && SR) return SR;
    if (typeof window !== 'undefined' && window.SR) return window.SR;
    if (typeof globalThis !== 'undefined' && globalThis.SR) return globalThis.SR;
    if (typeof require !== 'undefined') { try { return require('./game.js'); } catch (e) { /* ignore */ } }
    return null;
  }

  /* ---------------------------------------------------------------------------
   * 1. State codec — fold canonical card defs to {__ref:id}; drop volatile fields
   * ------------------------------------------------------------------------ */
  function serializeState(state) {
    var defs = (getSR() || {}).DEFS || {};
    return JSON.stringify(state, function (key, val) {
      if (key === '_hooks') return undefined;   // functions, not serializable
      if (key === 'log') return undefined;       // large + sent incrementally
      // A board/tableau/pile entry that IS a canonical card def -> a tiny ref.
      if (val && typeof val === 'object' && typeof val.id === 'string' && defs[val.id] === val) {
        return { __ref: val.id };
      }
      return val;
    });
  }

  function reviveState(json) {
    var defs = (getSR() || {}).DEFS || {};
    var st = JSON.parse(json, function (key, val) {
      if (val && typeof val === 'object' && typeof val.__ref === 'string') {
        return defs[val.__ref] || { id: val.__ref, name: val.__ref };
      }
      return val;
    });
    if (st && !st.log) st.log = [];   // render code never reads it, but be safe
    return st;
  }

  /* Fold/unfold card refs inside an arbitrary decide-request payload so the
   * host can ship `options`/`candidates` (plain today, but future-proof). */
  function packPayload(obj) { return JSON.parse(serializeAny(obj)); }
  function serializeAny(obj) {
    var defs = (getSR() || {}).DEFS || {};
    return JSON.stringify(obj, function (key, val) {
      if (val && typeof val === 'object' && typeof val.id === 'string' && defs[val.id] === val) return { __ref: val.id };
      return val;
    });
  }
  function unpackPayload(obj) {
    var defs = (getSR() || {}).DEFS || {};
    function walk(v) {
      if (!v || typeof v !== 'object') return v;
      if (typeof v.__ref === 'string') return defs[v.__ref] || v;
      if (Array.isArray(v)) return v.map(walk);
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = walk(v[k]); });
      return out;
    }
    return walk(obj);
  }


  /* ---------------------------------------------------------------------------
   * 3. QR encoder (byte mode) — adapted from Project Nayuki (MIT). Returns a
   *    { size, modules: boolean[][] } matrix; DOM drawing lives in the UI.
   * ------------------------------------------------------------------------ */
  var QR = (function () {
    // ECC codewords per block, indexed [ecl 0..3 = L,M,Q,H][version 1..40].
    var ECC_CW = [
      [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
      [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
      [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
    ];
    var ECC_BLOCKS = [
      [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
      [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
      [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
      [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
    ];

    function numRawDataModules(ver) {
      var result = (16 * ver + 128) * ver + 64;
      if (ver >= 2) {
        var numAlign = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7) result -= 36;
      }
      return result;
    }
    function numDataCodewords(ver, ecl) {
      return Math.floor(numRawDataModules(ver) / 8) - ECC_CW[ecl][ver] * ECC_BLOCKS[ecl][ver];
    }

    // Galois-field (GF(2^8), x^8+x^4+x^3+x^2+1) helpers for Reed-Solomon.
    function gfMul(x, y) {
      var z = 0;
      for (var i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11D);
        z ^= ((y >>> i) & 1) * x;
      }
      return z & 0xFF;
    }
    function rsDivisor(degree) {
      var result = [];
      for (var i = 0; i < degree - 1; i++) result.push(0);
      result.push(1);
      var root = 1;
      for (var j = 0; j < degree; j++) {
        for (var k = 0; k < result.length; k++) {
          result[k] = gfMul(result[k], root);
          if (k + 1 < result.length) result[k] ^= result[k + 1];
        }
        root = gfMul(root, 0x02);
      }
      return result;
    }
    function rsRemainder(data, divisor) {
      var result = divisor.map(function () { return 0; });
      data.forEach(function (b) {
        var factor = b ^ result.shift();
        result.push(0);
        divisor.forEach(function (d, i) { result[i] ^= gfMul(d, factor); });
      });
      return result;
    }

    function alignmentPositions(ver) {
      if (ver === 1) return [];
      var num = Math.floor(ver / 7) + 2;
      var step = Math.floor((ver * 8 + num * 3 + 5) / (num * 4 - 4)) * 2;
      var result = [6];
      for (var pos = ver * 4 + 10; result.length < num; pos -= step) result.splice(1, 0, pos);
      return result;
    }

    // Build the codeword sequence (data + interleaved ECC) for byte-mode `data`.
    function addEcc(dataCodewords, ver, ecl) {
      var numBlocks = ECC_BLOCKS[ecl][ver];
      var blockEccLen = ECC_CW[ecl][ver];
      var rawCodewords = Math.floor(numRawDataModules(ver) / 8);
      var numShortBlocks = numBlocks - rawCodewords % numBlocks;
      var shortBlockLen = Math.floor(rawCodewords / numBlocks);
      var blocks = [];
      var divisor = rsDivisor(blockEccLen);
      for (var i = 0, k = 0; i < numBlocks; i++) {
        var datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
        var dat = dataCodewords.slice(k, k + datLen);
        k += datLen;
        var ecc = rsRemainder(dat, divisor);
        if (i < numShortBlocks) dat.push(0);
        blocks.push(dat.concat(ecc));
      }
      var result = [];
      for (var col = 0; col < blocks[0].length; col++) {
        for (var b = 0; b < blocks.length; b++) {
          if (col !== shortBlockLen - blockEccLen || b >= numShortBlocks) result.push(blocks[b][col]);
        }
      }
      return result;
    }

    function encode(text, minEcl) {
      var bytes = new TextEncoder().encode(text);
      // Pick smallest version fitting at ECC L (max capacity), then boost ECC.
      var ecl = 0; // L
      var ver = 0, dataCap = 0;
      for (var v = 1; v <= 40; v++) {
        var ccBits = (v <= 9) ? 8 : 16;
        var usedBits = 4 + ccBits + bytes.length * 8;
        var cap = numDataCodewords(v, ecl) * 8;
        if (usedBits <= cap) { ver = v; dataCap = cap; break; }
      }
      if (ver === 0) throw new Error('QR: data too large (' + bytes.length + ' bytes)');
      // Boost to the highest ECC level that still fits at this version.
      for (var e = 3; e >= 1; e--) {
        var ccBits2 = (ver <= 9) ? 8 : 16;
        if (4 + ccBits2 + bytes.length * 8 <= numDataCodewords(ver, e) * 8) { ecl = e; break; }
      }

      // --- bit buffer: mode(0100) + char count + data ---
      var bb = [];
      function appendBits(val, len) { for (var i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); }
      appendBits(0x4, 4);
      appendBits(bytes.length, ver <= 9 ? 8 : 16);
      bytes.forEach(function (b) { appendBits(b, 8); });
      var capacityBits = numDataCodewords(ver, ecl) * 8;
      appendBits(0, Math.min(4, capacityBits - bb.length));      // terminator
      while (bb.length % 8 !== 0) bb.push(0);                    // byte-align
      for (var pad = 0xEC; bb.length < capacityBits; pad ^= 0xEC ^ 0x11) appendBits(pad, 8);

      var dataCodewords = [];
      for (var i2 = 0; i2 < bb.length; i2 += 8) {
        var byte = 0;
        for (var j = 0; j < 8; j++) byte = (byte << 1) | bb[i2 + j];
        dataCodewords.push(byte);
      }
      var allCodewords = addEcc(dataCodewords, ver, ecl);

      // --- draw the matrix ---
      var size = ver * 4 + 17;
      var modules = [], isFunction = [];
      for (var y = 0; y < size; y++) {
        modules.push(new Array(size).fill(false));
        isFunction.push(new Array(size).fill(false));
      }
      function setFunc(x, y, dark) {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        modules[y][x] = dark; isFunction[y][x] = true;
      }
      function drawFinder(x, y) {
        for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          setFunc(x + dx, y + dy, (d !== 2 && d !== 4));
        }
      }
      // Timing patterns
      for (var t = 0; t < size; t++) { setFunc(6, t, t % 2 === 0); setFunc(t, 6, t % 2 === 0); }
      drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4);
      // Alignment patterns
      var aln = alignmentPositions(ver);
      for (var ai = 0; ai < aln.length; ai++) for (var aj = 0; aj < aln.length; aj++) {
        var skip = (ai === 0 && aj === 0) || (ai === 0 && aj === aln.length - 1) || (ai === aln.length - 1 && aj === 0);
        if (skip) continue;
        var cx = aln[ai], cy = aln[aj];
        for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) {
          setFunc(cx + dx2, cy + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
        }
      }
      // Reserve format (and version) areas as function modules
      function reserveFormat() {
        for (var i = 0; i <= 8; i++) { setFunc(8, i, false); setFunc(i, 8, false); }
        for (var j2 = 0; j2 < 8; j2++) { setFunc(size - 1 - j2, 8, false); setFunc(8, size - 1 - j2, false); }
        setFunc(8, size - 8, true); // dark module
      }
      reserveFormat();
      if (ver >= 7) {
        var rem = ver;
        for (var vi = 0; vi < 12; vi++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        var vbits = (ver << 12) | rem;
        for (var vb = 0; vb < 18; vb++) {
          var bit = (vbits >>> vb) & 1;
          var a = size - 11 + vb % 3, bcoord = Math.floor(vb / 3);
          setFunc(a, bcoord, bit === 1); setFunc(bcoord, a, bit === 1);
        }
      }

      // Place data with zigzag
      var idx = 0;
      for (var right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (var vert = 0; vert < size; vert++) {
          for (var c = 0; c < 2; c++) {
            var xx = right - c;
            var upward = ((right + 1) & 2) === 0;
            var yy = upward ? size - 1 - vert : vert;
            if (!isFunction[yy][xx] && idx < allCodewords.length * 8) {
              modules[yy][xx] = ((allCodewords[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0;
              idx++;
            }
          }
        }
      }

      // Masking — choose the mask with the lowest penalty.
      function applyMask(mask) {
        for (var y2 = 0; y2 < size; y2++) for (var x2 = 0; x2 < size; x2++) {
          if (isFunction[y2][x2]) continue;
          var invert;
          switch (mask) {
            case 0: invert = (x2 + y2) % 2 === 0; break;
            case 1: invert = y2 % 2 === 0; break;
            case 2: invert = x2 % 3 === 0; break;
            case 3: invert = (x2 + y2) % 3 === 0; break;
            case 4: invert = (Math.floor(x2 / 3) + Math.floor(y2 / 2)) % 2 === 0; break;
            case 5: invert = (x2 * y2) % 2 + (x2 * y2) % 3 === 0; break;
            case 6: invert = ((x2 * y2) % 2 + (x2 * y2) % 3) % 2 === 0; break;
            default: invert = ((x2 + y2) % 2 + (x2 * y2) % 3) % 2 === 0; break;
          }
          if (invert) modules[y2][x2] = !modules[y2][x2];
        }
      }
      function drawFormat(mask) {
        // Map internal ecl (0=L,1=M,2=Q,3=H) to QR format ecl bits (L=01,M=00,Q=11,H=10)
        var fmtEcl = [1, 0, 3, 2][ecl];
        var data = (fmtEcl << 3) | mask;
        var rem = data;
        for (var fi = 0; fi < 10; fi++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        var bits = ((data << 10) | rem) ^ 0x5412;
        for (var k = 0; k <= 5; k++) setFunc(8, k, ((bits >>> k) & 1) !== 0);
        setFunc(8, 7, ((bits >>> 6) & 1) !== 0);
        setFunc(8, 8, ((bits >>> 7) & 1) !== 0);
        setFunc(7, 8, ((bits >>> 8) & 1) !== 0);
        for (var k2 = 9; k2 < 15; k2++) setFunc(14 - k2, 8, ((bits >>> k2) & 1) !== 0);
        for (var k3 = 0; k3 < 8; k3++) setFunc(size - 1 - k3, 8, ((bits >>> k3) & 1) !== 0);
        for (var k4 = 8; k4 < 15; k4++) setFunc(8, size - 15 + k4, ((bits >>> k4) & 1) !== 0);
        setFunc(8, size - 8, true);
      }
      function penalty() {
        var p = 0, i, j;
        // Rule 1: runs of 5+ in rows and columns
        for (i = 0; i < size; i++) {
          var runColor, runLen;
          runColor = false; runLen = 0;
          for (j = 0; j < size; j++) {
            if (modules[i][j] === runColor) { runLen++; if (runLen === 5) p += 3; else if (runLen > 5) p++; }
            else { runColor = modules[i][j]; runLen = 1; }
          }
          runColor = false; runLen = 0;
          for (j = 0; j < size; j++) {
            if (modules[j][i] === runColor) { runLen++; if (runLen === 5) p += 3; else if (runLen > 5) p++; }
            else { runColor = modules[j][i]; runLen = 1; }
          }
        }
        // Rule 2: 2x2 blocks of same color
        for (i = 0; i < size - 1; i++) for (j = 0; j < size - 1; j++) {
          var col = modules[i][j];
          if (col === modules[i][j + 1] && col === modules[i + 1][j] && col === modules[i + 1][j + 1]) p += 3;
        }
        // Rule 4: proportion of dark modules
        var dark = 0;
        for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (modules[i][j]) dark++;
        var total = size * size;
        var k = 0;
        while (true) { var lo = 50 - 5 * (k + 1), hi = 50 + 5 * (k + 1), pct = dark * 100 / total; if (pct < lo || pct > hi) k++; else break; if (k > 20) break; }
        p += k * 10;
        return p;
      }

      var bestMask = 0, bestPenalty = Infinity;
      for (var m = 0; m < 8; m++) {
        applyMask(m); drawFormat(m);
        var pen = penalty();
        if (pen < bestPenalty) { bestPenalty = pen; bestMask = m; }
        applyMask(m); // undo (XOR again)
      }
      applyMask(bestMask); drawFormat(bestMask);

      return { size: size, version: ver, ecl: ecl, modules: modules };
    }

    return { encode: encode, numDataCodewords: numDataCodewords };
  })();

  /* ---------------------------------------------------------------------------
   * 4. Wire protocol — a tiny versioned envelope + fixed type set + validity
   *    guard. Inbound messages come from untrusted peers, so isValid() gates
   *    every one before it reaches game logic.
   * ------------------------------------------------------------------------ */
  var PROTO = 1;
  var MSG = {
    JOIN_REQUEST: 'JOIN_REQUEST', JOIN_ACCEPTED: 'JOIN_ACCEPTED', JOIN_REJECTED: 'JOIN_REJECTED',
    LOBBY_UPDATE: 'LOBBY_UPDATE', START_GAME: 'START_GAME', STATE_UPDATE: 'STATE_UPDATE',
    ACTION_INTENT: 'ACTION_INTENT', ACTION_REJECTED: 'ACTION_REJECTED',
    DECIDE: 'DECIDE', DECIDE_ANSWER: 'DECIDE_ANSWER',
    YOUR_TURN: 'YOUR_TURN', AP_UPDATE: 'AP_UPDATE', TURN_ENDED: 'TURN_ENDED',
    EVENT: 'EVENT', EVENT_DONE: 'EVENT_DONE',
    REVIEW: 'REVIEW', REVIEW_DONE: 'REVIEW_DONE', GAME_OVER: 'GAME_OVER',
    LOG: 'LOG', KICK: 'KICK', PLAYER_CONNECTED: 'PLAYER_CONNECTED', PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
    PING: 'PING', PONG: 'PONG', ERROR: 'ERROR'
  };
  var MSG_SET = {};
  Object.keys(MSG).forEach(function (k) { MSG_SET[MSG[k]] = true; });
  function msg(type, payload) { return { v: PROTO, type: type, t: Date.now(), payload: (payload === undefined ? null : payload) }; }
  function isValid(m) {
    return !!m && typeof m === 'object' && m.v === PROTO && typeof m.type === 'string' && MSG_SET[m.type] === true && ('payload' in m);
  }

  /* ---------------------------------------------------------------------------
   * 5. Identity — dependency-free room codes + client ids. PeerJS ids are
   *    [a-z0-9-] with single separators, no leading/trailing/consecutive '-'.
   * ------------------------------------------------------------------------ */
  var NS = 'srk';
  function sanitizeId(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0);
  }
  // Fresh 6-char room code folded from the host name + a time seed, so a new
  // session doesn't collide with a prior room still tearing down on the broker.
  function deriveRoomCode(hostName, seed) {
    var s = (seed == null ? Date.now() : seed);
    return fnv1a(sanitizeId(hostName) + ':' + s).toString(36).slice(0, 6);
  }
  function roomPeerId(code) { return NS + '-' + (sanitizeId(code) || 'room'); }
  // Deterministic client id from (roomCode, name) so a refresh re-derives the
  // same id and reclaims the same seat; suffix bumps on duplicate names.
  function deriveClientId(roomCode, name, suffix) {
    var base = roomPeerId(roomCode) + '-' + (sanitizeId(name) || 'player');
    return suffix ? (base + '-' + suffix) : base;
  }

  /* ---------------------------------------------------------------------------
   * 6. ICE / TURN. STUN always; TURN only when TURN_CONFIG is filled in.
   *    NOTE: this is a static site — any credential set here is PUBLIC.
   * ------------------------------------------------------------------------ */
  // To enable TURN (needed for symmetric-NAT / two-phones-on-cellular), set ONE:
  //   TURN_CONFIG = { iceServers: [{ urls:'turn:host:3478', username:'u', credential:'p' }] };  // static creds
  //   TURN_CONFIG = { meteredSubdomain:'yoursub', meteredApiKey:'KEY' };  // fetch ephemeral (KEY is PUBLIC here)
  var TURN_CONFIG = null;
  var STUN_SERVERS = [{ urls: STUN }];
  function iceServers() {
    if (!TURN_CONFIG) return Promise.resolve(STUN_SERVERS.slice());
    if (TURN_CONFIG.iceServers) return Promise.resolve(STUN_SERVERS.concat(TURN_CONFIG.iceServers));
    if (TURN_CONFIG.meteredApiKey && typeof fetch !== 'undefined') {
      var url = 'https://' + TURN_CONFIG.meteredSubdomain + '.metered.live/api/v1/turn/credentials?apiKey=' + encodeURIComponent(TURN_CONFIG.meteredApiKey);
      return fetch(url).then(function (r) { return r.json(); })
        .then(function (list) { return STUN_SERVERS.concat(list); })
        .catch(function () { return STUN_SERVERS.slice(); });
    }
    return Promise.resolve(STUN_SERVERS.slice());
  }
  function hasTurn() { return !!TURN_CONFIG; }
  function isMobile() { return typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); }

  // Signalling broker. Default = PeerJS's free public cloud (0.peerjs.com). It
  // is best-effort and sometimes fails to relay the peer handshake; if online
  // play won't connect, point this at a dedicated PeerServer, e.g.:
  //   PEERJS_CONFIG = { host:'your.peerserver.com', port:443, path:'/', secure:true, key:'peerjs' };
  // (You can run one anywhere: `npx peerjs --port 9000`, or PeerServer Cloud.)
  var PEERJS_CONFIG = null;
  function peerOptions(ice) {
    var o = { config: { iceServers: ice || STUN_SERVERS } };
    if (PEERJS_CONFIG) { for (var k in PEERJS_CONFIG) { if (Object.prototype.hasOwnProperty.call(PEERJS_CONFIG, k)) o[k] = PEERJS_CONFIG[k]; } }
    return o;
  }

  /* ---------------------------------------------------------------------------
   * 8. PeerJS transport (host + client). window.Peer is a CDN global; the
   *    public broker is used for signalling only — data flows peer-to-peer.
   * ------------------------------------------------------------------------ */
  function getPeerCtor() { return (typeof Peer !== 'undefined' && Peer) || (typeof window !== 'undefined' && window.Peer) || null; }
  var TRANSIENT_ERR = { network: 1, 'server-error': 1, 'socket-error': 1, 'socket-closed': 1, disconnected: 1 };

  function hostRoom(opts) {
    var P = getPeerCtor();
    if (!P) return Promise.reject(new Error('PeerJS (window.Peer) not loaded'));
    var h = opts.handlers || {};
    return new Promise(function (resolve, reject) {
      var peer = new P(roomPeerId(opts.roomCode), peerOptions(opts.iceServers));
      var clients = {};   // clientId -> { conn, caps, lastFp, alive, lastSeen }
      var settled = false;
      var openTimer = setTimeout(function () { if (settled) return; settled = true; try { peer.destroy(); } catch (e) {} reject({ type: 'timeout', message: 'Timed out reaching the matchmaking server.' }); }, opts.timeout || 15000);
      // PeerJS default serialization (BinaryPack) — we send plain envelope
      // objects. (serialization:'none' does NOT complete the handshake in
      // PeerJS 1.5.x, so we don't use it.)
      function rawSend(conn, env) { if (!conn || !conn.open) return; try { conn.send(env); } catch (e) {} }
      var api = {
        peer: peer, roomCode: opts.roomCode, clients: clients,
        setCaps: function (clientId, caps) { if (clients[clientId]) clients[clientId].caps = caps; },
        send: function (clientId, env) { var c = clients[clientId]; if (c) rawSend(c.conn, env); },
        broadcast: function (env) { Object.keys(clients).forEach(function (id) { rawSend(clients[id].conn, env); }); },
        // dedup: skip a re-send when the redacted content is byte-identical
        // (`force` bypasses it for reconnect/resync).
        sendState: function (clientId, content, force) {
          var c = clients[clientId]; if (!c || !c.conn || !c.conn.open) return;
          if (!force && c.lastFp === content) return;
          c.lastFp = content;
          rawSend(c.conn, msg(MSG.STATE_UPDATE, content));
        },
        broadcastState: function (content) { Object.keys(clients).forEach(function (id) { api.sendState(id, content); }); },
        clientIds: function () { return Object.keys(clients); },
        isAlive: function (clientId) { var c = clients[clientId]; return !!(c && c.conn && c.conn.open && c.alive); },
        lastSeen: function (clientId) { var c = clients[clientId]; return c ? c.lastSeen : 0; },
        touch: function (clientId) { var c = clients[clientId]; if (c) { c.alive = true; c.lastSeen = Date.now(); } },
        kick: function (clientId, reason) {
          var c = clients[clientId];
          if (c && c.conn) { rawSend(c.conn, msg(MSG.KICK, { reason: reason || null })); setTimeout(function () { try { c.conn.close(); } catch (e) {} }, 150); }
          delete clients[clientId];
        },
        destroy: function () {
          Object.keys(clients).forEach(function (id) { try { clients[id].conn && clients[id].conn.close(); } catch (e) {} });
          try { peer.destroy(); } catch (e) {}
        }
      };
      peer.on('open', function () { if (settled) return; settled = true; clearTimeout(openTimer); resolve(api); if (h.onOpen) h.onOpen(opts.roomCode); });
      peer.on('connection', function (conn) {
        conn.on('open', function () {
          var rec = clients[conn.peer] || {};
          rec.conn = conn; rec.alive = true; rec.lastSeen = Date.now();
          clients[conn.peer] = rec;
          if (h.onConnect) h.onConnect(conn.peer, conn.metadata || {});
        });
        conn.on('data', function (env) {
          var rec = clients[conn.peer]; if (rec) { rec.alive = true; rec.lastSeen = Date.now(); }
          if (env && isValid(env) && h.onMessage) h.onMessage(conn.peer, env);
        });
        conn.on('close', function () { var rec = clients[conn.peer]; if (rec) rec.alive = false; if (h.onDisconnect) h.onDisconnect(conn.peer); });
        conn.on('error', function () {});
      });
      peer.on('disconnected', function () { if (h.onStatus) h.onStatus('reconnecting'); try { peer.reconnect(); } catch (e) {} });
      peer.on('error', function (e) {
        var t = e && e.type;
        if (!settled && (t === 'unavailable-id' || t === 'invalid-id')) { settled = true; clearTimeout(openTimer); reject(e); return; }
        if (TRANSIENT_ERR[t]) { if (h.onStatus) h.onStatus('reconnecting'); return; }
        if (h.onError) h.onError(e);
      });
    });
  }

  function joinRoom(opts) {
    var P = getPeerCtor();
    if (!P) return Promise.reject(new Error('PeerJS (window.Peer) not loaded'));
    var h = opts.handlers || {};
    return new Promise(function (resolve, reject) {
      var peer = new P(opts.clientId, peerOptions(opts.iceServers));
      var conn = null, settled = false, tries = 0;
      var api = {
        peer: peer,
        send: function (env) { if (conn && conn.open) { try { conn.send(env); } catch (e) {} } },
        destroy: function () { try { conn && conn.close(); } catch (e) {} try { peer.destroy(); } catch (e) {} }
      };
      // Overall guard: reject if we never open a DataConnection (broker down /
      // won't relay, or ICE can't traverse the NAT). Lets the UI show an error
      // instead of hanging forever.
      var overall = setTimeout(function () { if (settled) return; settled = true; try { peer.destroy(); } catch (e) {} reject({ type: 'timeout', message: 'Could not reach the host.' }); }, opts.timeout || 22000);
      function attemptConnect() {
        tries++;
        try { conn = peer.connect(roomPeerId(opts.roomCode), { reliable: true, metadata: opts.metadata || {} }); }
        catch (e) { return; }
        var opened = false;
        conn.on('open', function () { opened = true; if (settled) return; settled = true; clearTimeout(overall); resolve(api); if (h.onOpen) h.onOpen(); });
        conn.on('data', function (env) { if (env && isValid(env) && h.onMessage) h.onMessage(env); });
        conn.on('close', function () { if (h.onClose) h.onClose(); });
        conn.on('error', function () {});
        // The public broker sometimes drops the first connect offer; re-issue it.
        setTimeout(function () { if (!opened && !settled && tries < 3) { try { conn.close(); } catch (e) {} attemptConnect(); } }, 7000);
      }
      peer.on('open', function () { attemptConnect(); });
      peer.on('disconnected', function () { if (h.onStatus) h.onStatus('reconnecting'); try { peer.reconnect(); } catch (e) {} });
      peer.on('error', function (e) {
        var t = e && e.type;
        if (!settled && (t === 'unavailable-id' || t === 'peer-unavailable' || t === 'invalid-id')) { settled = true; clearTimeout(overall); reject(e); return; }
        if (TRANSIENT_ERR[t]) { if (h.onStatus) h.onStatus('reconnecting'); return; }
        if (h.onError) h.onError(e);
      });
    });
  }

  /* ---------------------------------------------------------------------------
   * 6. Export
   * ------------------------------------------------------------------------ */
  var SRNet = {
    STUN: STUN,
    NS: NS,
    PROTO: PROTO,
    MSG: MSG,
    msg: msg,
    isValid: isValid,
    serializeState: serializeState,
    reviveState: reviveState,
    // Perfect-information game: redaction is payload-trimming only (drops
    // _hooks/log, folds card refs). viewerId is kept as a seam for future use.
    redactFor: function (state, viewerId) { return serializeState(state); },
    packPayload: packPayload,
    unpackPayload: unpackPayload,
    qr: QR,
    sanitizeId: sanitizeId,
    fnv1a: fnv1a,
    deriveRoomCode: deriveRoomCode,
    deriveClientId: deriveClientId,
    roomPeerId: roomPeerId,
    iceServers: iceServers,
    hasTurn: hasTurn,
    isMobile: isMobile,
    hostRoom: hostRoom,
    joinRoom: joinRoom,
    hasPeerJS: function () { return !!getPeerCtor(); },
    hasBarcodeDetector: (typeof BarcodeDetector !== 'undefined')
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SRNet;
  if (typeof window !== 'undefined') window.SRNet = SRNet;
  if (typeof globalThis !== 'undefined') globalThis.SRNet = SRNet;
})();
