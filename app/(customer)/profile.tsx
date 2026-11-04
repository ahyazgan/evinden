import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme, type ThemeMode } from '@/lib/theme-context';
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';
import { Ionicons } from '@expo/vector-icons';
import { useDeleteAccount } from '@/lib/useDeleteAccount';
import { fetchUnreadCount } from '@/lib/messages';

export default function ProfileScreen() {
  const { session, profile, signOut, refreshProfile } = useAuth();
  const { mode, setMode, colors: t } = useTheme();
  const router = useRouter();
  const confirmDeleteAccount = useDeleteAccount();
  const isLoggedIn = !!session;
  const isSeller = profile?.role === 'seller';
  const sellerApp = profile?.seller_application ?? 'none';
  const initial = profile?.name?.charAt(0).toUpperCase() ?? '?';
  const [unreadMessages, setUnreadMessages] = useState(0);

  useFocusEffect(useCallback(() => {
    if (isLoggedIn) fetchUnreadCount('customer').then(setUnreadMessages);
  }, [isLoggedIn]));

  const cycleTheme = () => {
    const next: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = next.indexOf(mode);
    setMode(next[(idx + 1) % next.length]);
  };

  const themeLabel = mode === 'light' ? 'Açık Tema' : mode === 'dark' ? 'Koyu Tema' : 'Sistem';


  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <Text style={[styles.headerTitle, { color: t.text }]}>Profil</Text>

        {/* GUEST */}
        {!isLoggedIn ? (
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <Text style={{ fontFamily: fonts.regular, fontSize: 40, marginBottom: 12 }}>👤</Text>
            <Text style={[styles.cardTitle, { color: t.text }]}>Hoş Geldin!</Text>
            <Text style={[styles.cardSub, { color: t.textMuted }]}>Giriş yap ya da hesap oluştur.</Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.push('/(auth)/login' as any)}>
              <Text style={styles.primaryBtnText}>Giriş yap</Text>
            </Pressable>
            <Pressable style={[styles.secondaryBtn, { borderColor: t.surfaceBorder }]} onPress={() => router.push('/(auth)/register' as any)}>
              <Text style={[styles.secondaryBtnText, { color: t.text }]}>Hesap Oluştur</Text>
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
                <Text style={[styles.userName, { color: t.text }]}>{profile?.name ?? 'Kullanıcı'}</Text>
                <Text style={[styles.userRole, { color: t.textMuted }]}>{isSeller ? 'Satıcı' : 'Müşteri'}</Text>
              </View>
              <Pressable style={[styles.editBtn, { borderColor: t.surfaceBorder }]} onPress={() => router.push('/(customer)/profile-edit' as any)}>
                <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: t.textSecondary }}>Düzenle</Text>
              </Pressable>
            </View>

            {/* SELLER BANNER */}
            {isSeller ? (
              <Pressable style={styles.sellerBanner} onPress={() => router.push('/(seller)/dashboard' as any)}>
                <Text style={{ fontFamily: fonts.regular, fontSize: 24 }}>🧑‍🍳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sellerBannerTitle}>Satıcı panelim</Text>
                  <Text style={styles.sellerBannerSub}>Menü ve siparişlerini yönet</Text>
                </View>
                <Text style={{ fontFamily: fonts.regular, fontSize: 20, color: colors.primary }}>›</Text>
              </Pressable>
            ) : sellerApp === 'pending' ? (
              <View style={styles.pendingBanner}>
                <Ionicons name="hourglass-outline" size={24} color="#17402F" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: '#17402F' }}>Başvurun inceleniyor</Text>
                </View>
                <Pressable style={{ backgroundColor: '#17402F', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }} onPress={() => refreshProfile()}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.bold, color: '#fff' }}>Durumu Yenile</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.beSellerBanner} onPress={() => router.push('/(customer)/seller-apply' as any)}>
                <Ionicons name="restaurant-outline" size={24} color="#17402F" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: '#151A16' }}>Sen de mutfağını aç</Text>
                  <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' }}>Evinden'de satış yapmaya başla</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#17402F" />
              </Pressable>
            )}
          </>
        )}

        {/* HESABIM */}
        {isLoggedIn && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: t.textMuted }]}>HESABIM</Text>
            <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
              <MenuItem icon="receipt-outline" label="Siparişlerim" onPress={() => router.push('/(customer)/orders' as any)} colors={t} />
              <MenuItem icon="heart-outline" label="Favorilerim" onPress={() => router.push('/(customer)/favorites' as any)} colors={t} />
              <MenuItem icon="location-outline" label="Adreslerim" onPress={() => router.push('/(customer)/addresses' as any)} colors={t} />
              <MenuItem
                icon="chatbubble-outline"
                label="Mesajlarım"
                sub={unreadMessages > 0 ? `${unreadMessages} okunmamış` : undefined}
                onPress={() => router.push('/(customer)/messages' as any)}
                colors={t}
              />
              <MenuItem icon="notifications-outline" label="Bildirimler" onPress={() => router.push('/(customer)/notifications' as any)} colors={t} />
              <MenuItem icon="pricetag-outline" label="Kampanyalar" onPress={() => router.push('/(customer)/campaign' as any)} colors={t} />
              <MenuItem icon="gift-outline" label="Sadakat Programı" onPress={() => router.push('/(customer)/loyalty' as any)} colors={t} last />
            </View>
          </View>
        )}

        {/* DESTEK */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>DESTEK</Text>
          <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <MenuItem icon="help-circle-outline" label="Yardım & SSS" onPress={() => Alert.alert('Yardım & SSS', 'Destek için destek@evinden.app adresine yazabilirsin.')} colors={t} />
            <MenuItem icon="mail-outline" label="Bize Ulaşın" onPress={() => Linking.openURL('mailto:destek@evinden.app')} colors={t} />
            <MenuItem icon="star-outline" label="Uygulamayı Değerlendir" onPress={() => Alert.alert('Teşekkürler!', 'Uygulama mağazaya yüklendiğinde değerlendirme yapabileceksin.')} colors={t} last />
          </View>
        </View>

        {/* UYGULAMA */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>UYGULAMA</Text>
          <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <MenuItem icon="contrast-outline" label="Tema" sub={themeLabel} onPress={cycleTheme} colors={t} />
            <MenuItem icon="lock-closed-outline" label="Gizlilik Politikası" onPress={() => router.push('/(customer)/privacy' as any)} colors={t} />
            <MenuItem icon="document-text-outline" label="Kullanım Kosullari" onPress={() => router.push('/(customer)/terms' as any)} colors={t} last />
          </View>
        </View>

        {/* HESABI SIL BUTONU */}
        {isLoggedIn && (
          <Pressable
            onPress={confirmDeleteAccount}
            style={{
              marginHorizontal: 16,
              marginTop: 8,
              marginBottom: 4,
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: 'center',
              borderWidth: 1.5,
              borderColor: '#C62828',
            }}
          >
            <Text style={{ color: '#C62828', fontSize: 16, fontFamily: fonts.extrabold }}>Hesabımı Sil</Text>
          </Pressable>
        )}

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
            <Text style={{ color: '#fff', fontSize: 16, fontFamily: fonts.extrabold }}>Çıkış yap</Text>
          </Pressable>
        )}

        <Text style={[styles.version, { color: t.textMuted }]}>evinden v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// Ayri basit component — her item kendi onPress'ini aliyor
