import express from 'express';

const app = express();

// Intentionally vulnerable — demo fixture for Aegis Loop / code
// AWS key + password use env (safe for public repos). Other demo vulns: SQL.
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? '' /* moved to env */;
const api_key = process.env.API_KEY ?? '' /* moved to env */;

const password = process.env.PASSWORD ?? '' /* moved to env */;

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(3000);
