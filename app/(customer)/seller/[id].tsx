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
import { supabase } from '@/lib/supabase';
import type { MenuItem, Seller } from '@/types';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

const IS_DEMO = !process.env.EXPO_PUBLIC_SUPABASE_URL;

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
    { id: 'm4-2', seller_id: 'demo-4', title: 'Kurabiye Kutusu', description: '12 adet karışık el yapımı kurabiye: tereyağlı, badamli, fıstıklı.', price_cents: 15000, currency: 'TRY', image_url: null, is_available: true, created_at: '', updated_at: '' },
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

  const fetchData = useCallback(async () => {
    if (!id) return;
    if (IS_DEMO) {
      setSeller(DEMO_SELLERS[id] ?? null);
      setMenuItems(DEMO_MENUS[id] ?? []);
      return;
    }
    const [{ data: sellerData }, { data: menuData }] = await Promise.all([
      supabase.from('sellers').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('menu_items')
        .select('*')
        .eq('seller_id', id)
        .eq('is_available', true)
        .order('created_at'),
    ]);
    setSeller(sellerData as Seller | null);
    setMenuItems((menuData as MenuItem[]) ?? []);
  }, [id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Nav */}
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.navBack}>← Geri</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Satıcı başlık */}
        <View style={styles.sellerCard}>
          <Text style={styles.sellerName}>{seller.display_name}</Text>
          {seller.bio ? <Text style={styles.sellerBio}>{seller.bio}</Text> : null}
          <View style={styles.sellerMeta}>
            {seller.city || seller.district ? (
              <Text style={styles.metaChip}>
                📍 {[seller.district, seller.city].filter(Boolean).join(', ')}
              </Text>
            ) : null}
            {seller.rating_count > 0 ? (
              <Text style={styles.metaChip}>
                ★ {Number(seller.rating_avg).toFixed(1)} ({seller.rating_count} değerlendirme)
              </Text>
            ) : null}
          </View>
        </View>

        {/* Menü */}
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

            return (
              <View key={item.id} style={styles.menuItem}>
                <View style={styles.menuItemInfo}>
                  <Text style={styles.menuItemTitle}>{item.title}</Text>
                  {item.description ? (
                    <Text style={styles.menuItemDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                  <Text style={styles.menuItemPrice}>{priceTL(item.price_cents)}</Text>
                </View>

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

        {/* alt boşluk sepet bar için */}
        {fromThisSeller && totalItems > 0 ? <View style={{ height: 80 }} /> : null}
      </ScrollView>

      {/* Sepet Bar */}
      {fromThisSeller && totalItems > 0 ? (
        <View style={styles.cartBar}>
          <Text style={styles.cartBarInfo}>
            {totalItems} ürün · {priceTL(totalCents)}
          </Text>
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
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 16, color: '#666', textAlign: 'center' },
  backLink: { marginTop: 16 },
  backLinkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },

  nav: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBE3',
    backgroundColor: colors.background,
  },
  navBack: { fontSize: 15, fontWeight: '600', color: colors.primary },

  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },

  sellerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#F0EBE3',
  },
  sellerName: { fontSize: 22, fontWeight: '800', color: colors.secondary, marginBottom: 6 },
  sellerBio: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 10 },
  sellerMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaChip: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    color: '#666',
    borderWidth: 1,
    borderColor: '#E8E4DD',
  },

  menuHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.secondary,
    marginBottom: 12,
  },

  menuItem: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F0EBE3',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuItemInfo: { flex: 1 },
  menuItemTitle: { fontSize: 15, fontWeight: '700', color: colors.secondary, marginBottom: 3 },
  menuItemDesc: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 4 },
  menuItemPrice: { fontSize: 15, fontWeight: '800', color: colors.primary },

  qtyWrap: { alignItems: 'flex-end' },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: colors.secondary },
  qtyNum: { fontSize: 16, fontWeight: '800', color: colors.secondary, minWidth: 20, textAlign: 'center' },

  emptyMenu: { alignItems: 'center', paddingVertical: 40 },
  emptyMenuEmoji: { fontSize: 48, lineHeight: 56 },
  emptyMenuText: { fontSize: 15, color: '#888', marginTop: 10 },

  cartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    paddingBottom: 24,
  },
  cartBarInfo: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cartBarBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  cartBarBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
