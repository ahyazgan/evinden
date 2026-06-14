import { findCouponByCode, fetchActiveCoupons, type CouponRow } from './db';

export type CouponType = 'percentage' | 'fixed' | 'free_delivery';

export type Coupon = {
  code: string;
  type: CouponType;
  value: number; // percentage (0-100) or fixed amount in cents
  minOrderCents: number;
  maxDiscountCents: number; // cap for percentage coupons
  title: string;
  description: string;
  expiresAt: string; // ISO date
  usageLimit: number; // 0 = unlimited
  icon: string;
  color: string;
};

export const COUPONS: Coupon[] = [
  {
    code: 'EVINDEN20',
    type: 'percentage',
    value: 20,
    minOrderCents: 5000,
    maxDiscountCents: 5000,
    title: 'Hoş Geldin İndirimi',
    description: 'İlk siparişinize %20 indirim! Minimum ₺50 sipariş tutarı.',
    expiresAt: '2026-06-30T23:59:59Z',
    usageLimit: 1,
    icon: '🎉',
    color: '#E8593E',
  },
  {
    code: 'LEZZET10',
    type: 'percentage',
    value: 10,
    minOrderCents: 10000,
    maxDiscountCents: 3000,
    title: '%10 Lezzet İndirimi',
    description: 'Tüm ev yemeklerinde %10 indirim. Min. ₺100 sipariş.',
    expiresAt: '2026-05-31T23:59:59Z',
    usageLimit: 3,
    icon: '🍽️',
    color: '#F57F17',
  },
  {
    code: 'UCRETSIZ',
    type: 'free_delivery',
    value: 0,
    minOrderCents: 7500,
    maxDiscountCents: 1500,
    title: 'Ücretsiz Teslimat',
    description: '₺75 üzeri siparişlerde teslimat ücretsiz!',
    expiresAt: '2026-04-30T23:59:59Z',
    usageLimit: 0,
    icon: '🚚',
    color: '#2E7D32',
  },
  {
    code: 'TATLI15',
    type: 'fixed',
    value: 1500,
    minOrderCents: 8000,
    maxDiscountCents: 1500,
    title: '₺15 Tatlı İndirimi',
    description: 'Tatlı kategorisinde ₺15 anında indirim. Min. ₺80.',
    expiresAt: '2026-05-15T23:59:59Z',
    usageLimit: 2,
    icon: '🍰',
    color: '#AD1457',
  },
  {
    code: 'KAHVALTI25',
    type: 'percentage',
    value: 25,
    minOrderCents: 12000,
    maxDiscountCents: 6000,
    title: '%25 Kahvaltı Şöleni',
    description: 'Kahvaltı siparişlerinde %25 indirim. Min. ₺120.',
    expiresAt: '2026-04-15T23:59:59Z',
    usageLimit: 1,
    icon: '🍳',
    color: '#E65100',
  },
];

export type CouponResult =
  | { valid: true; coupon: Coupon; discountCents: number; freeDelivery: boolean }
  | { valid: false; error: string };

function rowToCoupon(row: CouponRow): Coupon {
  const typeMap: Record<string, CouponType> = {
    percent: 'percentage',
    fixed: 'fixed',
    free_delivery: 'free_delivery',
  };
  return {
    code: row.code,
    type: typeMap[row.discount_type] ?? 'percentage',
    value: row.discount_value,
    minOrderCents: row.min_order_cents,
    maxDiscountCents: row.max_discount_cents ?? row.discount_value,
    title: row.title ?? row.code,
    description: row.description ?? '',
    expiresAt: row.expires_at ?? '2099-12-31T23:59:59Z',
    usageLimit: row.max_uses ?? 0,
    icon: row.icon ?? '🏷️',
    color: row.color ?? '#666',
  };
}

function applyCoupon(coupon: Coupon, orderTotalCents: number): CouponResult {
  if (new Date(coupon.expiresAt) < new Date()) {
    return { valid: false, error: 'Bu promosyon kodunun süresi dolmuş.' };
  }

  if (orderTotalCents < coupon.minOrderCents) {
    const minTL = (coupon.minOrderCents / 100).toFixed(0);
    return { valid: false, error: `Minimum sipariş tutarı ₺${minTL} olmalıdır.` };
  }

  let discountCents = 0;
  let freeDelivery = false;

  switch (coupon.type) {
    case 'percentage':
      discountCents = Math.round(orderTotalCents * (coupon.value / 100));
      if (discountCents > coupon.maxDiscountCents) {
        discountCents = coupon.maxDiscountCents;
      }
      break;
    case 'fixed':
      discountCents = coupon.value;
      break;
    case 'free_delivery':
      freeDelivery = true;
      break;
  }

  return { valid: true, coupon, discountCents, freeDelivery };
}

export async function validateCoupon(code: string, orderTotalCents: number): Promise<CouponResult> {
  // Try Supabase first
  try {
    const row = await findCouponByCode(code);
    if (row) {
      if (row.max_uses && row.used_count >= row.max_uses) {
        return { valid: false, error: 'Bu promosyon kodunun kullanım limiti dolmuş.' };
      }
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return { valid: false, error: 'Bu promosyon kodunun süresi dolmuş.' };
      }
      return applyCoupon(rowToCoupon(row), orderTotalCents);
    }
  } catch {
    // Supabase unavailable, fall through to local
  }

  // Fallback to hardcoded coupons
  const coupon = COUPONS.find(c => c.code === code.trim().toUpperCase());
  if (!coupon) {
    return { valid: false, error: 'Bu promosyon kodu geçerli değil.' };
  }
  return applyCoupon(coupon, orderTotalCents);
}

/** Fetch all available coupons (Supabase + local fallback) */
export async function getAvailableCoupons(): Promise<Coupon[]> {
  try {
    const rows = await fetchActiveCoupons();
    if (rows.length > 0) {
      return rows.map(rowToCoupon);
    }
  } catch {
    // Supabase unavailable
  }
  return COUPONS.filter(c => new Date(c.expiresAt) > new Date());
}

export function formatDiscount(coupon: Coupon): string {
  switch (coupon.type) {
    case 'percentage':
      return `%${coupon.value} indirim`;
    case 'fixed':
      return `₺${(coupon.value / 100).toFixed(0)} indirim`;
    case 'free_delivery':
      return 'Ücretsiz teslimat';
  }
}

export function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}
