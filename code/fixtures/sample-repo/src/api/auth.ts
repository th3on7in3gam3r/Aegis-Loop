import express from 'express';

const app = express();

// Intentionally vulnerable — demo fixture for Aegis Loop / code
// Values are fake placeholders (not real secrets); safe for public repos.
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? '' /* moved to env */;
const api_key = 'aegis_loop_demo_not_a_real_stripe_key';

const password = 'SuperSecret123!';

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(3000);
