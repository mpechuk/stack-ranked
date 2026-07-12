/* =============================================================================
 * STACK RANKED — networked play (serverless WebRTC)
 * -----------------------------------------------------------------------------
 * Transport + protocol helpers for online play, kept OUT of the rules engine.
 * The game stays host-authoritative: one peer (the host) runs SR.play() and
 * every remote human answers its turn/decision hooks over a WebRTC data channel.
 * This module never touches the DOM; the browser-only bits (RTCPeerConnection,
 * CompressionStream, BarcodeDetector) are feature-guarded so the pure pieces
 * (state codec, code codec, QR matrix) can be exercised headlessly in Node.
 *
 * Public surface (window.SRNet / module.exports):
 *   serializeState(state) -> string      snapshot for the wire (card refs folded
 *   reviveState(json)     -> state          to {__ref:id}; log/_hooks dropped)
 *   encodeCode(str)  -> Promise<string>  gzip+base64url signaling code ('g'|'r')
 *   decodeCode(code) -> Promise<string>
 *   qr.encode(text)  -> {size, modules}  dependency-free QR matrix (byte mode)
 *   hostCreateOffer(handlers)  -> Promise<{pc, channel, offerCode, accept}>
 *   guestAnswerOffer(code, h)  -> Promise<{pc, answerCode, channel()}>
 *   wrapChannel(ch, handlers)            JSON message framing over a data channel
 *   STUN                                  the public STUN server URL
 *
 * The QR encoder is adapted from Project Nayuki's "QR Code generator library"
 * (MIT License) — the algorithm/tables are canonical; folded inline to honor the
 * repo's dependency-free rule.
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
   * 2. Signaling code codec — gzip (when available) + base64url, tagged
   * ------------------------------------------------------------------------ */
  function bytesToB64url(bytes) {
    var b64;
    if (typeof btoa !== 'undefined') {
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      b64 = btoa(bin);
    } else {
      b64 = Buffer.from(bytes).toString('base64');
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof atob !== 'undefined') {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  function streamThrough(bytes, Ctor, fmt) {
    var s = new Ctor(fmt);
    var writer = s.writable.getWriter();
    writer.write(bytes); writer.close();
    var reader = s.readable.getReader();
    var chunks = [];
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var len = chunks.reduce(function (a, c) { return a + c.length; }, 0);
          var out = new Uint8Array(len), off = 0;
          chunks.forEach(function (c) { out.set(c, off); off += c.length; });
          return out;
        }
        chunks.push(r.value);
        return pump();
      });
    }
    return pump();
  }

  function encodeCode(str) {
    var bytes = new TextEncoder().encode(str);
    if (typeof CompressionStream !== 'undefined') {
      return streamThrough(bytes, CompressionStream, 'gzip').then(function (z) { return 'g' + bytesToB64url(z); });
    }
    return Promise.resolve('r' + bytesToB64url(bytes));
  }
  function decodeCode(code) {
    var tag = code.charAt(0), body = code.slice(1);
    var bytes = b64urlToBytes(body);
    var out;
    if (tag === 'g' && typeof DecompressionStream !== 'undefined') {
      out = streamThrough(bytes, DecompressionStream, 'gzip');
    } else {
      out = Promise.resolve(bytes);
    }
    return out.then(function (b) { return new TextDecoder().decode(b); });
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
   * 4. Message framing over an RTCDataChannel (JSON lines)
   * ------------------------------------------------------------------------ */
  function wrapChannel(ch, handlers) {
    handlers = handlers || {};
    var api = {
      channel: ch,
      send: function (obj) {
        if (ch.readyState !== 'open') return false;
        try { ch.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
      },
      isOpen: function () { return ch.readyState === 'open'; },
      close: function () { try { ch.close(); } catch (e) { /* ignore */ } }
    };
    ch.onopen = function () { if (handlers.onOpen) handlers.onOpen(api); };
    ch.onclose = function () { if (handlers.onClose) handlers.onClose(api); };
    ch.onerror = function (e) { if (handlers.onError) handlers.onError(e, api); };
    ch.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (handlers.onMessage) handlers.onMessage(msg, api);
    };
    return api;
  }

  /* ---------------------------------------------------------------------------
   * 5. WebRTC signaling (non-trickle: one code carries all ICE candidates)
   * ------------------------------------------------------------------------ */
  function newPeer() {
    return new RTCPeerConnection({ iceServers: [{ urls: STUN }] });
  }
  function waitIceComplete(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; pc.removeEventListener('icegatheringstatechange', check); resolve(); }
      function check() { if (pc.iceGatheringState === 'complete') finish(); }
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(finish, 4000); // fall back to whatever candidates we have
    });
  }

  // HOST side: create an offer + data channel, produce the join code, and return
  // an `accept(answerCode)` to finish the handshake once the guest replies.
  function hostCreateOffer(handlers) {
    var pc = newPeer();
    var ch = pc.createDataChannel('sr', { ordered: true });
    var wrapped = wrapChannel(ch, handlers);
    return pc.createOffer()
      .then(function (offer) { return pc.setLocalDescription(offer); })
      .then(function () { return waitIceComplete(pc); })
      .then(function () { return encodeCode(JSON.stringify(pc.localDescription)); })
      .then(function (offerCode) {
        return {
          pc: pc, channel: wrapped, offerCode: offerCode,
          accept: function (answerCode) {
            return decodeCode(answerCode).then(function (json) {
              return pc.setRemoteDescription(JSON.parse(json));
            });
          }
        };
      });
  }

  // GUEST side: consume the host's offer code, produce an answer code to send back.
  function guestAnswerOffer(offerCode, handlers) {
    var pc = newPeer();
    var chRef = { ch: null, wrapped: null };
    pc.ondatachannel = function (ev) { chRef.ch = ev.channel; chRef.wrapped = wrapChannel(ev.channel, handlers); };
    return decodeCode(offerCode)
      .then(function (json) { return pc.setRemoteDescription(JSON.parse(json)); })
      .then(function () { return pc.createAnswer(); })
      .then(function (answer) { return pc.setLocalDescription(answer); })
      .then(function () { return waitIceComplete(pc); })
      .then(function () { return encodeCode(JSON.stringify(pc.localDescription)); })
      .then(function (answerCode) {
        return { pc: pc, answerCode: answerCode, channel: function () { return chRef.wrapped; } };
      });
  }

  /* ---------------------------------------------------------------------------
   * 6. Export
   * ------------------------------------------------------------------------ */
  var SRNet = {
    STUN: STUN,
    serializeState: serializeState,
    reviveState: reviveState,
    packPayload: packPayload,
    unpackPayload: unpackPayload,
    encodeCode: encodeCode,
    decodeCode: decodeCode,
    qr: QR,
    wrapChannel: wrapChannel,
    hostCreateOffer: hostCreateOffer,
    guestAnswerOffer: guestAnswerOffer,
    hasWebRTC: (typeof RTCPeerConnection !== 'undefined'),
    hasBarcodeDetector: (typeof BarcodeDetector !== 'undefined')
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SRNet;
  if (typeof window !== 'undefined') window.SRNet = SRNet;
  if (typeof globalThis !== 'undefined') globalThis.SRNet = SRNet;
})();
