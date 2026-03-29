import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { useTheme, type ThemeMode } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';

type ProfileMenuItem = { icon: string; label: string; sub?: string; onPress?: () => void; danger?: boolean };

export default function ProfileScreen() {
  const { session, profile, signOut, approveSellerDemo } = useAuth();
  const { mode, setMode, colors: t } = useTheme();
  const router = useRouter();
  const isLoggedIn = !!session;
  const isSeller = profile?.role === 'seller';
  const sellerApp = profile?.seller_application ?? 'none';

  const initial = profile?.name?.charAt(0).toUpperCase() ?? '?';

  const accountItems: ProfileMenuItem[] = isLoggedIn
    ? [
        { icon: '📦', label: 'Siparişlerim', sub: '3 sipariş', onPress: () => router.push('/(customer)/orders' as any) },
        { icon: '❤️', label: 'Favorilerim', sub: '3 satıcı', onPress: () => router.push('/(customer)/favorites' as any) },
        { icon: '📍', label: 'Adreslerim', sub: 'Kayıtlı adreslerinizi yönetin', onPress: () => router.push('/(customer)/addresses' as any) },
        { icon: '🔔', label: 'Bildirimler', onPress: () => router.push('/(customer)/notifications' as any) },
        { icon: '🎁', label: 'Sadakat Programı', sub: 'Puan kazan, ödül al', onPress: () => router.push('/(customer)/loyalty' as any) },
        { icon: '👥', label: 'Arkadaşını Davet Et', sub: '₺15 indirim kazanın', onPress: () => router.push('/(customer)/loyalty' as any) },
      ]
    : [];

  const supportItems: ProfileMenuItem[] = [
    { icon: '❓', label: 'Yardım & SSS' },
    { icon: '💬', label: 'Bize Ulaşın' },
    { icon: '⭐', label: 'Uygulamayı Değerlendir' },
  ];

  const themeLabel = mode === 'light' ? 'Açık Tema' : mode === 'dark' ? 'Koyu Tema' : 'Sistem';
  const cycleTheme = () => {
    const next: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = next.indexOf(mode);
    setMode(next[(idx + 1) % next.length]);
  };

  const appItems: ProfileMenuItem[] = [
    { icon: '🌙', label: 'Tema', sub: themeLabel, onPress: cycleTheme },
    { icon: '🔒', label: 'Gizlilik Politikası' },
    { icon: '📋', label: 'Kullanım Şartları' },
    ...(isLoggedIn
      ? [{
          icon: '🚪',
          label: 'Çıkış Yap',
          danger: true,
          onPress: () =>
            Alert.alert('Çıkış Yap', 'Hesabınızdan çıkış yapmak istediğinize emin misiniz?', [
              { text: 'İptal', style: 'cancel' },
              { text: 'Çıkış Yap', style: 'destructive', onPress: () => signOut() },
            ]),
        }]
      : []),
  ];

  const menuSections: { title: string; items: ProfileMenuItem[] }[] = [
    ...(accountItems.length > 0 ? [{ title: 'Hesabım', items: accountItems }] : []),
    { title: 'Destek', items: supportItems },
    { title: 'Uygulama', items: appItems },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: t.text }]}>Profil</Text>
        </View>

        {/* --- GUEST STATE --- */}
        {!isLoggedIn ? (
          <View style={[styles.guestCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <View style={[styles.guestAvatarCircle, { backgroundColor: t.background, borderColor: t.surfaceBorder }]}>
              <Text style={styles.guestAvatarText}>👤</Text>
            </View>
            <Text style={[styles.guestTitle, { color: t.text }]}>Hoş Geldiniz!</Text>
            <Text style={[styles.guestSub, { color: t.textMuted }]}>
              Sipariş vermek, favorilere eklemek ve daha fazlası için giriş yapın.
            </Text>
            <Pressable style={styles.loginBtn} onPress={() => router.push('/(auth)/login' as any)}>
              <Text style={styles.loginBtnText}>Giriş Yap</Text>
            </Pressable>
            <Pressable style={styles.registerBtn} onPress={() => router.push('/(auth)/register' as any)}>
              <Text style={styles.registerBtnText}>Hesap Oluştur</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* --- LOGGED IN --- */}
            <View style={[styles.userCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
              <View style={styles.avatarWrap}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={styles.avatarBadge}>
                  <Text style={styles.avatarBadgeText}>✓</Text>
                </View>
              </View>
              <View style={styles.userInfo}>
                <Text style={[styles.userName, { color: t.text }]}>{profile?.name ?? 'Kullanıcı'}</Text>
                <Text style={[styles.userSub, { color: t.textMuted }]}>
                  {isSeller ? 'Satıcı' : 'Müşteri'} · Kadıköy, İstanbul
                </Text>
              </View>
              <Pressable style={[styles.editBtn, { borderColor: t.surfaceBorder }]} onPress={() => router.push('/(customer)/profile-edit' as any)}>
                <Text style={[styles.editBtnText, { color: t.textSecondary }]}>Düzenle</Text>
              </Pressable>
            </View>

            {/* Sadakat Kartı */}
            <View style={styles.loyaltyCard}>
              <View style={styles.loyaltyLeft}>
                <Text style={styles.loyaltyIcon}>🏆</Text>
                <View>
                  <Text style={styles.loyaltyTitle}>245 Puan</Text>
                  <Text style={styles.loyaltySub}>Bronz Üye</Text>
                </View>
              </View>
              <Text style={styles.loyaltyReward}>100 puana ₺10 İndirim!</Text>
            </View>

            {/* Satıcı paneli / başvuru durumu */}
            {isSeller ? (
              <Pressable
                style={styles.sellerBanner}
                onPress={() => router.push('/(seller)/dashboard' as any)}
              >
                <View style={styles.sellerBannerLeft}>
                  <Text style={styles.sellerBannerEmoji}>🧑‍🍳</Text>
                  <View>
                    <Text style={styles.sellerBannerTitle}>Satıcı Panelim</Text>
                    <Text style={styles.sellerBannerSub}>Menü ve siparişlerini yönet</Text>
                  </View>
                </View>
                <Text style={styles.sellerBannerArrow}>›</Text>
              </Pressable>
            ) : sellerApp === 'pending' ? (
              <View style={styles.pendingBanner}>
                <View style={styles.sellerBannerLeft}>
                  <Text style={styles.sellerBannerEmoji}>⏳</Text>
                  <View>
                    <Text style={styles.pendingTitle}>Başvurunuz İnceleniyor</Text>
                    <Text style={styles.pendingSub}>
                      {profile?.seller_store_name ?? 'Mağazanız'} için başvurunuz alındı
                    </Text>
                  </View>
                </View>
                {/* Demo: hızlı onay butonu */}
                <Pressable
                  style={styles.demoApproveBtn}
                  onPress={() => Alert.alert(
                    'Demo Onay',
                    'Başvuruyu hemen onaylamak ister misiniz? (Gerçekte admin tarafından yapılır)',
                    [
                      { text: 'İptal', style: 'cancel' },
                      { text: 'Onayla', onPress: () => approveSellerDemo() },
                    ],
                  )}
                >
                  <Text style={styles.demoApproveBtnText}>Demo Onayla</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.beSellerBanner}
                onPress={() => router.push('/(customer)/seller-apply' as any)}
              >
                <View style={styles.sellerBannerLeft}>
                  <Text style={styles.sellerBannerEmoji}>🍽️</Text>
                  <View>
                    <Text style={styles.beSellerTitle}>Sen de Satıcı Ol!</Text>
                    <Text style={styles.beSellerSub}>Ev yemeklerini satmaya başla</Text>
                  </View>
                </View>
                <Text style={styles.beSellerArrow}>›</Text>
              </Pressable>
            )}
          </>
        )}

        {/* Menu sections */}
        {menuSections.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: t.textMuted }]}>{section.title}</Text>
            <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
              {section.items.map((item, idx) => (
                <Pressable
                  key={item.label}
                  style={[
                    styles.menuRow,
                    idx < section.items.length - 1 && [styles.menuRowBorder, { borderBottomColor: t.divider }],
                  ]}
                  onPress={item.onPress}
                >
                  <View style={[styles.menuIcon, { backgroundColor: t.inputBg }]}>
                    <Text style={styles.menuIconText}>{item.icon}</Text>
                  </View>
                  <View style={styles.menuLabel}>
                    <Text style={[styles.menuLabelText, { color: t.text }, item.danger && { color: '#C62828' }]}>{item.label}</Text>
                    {item.sub ? <Text style={[styles.menuSub, { color: t.textMuted }]}>{item.sub}</Text> : null}
                  </View>
                  <Text style={[styles.menuArrow, { color: t.textMuted }]}>›</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {/* Version */}
        <Text style={styles.version}>evinden v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  scroll: { paddingBottom: 40 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: fonts.extrabold },

  /* Guest state */
  guestCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 28,
    alignItems: 'center',
    marginBottom: 24,
  },
  guestAvatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#EDE8E2',
  },
  guestAvatarText: { fontSize: 32 },
  guestTitle: { fontSize: 20, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208', marginBottom: 6 },
  guestSub: { fontSize: 13, color: '#A89A8A', textAlign: 'center', lineHeight: 19, marginBottom: 20, paddingHorizontal: 10 },
  loginBtn: {
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  loginBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  registerBtn: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
  },
  registerBtnText: { fontSize: 15, fontWeight: '700', color: '#1A1208' },

  /* User card */
  userCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 24, fontWeight: '700', color: '#fff' },
  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#3DBE7A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarBadgeText: { fontSize: 9, fontWeight: '900', color: '#fff' },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '800', fontFamily: fonts.extrabold, color: '#1A1208', marginBottom: 2 },
  userSub: { fontSize: 12, color: '#A89A8A' },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  editBtnText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },

  /* Loyalty */
  loyaltyCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#FFF8E1',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  loyaltyLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  loyaltyIcon: { fontSize: 24 },
  loyaltyTitle: { fontSize: 16, fontWeight: '800', color: '#F57F17' },
  loyaltySub: { fontSize: 12, color: '#F9A825', fontWeight: '600' },
  loyaltyReward: { fontSize: 11, color: '#F57F17', fontWeight: '700', backgroundColor: '#FFFDF6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },

  /* Seller banner */
  sellerBanner: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: '#1A1208',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sellerBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sellerBannerEmoji: { fontSize: 30 },
  sellerBannerTitle: { fontSize: 15, fontWeight: '800', color: '#fff', marginBottom: 2 },
  sellerBannerSub: { fontSize: 12, color: '#A89A8A' },
  sellerBannerArrow: { fontSize: 22, color: colors.primary, fontWeight: '700' },

  /* Be a seller banner (for buyers) */
  beSellerBanner: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: '#FFF8E1',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  beSellerTitle: { fontSize: 15, fontWeight: '800', color: '#1A1208', marginBottom: 2 },
  beSellerSub: { fontSize: 12, color: '#A89A8A' },
  beSellerArrow: { fontSize: 22, color: '#F57F17', fontWeight: '700' },

  pendingBanner: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: '#FFF8E1',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFE082',
    gap: 12,
  },
  pendingTitle: { fontSize: 15, fontWeight: '800', color: '#F57F17', marginBottom: 2 },
  pendingSub: { fontSize: 12, color: '#A89A8A' },
  demoApproveBtn: {
    backgroundColor: '#1A1208',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  demoApproveBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  /* Sections */
  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A89A8A',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F5F0EA' },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconText: { fontSize: 17 },
  menuLabel: { flex: 1 },
  menuLabelText: { fontSize: 14, fontWeight: '600', color: '#1A1208' },
  menuSub: { fontSize: 11, color: '#A89A8A', marginTop: 1 },
  menuArrow: { fontSize: 18, color: '#C4B8AA', fontWeight: '600' },

  version: { textAlign: 'center', fontSize: 12, color: '#C4B8AA', marginTop: 8 },
});
