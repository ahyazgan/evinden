import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { fetchSupportHistory, type SupportMessage } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

/**
 * Destek talebinin yazışması. viewer: müşteri kendi mesajlarını "Sen", yönetici müşteriyi adıyla görür.
 * onSend verilirse altta yanıt alanı çıkar; gönderilince geçmiş yeniden okunur.
 */
export function SupportThread({ ticketId, viewer, customerName, onSend, sendLabel = 'Gönder', placeholder = 'Mesajını yaz', reloadKey = 0 }: {
  ticketId: string;
  viewer: 'customer' | 'admin';
  customerName?: string | null;
  onSend?: (text: string) => Promise<void>;
  sendLabel?: string;
  placeholder?: string;
  /** Dışarıdan yeniden yükletmek için (ör. yönetici yanıtından sonra) */
  reloadKey?: number;
}) {
  const { colors: t } = useTheme();
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try { setMessages(await fetchSupportHistory(ticketId)); } catch { setFailed(true); }
  }, [ticketId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !onSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text);
      setDraft('');
      await load();
    } catch (e: any) {
      setError(e?.code === '55000' || e?.code === '22023' ? e.message : 'Gönderilemedi, tekrar dene.');
    } finally {
      setSending(false);
    }
  };

  const author = (m: SupportMessage) => {
    if (m.author_role === 'admin') return viewer === 'admin' ? 'Destek ekibi' : 'Afiyetli';
    if (m.author_role === 'system') return 'Sistem';
    return viewer === 'customer' ? 'Sen' : customerName || 'Müşteri';
  };

  return (
    <View style={s.wrap}>
      {messages === null && !failed ? <Text style={[s.meta, { color: t.textSecondary }]}>Yazışma yükleniyor…</Text> : null}
      {failed ? (
        <View style={s.row}>
          <Text style={[s.meta, { color: t.danger }]}>Yazışma açılamadı.</Text>
          <Button label="Tekrar dene" size="sm" variant="outline" onPress={load} />
        </View>
      ) : null}
      {(messages ?? []).map(m => {
        const mine = (viewer === 'customer' && m.author_role === 'customer') || (viewer === 'admin' && m.author_role === 'admin');
        return (
          <View key={m.id} style={[s.bubble, mine ? s.mine : s.theirs, { backgroundColor: mine ? t.background : t.surface, borderColor: t.divider }]}>
            <Text style={[s.author, { color: t.textSecondary }]}>
              {author(m)} · {new Date(m.created_at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
            <Text selectable style={[s.body, { color: t.text }]}>{m.body}</Text>
          </View>
        );
      })}
      {onSend ? (
        <>
          <TextInput
            style={[s.input, { borderColor: t.surfaceBorder, color: t.text }]}
            value={draft}
            onChangeText={v => { setDraft(v); setError(null); }}
            placeholder={placeholder}
            placeholderTextColor={t.textMuted}
            multiline
            maxLength={3000}
            textAlignVertical="top"
            accessibilityLabel={placeholder}
          />
          {error ? <Text style={[s.meta, { color: t.danger }]}>{error}</Text> : null}
          <Button label={sendLabel} size="sm" loading={sending} disabled={!draft.trim()} onPress={send} />
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.medium },
  bubble: { borderRadius: 12, padding: 10, gap: 3, maxWidth: '92%', borderWidth: 1 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  author: { fontSize: 11, fontFamily: fonts.bold },
  body: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  input: { minHeight: 72, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
});
