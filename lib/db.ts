/**
 * Supabase veritabanı CRUD katmanı
 * sellers, menu_items tabloları için
 */
import { supabase } from './supabase';
import { istanbulToday } from './date';
import { DEFAULT_COMMISSION_RATES } from '@/constants/business';
import { DEFAULT_ORDER_PRICING, type OrderPricing } from './pricing';

// ─── Seller ──────────────────────────────────────────────────────────────────

export type SellerType = 'home' | 'restaurant';

export type SellerRow = {
  id: string;
  /** Hesabı silinmiş satıcıda boştur (014); mağaza kaydı yalnızca sipariş geçmişi için kalır. */
  user_id: string | null;
  display_name: string;
  bio: string | null;
  city: string | null;
  district: string | null;
  address_line: string | null;
  latitude: number | null;
  longitude: number | null;
  rating_avg: number;
  rating_count: number;
  is_active: boolean;
  seller_type: SellerType;
  /** Satıcının kendi açıp kapattığı mağaza durumu; is_active ise yönetici onayıdır. */
  is_paused: boolean;
  /** Boşsa platform varsayılanı geçerlidir (020). */
  delivery_fee_cents: number | null;
  free_delivery_threshold_cents: number | null;
  min_order_cents: number;
  delivery_time_min: number;
  delivery_time_max: number;
  delivery_radius_km: number;
  logo_url: string | null;
  cover_url: string | null;
  uses_weekly_menu: boolean;
  created_at: string;
  updated_at: string;
};

type SellerDeliveryFields = 'delivery_fee_cents' | 'free_delivery_threshold_cents' | 'min_order_cents' | 'delivery_time_min' | 'delivery_time_max' | 'delivery_radius_km';
export type SellerInsert = Omit<SellerRow, 'id' | 'user_id' | 'seller_type' | 'is_paused' | SellerDeliveryFields | 'rating_avg' | 'rating_count' | 'is_active' | 'uses_weekly_menu' | 'created_at' | 'updated_at'> & { user_id: string; seller_type?: SellerType } & Partial<Pick<SellerRow, SellerDeliveryFields>>;
export type SellerUpdate = Partial<Omit<SellerRow, 'id' | 'user_id' | 'seller_type' | 'created_at'>>;

/** Tüm aktif satıcıları çek */
export async function fetchSellers(): Promise<SellerRow[]> {
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('is_active', true)
    .order('rating_avg', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Tek satıcı çek (id ile) */
export async function fetchSellerById(id: string): Promise<SellerRow | null> {
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/** user_id ile satıcı profili çek */
export async function fetchSellerByUserId(userId: string): Promise<SellerRow | null> {
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/** Satıcı profili oluştur */
export async function createSeller(seller: SellerInsert): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .insert(seller)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Satıcı profili güncelle */
export async function updateSeller(id: string, updates: SellerUpdate): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Commission ──────────────────────────────────────────────────────────────

export type CommissionRates = Record<SellerType, number>;

/** Satıcı türüne göre güncel komisyon oranları (app_config.order_pricing). */
export async function fetchCommissionRates(): Promise<CommissionRates> {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'order_pricing')
    .maybeSingle();
  const value = data?.value as { commission_rate_percent?: number; restaurant_commission_rate_percent?: number } | undefined;
  return {
    home: Number(value?.commission_rate_percent ?? DEFAULT_COMMISSION_RATES.home),
    restaurant: Number(value?.restaurant_commission_rate_percent ?? DEFAULT_COMMISSION_RATES.restaurant),
  };
}

/** Yalnızca yönetici yazabilir; diğer fiyat ayarlarına dokunmaz. Eski siparişlerin oranı değişmez. */
export async function updateCommissionRates(rates: CommissionRates): Promise<void> {
  const { data, error: readError } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'order_pricing')
    .single();
  if (readError) throw readError;
  const { error } = await supabase
    .from('app_config')
    .update({
      value: {
        ...(data.value as object),
        commission_rate_percent: rates.home,
        restaurant_commission_rate_percent: rates.restaurant,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('key', 'order_pricing')
    .select()
    .single();
  if (error) throw error;
}

// ─── Order Pricing & Online Payment Settings ─────────────────────────────────

/** Platform varsayılan teslimat ayarları (app_config.order_pricing). */
export async function fetchOrderPricing(): Promise<OrderPricing> {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'order_pricing')
    .maybeSingle();
  const value = data?.value as { delivery_fee_cents?: number; free_delivery_threshold_cents?: number; min_order_cents?: number } | undefined;
  return {
    deliveryFeeCents: value?.delivery_fee_cents ?? DEFAULT_ORDER_PRICING.deliveryFeeCents,
    freeDeliveryThresholdCents: value?.free_delivery_threshold_cents ?? DEFAULT_ORDER_PRICING.freeDeliveryThresholdCents,
    minOrderCents: value?.min_order_cents ?? DEFAULT_ORDER_PRICING.minOrderCents,
  };
}

export async function fetchOnlinePaymentEnabled(): Promise<boolean> {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'online_payment')
    .maybeSingle();
  return (data?.value as { enabled?: boolean } | undefined)?.enabled === true;
}

/** Yalnızca yönetici yazabilir. */
export async function setOnlinePaymentEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .update({ value: { enabled }, updated_at: new Date().toISOString() })
    .eq('key', 'online_payment')
    .select()
    .single();
  if (error) throw error;
}

export async function fetchPhoneVerificationRequired(): Promise<boolean> {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'phone_verification')
    .maybeSingle();
  return (data?.value as { required?: boolean } | undefined)?.required === true;
}

/** Yalnızca yönetici yazabilir. Supabase'de SMS sağlayıcısı kurulmadan açılmamalı. */
export async function setPhoneVerificationRequired(required: boolean): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .update({ value: { required }, updated_at: new Date().toISOString() })
    .eq('key', 'phone_verification')
    .select()
    .single();
  if (error) throw error;
}

