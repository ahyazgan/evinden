import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import type { Order, OrderStatus, Seller } from '@/types';

type RecentOrder = Pick<Order, 'id' | 'status' | 'total_cents' | 'created_at'> & {
  order_items: { quantity: number; title_snapshot: string }[];
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Bekliyor',
  accepted: 'Kabul Edildi',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  out_for_delivery: 'Yolda',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal',
};

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// ─── Mağaza Kurulum Formu ────────────────────────────────────────────────────

function SetupForm({
  defaultName,
  onComplete,
}: {
  defaultName: string;
  onComplete: (seller: Seller) => void;
}) {
  const { profile } = useAuth();
  const [displayName, setDisplayName] = useState(defaultName);
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!profile) return;
    if (!displayName.trim()) {
      Alert.alert('Mağaza adı gerekli', 'Lütfen mağaza adı girin.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('sellers')
      .insert({
        user_id: profile.id,
        display_name: displayName.trim(),
        city: city.trim() || null,
        district: district.trim() || null,
        bio: bio.trim() || null,
        is_active: true,
      })
      .select()
      .single();
    setLoading(false);
    if (error) {
      Alert.alert('Hata', error.message);
      return;
    }
    onComplete(data as Seller);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.setupEmoji}>🧑‍🍳</Text>
        <Text style={styles.setupTitle}>Mağazanı Kur</Text>
        <Text style={styles.setupSub}>
          Müşterilerin seni keşfedebilmesi için birkaç bilgi gir.
        </Text>

        <Text style={styles.label}>Mağaza Adı *</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Örn: Ayşe'nin Ev Yemekleri"
          placeholderTextColor="#AAAAAA"
          editable={!loading}
        />

        <Text style={[styles.label, { marginTop: 14 }]}>Şehir</Text>
        <TextInput
          style={styles.input}
          value={city}
          onChangeText={setCity}
          placeholder="İstanbul"
          placeholderTextColor="#AAAAAA"
          editable={!loading}
        />

        <Text style={[styles.label, { marginTop: 14 }]}>İlçe</Text>
        <TextInput
          style={styles.input}
          value={district}
          onChangeText={setDistrict}
          placeholder="Kadıköy"
          placeholderTextColor="#AAAAAA"
          editable={!loading}
        />

        <Text style={[styles.label, { marginTop: 14 }]}>Hakkında (isteğe bağlı)</Text>
        <TextInput
          style={[styles.input, styles.inputMulti]}
          value={bio}
          onChangeText={setBio}
          placeholder="Taze ve ev yapımı yemekler sunuyorum..."
          placeholderTextColor="#AAAAAA"
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          editable={!loading}
        />

        <Pressable
          style={[styles.primaryBtn, loading && styles.btnDisabled]}
          onPress={submit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Mağazamı Oluştur</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Dashboard İçeriği ───────────────────────────────────────────────────────

export default function SellerDashboardScreen() {
  const { profile } = useAuth();
  const [sellerProfile, setSellerProfile] = useState<Seller | null | undefined>(undefined);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [stats, setStats] = useState({ todayCount: 0, todayRevenue: 0, pendingCount: 0 });
  const [ordersLoading, setOrdersLoading] = useState(false);

  const loadSeller = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('sellers')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle();
    setSellerProfile((data as Seller) ?? null);
  }, [profile]);

  const loadOrders = useCallback(async (sp: Seller) => {
    setOrdersLoading(true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from('orders')
      .select('id, status, total_cents, created_at, order_items(quantity, title_snapshot)')
      .eq('seller_id', sp.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const orders = (data as RecentOrder[]) ?? [];
    setRecentOrders(orders);

    const todayOrders = orders.filter(
      o => new Date(o.created_at) >= today && o.status !== 'cancelled',
    );
    setStats({
      todayCount: todayOrders.length,
      todayRevenue: todayOrders.reduce((s, o) => s + o.total_cents, 0),
      pendingCount: orders.filter(o => o.status === 'pending').length,
    });
    setOrdersLoading(false);
  }, []);

  useEffect(() => {
    loadSeller();
  }, [loadSeller]);

  useEffect(() => {
    if (sellerProfile) loadOrders(sellerProfile);
  }, [sellerProfile, loadOrders]);

  const signOut = () => supabase.auth.signOut();

  if (sellerProfile === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (sellerProfile === null) {
    return (
      <SetupForm
        defaultName={profile?.name ?? ''}
        onComplete={(s) => setSellerProfile(s)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Başlık */}
        <View style={styles.topRow}>
          <View>
            <Text style={styles.logo}>evinden</Text>
            <Text style={styles.greeting}>
              Merhaba, {profile?.name?.split(' ')[0] ?? 'Satıcı'} 👋
            </Text>
          </View>
          <Pressable onPress={signOut}>
            <Text style={styles.signOutText}>Çıkış</Text>
          </Pressable>
        </View>

        {/* Mağaza adı */}
        <View style={styles.storeCard}>
          <Text style={styles.storeName}>{sellerProfile.display_name}</Text>
          {sellerProfile.city || sellerProfile.district ? (
            <Text style={styles.storeLoc}>
              📍 {[sellerProfile.district, sellerProfile.city].filter(Boolean).join(', ')}
            </Text>
          ) : null}
        </View>

        {/* İstatistikler */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: '#FFF5E8' }]}>
            <Text style={styles.statNum}>{stats.pendingCount}</Text>
            <Text style={styles.statLabel}>Bekleyen</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
            <Text style={styles.statNum}>{stats.todayCount}</Text>
            <Text style={styles.statLabel}>Bugün Sipariş</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#E3F2FD' }]}>
            <Text style={styles.statNum}>{priceTL(stats.todayRevenue)}</Text>
            <Text style={styles.statLabel}>Bugün Gelir</Text>
          </View>
        </View>

        {/* Son siparişler */}
        <Text style={styles.sectionTitle}>Son Siparişler</Text>

        {ordersLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : recentOrders.length === 0 ? (
          <View style={styles.noOrders}>
            <Text style={styles.noOrdersText}>Henüz sipariş yok. 🎯</Text>
            <Text style={styles.noOrdersSub}>
              Menüne ürün ekleyince siparişler burada görünecek.
            </Text>
          </View>
        ) : (
          recentOrders.slice(0, 8).map(order => (
            <View key={order.id} style={styles.orderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderItems} numberOfLines={1}>
                  {order.order_items.map(i => `${i.quantity}× ${i.title_snapshot}`).join(', ')}
                </Text>
                <Text style={styles.orderDate}>
                  {new Date(order.created_at).toLocaleDateString('tr-TR', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={styles.orderTotal}>{priceTL(order.total_cents)}</Text>
                <Text style={styles.orderStatus}>{STATUS_LABEL[order.status]}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 20, paddingBottom: 32 },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  logo: { fontSize: 22, fontWeight: '900', color: colors.primary, letterSpacing: -0.5 },
  greeting: { fontSize: 13, color: '#777', marginTop: 2 },
  signOutText: { fontSize: 13, color: '#999', fontWeight: '600', paddingTop: 4 },

  storeCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F0EBE3',
  },
  storeName: { fontSize: 18, fontWeight: '800', color: colors.secondary, marginBottom: 4 },
  storeLoc: { fontSize: 13, color: '#888' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statNum: { fontSize: 18, fontWeight: '800', color: colors.secondary },
  statLabel: { fontSize: 10, color: '#777', marginTop: 2, textAlign: 'center' },

  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  orderRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F0EBE3',
    alignItems: 'center',
    gap: 8,
  },
  orderItems: { fontSize: 13, fontWeight: '600', color: colors.secondary, marginBottom: 3 },
  orderDate: { fontSize: 11, color: '#999' },
  orderTotal: { fontSize: 14, fontWeight: '800', color: colors.primary },
  orderStatus: { fontSize: 11, color: '#888' },

  noOrders: { alignItems: 'center', paddingVertical: 32 },
  noOrdersText: { fontSize: 16, fontWeight: '700', color: colors.secondary },
  noOrdersSub: { fontSize: 13, color: '#888', marginTop: 6, textAlign: 'center' },

  // Setup form
  setupEmoji: { fontSize: 56, lineHeight: 64, textAlign: 'center', marginBottom: 12 },
  setupTitle: { fontSize: 24, fontWeight: '800', color: colors.secondary, textAlign: 'center', marginBottom: 8 },
  setupSub: { fontSize: 14, color: '#777', textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  label: { fontSize: 13, fontWeight: '600', color: colors.secondary, marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E4DD',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.secondary,
  },
  inputMulti: { height: 80, paddingTop: 12 },
  primaryBtn: {
    marginTop: 28,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
