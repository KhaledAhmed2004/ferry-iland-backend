'use strict';
// Drop-in replacement for buffer-equal-constant-time@1.0.1.
// The original reads require('buffer').SlowBuffer.prototype at load time,
// which crashes on Node >= 26 where SlowBuffer was removed.
var Buffer = require('buffer').Buffer;
var SlowBuffer = require('buffer').SlowBuffer; // undefined on Node >= 26

module.exports = bufferEq;

function bufferEq(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false;
  if (a.length !== b.length) return false;
  var c = 0;
  for (var i = 0; i < a.length; i++) c |= a[i] ^ b[i];
  return c === 0;
}

var origBufEqual = Buffer.prototype.equal;
var origSlowBufEqual = SlowBuffer ? SlowBuffer.prototype.equal : undefined;

bufferEq.install = function () {
  var fn = function equal(that) { return bufferEq(this, that); };
  Buffer.prototype.equal = fn;
  if (SlowBuffer) SlowBuffer.prototype.equal = fn;
};

bufferEq.restore = function () {
  Buffer.prototype.equal = origBufEqual;
  if (SlowBuffer) SlowBuffer.prototype.equal = origSlowBufEqual;
};
