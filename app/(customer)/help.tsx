import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';
import { createSupportTicket, fetchMySupportTickets, replySupportTicket, type SupportCategory, type SupportStatus, type SupportTicket } from '@/lib/db';
import { SupportThread } from '@/components/shared/SupportThread';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { LogoLoader } from '@/components/shared/Logo';

const FAQ = [
  { q: 'Siparişimi nasıl iptal ederim?', a: 'Satıcı hazırlamaya başlamadan önce sipariş ekranından iptal edebilirsin. Başladıysa satıcıya mesaj at ya da aşağıdan talep aç.' },
  { q: 'Satıcı siparişimi kabul etmezse ne olur?', a: 'Satıcı 30 dakika içinde yanıt vermezse sipariş iptal olur. İleri tarihli siparişte bu süre restoran açıkken işler. Online ödediysen ücretin iade sürecine girer.' },
  { q: 'Yemeğim eksik veya bozuk geldi', a: 'Siparişlerim ekranından o siparişi bulup iade talebi oluştur. Satıcı inceler, sonucu bildirim olarak görürsün.' },
  { q: 'Alerjen bilgisini nereden görürüm?', a: 'Ürüne dokununca açılan sayfada yazar. Bilgi girilmemişse ya da emin değilsen siparişten önce satıcıya mesaj at.' },
  { q: 'Hangi ödeme yöntemleri var?', a: 'Kapıda nakit ve kapıda kart. Restoran kabul ediyorsa kapıda yemek kartı, online ödeme açıksa kartla ödeme de sepette görünür.' },
  { q: 'Nasıl satıcı olurum?', a: 'Profil ekranında "Restoranını ekle" satırından başvur. Başvurun onaylanınca satışa başlarsın.' },
  { q: 'Hesabımı nasıl silerim?', a: 'Profil ekranının en altındaki "Hesabımı sil" ile. Devam eden siparişin varsa önce tamamlanması gerekir.' },
];

const CATEGORIES: { key: SupportCategory; label: string }[] = [
  { key: 'order', label: 'Sipariş' },
  { key: 'payment', label: 'Ödeme' },
  { key: 'account', label: 'Hesap' },
  { key: 'seller', label: 'Satıcı' },
  { key: 'other', label: 'Diğer' },
];

const STATUS_LABEL: Record<SupportStatus, string> = { open: 'Bekliyor', answered: 'Yanıtlandı', closed: 'Kapandı' };
const MIN_MESSAGE = 5;

