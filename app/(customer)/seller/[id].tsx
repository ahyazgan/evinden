import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors } from '@/constants/theme';
import { useCart } from '@/lib/cart-context';
import { useRecentlyViewed } from '@/lib/recently-viewed';
import type { MenuItem, Seller } from '@/types';

const FAV_STORAGE_KEY = '@evinden_favorites';

const { width: SCREEN_W } = Dimensions.get('window');

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const SELLER_AVATARS: Record<string, { emoji: string; bg: string }> = {
  'demo-1': { emoji: '🍲', bg: '#FFF3E0' },
  'demo-2': { emoji: '🥟', bg: '#E8F5E9' },
  'demo-3': { emoji: '🐟', bg: '#E3F2FD' },
  'demo-4': { emoji: '🎂', bg: '#FCE4EC' },
  'demo-5': { emoji: '🥩', bg: '#FBE9E7' },
  'demo-6': { emoji: '🍳', bg: '#FFFDE7' },
};

type WorkingHours = { day: string; hours: string; open: boolean };

const WORKING_HOURS: Record<string, WorkingHours[]> = {
  'demo-1': [
    { day: 'Pazartesi', hours: '09:00 - 21:00', open: true },
    { day: 'Salı', hours: '09:00 - 21:00', open: true },
    { day: 'Çarşamba', hours: '09:00 - 21:00', open: true },
    { day: 'Perşembe', hours: '09:00 - 21:00', open: true },
    { day: 'Cuma', hours: '09:00 - 22:00', open: true },
    { day: 'Cumartesi', hours: '10:00 - 22:00', open: true },
    { day: 'Pazar', hours: '10:00 - 20:00', open: true },
  ],
  'demo-2': [
    { day: 'Pazartesi', hours: '10:00 - 20:00', open: true },
    { day: 'Salı', hours: '10:00 - 20:00', open: true },
    { day: 'Çarşamba', hours: '10:00 - 20:00', open: true },
    { day: 'Perşembe', hours: '10:00 - 20:00', open: true },
    { day: 'Cuma', hours: '10:00 - 21:00', open: true },
    { day: 'Cumartesi', hours: '10:00 - 21:00', open: true },
    { day: 'Pazar', hours: 'Kapalı', open: false },
  ],
  'demo-3': [
    { day: 'Pazartesi', hours: '08:00 - 22:00', open: true },
    { day: 'Salı', hours: '08:00 - 22:00', open: true },
    { day: 'Çarşamba', hours: '08:00 - 22:00', open: true },
    { day: 'Perşembe', hours: '08:00 - 22:00', open: true },
    { day: 'Cuma', hours: '08:00 - 23:00', open: true },
    { day: 'Cumartesi', hours: '09:00 - 23:00', open: true },
    { day: 'Pazar', hours: '09:00 - 21:00', open: true },
  ],
  'demo-4': [
    { day: 'Pazartesi', hours: '10:00 - 20:00', open: true },
    { day: 'Salı', hours: '10:00 - 20:00', open: true },
    { day: 'Çarşamba', hours: '10:00 - 20:00', open: true },
    { day: 'Perşembe', hours: '10:00 - 20:00', open: true },
    { day: 'Cuma', hours: '10:00 - 21:00', open: true },
    { day: 'Cumartesi', hours: '10:00 - 21:00', open: true },
    { day: 'Pazar', hours: '11:00 - 19:00', open: true },
  ],
  'demo-5': [
    { day: 'Pazartesi', hours: '11:00 - 22:00', open: true },
    { day: 'Salı', hours: '11:00 - 22:00', open: true },
    { day: 'Çarşamba', hours: '11:00 - 22:00', open: true },
    { day: 'Perşembe', hours: '11:00 - 22:00', open: true },
    { day: 'Cuma', hours: '11:00 - 23:00', open: true },
    { day: 'Cumartesi', hours: '12:00 - 23:00', open: true },
    { day: 'Pazar', hours: 'Kapalı', open: false },
  ],
  'demo-6': [
    { day: 'Pazartesi', hours: '07:00 - 14:00', open: true },
    { day: 'Salı', hours: '07:00 - 14:00', open: true },
    { day: 'Çarşamba', hours: '07:00 - 14:00', open: true },
    { day: 'Perşembe', hours: '07:00 - 14:00', open: true },
    { day: 'Cuma', hours: '07:00 - 15:00', open: true },
    { day: 'Cumartesi', hours: '08:00 - 15:00', open: true },
    { day: 'Pazar', hours: '08:00 - 14:00', open: true },
  ],
};

