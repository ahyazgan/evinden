/** Kurumsal hesabın saf yardımcıları (060); supabase'e bağlı değildir, birim testinde kullanılır. */

export type CorporateStatus = 'pending' | 'active' | 'suspended';

export type MyCorporateWorkspace = {
  id: string;
  name: string;
  status: CorporateStatus;
  monthly_budget_cents: number | null;
  role: 'owner' | 'member' | null;
  member_status: 'active' | 'removed' | null;
  join_code: string | null;
  month_spent_cents: number;
  my_month_spent_cents: number;
  created_at: string;
};

export const CORPORATE_STATUS_TEXT: Record<CorporateStatus, string> = {
  pending: 'Onay bekliyor',
  active: 'Etkin',
  suspended: 'Askıda',
};

/** Bu ay kalan bütçe; bütçe yoksa sınırsız (null). */
export function corporateBudgetLeft(ws: Pick<MyCorporateWorkspace, 'monthly_budget_cents' | 'month_spent_cents'>): number | null {
  if (ws.monthly_budget_cents == null) return null;
  return Math.max(0, ws.monthly_budget_cents - ws.month_spent_cents);
}

/** Bütçenin kullanılan payı, 0–1 (bütçe yoksa ya da sıfırsa null). */
export function corporateBudgetRatio(ws: Pick<MyCorporateWorkspace, 'monthly_budget_cents' | 'month_spent_cents'>): number | null {
  if (!ws.monthly_budget_cents) return null;
  return Math.min(1, Math.max(0, ws.month_spent_cents / ws.monthly_budget_cents));
}

/** Kod 4+4 gruplanır: "ABCD-EFGH". Yazılan kod boşluk ve tireden arındırılır. */
export function formatJoinCode(code: string | null | undefined): string {
  const c = normalizeJoinCode(code ?? '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
