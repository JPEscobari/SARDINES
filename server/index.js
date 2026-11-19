require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({ origin: 'http://localhost:5173' }));
app.use('/api/transcribe', require('./routes/transcribe'));
app.use('/api/ingest', require('./routes/ingest'));
app.use('/api/ready', require('./routes/readiness'));
app.use('/api/review', require('./routes/review'));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// MongoDB connection
if (process.env.MONGO_URI) mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(() => console.error('MongoDB connection failed'));
else console.warn('MONGO_URI is not configured; Chat, Tasks and Decisions require MongoDB.');

// Existing Mongo features fail promptly without blocking the operational queue.
app.use(['/api/chat', '/api/tasks', '/api/decisions'], (req, res, next) => {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'MongoDB features unavailable; ingestion and Promise Queue remain available' });
  next();
});

// Routes
app.use('/api/chat', require('./routes/chat'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/decisions', require('./routes/decisions'));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