export default function HelpScreen() {
  const { colors: t } = useTheme();
  const { session } = useAuth();
  const { requireAuth } = useRequireAuth();
  const params = useLocalSearchParams<{ orderId?: string; ticketId?: string }>();
  const orderId = typeof params.orderId === 'string' && params.orderId ? params.orderId : null;
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [category, setCategory] = useState<SupportCategory>(orderId ? 'order' : 'other');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [openTicket, setOpenTicket] = useState<string | null>(typeof params.ticketId === 'string' ? params.ticketId : null);

  const load = useCallback(async () => {
    if (!session?.userId) return;
    setLoading(true);
    try {
      setTickets(await fetchMySupportTickets(session.userId));
    } catch {
      // Liste açılamazsa form yine çalışır.
    } finally {
      setLoading(false);
    }
  }, [session?.userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Ekran açıkken başka bir talebin bildirimine dokunulursa o talep açılır.
  useEffect(() => {
    if (typeof params.ticketId === 'string' && params.ticketId) setOpenTicket(params.ticketId);
  }, [params.ticketId]);

  const send = async () => {
    if (!requireAuth()) return;
    const text = message.trim();
    if (text.length < MIN_MESSAGE) {
      setNotice({ ok: false, text: 'Sorununu birkaç kelimeyle yaz.' });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      await createSupportTicket({ category, message: text, orderId });
      setMessage('');
      setNotice({ ok: true, text: 'Talebin bize ulaştı. Yanıtladığımızda bildirim alacaksın.' });
      await load();
    } catch (e: any) {
      setNotice({ ok: false, text: e?.code === '55000' ? e.message : 'Talep gönderilemedi. Tekrar dene.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <TopBar title="Yardım ve destek" subtitle="Sana nasıl yardım edelim?" back />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[s.section, { color: t.heading }]}>Sık sorulanlar</Text>
        <View style={[s.card, s.faqCard, { backgroundColor: t.surface }]}>
          {FAQ.map((item, i) => {
            const open = openFaq === i;
            return (
              <View key={item.q} style={i < FAQ.length - 1 ? [s.faqItem, { borderBottomColor: t.divider }] : undefined}>
                <Pressable
                  style={s.faqHead}
                  onPress={() => setOpenFaq(open ? null : i)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                >
                  <Text style={[s.faqQ, { color: t.text }]}>{item.q}</Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.textSecondary} />
                </Pressable>
                {open ? <Text style={[s.faqA, { color: t.textSecondary }]}>{item.a}</Text> : null}
              </View>
            );
          })}
        </View>

        <Text style={[s.section, { color: t.heading }]}>Talep aç</Text>
        <View style={[s.card, { backgroundColor: t.surface }]}>
          {orderId ? (
            <View style={[s.linked, { backgroundColor: t.background }]}>
              <Ionicons name="receipt-outline" size={16} color={t.text} />
              <Text style={[s.linkedText, { color: t.text }]}>Sipariş #{orderId.slice(0, 8).toUpperCase()} ile ilgili</Text>
            </View>
          ) : null}
          <View style={s.chips}>
            {CATEGORIES.map(c => {
              const on = category === c.key;
              return (
                <Pressable
                  key={c.key}
                  style={[s.chip, { backgroundColor: on ? t.brand : t.background }]}
                  hitSlop={2}
                  onPress={() => setCategory(c.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.chipText, { color: on ? t.onBrand : t.text }]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={[s.input, { borderColor: t.surfaceBorder, color: t.text }]}
            value={message}
            onChangeText={v => { setMessage(v); setNotice(null); }}
            placeholder="Sorununu yaz"
            placeholderTextColor={t.textMuted}
            multiline
            maxLength={2000}
            textAlignVertical="top"
            accessibilityLabel="Sorununu yaz"
          />
          {notice ? <Text style={[s.notice, { color: notice.ok ? t.success : t.danger }]}>{notice.text}</Text> : null}
          <Button label="Gönder" size="lg" fullWidth loading={sending} onPress={send} />
          <Pressable style={s.mail} onPress={() => Linking.openURL('mailto:destek@afiyetli.app')} accessibilityRole="link">
            <Ionicons name="mail-outline" size={16} color={t.textSecondary} />
            <Text style={[s.mailText, { color: t.textSecondary }]}>destek@afiyetli.app</Text>
          </Pressable>
        </View>

        {session?.userId ? (
          <>
            <Text style={[s.section, { color: t.heading }]}>Taleplerin</Text>
            {loading && tickets.length === 0 ? <LogoLoader /> : null}
            {!loading && tickets.length === 0 ? (
              <Text style={[s.empty, { color: t.textSecondary }]}>Henüz talebin yok.</Text>
            ) : null}
            {tickets.map(ticket => {
              const open = openTicket === ticket.id;
              return (
                <View key={ticket.id} style={[s.card, s.ticket, { backgroundColor: t.surface }]}>
                  <Pressable
                    style={s.ticketHead}
                    onPress={() => setOpenTicket(open ? null : ticket.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityHint="Yazışmayı açar"
                  >
                    <Text style={[s.ticketDate, { color: t.textSecondary }]}>
                      {new Date(ticket.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                    </Text>
                    <View style={s.ticketHeadEnd}>
                      <View style={[s.status, { backgroundColor: ticket.status === 'answered' ? t.accent : t.background }]}>
                        <Text style={[s.statusText, { color: ticket.status === 'answered' ? t.onAccent : t.text }]}>{STATUS_LABEL[ticket.status]}</Text>
                      </View>
                      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.textSecondary} />
                    </View>
                  </Pressable>
                  {open ? (
                    <SupportThread
                      ticketId={ticket.id}
                      viewer="customer"
                      onSend={ticket.status === 'closed' ? undefined : async text => { await replySupportTicket(ticket.id, text); await load(); }}
                      sendLabel="Yanıtla"
                      placeholder="Yanıtını yaz"
                    />
                  ) : (
                    <>
                      <Text style={[s.ticketText, { color: t.text }]} numberOfLines={2}>{ticket.message}</Text>
                      {ticket.reply ? (
                        <View style={[s.reply, { backgroundColor: t.background }]}>
                          <Text style={[s.replyLabel, { color: t.textSecondary }]}>Afiyetli</Text>
                          <Text style={[s.ticketText, { color: t.text }]} numberOfLines={3}>{ticket.reply}</Text>
                        </View>
                      ) : null}
                    </>
                  )}
                  {open && ticket.status === 'closed' ? (
                    <Text style={[s.ticketDate, { color: t.textSecondary }]}>Bu talep kapandı. Yeni bir sorun için yukarıdan talep aç.</Text>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32, gap: 10 },
  section: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 8 },
  card: { borderRadius: 16, padding: 14, gap: 12 },
  faqCard: { paddingVertical: 2, gap: 0 },
  faqItem: { borderBottomWidth: 1 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  faqQ: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.semibold },
  faqA: { fontSize: 14, lineHeight: 21, fontFamily: fonts.regular, paddingBottom: 14 },
  linked: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  linkedText: { fontSize: 13, fontFamily: fonts.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },
  input: { minHeight: 110, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  notice: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold },
  mail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
  mailText: { fontSize: 13, fontFamily: fonts.medium },
  empty: { fontSize: 14, fontFamily: fonts.regular },
  ticket: { gap: 8 },
  ticketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  ticketHeadEnd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketDate: { fontSize: 12, fontFamily: fonts.medium },
  status: { paddingHorizontal: 10, height: 26, borderRadius: 8, justifyContent: 'center' },
  statusText: { fontSize: 12, fontFamily: fonts.bold },
  ticketText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  reply: { borderRadius: 12, padding: 12, gap: 2 },
  replyLabel: { fontSize: 12, fontFamily: fonts.bold },
});