const DEMO_SELLERS: Record<string, Seller & { deliveryTime: string; minOrder: number }> = {
  'demo-1': {
    id: 'demo-1', user_id: 'u1', display_name: "Ayşe'nin Ev Yemekleri",
    bio: 'Her gün taze pişirilen geleneksel Türk yemekleri. Anneannemden kalma tariflerle, doğal malzemelerle hazırlanan ev lezzetleri.',
    city: 'İstanbul', district: 'Kadıköy', address_line: 'Caferağa Mah.', latitude: 40.9903, longitude: 29.0278,
    rating_avg: 4.8, rating_count: 124, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '25-35', minOrder: 5000,
  },
  'demo-2': {
    id: 'demo-2', user_id: 'u2', display_name: 'Fatma Hanım Mutfağı',
    bio: 'Ege usulü zeytinyağlı yemekler ve taze börekler. Her gün el açması yufka ile hazırlanır.',
    city: 'İstanbul', district: 'Beşiktaş', address_line: 'Sinanpaşa Mah.', latitude: 41.0422, longitude: 29.0099,
    rating_avg: 4.6, rating_count: 87, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '30-40', minOrder: 6000,
  },
  'demo-3': {
    id: 'demo-3', user_id: 'u3', display_name: 'Mehmet Usta Karadeniz',
    bio: 'Karadeniz mutfağının eşsiz tatları: hamsi, kuymak, mısır ekmeği. Trabzon usulü.',
    city: 'İstanbul', district: 'Üsküdar', address_line: 'Altunizade Mah.', latitude: 41.0233, longitude: 29.0151,
    rating_avg: 4.9, rating_count: 203, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '20-30', minOrder: 4500,
  },
  'demo-4': {
    id: 'demo-4', user_id: 'u4', display_name: 'Zeynep Pasta & Tatlı',
    bio: 'El yapımı pastalar, kurabiyeler ve geleneksel tatlılar. Özel günlerinize lezzet katıyoruz.',
    city: 'İstanbul', district: 'Bakırköy', address_line: null, latitude: 40.9792, longitude: 28.8720,
    rating_avg: 4.7, rating_count: 56, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '35-45', minOrder: 8000,
  },
  'demo-5': {
    id: 'demo-5', user_id: 'u5', display_name: 'Hüseyin Bey Izgara',
    bio: 'Mangalda pişirilen köfteler, tavuk şiş ve sebze ızgara. Günlük taze et kullanılır.',
    city: 'İstanbul', district: 'Şişli', address_line: null, latitude: 41.0602, longitude: 28.9877,
    rating_avg: 4.5, rating_count: 41, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '25-35', minOrder: 7000,
  },
  'demo-6': {
    id: 'demo-6', user_id: 'u6', display_name: 'Elif Anne Kahvaltı',
    bio: 'Serpme kahvaltı, gözleme ve köy kahvaltısı. Her sabah taze hazırlanır.',
    city: 'İstanbul', district: 'Sarıyer', address_line: null, latitude: 41.1667, longitude: 29.0500,
    rating_avg: 4.8, rating_count: 92, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '20-30', minOrder: 6000,
  },
};

const ITEM_EMOJIS: Record<string, string> = {
  'm1-1': '🍜', 'm1-2': '🍚', 'm1-3': '🍖', 'm1-4': '🥗',
  'm2-1': '🥬', 'm2-2': '🥐', 'm2-3': '🌿',
  'm3-1': '🐟', 'm3-2': '🧀', 'm3-3': '🌽', 'm3-4': '🍵',
  'm4-1': '🎂', 'm4-2': '🍪', 'm4-3': '🍮',
  'm5-1': '🥩', 'm5-2': '🍗', 'm5-3': '🍽️',
  'm6-1': '🍳', 'm6-2': '🫓', 'm6-3': '🧈',
};

