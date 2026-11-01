'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BaseAdapter = require('../src/adapters/base');

it('keeps owned credentials out of logs, tool status and thinking messages', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-redaction-'));
  const token = 'workspace-credential-without-a-provider-prefix';
  const key = 'short-private-provider-key';
  const logged = [];
  const sent = [];
  try {
    const adapter = new BaseAdapter({ workspaceId: 'test', channelName: 'general', agentName: 'trial', token,
      configDir: directory, agentEnv: { OPENAI_API_KEY: key }, logSink: (_level, message) => logged.push(message) });
    adapter.client.sendMessage = async (...args) => sent.push(args[3]);
    adapter._log(`Tool invoked with ${token} and ${key}`);
    await adapter.sendStatus('general', `curl -H 'X-Workspace-Token: ${token}'`);
    await adapter.sendThinking('general', `Provider returned credential ${key}`);
    assert.equal(logged.length, 1);
    assert.equal(sent.length, 2);
    for (const message of [...logged, ...sent]) {
      assert.ok(!message.includes(token));
      assert.ok(!message.includes(key));
      assert.ok(message.includes('[REDACTED]'));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