function MenuItem({ icon, label, sub, onPress, colors: t, danger, last }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; onPress: () => void;
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
      <View style={[styles.menuIcon, { backgroundColor: t.mint }]}>
        <Ionicons name={icon} size={18} color={t.heading} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuLabel, { color: danger ? '#C62828' : t.text }]}>{label}</Text>
        {sub ? <Text style={{ fontFamily: fonts.regular, fontSize: 11, color: t.textMuted, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingBottom: 40 },
  headerTitle: { fontSize: 24, fontFamily: fonts.extrabold, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },

  card: { marginHorizontal: 16, borderRadius: 20, borderWidth: 1, padding: 28, alignItems: 'center', marginBottom: 24 },
  cardTitle: { fontSize: 20, fontFamily: fonts.extrabold, marginBottom: 6 },
  cardSub: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', marginBottom: 20 },
  primaryBtn: { width: '100%', backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  primaryBtnText: { fontSize: 15, fontFamily: fonts.extrabold, color: '#fff' },
  secondaryBtn: { width: '100%', borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5 },
  secondaryBtnText: { fontSize: 15, fontFamily: fonts.bold },

  userCard: { marginHorizontal: 16, borderRadius: 18, borderWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontFamily: fonts.display, color: '#fff' },
  userName: { fontSize: 16, fontFamily: fonts.extrabold, marginBottom: 2 },
  userRole: { fontFamily: fonts.regular, fontSize: 12 },
  editBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },

  sellerBanner: { marginHorizontal: 16, marginBottom: 20, backgroundColor: '#17402F', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sellerBannerTitle: { fontSize: 15, fontFamily: fonts.extrabold, color: '#fff', marginBottom: 2 },
  sellerBannerSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },

  pendingBanner: { marginHorizontal: 16, marginBottom: 20, backgroundColor: '#E6EEDF', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  beSellerBanner: { marginHorizontal: 16, marginBottom: 20, backgroundColor: '#E6EEDF', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },

  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1 },

  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
  menuIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 14, fontFamily: fonts.semibold },

  version: { textAlign: 'center', fontFamily: fonts.regular, fontSize: 12, marginTop: 8 },
});