// ─── Destek talepleri ──────────────────────────────────────────

export type SupportCategory = 'order' | 'payment' | 'account' | 'seller' | 'other';
export type SupportStatus = 'open' | 'answered' | 'closed';

export type SupportTicket = {
  id: string;
  user_id: string;
  order_id: string | null;
  category: SupportCategory;
  message: string;
  status: SupportStatus;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
};

export type AdminSupportTicket = SupportTicket & { user_name: string | null };

export async function createSupportTicket(params: { category: SupportCategory; message: string; orderId?: string | null }): Promise<SupportTicket> {
  const { data, error } = await supabase.rpc('create_support_ticket', {
    p_category: params.category,
    p_message: params.message,
    p_order: params.orderId ?? null,
  });
  if (error) throw error;
  return data as SupportTicket;
}

export async function fetchMySupportTickets(userId: string): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SupportTicket[];
}

export async function adminFetchSupportTickets(status: SupportStatus | null): Promise<AdminSupportTicket[]> {
  const { data, error } = await supabase.rpc('admin_list_support_tickets', { p_status: status });
  if (error) throw error;
  return (data ?? []) as AdminSupportTicket[];
}

export async function adminAnswerSupportTicket(ticketId: string, reply: string): Promise<void> {
  const { error } = await supabase.rpc('admin_answer_support_ticket', { p_ticket: ticketId, p_reply: reply });
  if (error) throw error;
}

export async function adminCloseSupportTicket(ticketId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_close_support_ticket', { p_ticket: ticketId });
  if (error) throw error;
}

/** iyzico ödeme sayfasının adresini döndürür; tutarı sunucu belirler. */
export async function startOnlinePayment(orderId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('payment-init', { body: { orderId } });
  if (error) throw error;
  return data.paymentPageUrl as string;
}

export async function fetchOrderPaymentStatus(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.from('orders').select('payment_status').eq('id', orderId).single();
  if (error) throw error;
  return data?.payment_status ?? null;
}

/**
 * Yalnızca hâlâ ödeme bekleyen siparişi iptal eder; ödenmiş sipariş bu sorguyla iptal edilemez.
 * Sipariş o arada ödendiyse hiçbir satır değişmez.
 */
export async function cancelUnpaidOrder(orderId: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', cancel_reason: 'Ödeme tamamlanmadı', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('status', 'awaiting_payment')
    .eq('payment_status', 'pending');
  if (error) throw error;
}

/** Yönetici: iyzico panelinde iade edildiği görülen ödemeyi işaretler. */
export async function adminMarkRefunded(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_refunded', { p_order: orderId });
  if (error) throw error;
}

/** Yönetici: iade bekleyen online ödemeyi iyzico üzerinden geri öder. */
export async function refundOnlinePayment(orderId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('payment-refund', { body: { orderId } });
  if (error) throw error;
}

// ─── Seller Documents ────────────────────────────────────────────────────────

export type SellerDocumentType = 'tax_certificate' | 'business_license';

export type SellerDocumentRow = {
  seller_id: string;
  doc_type: SellerDocumentType;
  storage_path: string;
};

/** RLS: başvuran yalnızca kendi belgelerini, yönetici hepsini görür. */
export async function fetchSellerDocuments(): Promise<SellerDocumentRow[]> {
  const { data, error } = await supabase
    .from('seller_documents')
    .select('seller_id, doc_type, storage_path');
  if (error) throw error;
  return (data ?? []) as SellerDocumentRow[];
}

// ─── Menu Items ──────────────────────────────────────────────────────────────

export type MenuItemRow = {
  /** Günlük adet; 0 ise sınırsız */
  daily_limit?: number;
  sold_today?: number;
  stock_reset_date?: string | null;
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  is_available: boolean;
  category: string | null;
  /** null: belirtilmedi, boş: alerjen içermiyor */
  allergens?: string[] | null;
  created_at: string;
  updated_at: string;
};

export type MenuItemInsert = {
  seller_id: string;
  title: string;
  description?: string | null;
  price_cents: number;
  currency?: string;
  image_url?: string | null;
  is_available?: boolean;
  category?: string | null;
  allergens?: string[] | null;
};

export type MenuItemUpdate = Partial<Omit<MenuItemRow, 'id' | 'seller_id' | 'created_at'>>;

