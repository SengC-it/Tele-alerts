import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scanAll } from '../lib/scanner';
import { cleanupOldSignals } from '../lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 安全验证：只允许 GET（Vercel Cron / GitHub Actions）和 POST（手动触发）
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 验证 Cron Secret（防滥用）
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
    if (provided !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const results = await scanAll();

    // 清理 30 天前的旧数据（顺带执行，不阻塞响应）
    cleanupOldSignals(30).catch(() => {});

    const sigCount = results.reduce((s, r) => s + r.signals.length, 0);
    const errCount = results.filter((r) => r.error).length;

    return res.status(200).json({
      ok: true,
      scanned: results.length,
      signals: sigCount,
      errors: errCount,
      results,
    });
  } catch (err: any) {
    console.error('[API /scan] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
