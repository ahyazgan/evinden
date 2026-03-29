/** Supabase public.users tablosu (telefon auth) */
export type AppUserRole = 'buyer' | 'seller';
export type SellerApplicationStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  id: string;
  name: string | null;
  phone: string | null;
  role: AppUserRole;
  avatar_url: string | null;
  is_approved: boolean;
  seller_application?: SellerApplicationStatus;
  seller_store_name?: string;
  created_at: string;
}

/** Eski / genel kullanıcı (sipariş vb. için) */
export type UserRole = 'buyer' | 'seller' | 'courier' | 'admin';

export interface User {
  id: string;
  email?: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Seller {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  city: string | null;
  district: string | null;
  address_line: string | null;
  latitude: number | null;
  longitude: number | null;
  rating_avg: number | null;
  rating_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface Order {
  id: string;
  customer_id: string;
  seller_id: string;
  courier_id: string | null;
  status: OrderStatus;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  currency: string;
  delivery_address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  title_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

export interface Review {
  id: string;
  order_id: string;
  seller_id: string;
  customer_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}
