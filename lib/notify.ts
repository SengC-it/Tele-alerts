import nodemailer from 'nodemailer';
import type { Signal, SignalDirection } from './types';
import { LAYER_CONFIGS } from './types';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return transporter;
}

/** Format price to appropriate precision */
function fmt(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(6);
}

/** Calculate composite score for sorting: strategy > info, higher strength first */
function signalScore(s: Signal): number {
  const base = s.reliability === 'strategy' ? 100 : 0;
  const strength = s.strength * 10;
  const layerBonus = (5 - (s.layer || 3)) * 5; // L1 > L2 > L3 > L4
  return base + strength + layerBonus;
}

/** Build a single signal row HTML for the summary table */
function signalRowHTML(s: Signal, rank: number): string {
  const isStrategy = s.reliability === 'strategy';
  const di = s.direction === 'long' ? '🟢' : s.direction === 'short' ? '🔴' : '⚪';
  const dl = s.direction === 'long' ? '做多' : s.direction === 'short' ? '做空' : '中性';
  const dirColor = s.direction === 'long' ? '#00c853' : '#ff1744';
  const layerLabel = LAYER_CONFIGS[s.layer || 1]?.label || `L${s.layer}`;
  const st = '★'.repeat(s.strength) + '☆'.repeat(5 - s.strength);
  const typeLabel = s.type === 'technical' ? '技术面' : s.type === 'funding' ? '资金面' : '价格面';
  const score = signalScore(s);

  // Levels section
  let levelsHTML = '';
  if (isStrategy && s.levels) {
    const lv = s.levels;
    const pctSL = Math.abs((lv.stopLoss - lv.entry) / lv.entry * 100);
    const pctTP = Math.abs((lv.takeProfit - lv.entry) / lv.entry * 100);
    levelsHTML = `
      <div style="display:flex;gap:16px;margin-top:8px">
        <div style="flex:1;background:rgba(255,255,255,0.04);border-radius:6px;padding:8px 12px">
          <div style="color:#78909c;font-size:11px;margin-bottom:2px">入场</div>
          <div style="color:#fff;font-size:15px;font-weight:600">${fmt(lv.entry)}</div>
        </div>
        <div style="flex:1;background:rgba(255,23,68,0.06);border-radius:6px;padding:8px 12px">
          <div style="color:#ef5350;font-size:11px;margin-bottom:2px">止损 (${pctSL.toFixed(1)}%)</div>
          <div style="color:#ff5252;font-size:15px;font-weight:600">${fmt(lv.stopLoss)}</div>
        </div>
        <div style="flex:1;background:rgba(0,200,83,0.06);border-radius:6px;padding:8px 12px">
          <div style="color:#66bb6a;font-size:11px;margin-bottom:2px">止盈 (${pctTP.toFixed(1)}%)</div>
          <div style="color:#69f0ae;font-size:15px;font-weight:600">${fmt(lv.takeProfit)}</div>
        </div>
        <div style="flex:0.6;background:rgba(255,255,255,0.04);border-radius:6px;padding:8px 12px">
          <div style="color:#78909c;font-size:11px;margin-bottom:2px">盈亏比</div>
          <div style="color:#ffd740;font-size:15px;font-weight:600">${lv.riskReward.toFixed(1)}:1</div>
        </div>
      </div>`;
  } else if (!isStrategy) {
    levelsHTML = `
      <div style="margin-top:6px;background:rgba(255,193,7,0.08);border-radius:4px;padding:4px 10px;font-size:12px;color:#ffc107">
        ⚠ 仅供参考，无交易点位
      </div>`;
  }

  // Supporting signals context
  let supportHTML = '';
  if (s.supportingSignals && s.supportingSignals.length > 0) {
    supportHTML = `
      <div style="margin-top:6px;background:rgba(33,150,243,0.08);border-radius:4px;padding:6px 10px">
        <span style="font-size:11px;color:#64b5f6">背景: </span>
        ${s.supportingSignals.map(x => `<span style="font-size:12px;color:#90caf9">${x.direction === 'long' ? '🟢' : '🔴'}${x.name}(${x.direction === 'long' ? '偏多' : '偏空'})</span>`).join(' ')}
      </div>`;
  }

  const relBadge = isStrategy
    ? '<span style="background:rgba(0,200,83,0.15);color:#69f0ae;font-size:11px;padding:2px 6px;border-radius:3px">策略信号</span>'
    : '<span style="background:rgba(255,193,7,0.15);color:#ffc107;font-size:11px;padding:2px 6px;border-radius:3px">仅供参考</span>';

  return `
    <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:16px;margin-bottom:12px;border-left:3px solid ${dirColor}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:22px">${di}</span>
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="color:#fff;font-size:16px;font-weight:600">${s.name}</span>
              ${relBadge}
              <span style="background:rgba(255,255,255,0.06);color:#aaa;font-size:11px;padding:2px 6px;border-radius:3px">L${s.layer} ${layerLabel}</span>
            </div>
            <div style="color:#78909c;font-size:13px;margin-top:2px">${s.symbol} · ${s.timeframe} · ${typeLabel}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="color:${dirColor};font-size:18px;font-weight:700">${dl}</div>
          <div style="color:#ffd740;font-size:14px">${st}</div>
        </div>
      </div>
      <div style="color:#b0bec5;font-size:14px;line-height:1.5">${s.message}</div>
      ${levelsHTML}
      ${supportHTML}
    </div>`;
}

