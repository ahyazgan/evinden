import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import {
  adminAnswerSupportTicket,
  adminCloseSupportTicket,
  adminFetchSupportTickets,
  type AdminSupportTicket,
  type SupportCategory,
  type SupportStatus,
} from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

const TABS: { key: SupportStatus; label: string }[] = [
  { key: 'open', label: 'Bekleyen' },
  { key: 'answered', label: 'Yanıtlanan' },
  { key: 'closed', label: 'Kapanan' },
];

const CATEGORY_LABEL: Record<SupportCategory, string> = {
  order: 'Sipariş',
  payment: 'Ödeme',
  account: 'Hesap',
  seller: 'Satıcı',
  other: 'Diğer',
};

export default function AdminSupportScreen() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<SupportStatus>('open');
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setTickets(await adminFetchSupportTickets(tab));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const answer = async (ticket: AdminSupportTicket) => {
    const reply = (drafts[ticket.id] ?? '').trim();
    if (!reply) {
      Alert.alert('Yanıt boş', 'Göndermeden önce yanıtını yaz.');
      return;
    }
    setBusy(ticket.id);
    try {
      await adminAnswerSupportTicket(ticket.id, reply);
      setDrafts(d => ({ ...d, [ticket.id]: '' }));
      await load();
    } catch (e: any) {
      Alert.alert('Gönderilemedi', e?.message ?? 'Tekrar dene.');
    } finally {
      setBusy(null);
    }
  };

  const close = async (ticket: AdminSupportTicket) => {
    setBusy(ticket.id);
    try {
      await adminCloseSupportTicket(ticket.id);
      await load();
    } catch (e: any) {
      Alert.alert('Kapatılamadı', e?.message ?? 'Tekrar dene.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <TopBar title="Destek talepleri" back />
      <View style={s.tabs}>
        {TABS.map(item => {
          const on = tab === item.key;
          return (
            <Pressable
              key={item.key}
              style={[s.chip, { backgroundColor: on ? t.brand : t.surface }]}
              hitSlop={2}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.chipText, { color: on ? t.onBrand : t.text }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={s.center}><LogoLoader /></View>
      ) : failed ? (
        <View style={s.center}>
          <Text style={[s.emptyText, { color: t.textSecondary }]}>Talepler açılamadı.</Text>
          <Button label="Tekrar dene" onPress={load} />
        </View>
      ) : tickets.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="checkmark-circle-outline" size={44} color={t.textMuted} />
          <Text style={[s.emptyText, { color: t.textSecondary }]}>Burada talep yok.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {tickets.map(ticket => (
            <View key={ticket.id} style={[s.card, { backgroundColor: t.surface }]}>
              <View style={s.head}>
                <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{ticket.user_name || 'Kullanıcı'}</Text>
                <Text style={[s.meta, { color: t.textSecondary }]}>
                  {CATEGORY_LABEL[ticket.category]} · {new Date(ticket.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              {ticket.order_id ? (
                <Pressable style={s.orderLink} onPress={() => router.push('/yonetim/orders' as any)} accessibilityRole="link">
                  <Ionicons name="receipt-outline" size={14} color={t.textSecondary} />
                  <Text style={[s.meta, { color: t.textSecondary }]}>Sipariş #{ticket.order_id.slice(0, 8).toUpperCase()}</Text>
                </Pressable>
              ) : null}
              <Text style={[s.message, { color: t.text }]}>{ticket.message}</Text>
              {ticket.reply ? (
                <View style={[s.reply, { backgroundColor: t.background }]}>
                  <Text style={[s.replyLabel, { color: t.textSecondary }]}>Yanıtın</Text>
                  <Text style={[s.message, { color: t.text }]}>{ticket.reply}</Text>
                </View>
              ) : null}
              {ticket.status !== 'closed' ? (
                <>
                  <TextInput
                    style={[s.input, { borderColor: t.surfaceBorder, color: t.text }]}
                    value={drafts[ticket.id] ?? ''}
                    onChangeText={v => setDrafts(d => ({ ...d, [ticket.id]: v }))}
                    placeholder={ticket.reply ? 'Yeni yanıt yaz' : 'Yanıtını yaz'}
                    placeholderTextColor={t.textMuted}
                    multiline
                    textAlignVertical="top"
                    accessibilityLabel="Yanıt"
                  />
                  <View style={s.actions}>
                    <View style={s.flex}>
                      <Button label="Kapat" variant="outline" fullWidth disabled={busy === ticket.id} onPress={() => close(ticket)} />
                    </View>
                    <View style={s.flex}>
                      <Button label="Yanıtla" fullWidth loading={busy === ticket.id} onPress={() => answer(ticket)} />
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, textAlign: 'center' },
  list: { padding: 16, gap: 10 },
  card: { borderRadius: 16, padding: 14, gap: 10 },
  head: { gap: 2 },
  name: { fontSize: 15, fontFamily: fonts.bold },
  meta: { fontSize: 12, fontFamily: fonts.medium },
  orderLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  message: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  reply: { borderRadius: 12, padding: 12, gap: 2 },
  replyLabel: { fontSize: 12, fontFamily: fonts.bold },
  input: { minHeight: 80, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  actions: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
