import { supabase } from './supabase';

/** Büyüme raporları (050, 051, 059): restoran kalitesi, birim ekonomi, kampanya ve geri kazanım. */

export type SellerQualityRow = {
  seller_id: string;
  display_name: string;
  is_active: boolean;
  score: number;
  rating: number;
  orders: number;
  cancelled: number;
  refunds: number;
  sla_violations: number;
};

export type UnitEconomics = {
  days: number;
  orders: number;
  gross_cents: number;
  commission_cents: number;
  discount_cents: number;
  refunds: number;
  delivery_cost_cents: number;
  support_cost_cents: number;
  acquisition_cost_cents: number;
  payment_fee_cents: number;
  contribution_cents: number;
  contribution_per_order_cents: number;
  margin_bps: number;
};

export type UnitEconomicsSettings = {
  delivery_cost_cents: number;
  support_cost_cents: number;
  payment_fee_bps: number;
  acquisition_cost_cents: number;
};

export type CampaignPerformanceRow = {
  coupon_id: string;
  code: string;
  title: string;
  seller_id: string | null;
  seller_name: string | null;
  redemptions: number;
  gross_cents: number;
  discount_cents: number;
  refunds: number;
  commission_cents: number;
  delivery_cost_cents: number;
  support_cost_cents: number;
  contribution_cents: number;
  margin_bps: number;
};

export type WinbackRow = {
  customer_id: string;
  customer_name: string | null;
  last_order_at: string;
  orders: number;
  spend_cents: number;
  days_since: number;
};

const num = (v: unknown) => Number(v ?? 0);

export async function fetchSellerQuality(days: number): Promise<SellerQualityRow[]> {
  const { data, error } = await supabase.rpc('admin_seller_quality', { p_days: days });
  if (error) throw error;
  return ((data ?? []) as SellerQualityRow[]).map(r => ({
    ...r, score: num(r.score), rating: num(r.rating), orders: num(r.orders), cancelled: num(r.cancelled),
    refunds: num(r.refunds), sla_violations: num(r.sla_violations),
  }));
}

export async function fetchUnitEconomics(days: number): Promise<UnitEconomics> {
  const { data, error } = await supabase.rpc('admin_unit_economics', { p_days: days });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)])) as unknown as UnitEconomics;
}

export const UNIT_ECONOMICS_DEFAULTS: UnitEconomicsSettings = {
  delivery_cost_cents: 2500, support_cost_cents: 500, payment_fee_bps: 290, acquisition_cost_cents: 0,
};

export async function fetchUnitEconomicsSettings(): Promise<UnitEconomicsSettings> {
  const { data, error } = await supabase.from('app_config').select('value').eq('key', 'unit_economics').maybeSingle();
  if (error) throw error;
  const v = (data?.value ?? {}) as Partial<Record<keyof UnitEconomicsSettings, unknown>>;
  return {
    delivery_cost_cents: num(v.delivery_cost_cents ?? UNIT_ECONOMICS_DEFAULTS.delivery_cost_cents),
    support_cost_cents: num(v.support_cost_cents ?? UNIT_ECONOMICS_DEFAULTS.support_cost_cents),
    payment_fee_bps: num(v.payment_fee_bps ?? UNIT_ECONOMICS_DEFAULTS.payment_fee_bps),
    acquisition_cost_cents: num(v.acquisition_cost_cents ?? UNIT_ECONOMICS_DEFAULTS.acquisition_cost_cents),
  };
}

export async function updateUnitEconomicsSettings(value: UnitEconomicsSettings): Promise<void> {
  const { error } = await supabase.rpc('admin_update_unit_economics', { p_value: value });
  if (error) throw error;
}

export async function fetchCampaignPerformance(days: number): Promise<CampaignPerformanceRow[]> {
  const { data, error } = await supabase.rpc('admin_campaign_performance', { p_days: days });
  if (error) throw error;
  return ((data ?? []) as CampaignPerformanceRow[]).map(r => ({
    ...r, redemptions: num(r.redemptions), gross_cents: num(r.gross_cents), discount_cents: num(r.discount_cents),
    refunds: num(r.refunds), commission_cents: num(r.commission_cents), delivery_cost_cents: num(r.delivery_cost_cents),
    support_cost_cents: num(r.support_cost_cents), contribution_cents: num(r.contribution_cents), margin_bps: num(r.margin_bps),
  }));
}

export async function fetchWinbackCustomers(days: number): Promise<WinbackRow[]> {
  const { data, error } = await supabase.rpc('admin_winback_customers', { p_days: days });
  if (error) throw error;
  return ((data ?? []) as WinbackRow[]).map(r => ({ ...r, orders: num(r.orders), spend_cents: num(r.spend_cents), days_since: num(r.days_since) }));
}

export { bpsLabel, qualityLevel } from './growth-format';
