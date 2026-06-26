import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getWatchlist, upsertWatchlist } from '../lib/supabase';
import type { WatchItem } from '../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const list = await getWatchlist();
      return res.status(200).json(list);
    }

    if (req.method === 'PUT') {
      const list = req.body as WatchItem[];
      await upsertWatchlist(list);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
