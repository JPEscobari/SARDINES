const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('server loads repository .env independently of launch directory and mounts ingest once', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  let envPath;
  const mounts = [];
  const app = { use: (...args) => mounts.push(args), get() {}, listen() {} };
  const express = () => app;
  express.json = () => 'parser';
  vm.runInNewContext(source, {
    __dirname: path.resolve(__dirname, '..'), process: { env: {} }, console: { warn() {} },
    require(name) {
      if (name === 'dotenv') return { config: options => { envPath = options.path; } };
      if (name === 'path') return path;
      if (name === 'express') return express;
      if (name === 'cors') return () => 'cors';
      if (name === 'mongoose') return {};
      return name;
    },
  });
  assert.equal(envPath, path.resolve(__dirname, '../../.env'));
  assert.equal(mounts.filter(args => args[0] === '/api/ingest').length, 1);
  assert.ok(mounts.findIndex(args => args[0] === '/api/ingest') < mounts.findIndex(args => args[0] === 'parser'));
});