/** Satıcının menü öğelerini çek */
export async function fetchMenuItems(sellerId: string): Promise<MenuItemRow[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Tek menü öğesi çek */
export async function fetchMenuItemById(id: string): Promise<MenuItemRow | null> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/** Menü öğesi ekle */
export async function createMenuItem(item: MenuItemInsert): Promise<MenuItemRow> {
  const { data, error } = await supabase
    .from('menu_items')
    .insert({ currency: 'TRY', is_available: true, ...item })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Menü öğesi güncelle */
export async function updateMenuItem(id: string, updates: MenuItemUpdate): Promise<MenuItemRow> {
  const { data, error } = await supabase
    .from('menu_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Menü öğesi sil */
export async function deleteMenuItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('menu_items')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Müşteri için: satıcı + menü birlikte ──────────────────────────────────

export type MenuItemWithOptions = MenuItemRow & {
  menu_item_variants: VariantRow[];
  menu_item_extras: ExtraRow[];
  menu_item_portions: PortionRow[];
};

export type SellerWithMenu = SellerRow & { menu_items: MenuItemWithOptions[] };

/** Satıcı + menüsünü tek sorguda çek */
export async function fetchSellerWithMenu(sellerId: string): Promise<SellerWithMenu | null> {
  const { data, error } = await supabase
    .from('sellers')
    .select('*, menu_items(*, menu_item_variants(*), menu_item_extras(*), menu_item_portions(*))')
    .eq('id', sellerId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// ─── Favorites ──────────────────────────────────────────────────────────────

export type FavoriteRow = {
  id: string;
  user_id: string;
  seller_id: string;
  created_at: string;
};

/** Kullanıcının favorilerini çek */
export async function fetchFavorites(userId: string): Promise<FavoriteRow[]> {
  const { data, error } = await supabase
    .from('favorites')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Favori ekle */
export async function addFavorite(userId: string, sellerId: string): Promise<FavoriteRow> {
  const { data, error } = await supabase
    .from('favorites')
    .insert({ user_id: userId, seller_id: sellerId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Favori sil */
export async function removeFavorite(userId: string, sellerId: string): Promise<void> {
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('user_id', userId)
    .eq('seller_id', sellerId);
  if (error) throw error;
}

// ─── Reviews ────────────────────────────────────────────────────────────────

export type ReviewRow = {
  id: string;
  order_id: string | null;
  seller_id: string;
  customer_id: string;
  rating: number;
  comment: string | null;
  photo_url: string | null;
  menu_item_title: string | null;
  helpful_count: number;
  seller_reply: string | null;
  created_at: string;
};

/** Satıcının yorumlarını çek */
export async function fetchReviews(sellerId: string): Promise<ReviewRow[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Yorum ekle */
export async function createReview(review: {
  order_id?: string;
  seller_id: string;
  customer_id: string;
  rating: number;
  comment?: string;
  photo_url?: string;
  menu_item_title?: string;
}): Promise<ReviewRow> {
  const { data, error } = await supabase
    .from('reviews')
    .insert(review)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export type OrderRow = {
  id: string;
  /** Müşteri hesabını sildiyse boştur (014). */
  customer_id: string | null;
  seller_id: string;
  courier_id: string | null;
  status: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  currency: string;
  delivery_address: string | null;
  notes: string | null;
  /** Sunucuda hesaplanır (013): platform komisyonu ve kupon indirimi */
  commission_rate?: number;
  commission_cents?: number;
  discount_cents?: number;
  coupon_code?: string | null;
  /** İndirimin satıcının karşıladığı kısmı ve platformun karşıladığı teslimat bedeli (024) */
  seller_discount_cents?: number;
  platform_delivery_cents?: number;
  delivered_at?: string | null;
  payout_id?: string | null;
  refund_status?: string | null;
  refund_reason?: string | null;
  payment_method?: string;
  payment_status?: string;
  created_at: string;
  updated_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  menu_item_id: string;
  title_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

/** Müşterinin siparişlerini çek */
export async function fetchCustomerOrders(customerId: string): Promise<OrderWithItems[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Satıcının siparişlerini çek */
export async function fetchSellerOrders(sellerId: string): Promise<OrderWithItems[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('seller_id', sellerId)
    // Parası alınmamış online sipariş satıcıya görünmez (022).
    .or('payment_method.neq.online,payment_status.neq.pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** `place_order`: hesaplanan tutar ekrandakinden farklı; yeni tutar hatanın `details` alanındadır. */
export const ORDER_TOTAL_CHANGED = 'EVN01';
/** Telefon doğrulaması zorunluyken doğrulanmamış müşteri (031). */
export const PHONE_NOT_VERIFIED = 'EVN02';

/** Sepetteki bir satır: fiyat göndermeyiz, yalnızca seçimleri göndeririz — fiyatı sunucu hesaplar. */
export type OrderLineInput = {
  menuItemId: string;
  quantity: number;
  variantId?: string | null;
  portionId?: string | null;
  extraIds?: string[];
};

/**
 * Yeni sipariş oluştur. Tutarlar, teslimat ücreti, kupon indirimi, stok ve komisyon
 * `place_order` fonksiyonunda sunucuda hesaplanır (013); istemci fiyat gönderemez.
 */
export async function createOrder(params: {
  sellerId: string;
  items: OrderLineInput[];
  deliveryAddress: string;
  notes?: string;
  paymentMethod: 'cash' | 'card_door' | 'online';
  couponCode?: string | null;
  /** Müşterinin ekranda gördüğü tutar; sunucu farklı hesaplarsa sipariş açılmaz. */
  expectedTotalCents?: number;
  /** Teslimat alanı denetimi için: konumu bilinen satıcıda zorunludur (020). */
  deliveryCoords?: { latitude: number; longitude: number } | null;
  /** Müşterinin onayladığı sözleşme sürümü */
  termsVersion?: string;
}): Promise<OrderWithItems> {
  const { data, error } = await supabase.rpc('place_order', {
    p_seller_id: params.sellerId,
    p_items: params.items.map(i => ({
      menu_item_id: i.menuItemId,
      quantity: i.quantity,
      variant_id: i.variantId ?? null,
      portion_id: i.portionId ?? null,
      extra_ids: i.extraIds ?? [],
    })),
    p_delivery_address: params.deliveryAddress,
    p_notes: params.notes ?? null,
    p_payment_method: params.paymentMethod,
    p_coupon_code: params.couponCode ?? null,
    p_expected_total_cents: params.expectedTotalCents ?? null,
    p_delivery_lat: params.deliveryCoords?.latitude ?? null,
    p_delivery_lng: params.deliveryCoords?.longitude ?? null,
    p_terms_version: params.termsVersion ?? null,
  });
  if (error) throw error;
  const order = data as OrderRow;

  // Sipariş bu noktada açılmıştır: kalemler okunamadı diye hata dönersek müşteri tekrar deneyip
  // ikinci siparişi verir.
  const { data: itemsData } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', order.id);

  return { ...order, order_items: itemsData ?? [] };
}

/** Sipariş durumu güncelle */
export async function updateOrderStatus(orderId: string, status: string): Promise<OrderRow> {
  const { data, error } = await supabase
    .from('orders')
    .update({
      status,
      // Ödeme kapıda alınır: teslim edilen siparişin ödemesi alınmıştır.
      ...(status === 'delivered' ? { payment_status: 'paid' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── User Addresses ─────────────────────────────────────────────────────────

export type AddressRow = {
  id: string;
  user_id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  created_at: string;
};

/** Kullanıcının adreslerini çek */
export async function fetchAddresses(userId: string): Promise<AddressRow[]> {
  const { data, error } = await supabase
    .from('user_addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Adres ekle */
export async function createAddress(address: {
  user_id: string;
  label: string;
  address: string;
  latitude?: number;
  longitude?: number;
  is_default?: boolean;
}): Promise<AddressRow> {
  const { data, error } = await supabase
    .from('user_addresses')
    .insert(address)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Adres güncelle */
export async function updateAddress(id: string, updates: Partial<Omit<AddressRow, 'id' | 'user_id' | 'created_at'>>): Promise<AddressRow> {
  const { data, error } = await supabase
    .from('user_addresses')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Adres sil */
export async function deleteAddress(id: string): Promise<void> {
  const { error } = await supabase
    .from('user_addresses')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Loyalty ────────────────────────────────────────────────────────────────

export type LoyaltyRow = {
  id: string;
  user_id: string;
  points: number;
  total_orders: number;
  total_spent: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  free_deliveries_earned: number;
  free_deliveries_used: number;
  streak_days: number;
  referral_code: string | null;
  referral_count: number;
  referral_earnings: number;
  last_order_date: string | null;
  updated_at: string;
};

/** Kullanıcının sadakat bilgisini çek */
export async function fetchLoyalty(userId: string): Promise<LoyaltyRow | null> {
  const { data, error } = await supabase
    .from('loyalty')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  type: string;
  is_read: boolean;
  data: Record<string, unknown> | null;
  created_at: string;
};

/** Kullanıcının bildirimlerini çek */
export async function fetchNotifications(userId: string): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

/** Bildirimi okundu olarak işaretle */
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id);
  if (error) throw error;
}

/** Tüm bildirimleri okundu yap */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
}

// ─── Coupons ────────────────────────────────────────────────────────────────

export type CouponRow = {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed' | 'free_delivery';
  discount_value: number;
  min_order_cents: number;
  max_discount_cents: number | null;
  max_uses: number | null;
  /** Kişi başı kullanım hakkı; boşsa sınırsız (013) */
  max_uses_per_user: number | null;
  /** Doluysa kupon yalnızca bu satıcıda geçer ve indirimi satıcı karşılar (024) */
  seller_id: string | null;
  used_count: number;
  is_active: boolean;
  expires_at: string | null;
  title: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  created_at: string;
};

/** Aktif platform kuponlarını çek; satıcı kuponları satıcının sayfasında görünür. */
export async function fetchActiveCoupons(): Promise<CouponRow[]> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('is_active', true)
    .is('seller_id', null);
  if (error) throw error;
  return data ?? [];
}

export type OrderContact = { order_id: string; customer_name: string | null; customer_phone: string | null };

/** Satıcı: siparişlerdeki müşteri adı ve (sipariş sürerken) telefonu */
export async function fetchSellerOrderContacts(sellerId: string): Promise<OrderContact[]> {
  const { data, error } = await supabase.rpc('get_seller_order_contacts', { p_seller: sellerId });
  if (error) throw error;
  return (data ?? []) as OrderContact[];
}

/** Satıcı: siparişten müşteriyle sohbet açar, sohbet kimliğini döner */
export async function openOrderConversation(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_order_conversation', { p_order: orderId });
  if (error) throw error;
  return data as string;
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

export async function adminSetUserSuspended(userId: string, suspended: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_suspended', { p_user: userId, p_suspended: suspended });
  if (error) throw error;
}

/** Yönetici: toplu duyuru. Gönderilen kişi sayısını döner. */
export async function adminBroadcast(title: string, body: string, audience: 'all' | 'buyer' | 'seller'): Promise<number> {
  const { data, error } = await supabase.rpc('admin_broadcast', { p_title: title, p_body: body, p_audience: audience });
  if (error) throw error;
  return data as number;
}

/** Sipariş satırlarında gösterilecek ürün fotoğrafları */
export async function fetchMenuItemImages(ids: string[]): Promise<Record<string, string | null>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from('menu_items').select('id, image_url').in('id', ids);
  if (error) throw error;
  const out: Record<string, string | null> = {};
  for (const row of (data ?? []) as { id: string; image_url: string | null }[]) out[row.id] = row.image_url;
  return out;
}

/** Keşfet ekranı: "Şimdi açık" filtresi için çalışma saatleriyle */
export async function fetchSellersWithHours(): Promise<(SellerRow & { seller_hours?: SellerHourRow[] })[]> {
  const { data, error } = await supabase
    .from('sellers')
    .select('*, seller_hours(*)')
    .eq('is_active', true)
    .order('rating_avg', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Ana sayfa kartları için: her satıcının öne çıkan tek aktif kampanyası */
export async function fetchSellerCampaignMap(): Promise<Record<string, CouponRow>> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out: Record<string, CouponRow> = {};
  for (const c of (data ?? []) as CouponRow[]) {
    if (!c.seller_id || (c.max_uses != null && c.used_count >= c.max_uses)) continue;
    if (!out[c.seller_id]) out[c.seller_id] = c;
  }
  return out;
}

/** Satıcı sayfasında gösterilecek, hâlâ kullanılabilir kampanyalar */
export async function fetchSellerCoupons(sellerId: string): Promise<CouponRow[]> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('seller_id', sellerId)
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as CouponRow[]).filter(c => c.max_uses == null || c.used_count < c.max_uses);
}

/** Satıcının yönetim ekranı: durdurulan ve süresi dolanlar dahil */
export async function fetchMyCampaigns(sellerId: string): Promise<CouponRow[]> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSellerCoupon(params: {
  code: string;
  title: string;
  type: 'percent' | 'fixed' | 'free_delivery';
  value: number;
  minOrderCents: number;
  maxUses: number | null;
  expiresAt: string;
  maxDiscountCents?: number | null;
}): Promise<CouponRow> {
  const { data, error } = await supabase.rpc('create_seller_coupon', {
    p_code: params.code,
    p_title: params.title,
    p_type: params.type,
    p_value: params.value,
    p_min_order_cents: params.minOrderCents,
    p_max_uses: params.maxUses,
    p_expires_at: params.expiresAt,
    p_max_discount_cents: params.maxDiscountCents ?? null,
  });
  if (error) throw error;
  return data as CouponRow;
}

export async function setSellerCouponActive(couponId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_seller_coupon_active', { p_coupon: couponId, p_active: active });
  if (error) throw error;
}

/** Kullanılmış kupon silinmez, kapatılır. Gerçekten silindiyse true döner. */
export async function deleteSellerCoupon(couponId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_seller_coupon', { p_coupon: couponId });
  if (error) throw error;
  return data as boolean;
}

/** Kupon kodu ile ara */
export async function findCouponByCode(code: string): Promise<CouponRow | null> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .eq('is_active', true)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Giriş yapmış kullanıcının bu kuponu kaç siparişte kullandığı (RLS yalnızca kendi kayıtlarını gösterir).
 * Yalnızca önizleme içindir: asıl kontrolü `place_order` yapar, bu yüzden hata 0 sayılır.
 */
export async function countMyCouponRedemptions(couponId: string): Promise<number> {
  const { count, error } = await supabase
    .from('coupon_redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('coupon_id', couponId);
  if (error) return 0;
  return count ?? 0;
}

// ─── Seller Hours ───────────────────────────────────────────────────────────

export type SellerHourRow = {
  id: string;
  seller_id: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_open: boolean;
};

/** Satıcının çalışma saatlerini çek */
export async function fetchSellerHours(sellerId: string): Promise<SellerHourRow[]> {
  const { data, error } = await supabase
    .from('seller_hours')
    .select('*')
    .eq('seller_id', sellerId)
    .order('day_of_week', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Çalışma saatlerini kaydet (upsert) */
export async function upsertSellerHours(sellerId: string, hours: { day_of_week: number; open_time: string | null; close_time: string | null; is_open: boolean }[]): Promise<void> {
  const rows = hours.map(h => ({ seller_id: sellerId, ...h }));
  const { error } = await supabase
    .from('seller_hours')
    .upsert(rows, { onConflict: 'seller_id,day_of_week' });
  if (error) throw error;
}

// ─── Sellers with Menu (for search/explore) ────────────────────────────────

/** Tüm aktif satıcıları menü sayısıyla birlikte çek */
export async function fetchSellersWithMenuCount(): Promise<(SellerRow & { menu_items: { count: number }[] })[]> {
  const { data, error } = await supabase
    .from('sellers')
    .select('*, menu_items(count)')
    .eq('is_active', true)
    .order('rating_avg', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Satıcıları arama — isim, bio, ilçe, menü öğeleri */
export async function searchSellers(query: string): Promise<SellerRow[]> {
  const q = `%${query}%`;
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .eq('is_active', true)
    .or(`display_name.ilike.${q},bio.ilike.${q},district.ilike.${q}`);
  if (error) throw error;
  return data ?? [];
}

/** Birden fazla satıcıyı ID listesiyle çek */
export async function fetchSellersByIds(ids: string[]): Promise<SellerRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('sellers')
    .select('*')
    .in('id', ids);
  if (error) throw error;
  return data ?? [];
}

/** Yorum yanıtla (satıcı) */
export async function replyToReview(reviewId: string, reply: string): Promise<void> {
  const { error } = await supabase
    .from('reviews')
    .update({ seller_reply: reply })
    .eq('id', reviewId);
  if (error) throw error;
}

// ─── Stock Management ──────────────────────────────────────────────────────

/** Günlük stok limitini ayarla */
export async function setMenuItemDailyLimit(menuItemId: string, dailyLimit: number): Promise<void> {
  const { error } = await supabase
    .from('menu_items')
    .update({ daily_limit: dailyLimit, updated_at: new Date().toISOString() })
    .eq('id', menuItemId);
  if (error) throw error;
}

/** @deprecated Stok artık `place_order` içinde sunucuda düşülür; müşteri menu_items'a yazamaz. */
export async function recordMenuItemSale(menuItemId: string, quantity: number): Promise<boolean> {
  const today = istanbulToday();

  // Get current stock info
  const { data, error } = await supabase
    .from('menu_items')
    .select('daily_limit, sold_today, stock_reset_date')
    .eq('id', menuItemId)
    .single();
  if (error) return true; // Assume OK if can't check

  // Auto-reset if new day
  let soldToday = data.sold_today ?? 0;
  if (data.stock_reset_date !== today) {
    soldToday = 0;
  }

  // Check limit
  if (data.daily_limit > 0 && soldToday + quantity > data.daily_limit) {
    return false; // Not enough stock
  }

  // Update
  await supabase
    .from('menu_items')
    .update({ sold_today: soldToday + quantity, stock_reset_date: today, updated_at: new Date().toISOString() })
    .eq('id', menuItemId);

  return true;
}

/** Menü öğesinin stok durumunu çek */
export async function fetchMenuItemStock(menuItemId: string): Promise<{ remaining: number; limit: number; soldOut: boolean } | null> {
  const today = istanbulToday();
  const { data, error } = await supabase
    .from('menu_items')
    .select('daily_limit, sold_today, stock_reset_date')
    .eq('id', menuItemId)
    .single();
  if (error || !data || data.daily_limit === 0) return null;

  const sold = data.stock_reset_date === today ? (data.sold_today ?? 0) : 0;
  const remaining = Math.max(data.daily_limit - sold, 0);
  return { remaining, limit: data.daily_limit, soldOut: remaining === 0 };
}

// ─── Menu Variants & Extras ────────────────────────────────────────────────

export type VariantRow = {
  id: string;
  menu_item_id: string;
  label: string;
  price_diff_cents: number;
  is_available: boolean;
  sort_order: number;
  created_at: string;
};

export type ExtraRow = {
  id: string;
  menu_item_id: string;
  label: string;
  price_cents: number;
  is_available: boolean;
  sort_order: number;
  created_at: string;
};

/** Menü öğesinin varyantlarını çek */
export async function fetchVariants(menuItemId: string): Promise<VariantRow[]> {
  const { data, error } = await supabase
    .from('menu_item_variants')
    .select('*')
    .eq('menu_item_id', menuItemId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Varyant ekle */
export async function createVariant(variant: { menu_item_id: string; label: string; price_diff_cents: number; sort_order?: number }): Promise<VariantRow> {
  const { data, error } = await supabase
    .from('menu_item_variants')
    .insert(variant)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Varyant sil */
export async function deleteVariant(id: string): Promise<void> {
  const { error } = await supabase.from('menu_item_variants').delete().eq('id', id);
  if (error) throw error;
}

/** Menü öğesinin ekstralarını çek */
export async function fetchExtras(menuItemId: string): Promise<ExtraRow[]> {
  const { data, error } = await supabase
    .from('menu_item_extras')
    .select('*')
    .eq('menu_item_id', menuItemId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Ekstra ekle */
export async function createExtra(extra: { menu_item_id: string; label: string; price_cents: number; sort_order?: number }): Promise<ExtraRow> {
  const { data, error } = await supabase
    .from('menu_item_extras')
    .insert(extra)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Ekstra sil */
export async function deleteExtra(id: string): Promise<void> {
  const { error } = await supabase.from('menu_item_extras').delete().eq('id', id);
  if (error) throw error;
}

// ─── Notification Creation ─────────────────────────────────────────────────

// ─── Menu Items Search ─────────────────────────────────────────────────────

/** Tüm menü öğelerini ara */
export async function searchMenuItems(query: string): Promise<(MenuItemRow & { seller: SellerRow })[]> {
  const q = `%${query}%`;
  const { data, error } = await supabase
    .from('menu_items')
    .select('*, seller:sellers(*)')
    .eq('is_available', true)
    .or(`title.ilike.${q},description.ilike.${q},category.ilike.${q}`);
  if (error) throw error;
  return data ?? [];
}

/** Tüm menü öğelerini çek (tüm satıcılardan) */
export async function fetchAllMenuItems(): Promise<(MenuItemRow & { seller: SellerRow })[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*, seller:sellers(*)')
    .eq('is_available', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── Push Token ────────────────────────────────────────────────────────────

/** Push token'ı Supabase'e kaydet */
export async function savePushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ push_token: token })
    .eq('id', userId);
  if (error) console.error('[db] savePushToken error:', error.message);
}

/** Kullanıcının push token'ını getir */
export async function fetchPushToken(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('push_token')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return data.push_token;
}

// ─── Portions ──────────────────────────────────────────────────────────────

export type PortionRow = {
  id: string;
  menu_item_id: string;
  label: string;
  price_cents: number;
  sort_order: number;
  is_available: boolean;
  created_at: string;
};

/** Menü öğesinin porsiyonlarını çek */
export async function fetchPortions(menuItemId: string): Promise<PortionRow[]> {
  const { data, error } = await supabase
    .from('menu_item_portions')
    .select('*')
    .eq('menu_item_id', menuItemId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Porsiyon ekle */
export async function createPortion(portion: { menu_item_id: string; label: string; price_cents: number; sort_order?: number }): Promise<PortionRow> {
  const { data, error } = await supabase
    .from('menu_item_portions')
    .insert(portion)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Porsiyon sil */
export async function deletePortion(id: string): Promise<void> {
  const { error } = await supabase.from('menu_item_portions').delete().eq('id', id);
  if (error) throw error;
}

// ─── Account Deletion ─────────────────────────────────────────────────────

/**
 * Giriş yapmış kullanıcının hesabını sunucuda kalıcı olarak siler (014).
 * Satıcıysa mağaza kimliğini döndürür. Devam eden sipariş varsa '55000' koduyla reddedilir.
 */
export async function deleteUserAccount(): Promise<string | null> {
  const { data, error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
  return data as string | null;
}

// ─── Cancel / Refund ──────────────────────────────────────────────────────

/** Siparişi iptal et (sadece pending/accepted durumunda) */
export async function cancelOrder(orderId: string, reason?: string): Promise<void> {
  const { data: order, error: fetchErr } = await supabase
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!order || !['awaiting_payment', 'pending', 'accepted'].includes(order.status)) {
    throw new Error('Bu sipariş artık iptal edilemez.');
  }
  const { error } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      cancel_reason: reason ?? null,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);
  if (error) throw error;
}

/** İade talebi oluştur */
export async function requestRefund(orderId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({
      refund_status: 'requested',
      refund_reason: reason,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);
  if (error) throw error;
}

/** Yönetici iade talebini karara bağlar; müşteriye bildirim sunucudan gider (018). */
export async function reviewRefund(orderId: string, decision: 'approved' | 'rejected'): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ refund_status: decision, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .select('id')
    .single();
  if (error) throw error;
}

/** Puan karşılığı kişiye özel kupon alır, kupon kodunu döndürür. Yetersiz puanda '55000' döner. */
export async function redeemLoyaltyReward(rewardId: string): Promise<string> {
  const { data, error } = await supabase.rpc('redeem_reward', { p_reward_id: rewardId });
  if (error) throw error;
  return data as string;
}

/** Satıcıyı takip eden müşterilere duyuru yapar, saatte en çok bir kez; yazma ve push sunucudadır (026, 019). */
export async function notifyMyFollowers(title: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('notify_my_followers', { p_title: title, p_body: body });
  if (error) throw error;
}

// ─── Takip ve Faydalı ───────────────────────────────────────────────────────

export async function fetchFollowState(sellerId: string): Promise<{ is_following: boolean; follower_count: number }> {
  const { data, error } = await supabase.rpc('get_seller_follow_state', { p_seller: sellerId });
  if (error) throw error;
  return (data as { is_following: boolean; follower_count: number }[])[0] ?? { is_following: false, follower_count: 0 };
}

export async function followSeller(userId: string, sellerId: string): Promise<void> {
  const { error } = await supabase.from('seller_follows').insert({ user_id: userId, seller_id: sellerId });
  // Başka cihazdan zaten takip edildiyse amaç yerine gelmiştir.
  if (error && error.code !== '23505') throw error;
}

export async function unfollowSeller(userId: string, sellerId: string): Promise<void> {
  const { error } = await supabase.from('seller_follows').delete().eq('user_id', userId).eq('seller_id', sellerId);
  if (error) throw error;
}

/** Kullanıcının bu yorumlardan faydalı bulduklarını döndürür (RLS yalnızca kendi oylarını gösterir). */
export async function fetchMyHelpfulReviewIds(reviewIds: string[]): Promise<string[]> {
  if (reviewIds.length === 0) return [];
  const { data, error } = await supabase.from('review_helpful').select('review_id').in('review_id', reviewIds);
  if (error) throw error;
  return (data ?? []).map((r: { review_id: string }) => r.review_id);
}

export async function markReviewHelpful(userId: string, reviewId: string): Promise<void> {
  const { error } = await supabase.from('review_helpful').insert({ review_id: reviewId, user_id: userId });
  if (error && error.code !== '23505') throw error;
}

export async function unmarkReviewHelpful(userId: string, reviewId: string): Promise<void> {
  const { error } = await supabase.from('review_helpful').delete().eq('review_id', reviewId).eq('user_id', userId);
  if (error) throw error;
}

// ─── Kazanç ve Hesap Kesimi ─────────────────────────────────────────────────

export type EarningsSummary = {
  order_count: number;
  gross_cents: number;
  seller_discount_cents: number;
  commission_cents: number;
  net_cents: number;
  collected_cents: number;
  /** Artı: platform satıcıya ödeyecek. Eksi: satıcı platforma ödeyecek. */
  open_balance_cents: number;
  open_order_count: number;
  held_count: number;
};

export type PayoutRow = {
  id: string;
  seller_id: string;
  amount_cents: number;
  order_count: number;
  commission_cents: number;
  note: string | null;
  created_at: string;
};

export type PayoutAccountRow = { seller_id: string; iban: string; account_name: string };

export type PayoutOverviewRow = {
  seller_id: string;
  display_name: string;
  seller_type: string;
  iban: string | null;
  account_name: string | null;
  balance_cents: number;
  order_count: number;
  commission_cents: number;
  held_count: number;
  last_payout_at: string | null;
};

export type PlatformTotals = {
  delivered_count: number;
  sales_cents: number;
  commission_cents: number;
  payable_cents: number;
  receivable_cents: number;
};

export async function fetchMyEarnings(fromIso: string, toIso: string): Promise<EarningsSummary> {
  const { data, error } = await supabase.rpc('get_my_earnings', { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return (data as EarningsSummary[])[0];
}

export async function fetchMyPayouts(sellerId: string): Promise<PayoutRow[]> {
  const { data, error } = await supabase
    .from('seller_payouts')
    .select('*')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function fetchPayoutAccount(sellerId: string): Promise<PayoutAccountRow | null> {
  const { data, error } = await supabase
    .from('seller_payout_accounts')
    .select('seller_id, iban, account_name')
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function savePayoutAccount(sellerId: string, iban: string, accountName: string): Promise<void> {
  const { error } = await supabase
    .from('seller_payout_accounts')
    .upsert({ seller_id: sellerId, iban, account_name: accountName, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function fetchPayoutOverview(): Promise<PayoutOverviewRow[]> {
  const { data, error } = await supabase.rpc('admin_payout_overview');
  if (error) throw error;
  return (data ?? []) as PayoutOverviewRow[];
}

export async function fetchPlatformTotals(): Promise<PlatformTotals> {
  const { data, error } = await supabase.rpc('admin_platform_totals');
  if (error) throw error;
  const row = (data as Record<keyof PlatformTotals, number | string>[])[0];
  return {
    delivered_count: Number(row.delivered_count),
    sales_cents: Number(row.sales_cents),
    commission_cents: Number(row.commission_cents),
    payable_cents: Number(row.payable_cents),
    receivable_cents: Number(row.receivable_cents),
  };
}

/** Yönetici ekranda gördüğü tutarı gönderir; bakiye o arada değiştiyse 'EVN04' ile reddedilir. */
export async function settleSeller(sellerId: string, expectedCents: number, note: string): Promise<PayoutRow> {
  const { data, error } = await supabase.rpc('admin_settle_seller', {
    p_seller: sellerId,
    p_expected_cents: expectedCents,
    p_note: note,
  });
  if (error) throw error;
  return data as PayoutRow;
}

// ─── Favorite Seller Notifications ──────────────────────────────────────────

// ─── Weekly Menu Calendar ──────────────────────────────────────────────────

export type WeeklyMenuRow = {
  id: string;
  seller_id: string;
  menu_item_id: string;
  day_of_week: number;
  is_active: boolean;
  created_at: string;
};

/** Satıcının haftalık menüsünü çek */
export async function fetchWeeklyMenu(sellerId: string): Promise<WeeklyMenuRow[]> {
  const { data, error } = await supabase
    .from('weekly_menu')
    .select('*')
    .eq('seller_id', sellerId)
    .order('day_of_week', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Haftalık menüye öğe ekle */
export async function addWeeklyMenuItem(sellerId: string, menuItemId: string, dayOfWeek: number): Promise<void> {
  const { error } = await supabase
    .from('weekly_menu')
    .upsert({ seller_id: sellerId, menu_item_id: menuItemId, day_of_week: dayOfWeek, is_active: true });
  if (error) throw error;
}

/** Haftalık menüden öğe kaldır */
export async function removeWeeklyMenuItem(sellerId: string, menuItemId: string, dayOfWeek: number): Promise<void> {
  const { error } = await supabase
    .from('weekly_menu')
    .delete()
    .eq('seller_id', sellerId)
    .eq('menu_item_id', menuItemId)
    .eq('day_of_week', dayOfWeek);
  if (error) throw error;
}

/** Satıcının haftalık menü kullanımını aç/kapa */
export async function toggleWeeklyMenuMode(sellerId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('sellers')
    .update({ uses_weekly_menu: enabled })
    .eq('id', sellerId);
  if (error) throw error;
}
