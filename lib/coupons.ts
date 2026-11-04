import { countMyCouponRedemptions, findCouponByCode, fetchActiveCoupons, type CouponRow } from './db';

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
  sellerId?: string | null;
};

/** Kuponlar sunucudadır; sipariş sırasında place_order yeniden doğrular. */

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
    // Tavan yoksa sınırsız: eskiden indirim yüzdesine (örn. 20 kuruş) düşüyordu.
    maxDiscountCents: row.max_discount_cents ?? Number.MAX_SAFE_INTEGER,
    title: row.title ?? row.code,
    description: row.description ?? '',
    expiresAt: row.expires_at ?? '2099-12-31T23:59:59Z',
    usageLimit: row.max_uses ?? 0,
    icon: row.icon ?? '🏷️',
    color: row.color ?? '#666',
    sellerId: row.seller_id,
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
      // Sunucudaki place_order ile aynı yuvarlama (aşağı) — önizleme ile gerçek tutar tutsun.
      discountCents = Math.floor((orderTotalCents * coupon.value) / 100);
      if (discountCents > coupon.maxDiscountCents) {
        discountCents = coupon.maxDiscountCents;
      }
      break;
    case 'fixed':
      // Sunucudaki place_order gibi: indirim sepet tutarını aşamaz.
      discountCents = Math.min(coupon.value, orderTotalCents);
      break;
    case 'free_delivery':
      freeDelivery = true;
      break;
  }

  return { valid: true, coupon, discountCents, freeDelivery };
}

export async function validateCoupon(code: string, orderTotalCents: number, sellerId?: string | null): Promise<CouponResult> {
  // Try Supabase first
  try {
    const row = await findCouponByCode(code);
    if (row) {
      if (row.seller_id && row.seller_id !== sellerId) {
        return { valid: false, error: 'Bu kupon yalnızca kuponu veren satıcıda geçerli.' };
      }
      if (row.max_uses && row.used_count >= row.max_uses) {
        return { valid: false, error: 'Bu promosyon kodunun kullanım limiti dolmuş.' };
      }
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return { valid: false, error: 'Bu promosyon kodunun süresi dolmuş.' };
      }
      if (row.max_uses_per_user != null && (await countMyCouponRedemptions(row.id)) >= row.max_uses_per_user) {
        return { valid: false, error: 'Bu promosyon kodunu kullanım hakkınız doldu.' };
      }
      return applyCoupon(rowToCoupon(row), orderTotalCents);
    }
  } catch {
    // Supabase unavailable, fall through to local
  }

  // Fallback to hardcoded coupons
  return { valid: false, error: 'Bu promosyon kodu geçersiz.' };
}

/** Aktif platform kuponları */
export async function getAvailableCoupons(): Promise<Coupon[]> {
  const rows = await fetchActiveCoupons();
  return rows.map(rowToCoupon).filter(c => new Date(c.expiresAt) > new Date());
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
