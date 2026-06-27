import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scanAll } from '../lib/scanner';
import { sendSignalSummaryEmail } from '../lib/notify';
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

    const sigCount = results.reduce((s, r) => s + r.signals.length, 0);
    const errCount = results.filter((r) => r.error).length;

    // Send HTTP response FIRST (so Vercel doesn't timeout the client)
    res.status(200).json({
      ok: true,
      scanned: results.length,
      signals: sigCount,
      errors: errCount,
      results,
    });

    // Now send email and cleanup in the background (Vercel grace period ~5s)
    const allSignals = results.flatMap(r => r.signals);
    if (allSignals.length > 0) {
      sendSignalSummaryEmail(allSignals).then(() => {
        console.log('[Scan] 汇总邮件已发送');
      }).catch((err: any) => {
        console.error('[Scan] 汇总邮件发送失败:', err.message);
      });
    }

    // 清理 30 天前的旧数据
    cleanupOldSignals(30).catch(() => {});
  } catch (err: any) {
    console.error('[API /scan] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
  }
}
