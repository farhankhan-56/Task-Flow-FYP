const test = require('node:test');
const assert = require('node:assert/strict');
const { isUuid } = require('../utils/validators');
const { escapeHtml } = require('../utils/email');

test('isUuid accepts a valid UUID', () => {
  assert.equal(isUuid('3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60'), true);
});

test('isUuid rejects malformed values', () => {
  const badValues = ['abc', '', null, undefined, 123, {}, '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f6'];
  for (const value of badValues) {
    assert.equal(isUuid(value), false);
  }
});

test('escapeHtml escapes HTML special characters', () => {
  assert.equal(escapeHtml('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
  assert.equal(escapeHtml("Tom & 'Jerry'"), 'Tom &amp; &#39;Jerry&#39;');
});

test('escapeHtml returns an empty string for null and undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});