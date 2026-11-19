// Isolated browser harness: no .env, no live IBM/Cloudant/Slack calls.
const express = require('express');
const path = require('node:path');
const { LocalRepository } = require('../operational/localRepository');
const { createSpeechService } = require('../services/speechToText');
const repo = new LocalRepository(path.resolve(__dirname, '../data/phase5a-browser.sqlite'));
const quote = 'Synthetic Cedar will send the proposal tomorrow.';
require('../services/watsonx.service').sendMessage = async () => JSON.stringify({ summary: 'MOCK browser analysis', promises: [{ title: 'Send proposal', customerName: 'Synthetic Cedar', ownerName: null, dueAt: null, dueText: 'tomorrow', sourceQuote: quote }], actions: [], blockers: [] });
const env = { STT_URL: 'https://api.us-south.speech-to-text.watson.cloud.ibm.com/instances/mock', STT_API_KEY: 'test-only' };
const service = createSpeechService({ env, http: { post: async url => ({ data: url.includes('iam.cloud') ? { access_token: 'mock', expires_in: 3600 } : { results: [{ final: true, alternatives: [{ transcript: quote, timestamps: [['Synthetic', 0, 0.5]] }] }] } }) } });
const app = express();
app.use('/api/transcribe', require('../routes/transcribe').createTranscribeRouter({ service, env }));
app.use('/api/ingest', require('../routes/ingest'));
app.use('/api/review', require('../routes/review').createReviewRouter(() => repo));
app.use((req, res) => res.status(503).json({ error: 'Mock browser harness only' }));
app.listen(5093, '127.0.0.1', () => console.log('Synthetic browser harness on 5093: STT/IBM mocked, isolated SQLite.'));
