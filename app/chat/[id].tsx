import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  chatErrorMessage,
  fetchConversation,
  fetchMessages,
  markConversationRead,
  MESSAGE_PAGE_SIZE,
  reportMessage,
  sendMessage,
  setConversationBlocked,
  useRealtimeMessages,
  type ConversationRow,
  type MessageRow,
} from '@/lib/messages';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';

const REPORT_REASONS = ['Hakaret veya taciz', 'Dolandırıcılık', 'Spam'];

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long' });
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: t } = useTheme();
  const [conversation, setConversation] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const hasMore = useRef(true);
  const loadingMore = useRef(false);

  const addMessage = useCallback((m: MessageRow) => {
    setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [m, ...prev]));
  }, []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const [conv, rows] = await Promise.all([fetchConversation(id), fetchMessages(id)]);
        if (!active) return;
        setConversation(conv);
        setMessages(rows);
        hasMore.current = rows.length === MESSAGE_PAGE_SIZE;
        setFailed(!conv);
        if (conv) markConversationRead(id).catch(() => undefined);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  useRealtimeMessages(id, (m) => {
    addMessage(m);
    if (m.sender_role !== conversation?.my_role) markConversationRead(m.conversation_id).catch(() => undefined);
  });

  const loadOlder = useCallback(async () => {
    const oldest = messages[messages.length - 1];
    if (!id || !oldest || !hasMore.current || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const rows = await fetchMessages(id, oldest.created_at);
      hasMore.current = rows.length === MESSAGE_PAGE_SIZE;
      setMessages(prev => [...prev, ...rows.filter(r => !prev.some(p => p.id === r.id))]);
    } catch {
      // Sonraki kaydırmada yeniden denenir.
    } finally {
      loadingMore.current = false;
    }
  }, [id, messages]);

  const send = async () => {
    const body = text.trim();
    if (!id || !body || sending) return;
    setSending(true);
    try {
      addMessage(await sendMessage(id, body));
      setText('');
    } catch (e: any) {
      Alert.alert('Mesaj gönderilemedi', chatErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const changeBlock = async (blocked: boolean) => {
    if (!id) return;
    try {
      await setConversationBlocked(id, blocked);
      setConversation(c => (c ? { ...c, blocked_by: blocked ? c.my_role : null } : c));
    } catch (e: any) {
      Alert.alert('İşlem yapılamadı', chatErrorMessage(e));
    }
  };

  const openMenu = () => {
    if (!conversation) return;
    const blockedByMe = conversation.blocked_by === conversation.my_role;
    Alert.alert(conversation.other_name, undefined, [
      blockedByMe
        ? { text: 'Engeli kaldır', onPress: () => changeBlock(false) }
        : {
            text: 'Engelle',
            style: 'destructive',
            onPress: () => Alert.alert('Engellensin mi?', 'İki taraf da bu sohbete mesaj yazamaz.', [
              { text: 'Vazgeç', style: 'cancel' },
              { text: 'Engelle', style: 'destructive', onPress: () => changeBlock(true) },
            ]),
          },
      { text: 'Vazgeç', style: 'cancel' },
    ]);
  };

  const report = (m: MessageRow, reason: string) => {
    reportMessage(m.id, reason)
      .then(() => Alert.alert('Bildirildi', 'Mesajı inceleyeceğiz. Teşekkürler.'))
      .catch((e: any) => Alert.alert('Bildirilemedi', chatErrorMessage(e)));
  };

  const askReport = (m: MessageRow) => {
    if (m.sender_role === conversation?.my_role) return;
    Alert.alert('Mesajı bildir', 'Neden bildiriyorsunuz?', [
      ...REPORT_REASONS.map(reason => ({ text: reason, onPress: () => report(m, reason) })),
      { text: 'Vazgeç', style: 'cancel' as const },
    ]);
  };

  const blocked = !!conversation?.blocked_by;

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top', 'bottom']}>
      <View style={[st.header, { borderBottomColor: t.surfaceBorder }]}>
        <Pressable style={[st.iconBtn, { backgroundColor: t.surface }]} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color={t.text} />
        </Pressable>
        <Pressable
          style={st.titleWrap}
          disabled={conversation?.my_role !== 'customer'}
          onPress={() => conversation && router.push(`/(customer)/seller/${conversation.seller_id}` as any)}
        >
          <Text style={[st.title, { color: t.text }]} numberOfLines={1}>{conversation?.other_name ?? 'Sohbet'}</Text>
        </Pressable>
        <Pressable style={[st.iconBtn, { backgroundColor: t.surface }]} onPress={openMenu} hitSlop={12} disabled={!conversation}>
          <Text style={[st.menuIcon, { color: t.text }]}>⋯</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={t.primary} /></View>
      ) : failed ? (
        <View style={st.center}>
          <Text style={[st.note, { color: t.textMuted }]}>Sohbet açılamadı. Geri dönüp tekrar deneyin.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={st.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            style={st.flex}
            inverted
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={st.list}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => {
              const mine = item.sender_role === conversation?.my_role;
              const older = messages[index + 1];
              const newDay = !older || dayLabel(older.created_at) !== dayLabel(item.created_at);
              return (
                <View>
                  {newDay && <Text style={[st.day, { color: t.textMuted }]}>{dayLabel(item.created_at)}</Text>}
                  <Pressable
                    onLongPress={() => askReport(item)}
                    style={[st.bubble, mine ? [st.mine, { backgroundColor: t.primary }] : [st.theirs, { backgroundColor: t.surface }]]}
                  >
                    <Text style={[st.body, { color: mine ? '#fff' : t.text }]}>{item.body}</Text>
                    <Text style={[st.time, { color: mine ? 'rgba(255,255,255,0.75)' : t.textMuted }]}>{clock(item.created_at)}</Text>
                  </Pressable>
                </View>
              );
            }}
          />

          {blocked ? (
            <View style={[st.blockedBar, { borderTopColor: t.surfaceBorder }]}>
              <Text style={[st.note, { color: t.textMuted }]}>Bu sohbet engellendi, mesaj gönderilemez.</Text>
            </View>
          ) : (
            <View style={[st.inputBar, { borderTopColor: t.surfaceBorder }]}>
              <TextInput
                style={[st.input, { backgroundColor: t.surface, color: t.text, borderColor: t.surfaceBorder }]}
                value={text}
                onChangeText={setText}
                placeholder="Mesaj yazın..."
                placeholderTextColor={t.textMuted}
                multiline
                maxLength={1000}
              />
              <Pressable
                style={[st.sendBtn, { backgroundColor: t.primary }, (!text.trim() || sending) && st.disabled]}
                onPress={send}
                disabled={!text.trim() || sending}
              >
                <Text style={st.sendText}>Gönder</Text>
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontFamily: fonts.display, marginTop: -2 },
  menuIcon: { fontSize: 20, fontFamily: fonts.display, marginTop: -4 },
  titleWrap: { flex: 1 },
  title: { fontSize: 16, fontFamily: fonts.extrabold, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  note: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
  list: { padding: 14, gap: 6 },
  day: { fontSize: 11, fontFamily: fonts.semibold, textAlign: 'center', marginVertical: 8 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  time: { fontFamily: fonts.regular, fontSize: 10, alignSelf: 'flex-end' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, maxHeight: 110, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontFamily: fonts.regular, fontSize: 15 },
  sendBtn: { borderRadius: 18, paddingHorizontal: 16, height: 40, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 14, fontFamily: fonts.bold },
  disabled: { opacity: 0.5 },
  blockedBar: { padding: 16, borderTopWidth: 1 },
});