const DEMO_MENUS: Record<string, MenuItem[]> = {
  'demo-1': [
    { id: 'm1-1', seller_id: 'demo-1', title: 'Mercimek Çorbası', description: 'Günlük taze kırmızı mercimek çorbası, limon ve nane ile', price_cents: 4500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm1-2', seller_id: 'demo-1', title: 'Kuru Fasulye + Pilav', description: 'Geleneksel tarif, yanında tereyağlı pirinç pilavı', price_cents: 8000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm1-3', seller_id: 'demo-1', title: 'İzmir Köfte', description: 'Domates soslu fırın köfte, patates ve biber ile', price_cents: 9500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm1-4', seller_id: 'demo-1', title: 'Karışık Salata', description: 'Mevsim yeşillikleri, domates, salatalık, zeytin', price_cents: 3500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-2': [
    { id: 'm2-1', seller_id: 'demo-2', title: 'Zeytinyağlı Enginar', description: 'Taze enginar, havuç ve bezelye ile, soğuk servis', price_cents: 7000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm2-2', seller_id: 'demo-2', title: 'Ispanaklı Börek', description: 'El açması yufka, lor peyniri ve ıspanak ile', price_cents: 6500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm2-3', seller_id: 'demo-2', title: 'Zeytinyağlı Dolma', description: 'Fıstıklı ve kuş üzümlü yaprak sarma', price_cents: 7500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-3': [
    { id: 'm3-1', seller_id: 'demo-3', title: 'Hamsi Tava', description: 'Taze hamsi, mısır ununda kızartılmış', price_cents: 11000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm3-2', seller_id: 'demo-3', title: 'Kuymak (Muhlama)', description: 'Mısır unu ve kaşar peyniri ile', price_cents: 8500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm3-3', seller_id: 'demo-3', title: 'Mısır Ekmeği', description: 'Günlük taze pişirilmiş (2 adet)', price_cents: 3000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm3-4', seller_id: 'demo-3', title: 'Karalahana Çorbası', description: 'Geleneksel Karadeniz usulü', price_cents: 5000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-4': [
    { id: 'm4-1', seller_id: 'demo-4', title: 'Çikolatalı Yaş Pasta', description: 'Bitter çikolata ganajlı, 6 kişilik', price_cents: 35000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm4-2', seller_id: 'demo-4', title: 'Kurabiye Kutusu', description: '12 adet karışık el yapımı kurabiye', price_cents: 15000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm4-3', seller_id: 'demo-4', title: 'Fırın Sütlaç', description: 'Geleneksel fırında pişirilmiş, 2 kişilik', price_cents: 8000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-5': [
    { id: 'm5-1', seller_id: 'demo-5', title: 'Izgara Köfte (5 Adet)', description: 'El yapımı dana köfte, mangalda pişirilmiş', price_cents: 12000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm5-2', seller_id: 'demo-5', title: 'Tavuk Şiş', description: '3 şiş marine tavuk, yanında pilav ve salata', price_cents: 13500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm5-3', seller_id: 'demo-5', title: 'Karışık Izgara Tabağı', description: 'Köfte, tavuk şiş, kanat + közlenmiş sebze', price_cents: 18000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-6': [
    { id: 'm6-1', seller_id: 'demo-6', title: 'Serpme Kahvaltı (2 Kişilik)', description: 'Peynir tabağı, zeytin, bal, kaymak, yumurta, reçel', price_cents: 25000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm6-2', seller_id: 'demo-6', title: 'Gözleme', description: 'El açması yufka, peynir veya patates seçenekli', price_cents: 6000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm6-3', seller_id: 'demo-6', title: 'Menemen', description: 'Domates, biber ve yumurta, tereyağında pişirilmiş', price_cents: 5500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
};

// ─── Info Chip Component ──────────────────────────────────────────────────────

function InfoChip({ icon, label, accent }: { icon: string; label: string; accent?: boolean }) {
  return (
    <View style={[st.chip, accent && st.chipAccent]}>
      <Text style={st.chipIcon}>{icon}</Text>
      <Text style={[st.chipLabel, accent && st.chipLabelAccent]}>{label}</Text>
    </View>
  );
}

// ─── Menu Item Card ───────────────────────────────────────────────────────────

function MenuCard({
  item,
  emoji,
  qty,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  item: MenuItem;
  emoji: string;
  qty: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  return (
    <View style={[st.menuCard, !item.is_available && st.menuCardDisabled]}>
      {/* Sol: emoji + bilgi */}
      <View style={st.menuLeft}>
        <View style={st.menuEmoji}>
          <Text style={st.menuEmojiText}>{emoji}</Text>
        </View>
      </View>

      {/* Orta: bilgi */}
      <View style={st.menuCenter}>
        <Text style={st.menuTitle}>{item.title}</Text>
        {item.description ? (
          <Text style={st.menuDesc} numberOfLines={2}>{item.description}</Text>
        ) : null}
        <Text style={st.menuPrice}>{priceTL(item.price_cents)}</Text>
      </View>

      {/* Sağ: sepet kontrol */}
      <View style={st.menuRight}>
        {!item.is_available ? (
          <View style={st.soldOut}>
            <Text style={st.soldOutText}>Tükendi</Text>
          </View>
        ) : qty === 0 ? (
          <Pressable style={st.addBtn} onPress={onAdd}>
            <Text style={st.addBtnPlus}>+</Text>
          </Pressable>
        ) : (
          <View style={st.qtyControl}>
            <Pressable style={st.qtyBtn} onPress={onDecrement} hitSlop={8}>
              <Text style={st.qtyBtnText}>−</Text>
            </Pressable>
            <Text style={st.qtyNum}>{qty}</Text>
            <Pressable style={[st.qtyBtn, st.qtyBtnAdd]} onPress={onIncrement} hitSlop={8}>
              <Text style={[st.qtyBtnText, st.qtyBtnAddText]}>+</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SellerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const {
    sellerId: cartSellerId,
    items: cartItems,
    totalItems,
    totalCents,
    addItem,
    forceAdd,
    incrementItem,
    decrementItem,
  } = useCart();
  const { addRecent } = useRecentlyViewed();

  const [seller, setSeller] = useState<(Seller & { deliveryTime: string; minOrder: number }) | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFav, setIsFav] = useState(false);
  const [showHours, setShowHours] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!id) return;
    setSeller(DEMO_SELLERS[id] ?? null);
    setMenuItems(DEMO_MENUS[id] ?? []);
    setLoading(false);
    addRecent(id);
    // Load fav state
    AsyncStorage.getItem(FAV_STORAGE_KEY).then((raw) => {
      if (raw) {
        try { setIsFav(JSON.parse(raw).includes(id)); } catch {}
      }
    });
  }, [id, addRecent]);

  const toggleFav = useCallback(() => {
    const next = !isFav;
    setIsFav(next);
    // Animate heart
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, friction: 3, tension: 200, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
    // Persist
    AsyncStorage.getItem(FAV_STORAGE_KEY).then((raw) => {
      let favs: string[] = [];
      if (raw) { try { favs = JSON.parse(raw); } catch {} }
      if (next) { favs = [id!, ...favs.filter((x) => x !== id)]; }
      else { favs = favs.filter((x) => x !== id); }
      AsyncStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(favs)).catch(() => {});
    });
  }, [id, isFav, heartScale]);

  const handleAdd = useCallback(
    (item: MenuItem) => {
      const ok = addItem(id!, {
        menuItemId: item.id,
        title: item.title,
        priceCents: item.price_cents,
      });
      if (!ok) {
        Alert.alert(
          'Sepeti Temizle?',
          'Sepetinizde başka bir satıcıdan ürün var. Devam etmek için sepet temizlenecek.',
          [
            { text: 'İptal', style: 'cancel' },
            {
              text: 'Temizle ve Ekle',
              style: 'destructive',
              onPress: () =>
                forceAdd(id!, {
                  menuItemId: item.id,
                  title: item.title,
                  priceCents: item.price_cents,
                }),
            },
          ],
        );
      }
    },
    [id, addItem, forceAdd],
  );

  const fromThisSeller = cartSellerId === id;

  // Sticky header opacity
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 140, 180],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  if (loading) {
    return (
      <View style={st.loadingWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!seller) {
    return (
      <SafeAreaView style={st.safe} edges={['top']}>
        <View style={st.errorWrap}>
          <Text style={st.errorEmoji}>😕</Text>
          <Text style={st.errorTitle}>Satıcı bulunamadı</Text>
          <Pressable style={st.errorBtn} onPress={() => router.back()}>
            <Text style={st.errorBtnText}>← Geri dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const avatar = SELLER_AVATARS[id!] ?? { emoji: '🍽️', bg: '#FFF3E0' };
  const hasCart = fromThisSeller && totalItems > 0;

  return (
    <View style={st.safe}>
      {/* ═══ Sticky Header (scroll'da görünür) ═══ */}
      <Animated.View style={[st.stickyHeader, { opacity: headerOpacity }]}>
        <SafeAreaView edges={['top']} style={st.stickyInner}>
          <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Text style={st.backIcon}>‹</Text>
          </Pressable>
          <Text style={st.stickyTitle} numberOfLines={1}>{seller.display_name}</Text>
          <View style={st.stickyRating}>
            <Text style={st.stickyRatingStar}>★</Text>
            <Text style={st.stickyRatingNum}>{Number(seller.rating_avg).toFixed(1)}</Text>
          </View>
        </SafeAreaView>
      </Animated.View>

      {/* ═══ Floating back & fav button (hero üstünde) ═══ */}
      <SafeAreaView edges={['top']} style={st.floatingBackWrap}>
        <View style={st.floatingRow}>
          <Pressable style={st.floatingBtn} onPress={() => router.back()} hitSlop={12}>
            <Text style={st.floatingBtnIcon}>‹</Text>
          </Pressable>
          <Pressable style={st.floatingBtn} onPress={toggleFav} hitSlop={12}>
            <Animated.Text style={[st.floatingFavIcon, { transform: [{ scale: heartScale }] }]}>
              {isFav ? '❤️' : '🤍'}
            </Animated.Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[st.scroll, hasCart && { paddingBottom: 110 }]}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
      >
        {/* ═══ HERO COVER ═══ */}
        <View style={[st.heroCover, { backgroundColor: avatar.bg }]}>
          <Text style={st.heroEmoji}>{avatar.emoji}</Text>
          {/* Gradient overlay alttan */}
          <View style={st.heroGradient} />
        </View>

        {/* ═══ SELLER INFO ═══ */}
        <View style={st.infoSection}>
          <Text style={st.sellerName}>{seller.display_name}</Text>

          {/* Rating bar */}
          <View style={st.ratingRow}>
            <View style={st.ratingBadge}>
              <Text style={st.ratingStarBig}>★</Text>
              <Text style={st.ratingNumBig}>{Number(seller.rating_avg).toFixed(1)}</Text>
            </View>
            <Text style={st.ratingCountText}>{seller.rating_count} değerlendirme</Text>
            <View style={st.ratingDivider} />
            <Text style={st.verifiedText}>✓ Onaylı Mutfak</Text>
          </View>

          {seller.bio ? (
            <Text style={st.sellerBio}>{seller.bio}</Text>
          ) : null}

          {/* Info chips — Yemeksepeti tarzı */}
          <View style={st.chipsRow}>
            <InfoChip icon="🕐" label={`${seller.deliveryTime} dk`} />
            <InfoChip icon="💰" label={`Min ${priceTL(seller.minOrder)}`} />
            <InfoChip icon="📍" label={seller.district ?? seller.city ?? ''} />
            <InfoChip icon="🟢" label="Açık" accent />
          </View>
        </View>

        {/* ═══ MENÜ ═══ */}
        <View style={st.menuSection}>
          <View style={st.menuHeader}>
            <Text style={st.menuHeading}>Menü</Text>
            <Text style={st.menuCount}>{menuItems.length} ürün</Text>
          </View>

          {menuItems.length === 0 ? (
            <View style={st.emptyMenu}>
              <Text style={st.emptyEmoji}>🍽️</Text>
              <Text style={st.emptyText}>Şu an aktif ürün bulunmuyor</Text>
            </View>
          ) : (
            <View style={st.menuList}>
              {menuItems.map((item) => {
                const cartItem = fromThisSeller
                  ? cartItems.find((ci) => ci.menuItemId === item.id)
                  : undefined;
                const qty = cartItem?.quantity ?? 0;
                const emoji = ITEM_EMOJIS[item.id] ?? '🍽️';

                return (
                  <MenuCard
                    key={item.id}
                    item={item}
                    emoji={emoji}
                    qty={qty}
                    onAdd={() => handleAdd(item)}
                    onIncrement={() => incrementItem(item.id)}
                    onDecrement={() => decrementItem(item.id)}
                  />
                );
              })}
            </View>
          )}
        </View>

        {/* ═══ ÇALIŞMA SAATLERİ ═══ */}
        {WORKING_HOURS[id!] && (
          <View style={st.hoursSection}>
            <Pressable style={st.hoursTitleRow} onPress={() => setShowHours(!showHours)}>
              <Text style={st.hoursHeading}>🕐 Çalışma Saatleri</Text>
              <Text style={st.hoursToggle}>{showHours ? '▲' : '▼'}</Text>
            </Pressable>
            {showHours && (
              <View style={st.hoursCard}>
                {WORKING_HOURS[id!].map((wh, idx) => {
                  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
                  const isToday = idx === todayIdx;
                  return (
                    <View key={wh.day} style={[st.hoursRow, isToday && st.hoursRowToday]}>
                      <Text style={[st.hoursDay, isToday && st.hoursDayToday]}>{wh.day}</Text>
                      <Text style={[st.hoursTime, !wh.open && st.hoursTimeClosed, isToday && st.hoursTimeToday]}>
                        {wh.hours}
                      </Text>
                      {isToday && <View style={st.hoursTodayDot} />}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ═══ SATICI BİLGİLERİ ═══ */}
        <View style={st.aboutSection}>
          <Text style={st.aboutHeading}>Satıcı Hakkında</Text>
          <View style={st.aboutCard}>
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>📍 Konum</Text>
              <Text style={st.aboutValue}>
                {[seller.address_line, seller.district, seller.city].filter(Boolean).join(', ')}
              </Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>🕐 Teslimat</Text>
              <Text style={st.aboutValue}>{seller.deliveryTime} dakika</Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>💰 Min. Sipariş</Text>
              <Text style={st.aboutValue}>{priceTL(seller.minOrder)}</Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>⭐ Puan</Text>
              <Text style={st.aboutValue}>
                {Number(seller.rating_avg).toFixed(1)} ({seller.rating_count} yorum)
              </Text>
            </View>
          </View>
        </View>
      </Animated.ScrollView>

      {/* ═══ CART BAR ═══ */}
      {hasCart && (
        <View style={st.cartBar}>
          <SafeAreaView edges={['bottom']} style={st.cartBarInner}>
            <View style={st.cartBarLeft}>
              <View style={st.cartBadge}>
                <Text style={st.cartBadgeText}>{totalItems}</Text>
              </View>
              <View>
                <Text style={st.cartBarLabel}>Sepeti Görüntüle</Text>
                <Text style={st.cartBarPrice}>{priceTL(totalCents)}</Text>
              </View>
            </View>
            <Pressable
              style={st.cartBarBtn}
              onPress={() => router.push('/(customer)/cart')}
            >
              <Text style={st.cartBarBtnText}>Sepete Git →</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAFAFA' },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  errorEmoji: { fontSize: 52 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#1A1208' },
  errorBtn: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  errorBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  scroll: { paddingBottom: 32 },

  // ── Sticky Header
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  stickyInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  stickyTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#1A1208' },
  stickyRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stickyRatingStar: { fontSize: 14, color: '#EF9F27' },
  stickyRatingNum: { fontSize: 14, fontWeight: '700', color: '#1A1208' },

  // ── Floating buttons
  floatingBackWrap: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 5,
  },
  floatingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  floatingBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  floatingBtnIcon: { fontSize: 24, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  floatingFavIcon: { fontSize: 20, marginTop: 1 },

  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },

  // ── Hero Cover
  heroCover: {
    height: 200,
    width: SCREEN_W,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  heroEmoji: { fontSize: 72 },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'transparent',
  },

  // ── Info Section
  infoSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE6',
  },
  sellerName: { fontSize: 24, fontWeight: '800', color: '#1A1208', marginBottom: 8 },

  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  ratingStarBig: { fontSize: 14, color: '#EF9F27' },
  ratingNumBig: { fontSize: 14, fontWeight: '800', color: '#1A1208' },
  ratingCountText: { fontSize: 13, color: '#8A7E72' },
  ratingDivider: { width: 1, height: 14, backgroundColor: '#E8E2DA' },
  verifiedText: { fontSize: 13, color: '#2E7D32', fontWeight: '600' },

  sellerBio: { fontSize: 14, color: '#6B5E50', lineHeight: 20, marginBottom: 14 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F7F3EE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  chipAccent: { backgroundColor: '#E8F5E9' },
  chipIcon: { fontSize: 13 },
  chipLabel: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  chipLabelAccent: { color: '#2E7D32' },

  // ── Menu Section
  menuSection: { paddingTop: 20, paddingHorizontal: 16 },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  menuHeading: { fontSize: 20, fontWeight: '800', color: '#1A1208' },
  menuCount: { fontSize: 13, color: '#A89A8A', fontWeight: '500' },
  menuList: { gap: 10 },

  // ── Menu Card
  menuCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  menuCardDisabled: { opacity: 0.5 },
  menuLeft: {},
  menuEmoji: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  menuEmojiText: { fontSize: 28 },
  menuCenter: { flex: 1, gap: 3 },
  menuTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  menuDesc: { fontSize: 12, color: '#8A7E72', lineHeight: 17 },
  menuPrice: { fontSize: 16, fontWeight: '800', color: colors.primary, marginTop: 2 },
  menuRight: { alignItems: 'flex-end', flexShrink: 0 },

  // ── Add / Qty controls
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  addBtnPlus: { fontSize: 22, fontWeight: '700', color: '#fff', marginTop: -1 },
  soldOut: {
    backgroundColor: '#F5F0EA',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  soldOutText: { fontSize: 11, fontWeight: '600', color: '#A89A8A' },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F3EE',
    borderRadius: 12,
    gap: 4,
    padding: 4,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  qtyBtnAdd: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: '#1A1208', lineHeight: 20 },
  qtyBtnAddText: { color: '#fff' },
  qtyNum: { fontSize: 15, fontWeight: '800', color: '#1A1208', minWidth: 24, textAlign: 'center' },

  // ── Empty
  emptyMenu: { alignItems: 'center', paddingVertical: 48 },
  emptyEmoji: { fontSize: 48 },
  emptyText: { fontSize: 14, color: '#A89A8A', marginTop: 12 },

  // ── About Section
  aboutSection: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 16 },
  aboutHeading: { fontSize: 18, fontWeight: '800', color: '#1A1208', marginBottom: 12 },
  aboutCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  aboutLabel: { fontSize: 13, color: '#8A7E72' },
  aboutValue: { fontSize: 13, fontWeight: '600', color: '#1A1208', textAlign: 'right', maxWidth: '55%' },
  aboutDivider: { height: 1, backgroundColor: '#F5F0EA' },

  // ── Cart Bar
  cartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F0ECE6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  cartBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  cartBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  cartBarLabel: { fontSize: 12, color: '#8A7E72', fontWeight: '500' },
  cartBarPrice: { fontSize: 17, fontWeight: '800', color: '#1A1208' },
  cartBarBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  cartBarBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── Working Hours
  hoursSection: { paddingHorizontal: 16, paddingTop: 24 },
  hoursTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  hoursHeading: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  hoursToggle: { fontSize: 14, color: '#A89A8A' },
  hoursCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    gap: 2,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  hoursRowToday: { backgroundColor: '#FFF5F2' },
  hoursDay: { fontSize: 13, fontWeight: '600', color: '#6B5E50', width: 90 },
  hoursDayToday: { color: colors.primary, fontWeight: '800' },
  hoursTime: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  hoursTimeClosed: { color: '#C62828' },
  hoursTimeToday: { color: colors.primary, fontWeight: '800' },
  hoursTodayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginLeft: 8,
  },
});
