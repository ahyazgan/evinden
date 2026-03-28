import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

const CAMPAIGNS: Record<string, {
  title: string;
  subtitle: string;
  code: string;
  emoji: string;
  color: string;
  description: string;
  conditions: string[];
  validUntil: string;
}> = {
  b1: {
    title: 'İlk Siparişe %20 İndirim',
    subtitle: 'Yeni kullanıcılara özel',
    code: 'EVINDEN20',
    emoji: '🎉',
    color: '#E8593C',
    description:
      'Evinden\'e hoş geldiniz! İlk siparişinizde %20 indirim kazanın. Geçerli tüm satıcılardaki yemekler için kullanabilirsiniz.',
    conditions: [
      'Yalnızca ilk siparişte geçerlidir',
      'Minimum sipariş tutarı: ₺50,00',
      'Maksimum indirim: ₺30,00',
      'Diğer kampanyalarla birleştirilemez',
    ],
    validUntil: '30 Nisan 2026',
  },
  b2: {
    title: 'Ücretsiz Teslimat',
    subtitle: '₺150 üzeri siparişlerde',
    code: 'UCRETSIZ150',
    emoji: '🚀',
    color: '#2E7D32',
    description:
      '₺150 ve üzeri siparişlerinizde teslimat ücreti bizden! Sınırlı süre için geçerli.',
    conditions: [
      'Minimum sipariş tutarı: ₺150,00',
      'Tüm satıcılarda geçerlidir',
      'Günlük 1 kez kullanılabilir',
    ],
    validUntil: '15 Nisan 2026',
  },
  b3: {
    title: 'Hafta Sonu Lezzetleri',
    subtitle: 'Özel ev yapımı menüler',
    code: 'HAFTASONU10',
    emoji: '🧑‍🍳',
    color: '#1565C0',
    description:
      'Cumartesi ve Pazar günleri tüm siparişlerinizde %10 indirim! Hafta sonu özel menüleri deneyin.',
    conditions: [
      'Yalnızca Cumartesi ve Pazar günleri geçerlidir',
      'Minimum sipariş tutarı: ₺75,00',
      'Tüm satıcılarda geçerlidir',
    ],
    validUntil: '31 Mart 2026',
  },
};

export default function CampaignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const campaign = id ? CAMPAIGNS[id] : null;

  const handleCopy = async () => {
    if (!campaign) return;
    try {
      await Clipboard.setStringAsync(campaign.code);
    } catch {
      // Clipboard not available on all platforms
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!campaign) {
    return (
      <SafeAreaView style={st.safe} edges={['top']}>
        <View style={st.navBar}>
          <Pressable style={st.navBack} onPress={() => router.back()} hitSlop={12}>
            <Text style={st.navBackIcon}>‹</Text>
          </Pressable>
          <Text style={st.navTitle}>Kampanya</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={st.emptyWrap}>
          <Text style={st.emptyEmoji}>😕</Text>
          <Text style={st.emptyTitle}>Kampanya bulunamadı</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Nav */}
      <View style={st.navBar}>
        <Pressable style={st.navBack} onPress={() => router.back()} hitSlop={12}>
          <Text style={st.navBackIcon}>‹</Text>
        </Pressable>
        <Text style={st.navTitle}>Kampanya Detayı</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={[st.heroBanner, { backgroundColor: campaign.color }]}>
          <Text style={st.heroEmoji}>{campaign.emoji}</Text>
          <Text style={st.heroTitle}>{campaign.title}</Text>
          <Text style={st.heroSub}>{campaign.subtitle}</Text>
        </View>

        {/* Kod kutusu */}
        <View style={st.codeCard}>
          <Text style={st.codeLabel}>Promosyon Kodu</Text>
          <View style={st.codeRow}>
            <View style={st.codeBadge}>
              <Text style={st.codeText}>{campaign.code}</Text>
            </View>
            <Pressable style={[st.copyBtn, copied && st.copyBtnDone]} onPress={handleCopy}>
              <Text style={[st.copyBtnText, copied && st.copyBtnTextDone]}>
                {copied ? '✓ Kopyalandı' : 'Kopyala'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Açıklama */}
        <View style={st.sectionCard}>
          <Text style={st.sectionTitle}>📋 Kampanya Hakkında</Text>
          <Text style={st.description}>{campaign.description}</Text>
        </View>

        {/* Koşullar */}
        <View style={st.sectionCard}>
          <Text style={st.sectionTitle}>📌 Koşullar</Text>
          {campaign.conditions.map((c, i) => (
            <View key={i} style={st.condRow}>
              <Text style={st.condBullet}>•</Text>
              <Text style={st.condText}>{c}</Text>
            </View>
          ))}
        </View>

        {/* Geçerlilik */}
        <View style={st.validCard}>
          <Text style={st.validIcon}>📅</Text>
          <Text style={st.validText}>Son geçerlilik: {campaign.validUntil}</Text>
        </View>

        {/* CTA */}
        <Pressable style={st.ctaBtn} onPress={() => router.push('/(customer)')}>
          <Text style={st.ctaBtnText}>Siparişe Başla →</Text>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F2ED' },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F0ECE6',
  },
  navBack: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  navBackIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  navTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },

  scroll: { padding: 16, paddingBottom: 20 },

  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },

  heroBanner: {
    borderRadius: 20, padding: 28, alignItems: 'center', gap: 10, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 6,
  },
  heroEmoji: { fontSize: 56 },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#fff', textAlign: 'center' },
  heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },

  codeCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#F0ECE6',
  },
  codeLabel: { fontSize: 12, color: '#8A7E72', fontWeight: '600', marginBottom: 10 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeBadge: {
    flex: 1, backgroundColor: '#FAF7F2', borderRadius: 12, padding: 14,
    borderWidth: 1.5, borderColor: '#EDE8E2', borderStyle: 'dashed',
  },
  codeText: { fontSize: 18, fontWeight: '900', color: '#1A1208', textAlign: 'center', letterSpacing: 2 },
  copyBtn: {
    backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
  },
  copyBtnDone: { backgroundColor: '#2E7D32' },
  copyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  copyBtnTextDone: { color: '#fff' },

  sectionCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#F0ECE6',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208', marginBottom: 10 },
  description: { fontSize: 14, color: '#6B5E50', lineHeight: 22 },
  condRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  condBullet: { fontSize: 14, color: colors.primary, fontWeight: '700', marginTop: 1 },
  condText: { flex: 1, fontSize: 13, color: '#6B5E50', lineHeight: 19 },

  validCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF8E1', borderRadius: 12, padding: 12, marginBottom: 20,
  },
  validIcon: { fontSize: 16 },
  validText: { fontSize: 13, color: '#F57F17', fontWeight: '600' },

  ctaBtn: {
    backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 14, alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  ctaBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
