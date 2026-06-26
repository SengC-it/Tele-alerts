import nodemailer from 'nodemailer';
import type { Signal } from './types';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  // Gmail SMTP 配置
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD, // Gmail 应用专用密码
    },
  });

  return transporter;
}

/** 发送信号邮件 */
export async function sendSignalEmail(signal: Signal): Promise<boolean> {
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.GMAIL_USER;

  if (!to || !from || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('[Notify] Gmail 配置不完整，跳过发送');
    return false;
  }

  const dirEmoji = signal.direction === 'long' ? '🟢' : signal.direction === 'short' ? '🔴' : '⚪';
  const dirText = signal.direction === 'long' ? '做多' : signal.direction === 'short' ? '做空' : '中性';
  const starBar = '★'.repeat(signal.strength) + '☆'.repeat(5 - signal.strength);

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:12px;padding:24px;color:#fff">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span style="font-size:32px">${dirEmoji}</span>
      <div>
        <h2 style="margin:0;color:#e94560">${signal.name}</h2>
        <span style="color:#a8a8b3;font-size:14px">${signal.symbol} · ${signal.timeframe}</span>
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:16px">
      <p style="margin:0;font-size:16px;line-height:1.6">${signal.message}</p>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <div><div style="color:#a8a8b3;font-size:12px">方向</div>
        <div style="font-size:18px;font-weight:600;color:${signal.direction === 'long' ? '#00c853' : '#ff1744'}">${dirText}</div></div>
      <div><div style="color:#a8a8b3;font-size:12px">强度</div>
        <div style="font-size:18px">${starBar}</div></div>
      <div><div style="color:#a8a8b3;font-size:12px">类型</div>
        <div style="font-size:18px">${signal.type === 'technical' ? '技术面' : signal.type === 'funding' ? '资金面' : '价格面'}</div></div>
    </div>
    <div style="color:#666;font-size:12px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px">
      ${new Date(signal.created_at || Date.now()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
    </div>
  </div>
</div>`;

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: `"TeleAlerts" <${from}>`,
      to,
      subject: `${dirEmoji} [${signal.symbol}] ${signal.name} - ${dirText}`,
      html,
    });
    console.log(`[Notify] 邮件已发送: ${signal.name} ${signal.symbol}`);
    return true;
  } catch (err) {
    console.error('[Notify] 邮件发送失败:', err);
    return false;
  }
}

/** 测试 Gmail SMTP 连接 */
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
