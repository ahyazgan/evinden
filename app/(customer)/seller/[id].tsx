import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors } from '@/constants/theme';
import { useCart } from '@/lib/cart-context';
import type { MenuItem, Seller } from '@/types';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

const SELLER_EMOJIS: Record<string, string> = {
  'demo-1': '🍲',
  'demo-2': '🥗',
  'demo-3': '🐟',
  'demo-4': '🎂',
  'demo-5': '🥩',
};

const SELLER_BG: Record<string, string> = {
  'demo-1': '#FFF3E0',
  'demo-2': '#E8F5E9',
  'demo-3': '#E3F2FD',
  'demo-4': '#FCE4EC',
  'demo-5': '#FBE9E7',
};

const ITEM_EMOJIS: Record<string, string> = {
  'm1-1': '🍜', 'm1-2': '🍚', 'm1-3': '🍖', 'm1-4': '🥗',
  'm2-1': '🥬', 'm2-2': '🥐', 'm2-3': '🌿',
  'm3-1': '🐟', 'm3-2': '🧀', 'm3-3': '🌽', 'm3-4': '🍵',
  'm4-1': '🎂', 'm4-2': '🍪', 'm4-3': '🍮',
  'm5-1': '🥩', 'm5-2': '🍗', 'm5-3': '🍽️',
};

const DEMO_SELLERS: Record<string, Seller> = {
  'demo-1': { id: 'demo-1', user_id: 'u1', display_name: "Ayşe'nin Ev Yemekleri", bio: 'Her gün taze pişirilen geleneksel Türk yemekleri.', city: 'İstanbul', district: 'Kadıköy', address_line: null, latitude: null, longitude: null, rating_avg: 4.8, rating_count: 124, is_active: true, created_at: '', updated_at: '' },
  'demo-2': { id: 'demo-2', user_id: 'u2', display_name: 'Fatma Hanım Mutfağı', bio: 'Ege usulü zeytinyağlı yemekler ve taze börekler.', city: 'İzmir', district: 'Bornova', address_line: null, latitude: null, longitude: null, rating_avg: 4.6, rating_count: 87, is_active: true, created_at: '', updated_at: '' },
  'demo-3': { id: 'demo-3', user_id: 'u3', display_name: 'Mehmet Usta Karadeniz Lezzetleri', bio: 'Karadeniz mutfağının eşsiz tatları: mısır ekmeği, hamsi tava, kuymak.', city: 'İstanbul', district: 'Üsküdar', address_line: null, latitude: null, longitude: null, rating_avg: 4.9, rating_count: 203, is_active: true, created_at: '', updated_at: '' },
  'demo-4': { id: 'demo-4', user_id: 'u4', display_name: 'Zeynep Pasta & Tatlı', bio: 'El yapımı pastalar, kurabiyeler ve geleneksel tatlılar.', city: 'Ankara', district: 'Çankaya', address_line: null, latitude: null, longitude: null, rating_avg: 4.7, rating_count: 56, is_active: true, created_at: '', updated_at: '' },
  'demo-5': { id: 'demo-5', user_id: 'u5', display_name: 'Hüseyin Bey Izgara', bio: 'Mangalda pişirilen köfteler, tavuk şiş ve sebze ızgara.', city: 'Bursa', district: 'Nilüfer', address_line: null, latitude: null, longitude: null, rating_avg: 4.5, rating_count: 41, is_active: true, created_at: '', updated_at: '' },
};