/** Send ONE aggregated email with all signals, sorted by score */
export async function sendSignalSummaryEmail(signals: Signal[]): Promise<boolean> {
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.GMAIL_USER;
  if (!to || !from || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('[Notify] Gmail 配置不完整，跳过发送');
    return false;
  }

  // Sort by composite score (highest first)
  const sorted = [...signals].sort((a, b) => signalScore(b) - signalScore(a));

  const strategyCount = sorted.filter(s => s.reliability === 'strategy').length;
  const infoCount = sorted.filter(s => s.reliability === 'info').length;
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:20px">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:12px;padding:20px;color:#fff;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <h1 style="margin:0;font-size:20px;color:#e94560">Tele-Alerts 信号汇总</h1>
          <div style="color:#78909c;font-size:13px;margin-top:4px">${ts} (UTC+8)</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:28px;font-weight:700;color:#fff">${sorted.length}</div>
          <div style="color:#78909c;font-size:12px">信号总数</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-top:12px">
        <div style="background:rgba(0,200,83,0.12);border-radius:6px;padding:6px 12px;flex:1;text-align:center">
          <div style="color:#69f0ae;font-size:18px;font-weight:700">${strategyCount}</div>
          <div style="color:#69f0ae;font-size:11px">策略信号</div>
        </div>
        <div style="background:rgba(255,193,7,0.12);border-radius:6px;padding:6px 12px;flex:1;text-align:center">
          <div style="color:#ffc107;font-size:18px;font-weight:700">${infoCount}</div>
          <div style="color:#ffc107;font-size:11px">仅供参考</div>
        </div>
        <div style="background:rgba(0,200,83,0.12);border-radius:6px;padding:6px 12px;flex:1;text-align:center">
          <div style="color:#69f0ae;font-size:18px;font-weight:700">${sorted.filter(s => s.direction === 'long').length}</div>
          <div style="color:#69f0ae;font-size:11px">做多</div>
        </div>
        <div style="background:rgba(255,23,68,0.12);border-radius:6px;padding:6px 12px;flex:1;text-align:center">
          <div style="color:#ff5252;font-size:18px;font-weight:700">${sorted.filter(s => s.direction === 'short').length}</div>
          <div style="color:#ff5252;font-size:11px">做空</div>
        </div>
      </div>
    </div>

    <!-- Signal list sorted by score -->
    ${sorted.map((s, i) => signalRowHTML(s, i + 1)).join('')}

    <!-- Footer -->
    <div style="text-align:center;color:#546e7a;font-size:11px;padding:12px">
      止损 = 入场 ± 1.5×ATR | 止盈 = 入场 ± 3.0×ATR | 盈亏比 = 2:1<br>
      排序规则: 策略信号 &gt; 信息信号 &gt; 强度 &gt; 层级
    </div>
  </div>
</body></html>`;

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: `"TeleAlerts" <${from}>`,
      to,
      subject: `Tele-Alerts | ${sorted.length}信号 (${strategyCount}策略) | ${ts}`,
      html,
    });
    console.log(`[Notify] 汇总邮件已发送: ${sorted.length}信号 (${strategyCount}策略 ${infoCount}信息)`);
    return true;
  } catch (err: any) {
    console.error('[Notify] 汇总邮件发送失败:', err);
    return false;
  }
}

/** Test Gmail SMTP connection */
export async function testEmailConnection(): Promise<{ success: boolean; message: string }> {
  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      return { success: false, message: 'GMAIL_USER 或 GMAIL_APP_PASSWORD 未配置' };
    }
    const transport = getTransporter();
    await transport.verify();
    return { success: true, message: 'Gmail SMTP 连接正常' };
  } catch (err: any) {
    return { success: false, message: `Gmail SMTP 连接失败: ${err.message}` };
  }
}
