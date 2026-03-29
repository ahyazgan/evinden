import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

type MenuItem = { icon: string; label: string; sub?: string; onPress?: () => void; danger?: boolean };

export default function ProfileScreen() {
  const { session, profile, signOut } = useAuth();
  const router = useRouter();
  const isLoggedIn = !!session;
  const isSeller = profile?.role === 'seller';

  const initial = profile?.name?.charAt(0).toUpperCase() ?? '?';

  const accountItems: MenuItem[] = isLoggedIn
    ? [
        { icon: '📦', label: 'Siparişlerim', sub: '3 sipariş', onPress: () => router.push('/(customer)/orders' as any) },
        { icon: '❤️', label: 'Favorilerim', sub: '3 satıcı', onPress: () => router.push('/(customer)/favorites' as any) },
        { icon: '📍', label: 'Adreslerim', sub: 'Kayıtlı adreslerinizi yönetin', onPress: () => router.push('/(customer)/addresses' as any) },
        { icon: '🔔', label: 'Bildirimler', onPress: () => router.push('/(customer)/notifications' as any) },
      ]
    : [];

  const supportItems: MenuItem[] = [
    { icon: '❓', label: 'Yardım & SSS' },
    { icon: '💬', label: 'Bize Ulaşın' },
    { icon: '⭐', label: 'Uygulamayı Değerlendir' },
  ];

  const appItems: MenuItem[] = [
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

  const menuSections: { title: string; items: MenuItem[] }[] = [
    ...(accountItems.length > 0 ? [{ title: 'Hesabım', items: accountItems }] : []),
    { title: 'Destek', items: supportItems },
    { title: 'Uygulama', items: appItems },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profil</Text>
        </View>

        {/* --- GUEST STATE --- */}
        {!isLoggedIn ? (
          <View style={styles.guestCard}>
            <View style={styles.guestAvatarCircle}>
              <Text style={styles.guestAvatarText}>👤</Text>
            </View>
            <Text style={styles.guestTitle}>Hoş Geldiniz!</Text>
            <Text style={styles.guestSub}>
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
            <View style={styles.userCard}>
              <View style={styles.avatarWrap}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={styles.avatarBadge}>
                  <Text style={styles.avatarBadgeText}>✓</Text>
                </View>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{profile?.name ?? 'Kullanıcı'}</Text>
                <Text style={styles.userSub}>
                  {isSeller ? 'Satıcı' : 'Müşteri'} · Kadıköy, İstanbul
                </Text>
              </View>
              <Pressable style={styles.editBtn}>
                <Text style={styles.editBtnText}>Düzenle</Text>
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

            {/* Satıcı paneli — sadece seller rolü */}
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
            ) : (
              <Pressable
                style={styles.beSellerBanner}
                onPress={() => router.push('/(auth)/register' as any)}
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
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.sectionCard}>
              {section.items.map((item, idx) => (
                <Pressable
                  key={item.label}
                  style={[
                    styles.menuRow,
                    idx < section.items.length - 1 && styles.menuRowBorder,
                  ]}
                  onPress={item.onPress}
                >
                  <View style={styles.menuIcon}>
                    <Text style={styles.menuIconText}>{item.icon}</Text>
                  </View>
                  <View style={styles.menuLabel}>
                    <Text style={[styles.menuLabelText, item.danger && { color: '#C62828' }]}>{item.label}</Text>
                    {item.sub ? <Text style={styles.menuSub}>{item.sub}</Text> : null}
                  </View>
                  <Text style={styles.menuArrow}>›</Text>
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
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },

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
  guestTitle: { fontSize: 20, fontWeight: '800', color: '#1A1208', marginBottom: 6 },
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
  userName: { fontSize: 16, fontWeight: '800', color: '#1A1208', marginBottom: 2 },
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
