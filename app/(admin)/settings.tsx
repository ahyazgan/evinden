import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { COMMISSION_TIERS, DELIVERY_CONFIG } from '@/constants/business';

export default function AdminSettingsScreen() {
  const { signOut, profile } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    signOut();
    router.replace('/(auth)/login' as any);
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Ayarlar</Text>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Hesap</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="person-circle-outline" size={22} color="#6B5E50" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>{profile?.name ?? 'Admin'}</Text>
              <Text style={st.rowSub}>Admin hesabı</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Komisyon Oranları</Text>
        <View style={st.card}>
          {COMMISSION_TIERS.map((tier, i) => (
            <View key={i} style={[st.row, i < COMMISSION_TIERS.length - 1 && st.rowBorder]}>
              <View style={[st.tierDot, { backgroundColor: tier.id === 'new' ? '#4CAF50' : tier.id === 'pro' ? '#FF9800' : '#2196F3' }]} />
              <View style={st.rowInfo}>
                <Text style={st.rowLabel}>{tier.label}</Text>
                <Text style={st.rowSub}>{tier.description}</Text>
              </View>
              <Text style={st.tierRate}>%{tier.rate}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Teslimat</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="bicycle-outline" size={22} color="#6B5E50" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Teslimat Modeli</Text>
              <Text style={st.rowSub}>{DELIVERY_CONFIG.model === 'seller_courier' ? 'Esnaf Kurye' : 'Platform Kurye'}</Text>
            </View>
          </View>
          <View style={[st.row, st.rowBorder]}>
            <Ionicons name="navigate-outline" size={22} color="#6B5E50" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Maks. Mesafe</Text>
              <Text style={st.rowSub}>{DELIVERY_CONFIG.maxDeliveryRadiusKm} km</Text>
            </View>
          </View>
          <View style={[st.row, st.rowBorder]}>
            <Ionicons name="cash-outline" size={22} color="#6B5E50" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Varsayılan Ücret</Text>
              <Text style={st.rowSub}>₺{(DELIVERY_CONFIG.defaultDeliveryFeeCents / 100).toFixed(0)}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={st.section}>
        <Text style={st.sectionTitle}>Uygulama</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Ionicons name="information-circle-outline" size={22} color="#6B5E50" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Versiyon</Text>
              <Text style={st.rowSub}>1.0.0</Text>
            </View>
          </View>
          <Pressable style={[st.row, st.rowBorder]} onPress={() => router.push('/(customer)/privacy' as any)}>
            <Ionicons name="shield-checkmark-outline" size={22} color="#6B5E50" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Gizlilik Politikasi</Text>
              <Text style={st.rowSub}>KVKK ve veri koruma</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A89A8A" />
          </Pressable>
          <Pressable style={[st.row, st.rowBorder]} onPress={() => router.push('/(customer)/terms' as any)}>
            <Ionicons name="document-text-outline" size={22} color="#6B5E50" />
            <View style={st.rowInfo}>
              <Text style={st.rowLabel}>Kullanim Kosullari</Text>
              <Text style={st.rowSub}>Hizmet sartlari</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A89A8A" />
          </Pressable>
        </View>
      </View>

      <View style={st.logoutSection}>
        <Pressable style={st.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#C62828" />
          <Text style={st.logoutText}>Çıkış Yap</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EDE8E2' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#1A1208' },
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#A89A8A', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#EDE8E2', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F5F0EA' },
  rowInfo: { flex: 1, gap: 1 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: '#1A1208' },
  rowSub: { fontSize: 12, color: '#A89A8A' },
  tierDot: { width: 10, height: 10, borderRadius: 5 },
  tierRate: { fontSize: 16, fontWeight: '800', color: colors.primary },
  logoutSection: { paddingHorizontal: 16, marginTop: 32 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFEBEE', paddingVertical: 14, borderRadius: 14 },
  logoutText: { fontSize: 15, fontWeight: '700', color: '#C62828' },
});