const DEMO_MENUS: Record<string, MenuItem[]> = {
  'demo-1': [
    { id: 'm1-1', seller_id: 'demo-1', title: 'Mercimek Çorbası', description: 'Günlük taze pişirilen kırmızı mercimek çorbası, limon ve nane ile servis edilir.', price_cents: 4500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm1-2', seller_id: 'demo-1', title: 'Kuru Fasulye + Pilav', description: 'Geleneksel tarif ile pişirilmiş kuru fasulye, yanında tereyağlı pirinç pilavı.', price_cents: 8000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm1-3', seller_id: 'demo-1', title: 'İzmir Köfte', description: 'Domates soslu fırın köfte, patates ve biber ile.', price_cents: 9500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm1-4', seller_id: 'demo-1', title: 'Karışık Salata', description: 'Mevsim yeşillikleri, domates, salatalık, zeytin.', price_cents: 3500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-2': [
    { id: 'm2-1', seller_id: 'demo-2', title: 'Zeytinyağlı Enginar', description: 'Taze enginar, havuç ve bezelye ile pişirilmiş, soğuk servis.', price_cents: 7000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm2-2', seller_id: 'demo-2', title: 'Ispanaklı Börek', description: 'İnce yufkadan el açması börek, lor peyniri ve ıspanak ile.', price_cents: 6500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm2-3', seller_id: 'demo-2', title: 'Zeytinyağlı Dolma', description: 'Fısıklı ve kuş üzümlü zeytinyağlı yaprak sarma.', price_cents: 7500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-3': [
    { id: 'm3-1', seller_id: 'demo-3', title: 'Hamsi Tava', description: 'Taze hamsi, mısır ununda kızartılmış, yanında mısır ekmeği.', price_cents: 11000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm3-2', seller_id: 'demo-3', title: 'Kuymak', description: 'Karadeniz usulü mısır unu ve kaşar peyniri ile yapılan muhlama.', price_cents: 8500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm3-3', seller_id: 'demo-3', title: 'Mısır Ekmeği', description: 'Günlük pişirilmiş taze mısır ekmeği (2 adet).', price_cents: 3000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm3-4', seller_id: 'demo-3', title: 'Karalahana Çorbası', description: 'Geleneksel Karadeniz karalahana çorbası, mısır unu ile koyulaştırılmış.', price_cents: 5000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-4': [
    { id: 'm4-1', seller_id: 'demo-4', title: 'Çikolatalı Yaş Pasta', description: 'Bitter çikolata ganajlı, 6 kişilik. Önceden sipariş veriniz.', price_cents: 35000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm4-2', seller_id: 'demo-4', title: 'Kurabiye Kutusu', description: '12 adet karışık el yapımı kurabiye: tereyağlı, badamlı, fıstıklı.', price_cents: 15000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm4-3', seller_id: 'demo-4', title: 'Sütlaç', description: 'Fırında pişirilmiş geleneksel sütlaç, 2 kişilik.', price_cents: 8000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
  'demo-5': [
    { id: 'm5-1', seller_id: 'demo-5', title: 'Izgara Köfte (5 Adet)', description: 'El yapımı dana köfte, mangalda pişirilmiş, yanında ekmek ve sos.', price_cents: 12000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm5-2', seller_id: 'demo-5', title: 'Tavuk Şiş', description: '3 şiş marine edilmiş tavuk göğsü, yanında pilav ve salata.', price_cents: 13500, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
    { id: 'm5-3', seller_id: 'demo-5', title: 'Karışık Izgara Tabağı', description: 'Köfte, tavuk şiş ve kanat, yanında közlenmiş sebze.', price_cents: 18000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
  ],
};

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

  const [seller, setSeller] = useState<Seller | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setSeller(DEMO_SELLERS[id] ?? null);
    setMenuItems(DEMO_MENUS[id] ?? []);
    setLoading(false);
  }, [id]);

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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!seller) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Satıcı bulunamadı.</Text>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>← Geri dön</Text>
        </Pressable>
      </View>
    );
  }

  const sellerEmoji = SELLER_EMOJIS[id!] ?? '🍽️';
  const sellerBg = SELLER_BG[id!] ?? '#FFF3E0';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Nav bar */}
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.navBackBtn}>
          <Text style={styles.navBackIcon}>←</Text>
        </Pressable>
        <Text style={styles.navTitle} numberOfLines={1}>{seller.display_name}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, fromThisSeller && totalItems > 0 && { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero card */}
        <View style={styles.heroCard}>
          <View style={[styles.heroEmoji, { backgroundColor: sellerBg }]}>
            <Text style={styles.heroEmojiText}>{sellerEmoji}</Text>
          </View>
          <View style={styles.heroInfo}>
            <Text style={styles.heroName}>{seller.display_name}</Text>
            {seller.bio ? (
              <Text style={styles.heroBio} numberOfLines={2}>{seller.bio}</Text>
            ) : null}
            <View style={styles.heroMeta}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>✓ Onaylı Mutfak</Text>
              </View>
              {seller.rating_count > 0 ? (
                <View style={styles.ratingChip}>
                  <Text style={styles.ratingText}>⭐ {Number(seller.rating_avg).toFixed(1)}</Text>
                  <Text style={styles.ratingCount}> ({seller.rating_count})</Text>
                </View>
              ) : null}
            </View>
            {(seller.city || seller.district) ? (
              <Text style={styles.location}>
                📍 {[seller.district, seller.city].filter(Boolean).join(', ')}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Menu heading */}
        <Text style={styles.menuHeading}>Menü</Text>

        {menuItems.length === 0 ? (
          <View style={styles.emptyMenu}>
            <Text style={styles.emptyMenuEmoji}>🍽️</Text>
            <Text style={styles.emptyMenuText}>Şu an aktif ürün bulunmuyor.</Text>
          </View>
        ) : (
          menuItems.map(item => {
            const cartItem = fromThisSeller
              ? cartItems.find(ci => ci.menuItemId === item.id)
              : undefined;
            const qty = cartItem?.quantity ?? 0;
            const itemEmoji = ITEM_EMOJIS[item.id] ?? '🍽️';

            return (
              <View key={item.id} style={styles.menuItem}>
                {/* Food emoji icon */}
                <View style={styles.itemIcon}>
                  <Text style={styles.itemIconText}>{itemEmoji}</Text>
                </View>

                {/* Item info */}
                <View style={styles.itemInfo}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  {item.description ? (
                    <Text style={styles.itemDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                  <Text style={styles.itemPrice}>{priceTL(item.price_cents)}</Text>
                </View>

                {/* Add / qty control */}
                <View style={styles.qtyWrap}>
                  {qty === 0 ? (
                    <Pressable style={styles.addBtn} onPress={() => handleAdd(item)}>
                      <Text style={styles.addBtnText}>+ Ekle</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.qtyRow}>
                      <Pressable
                        style={styles.qtyBtn}
                        onPress={() => decrementItem(item.id)}
                        hitSlop={8}
                      >
                        <Text style={styles.qtyBtnText}>−</Text>
                      </Pressable>
                      <Text style={styles.qtyNum}>{qty}</Text>
                      <Pressable
                        style={styles.qtyBtn}
                        onPress={() => incrementItem(item.id)}
                        hitSlop={8}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Cart bar */}
      {fromThisSeller && totalItems > 0 ? (
        <View style={styles.cartBar}>
          <View style={styles.cartBarLeft}>
            <Text style={styles.cartBarCount}>{totalItems} ürün</Text>
            <Text style={styles.cartBarPrice}>{priceTL(totalCents)}</Text>
          </View>
          <Pressable
            style={styles.cartBarBtn}
            onPress={() => router.push('/(customer)/cart')}
          >
            <Text style={styles.cartBarBtnText}>Sepete Git →</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#FAF7F2' },
  errorText: { fontSize: 16, color: '#888', textAlign: 'center' },
  backLink: { marginTop: 16 },
  backLinkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },

  // Nav
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
    backgroundColor: '#FAF7F2',
  },
  navBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDE8E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBackIcon: { fontSize: 16, color: '#1A1208' },
  navTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#1A1208', marginHorizontal: 8 },

  scroll: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 32 },

  // Hero card
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  heroEmoji: {
    width: 72,
    height: 72,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  heroEmojiText: { fontSize: 36 },
  heroInfo: { flex: 1, gap: 4 },
  heroName: { fontSize: 17, fontWeight: '800', color: '#1A1208', fontFamily: 'serif', lineHeight: 22 },
  heroBio: { fontSize: 13, color: '#A89A8A', lineHeight: 18 },
  heroMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#388E3C' },
  ratingChip: {
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: { fontSize: 11, fontWeight: '700', color: '#F57F17' },
  ratingCount: { fontSize: 11, color: '#A89A8A' },
  location: { fontSize: 12, color: '#A89A8A', marginTop: 2 },

  // Menu
  menuHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A1208',
    fontFamily: 'serif',
    marginBottom: 14,
    marginLeft: 2,
  },

  menuItem: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  itemIconText: { fontSize: 24 },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 14, fontWeight: '700', color: '#1A1208', marginBottom: 2 },
  itemDesc: { fontSize: 12, color: '#A89A8A', lineHeight: 17, marginBottom: 5 },
  itemPrice: { fontSize: 15, fontWeight: '800', color: colors.primary },

  qtyWrap: { alignItems: 'flex-end', flexShrink: 0 },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F5F0EA',
    borderWidth: 1,
    borderColor: '#EDE8E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 17, fontWeight: '700', color: '#1A1208', lineHeight: 20 },
  qtyNum: { fontSize: 15, fontWeight: '800', color: '#1A1208', minWidth: 18, textAlign: 'center' },

  emptyMenu: { alignItems: 'center', paddingVertical: 48 },
  emptyMenuEmoji: { fontSize: 48 },
  emptyMenuText: { fontSize: 14, color: '#A89A8A', marginTop: 12 },

  // Cart bar
  cartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#EDE8E2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    paddingBottom: 24,
  },
  cartBarLeft: { gap: 2 },
  cartBarCount: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },
  cartBarPrice: { fontSize: 16, fontWeight: '800', color: '#1A1208' },
  cartBarBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  cartBarBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
