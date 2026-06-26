import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 返回脱敏配置信息
  res.status(200).json({
    exchange: {
      id: 'binance',
      apiKeyConfigured: !!(process.env.BINANCE_API_KEY),
    },
    gmail: {
      user: process.env.GMAIL_USER || '',
      configured: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    },
    alertEmailTo: process.env.ALERT_EMAIL_TO || '',
    supabase: {
      url: process.env.SUPABASE_URL || '',
      configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
  });
}
