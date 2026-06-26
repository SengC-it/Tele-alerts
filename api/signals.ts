import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSignals, getSignalStats } from '../lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // /api/signals → 列表, /api/signals?stats=true → 统计
    if (req.query.stats === 'true') {
      const stats = await getSignalStats();
      return res.status(200).json(stats);
    }

    const type = req.query.type as string | undefined;
    const symbol = req.query.symbol as string | undefined;
    const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const signals = await getSignals({ type, symbol, since, limit });
    return res.status(200).json(signals);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
