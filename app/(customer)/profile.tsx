import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme, type ThemeMode } from '@/lib/theme-context';
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';

export default function ProfileScreen() {
  const { session, profile, signOut, approveSellerDemo } = useAuth();
  const { mode, setMode, colors: t } = useTheme();
  const router = useRouter();
  const isLoggedIn = !!session;
  const isSeller = profile?.role === 'seller';
  const sellerApp = profile?.seller_application ?? 'none';
  const initial = profile?.name?.charAt(0).toUpperCase() ?? '?';

  const cycleTheme = () => {
    const next: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = next.indexOf(mode);
    setMode(next[(idx + 1) % next.length]);
  };

  const themeLabel = mode === 'light' ? 'Acik Tema' : mode === 'dark' ? 'Koyu Tema' : 'Sistem';


  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <Text style={[styles.headerTitle, { color: t.text }]}>Profil</Text>

        {/* GUEST */}
        {!isLoggedIn ? (
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>👤</Text>
            <Text style={[styles.cardTitle, { color: t.text }]}>Hos Geldiniz!</Text>
            <Text style={[styles.cardSub, { color: t.textMuted }]}>Giris yapin veya hesap olusturun.</Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.push('/(auth)/login' as any)}>
              <Text style={styles.primaryBtnText}>Giris Yap</Text>
            </Pressable>
            <Pressable style={[styles.secondaryBtn, { borderColor: t.surfaceBorder }]} onPress={() => router.push('/(auth)/register' as any)}>
              <Text style={[styles.secondaryBtnText, { color: t.text }]}>Hesap Olustur</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* USER CARD */}
            <View style={[styles.userCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.userName, { color: t.text }]}>{profile?.name ?? 'Kullanici'}</Text>
                <Text style={[styles.userRole, { color: t.textMuted }]}>{isSeller ? 'Satici' : 'Musteri'}</Text>
              </View>
              <Pressable style={[styles.editBtn, { borderColor: t.surfaceBorder }]} onPress={() => router.push('/(customer)/profile-edit' as any)}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: t.textSecondary }}>Duzenle</Text>
              </Pressable>
            </View>

            {/* SELLER BANNER */}
            {isSeller ? (
              <Pressable style={styles.sellerBanner} onPress={() => router.push('/(seller)/dashboard' as any)}>
                <Text style={{ fontSize: 24 }}>🧑‍🍳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sellerBannerTitle}>Satici Panelim</Text>
                  <Text style={styles.sellerBannerSub}>Menu ve siparislerini yonet</Text>
                </View>
                <Text style={{ fontSize: 20, color: colors.primary }}>›</Text>
              </Pressable>
            ) : sellerApp === 'pending' ? (
              <View style={styles.pendingBanner}>
                <Text style={{ fontSize: 24 }}>⏳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#F57F17' }}>Basvurunuz Inceleniyor</Text>
                </View>
                <Pressable style={{ backgroundColor: '#1A1208', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }} onPress={() => approveSellerDemo()}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>Demo Onayla</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.beSellerBanner} onPress={() => router.push('/(customer)/seller-apply' as any)}>
                <Text style={{ fontSize: 24 }}>🍽️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A1208' }}>Sen de Satici Ol!</Text>
                  <Text style={{ fontSize: 12, color: '#A89A8A' }}>Ev yemeklerini satmaya basla</Text>
                </View>
                <Text style={{ fontSize: 20, color: '#F57F17' }}>›</Text>
              </Pressable>
            )}
          </>
        )}

        {/* HESABIM */}
        {isLoggedIn && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: t.textMuted }]}>HESABIM</Text>
            <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
              <MenuItem icon="📦" label="Siparislerim" onPress={() => router.push('/(customer)/orders' as any)} colors={t} />
              <MenuItem icon="❤️" label="Favorilerim" onPress={() => router.push('/(customer)/favorites' as any)} colors={t} />
              <MenuItem icon="📍" label="Adreslerim" onPress={() => router.push('/(customer)/addresses' as any)} colors={t} />
              <MenuItem icon="🔔" label="Bildirimler" onPress={() => router.push('/(customer)/notifications' as any)} colors={t} />
              <MenuItem icon="🎁" label="Sadakat Programi" onPress={() => router.push('/(customer)/loyalty' as any)} colors={t} last />
            </View>
          </View>
        )}

        {/* DESTEK */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>DESTEK</Text>
          <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <MenuItem icon="❓" label="Yardim & SSS" onPress={() => Alert.alert('Yardim & SSS', 'Destek icin destek@evinden.app adresine yazabilirsiniz.')} colors={t} />
            <MenuItem icon="💬" label="Bize Ulasin" onPress={() => Linking.openURL('mailto:destek@evinden.app')} colors={t} />
            <MenuItem icon="⭐" label="Uygulamayi Degerlendir" onPress={() => Alert.alert('Tesekkurler!', 'Uygulama magazaya yuklendiginde degerlendirme yapabileceksiniz.')} colors={t} last />
          </View>
        </View>

        {/* UYGULAMA */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>UYGULAMA</Text>
          <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <MenuItem icon="🌙" label="Tema" sub={themeLabel} onPress={cycleTheme} colors={t} />
            <MenuItem icon="🔒" label="Gizlilik Politikasi" onPress={() => Alert.alert('Gizlilik Politikasi', 'Kisisel verileriniz KVKK kapsaminda korunmaktadir.\n\nDetayli bilgi icin: destek@evinden.app')} colors={t} />
            <MenuItem icon="📋" label="Kullanim Sartlari" onPress={() => Alert.alert('Kullanim Sartlari', 'evinden platformunu kullanarak siparis sureclerini kabul etmis olursunuz.\n\nDetayli bilgi icin: destek@evinden.app')} colors={t} last />
          </View>
        </View>

        {/* CIKIS BUTONU */}
        {isLoggedIn && (
          <Pressable
            onPress={() => {
              signOut();
              router.replace('/(auth)/login' as any);
            }}
            style={{
              marginHorizontal: 16,
              marginTop: 8,
              marginBottom: 8,
              backgroundColor: '#C62828',
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>Cikis Yap</Text>
          </Pressable>
        )}

        <Text style={[styles.version, { color: t.textMuted }]}>evinden v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// Ayri basit component — her item kendi onPress'ini aliyor
function MenuItem({ icon, label, sub, onPress, colors: t, danger, last }: {
  icon: string; label: string; sub?: string; onPress: () => void;
  colors: any; danger?: boolean; last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        !last && { borderBottomWidth: 1, borderBottomColor: t.divider },
        pressed && { opacity: 0.5, backgroundColor: t.inputBg },
      ]}
    >
      <View style={[styles.menuIcon, { backgroundColor: t.inputBg }]}>
        <Text style={{ fontSize: 17 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuLabel, { color: danger ? '#C62828' : t.text }]}>{label}</Text>
        {sub ? <Text style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <Text style={{ fontSize: 18, color: t.textMuted }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 40 },
  headerTitle: { fontSize: 24, fontWeight: '800', fontFamily: fonts.extrabold, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },

  card: { marginHorizontal: 16, borderRadius: 20, borderWidth: 1, padding: 28, alignItems: 'center', marginBottom: 24 },
  cardTitle: { fontSize: 20, fontWeight: '800', fontFamily: fonts.extrabold, marginBottom: 6 },
  cardSub: { fontSize: 13, textAlign: 'center', marginBottom: 20 },
  primaryBtn: { width: '100%', backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  secondaryBtn: { width: '100%', borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5 },
  secondaryBtnText: { fontSize: 15, fontWeight: '700' },

  userCard: { marginHorizontal: 16, borderRadius: 18, borderWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontWeight: '700', color: '#fff' },
  userName: { fontSize: 16, fontWeight: '800', fontFamily: fonts.extrabold, marginBottom: 2 },
  userRole: { fontSize: 12 },
  editBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },

  sellerBanner: { marginHorizontal: 16, marginBottom: 20, backgroundColor: '#1A1208', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sellerBannerTitle: { fontSize: 15, fontWeight: '800', color: '#fff', marginBottom: 2 },
  sellerBannerSub: { fontSize: 12, color: '#A89A8A' },

  pendingBanner: { marginHorizontal: 16, marginBottom: 20, backgroundColor: '#FFF8E1', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#FFE082' },
  beSellerBanner: { marginHorizontal: 16, marginBottom: 20, backgroundColor: '#FFF8E1', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#FFE082' },

  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1 },

  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
  menuIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 14, fontWeight: '600' },

  version: { textAlign: 'center', fontSize: 12, marginTop: 8 },
});
