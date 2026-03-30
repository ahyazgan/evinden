/**
 * Supabase veritabanı CRUD katmanı
 * sellers, menu_items tabloları için
 */
import { supabase } from './supabase';

// ─── Seller ──────────────────────────────────────────────────────────────────

export type SellerRow = {
  id: string;
  user_id: string;
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
  logo_url: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
};

export type SellerInsert = Omit<SellerRow, 'id' | 'rating_avg' | 'rating_count' | 'is_active' | 'created_at' | 'updated_at'>;
export type SellerUpdate = Partial<Omit<SellerRow, 'id' | 'user_id' | 'created_at'>>;

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

// ─── Menu Items ──────────────────────────────────────────────────────────────

export type MenuItemRow = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  is_available: boolean;
  category: string | null;
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

export type SellerWithMenu = SellerRow & { menu_items: MenuItemRow[] };

/** Satıcı + menüsünü tek sorguda çek */
export async function fetchSellerWithMenu(sellerId: string): Promise<SellerWithMenu | null> {
  const { data, error } = await supabase
    .from('sellers')
    .select('*, menu_items(*)')
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
  customer_id: string;
  seller_id: string;
  courier_id: string | null;
  status: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  currency: string;
  delivery_address: string | null;
  notes: string | null;
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
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Yeni sipariş oluştur */
export async function createOrder(order: {
  customer_id: string;
  seller_id: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  delivery_address?: string;
  notes?: string;
}, items: {
  menu_item_id: string;
  title_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}[]): Promise<OrderWithItems> {
  // Sipariş oluştur
  const { data: orderData, error: orderErr } = await supabase
    .from('orders')
    .insert({
      ...order,
      currency: 'TRY',
      status: 'pending',
    })
    .select()
    .single();
  if (orderErr) throw orderErr;

  // Sipariş kalemlerini ekle
  const itemsWithOrderId = items.map(item => ({
    ...item,
    order_id: orderData.id,
  }));
  const { data: itemsData, error: itemsErr } = await supabase
    .from('order_items')
    .insert(itemsWithOrderId)
    .select();
  if (itemsErr) throw itemsErr;

  return { ...orderData, order_items: itemsData ?? [] };
}

/** Sipariş durumu güncelle */
export async function updateOrderStatus(orderId: string, status: string): Promise<OrderRow> {
  const { data, error } = await supabase
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
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

/** Sadakat bilgisi oluştur veya güncelle */
export async function upsertLoyalty(userId: string, updates: Partial<Omit<LoyaltyRow, 'id' | 'user_id'>>): Promise<LoyaltyRow> {
  const { data, error } = await supabase
    .from('loyalty')
    .upsert({ user_id: userId, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
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
  used_count: number;
  is_active: boolean;
  expires_at: string | null;
  title: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  created_at: string;
};

/** Aktif kuponları çek */
export async function fetchActiveCoupons(): Promise<CouponRow[]> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('is_active', true);
  if (error) throw error;
  return data ?? [];
}

/** Kupon kodu ile ara */
export async function findCouponByCode(code: string): Promise<CouponRow | null> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('is_active', true)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
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
