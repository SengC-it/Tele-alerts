import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WatchItem, SignalRule, Signal } from './types';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

let client: SupabaseClient | null = null;

// 表名常量，统一管理
const TABLE = {
  watchlist: 'tele_watchlist',
  signalRules: 'tele_signal_rules',
  signals: 'tele_signals',
  signalCooldown: 'tele_signal_cooldown',
} as const;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey);
  }
  return client;
}

// ========== Watchlist ==========

export async function getWatchlist(): Promise<WatchItem[]> {
  const { data, error } = await getSupabase()
    .from(TABLE.watchlist)
    .select('*')
    .order('id');
  if (error) throw error;
  return data || [];
}

export async function getEnabledWatchlist(): Promise<WatchItem[]> {
  const { data, error } = await getSupabase()
    .from(TABLE.watchlist)
    .select('*')
    .eq('enabled', true)
    .order('id');
  if (error) throw error;
  return data || [];
}

export async function upsertWatchlist(items: WatchItem[]): Promise<void> {
  const sb = getSupabase();
  await sb.from(TABLE.watchlist).delete().neq('id', 0);
  if (items.length > 0) {
    const { error } = await sb.from(TABLE.watchlist).insert(
      items.map(({ symbol, timeframe, layer, enabled }) => ({ symbol, timeframe, layer: layer || 1, enabled }))
    );
    if (error) throw error;
  }
}

// ========== Signal Rules ==========

export async function getSignalRules(): Promise<SignalRule[]> {
  const { data, error } = await getSupabase()
    .from(TABLE.signalRules)
    .select('*')
    .order('id');
  if (error) throw error;
  return data || [];
}

export async function getEnabledRules(): Promise<SignalRule[]> {
  const { data, error } = await getSupabase()
    .from(TABLE.signalRules)
    .select('*')
    .eq('enabled', true)
    .order('id');
  if (error) throw error;
  return data || [];
}

export async function updateSignalRules(rules: SignalRule[]): Promise<void> {
  const sb = getSupabase();
  await sb.from(TABLE.signalRules).delete().neq('id', '');
  if (rules.length > 0) {
    const { error } = await sb.from(TABLE.signalRules).insert(rules);
    if (error) throw error;
  }
}

// ========== Signals ==========

export async function addSignal(signal: Signal): Promise<boolean> {
  const sb = getSupabase();
  const cooldownKey = `${signal.symbol}_${signal.type}_${signal.name}`;
  // Cooldown based on timeframe: 4h signals = 4h cooldown, 1h = 2h, others = 15min
  const tf = signal.timeframe || '-';
  let cooldownMs: number;
  if (tf === '4h') cooldownMs = 4 * 60 * 60 * 1000;
  else if (tf === '1h') cooldownMs = 2 * 60 * 60 * 1000;
  else cooldownMs = 15 * 60 * 1000;

  // 检查冷却
  const { data: cooldown } = await sb
    .from(TABLE.signalCooldown)
    .select('last_triggered')
    .eq('key', cooldownKey)
    .single();

  if (cooldown) {
    const elapsed = Date.now() - new Date(cooldown.last_triggered).getTime();
    if (elapsed < cooldownMs) return false; // 冷却中
  }

  // Write signal with layer
  const { error: insertErr } = await sb.from(TABLE.signals).insert({
    ...signal,
    layer: signal.layer || null,
    created_at: new Date().toISOString(),
  });
  if (insertErr) throw insertErr;

  // 更新冷却
  await sb
    .from(TABLE.signalCooldown)
    .upsert({ key: cooldownKey, last_triggered: new Date().toISOString() }, { onConflict: 'key' });

  return true;
}

export async function getSignals(opts?: {
  type?: string;
  symbol?: string;
  layer?: number;
  since?: number;
  limit?: number;
}): Promise<Signal[]> {
  let query = getSupabase()
    .from(TABLE.signals)
    .select('*')
    .order('created_at', { ascending: false });

  if (opts?.type) query = query.eq('type', opts.type);
  if (opts?.symbol) query = query.eq('symbol', opts.symbol);
  if (opts?.layer) query = query.eq('layer', opts.layer);
  if (opts?.since) query = query.gte('created_at', new Date(opts.since).toISOString());
  if (opts?.limit) query = query.limit(opts.limit);
  else query = query.limit(100);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getSignalStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  byDirection: Record<string, number>;
  last24h: number;
}> {
  const sb = getSupabase();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [allRes, dayRes] = await Promise.all([
    sb.from(TABLE.signals).select('type, direction'),
    sb.from(TABLE.signals).select('id', { count: 'exact', head: true }).gte('created_at', dayAgo),
  ]);

  const rows = allRes.data || [];
  const byType: Record<string, number> = {};
  const byDirection: Record<string, number> = {};

  for (const r of rows) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    byDirection[r.direction] = (byDirection[r.direction] || 0) + 1;
  }

  return {
    total: rows.length,
    byType,
    byDirection,
    last24h: dayRes.count || 0,
  };
}

// ========== 清理旧数据 ==========

export async function cleanupOldSignals(daysToKeep: number = 30): Promise<void> {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  const sb = getSupabase();

  await sb.from(TABLE.signals).delete().lt('created_at', cutoff);
  await sb.from(TABLE.signalCooldown).delete().lt('last_triggered', cutoff);
}
