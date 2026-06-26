import type { VercelRequest, VercelResponse } from '@vercel/node';
import { testEmailConnection } from '../lib/notify';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await testEmailConnection();
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
