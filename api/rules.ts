import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSignalRules, updateSignalRules } from '../lib/supabase';
import type { SignalRule } from '../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const rules = await getSignalRules();
      return res.status(200).json(rules);
    }

    if (req.method === 'PUT') {
      const rules = req.body as SignalRule[];
      await updateSignalRules(rules);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
