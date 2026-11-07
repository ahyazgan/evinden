/** Supabase public.users tablosu (telefon auth) */
export type AppUserRole = 'buyer' | 'seller' | 'admin';
export type SellerApplicationStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  id: string;
  name: string | null;
  phone: string | null;
  role: AppUserRole;
  avatar_url: string | null;
  is_approved: boolean;
  is_suspended?: boolean;
  /** Kampanya bildirimi izni; sunucuda varsayılan kapalı. */
  marketing_consent?: boolean;
  seller_application?: SellerApplicationStatus;
  /** Başvuru reddedildiyse yöneticinin yazdığı neden (058) */
  seller_rejection_reason?: string | null;
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
  user_id: string | null;
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

export type MenuVariant = {
  id: string;
  label: string;       // "Küçük", "Büyük", "Acılı"
  priceDiffCents: number; // fark: +500 = +₺5
};

export type MenuExtra = {
  id: string;
  label: string;       // "Ekstra Peynir", "Sos"
  priceCents: number;
};

export type MenuPortion = {
  id: string;
  label: string;       // "1 Kişilik", "2 Kişilik", "Aile Boyu"
  priceCents: number;
};

export interface MenuItem {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  /** null: belirtilmedi, boş: alerjen içermiyor */
  allergens?: string[] | null;
  /** Satıcının seçtiği etiketler (034): vegetarian, vegan, spicy */
  dietary?: string[];
  price_cents: number;
  currency: string;
  image_url: string | null;
  is_available: boolean;
  /** Bugün kalan porsiyon; null ise sınırsız */
  remaining_today?: number | null;
  category?: string;
  badge?: 'popular' | 'new' | 'spicy';
  variants?: MenuVariant[];
  extras?: MenuExtra[];
  portions?: MenuPortion[];
  /** Müşterinin göreceği seçim grupları (040) */
  optionGroups?: import('@/lib/option-groups').OptionGroup[];
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
