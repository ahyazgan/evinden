import { supabase } from './supabase';
import type { CorporateStatus, MyCorporateWorkspace } from './corporate-format';
export * from './corporate-format';

/**
 * Kurumsal hesap (060): şirket talebi yönetici onayıyla açılır, çalışanlar katılım koduyla katılır.
 * Şirket siparişi aylık bütçeden düşer; ödemeyi çalışan yapar, şirket harcamayı buradan izler.
 */
export async function fetchMyCorporateWorkspace(): Promise<MyCorporateWorkspace | null> {
  const { data, error } = await supabase.rpc('my_corporate_workspace');
  if (error) throw error;
  return (data ?? null) as MyCorporateWorkspace | null;
}

export async function requestCorporateWorkspace(name: string, budgetCents: number | null): Promise<void> {
  const { error } = await supabase.rpc('request_corporate_workspace', { p_name: name.trim(), p_budget_cents: budgetCents });
  if (error) throw error;
}

/** Kod yanlışsa false döner (deneme sayılır). */
export async function joinCorporateWorkspace(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('join_corporate_workspace', { p_code: code });
  if (error) throw error;
  return !!(data as { ok?: boolean } | null)?.ok;
}

export async function leaveCorporateWorkspace(): Promise<void> {
  const { error } = await supabase.rpc('leave_corporate_workspace');
  if (error) throw error;
}

export async function removeCorporateMember(userId: string): Promise<void> {
  const { error } = await supabase.rpc('corporate_remove_member', { p_user: userId });
  if (error) throw error;
}

export async function regenerateCorporateCode(): Promise<string> {
  const { data, error } = await supabase.rpc('corporate_regenerate_code');
  if (error) throw error;
  return data as string;
}

export async function updateCorporateBudget(budgetCents: number | null): Promise<void> {
  const { error } = await supabase.rpc('corporate_update_budget', { p_budget_cents: budgetCents });
  if (error) throw error;
}

export type CorporateReport = {
  month: string;
  spent_cents: number;
  monthly_budget_cents: number | null;
  members: { user_id: string; name: string; role: 'owner' | 'member'; joined_at: string; spent_cents: number; order_count: number }[];
  orders: { id: string; created_at: string; status: string; total_cents: number; member_name: string; restaurant_name: string }[];
};

/** month: "2026-11-01" biçiminde; boşsa bu ay. */
export async function fetchCorporateReport(month?: string): Promise<CorporateReport> {
  const { data, error } = await supabase.rpc('corporate_workspace_report', { p_month: month ?? null });
  if (error) throw error;
  return data as CorporateReport;
}

export type AdminCorporateRow = {
  id: string;
  name: string;
  status: CorporateStatus;
  owner_name: string;
  monthly_budget_cents: number | null;
  member_count: number;
  month_spent_cents: number;
  created_at: string;
};

export async function fetchAdminCorporateWorkspaces(): Promise<AdminCorporateRow[]> {
  const { data, error } = await supabase.rpc('admin_corporate_workspaces');
  if (error) throw error;
  return (data ?? []) as AdminCorporateRow[];
}

export async function adminSetCorporateStatus(id: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_approve_corporate_workspace', { p_workspace: id, p_approve: approve });
  if (error) throw error;
}

/** Sunucu "bütçe yetmiyor" hatası (EVN06); details kalan tutarı (kuruş) taşır. */
export const CORPORATE_BUDGET_EXCEEDED = 'EVN06';
