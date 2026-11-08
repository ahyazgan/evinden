import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAddresses, type SavedAddress } from '@/lib/address-context';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { Button } from '@/components/ui/Button';
import { TopBar } from '@/components/shared/TopBar';

const LABEL_OPTIONS: { value: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'Ev', icon: 'home-outline' },
  { value: 'İş', icon: 'briefcase-outline' },
  { value: 'Diğer', icon: 'location-outline' },
];

/** Eski kayıtların etiketinde emoji olabilir ("🏠 Ev"); ekranda sade hâli gösterilir. */
function plainLabel(label: string): string {
  return LABEL_OPTIONS.find(opt => label.includes(opt.value))?.value ?? label;
}

function labelIcon(label: string): keyof typeof Ionicons.glyphMap {
  return LABEL_OPTIONS.find(opt => label.includes(opt.value))?.icon ?? 'location-outline';
}

export default function AddressesScreen() {
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();
  const { addresses, addAddress, updateAddress, removeAddress, setDefault } = useAddresses();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState(LABEL_OPTIONS[0].value);
  const [addressLine, setAddressLine] = useState('');
  const [floor, setFloor] = useState('');

  const resetForm = () => {
    setLabel(LABEL_OPTIONS[0].value);
    setAddressLine('');
    setFloor('');
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (addr: SavedAddress) => {
    setEditingId(addr.id);
    setLabel(plainLabel(addr.label));
    setAddressLine(addr.addressLine);
    setFloor(addr.floor ?? '');
    setShowForm(true);
  };

  const handleSave = () => {
    if (!addressLine.trim()) {
      Alert.alert('Hata', 'Adres satırı boş bırakılamaz.');
      return;
    }
    if (editingId) {
      updateAddress(editingId, {
        label,
        addressLine: addressLine.trim(),
        floor: floor.trim() || undefined,
      });
    } else {
      addAddress({
        label,
        addressLine: addressLine.trim(),
        floor: floor.trim() || undefined,
        isDefault: addresses.length === 0,
      });
    }
    resetForm();
  };

  const handleDelete = (addr: SavedAddress) => {
    Alert.alert('Adresi sil', `"${plainLabel(addr.label)}" silinsin mi?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeAddress(addr.id) },
    ]);
  };

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar back title="Adreslerim" />

      <ScrollView style={st.flex} contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {addresses.length === 0 && !showForm ? (
          <View style={st.emptyWrap}>
            <Ionicons name="location-outline" size={44} color={t.textMuted} />
            <Text style={[st.emptyTitle, { color: t.heading }]}>Kayıtlı adres yok</Text>
            <Text style={[st.emptySub, { color: t.textSecondary }]}>Hızlı sipariş vermek için adres ekle.</Text>
          </View>
        ) : (
          addresses.map((addr) => {
            const name = plainLabel(addr.label);
            return (
              <Pressable
                key={addr.id}
                style={[st.addrCard, { backgroundColor: t.surface, borderColor: addr.isDefault ? t.brand : t.surface }]}
                onPress={() => setDefault(addr.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: addr.isDefault }}
                accessibilityLabel={`${name}, ${addr.addressLine}${addr.isDefault ? ', varsayılan adres' : ''}`}
              >
                <View style={[st.addrIcon, { backgroundColor: addr.isDefault ? t.accent : t.chip }]}>
                  <Ionicons name={labelIcon(addr.label)} size={20} color={addr.isDefault ? t.onAccent : t.text} />
                </View>
                <View style={st.addrBody}>
                  <Text style={[st.addrLabel, { color: t.text }]}>{name}</Text>
                  <Text style={[st.addrLine, { color: t.textSecondary }]} numberOfLines={2}>{addr.addressLine}</Text>
                  {addr.floor ? <Text style={[st.addrLine, { color: t.textSecondary }]}>Kat/Daire: {addr.floor}</Text> : null}
                  {addr.isDefault ? <Text style={[st.addrDefault, { color: t.text }]}>Varsayılan</Text> : null}
                </View>
                <Pressable style={st.editBtn} onPress={() => startEdit(addr)} accessibilityRole="button" accessibilityLabel={`${name} adresini düzenle`}>
                  <Text style={[st.editText, { color: t.text }]}>Düzenle</Text>
                </Pressable>
                <Pressable style={st.deleteBtn} onPress={() => handleDelete(addr)} accessibilityRole="button" accessibilityLabel={`${name} adresini sil`}>
                  <Ionicons name="trash-outline" size={18} color={t.danger} />
                </Pressable>
              </Pressable>
            );
          })
        )}

        {showForm ? (
          <View style={[st.formCard, { backgroundColor: t.surface }]}>
            <Text style={[st.formTitle, { color: t.heading }]}>
              {editingId ? 'Adresi düzenle' : 'Yeni adres ekle'}
            </Text>

            <View style={st.labelRow}>
              {LABEL_OPTIONS.map((opt) => {
                const on = label === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[st.labelPill, { backgroundColor: on ? t.brand : t.chip }]}
                    onPress={() => setLabel(opt.value)}
                    hitSlop={{ top: 2, bottom: 2 }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Ionicons name={opt.icon} size={16} color={on ? t.onBrand : t.text} />
                    <Text style={[st.labelPillText, { color: on ? t.onBrand : t.text }]}>{opt.value}</Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              style={[st.input, st.inputLarge, { backgroundColor: t.background, color: t.text }]}
              value={addressLine}
              onChangeText={setAddressLine}
              placeholder="Mahalle, sokak, bina no..."
              placeholderTextColor={t.textMuted}
              accessibilityLabel="Adres"
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            <TextInput
              style={[st.input, { backgroundColor: t.background, color: t.text }]}
              value={floor}
              onChangeText={setFloor}
              placeholder="Kat / Daire no (isteğe bağlı)"
              placeholderTextColor={t.textMuted}
              accessibilityLabel="Kat ve daire numarası"
            />

            <View style={st.formBtns}>
              <View style={st.flex}>
                <Button label="İptal" variant="outline" fullWidth onPress={resetForm} />
              </View>
              <View style={st.flex}>
                <Button label={editingId ? 'Güncelle' : 'Kaydet'} fullWidth onPress={handleSave} />
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {showForm ? null : (
        <View style={[st.bottom, { paddingBottom: Math.max(insets.bottom, 14) + 8 }]}>
          <Button label="+ Yeni adres ekle" size="lg" fullWidth onPress={() => { resetForm(); setShowForm(true); }} />
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 20, gap: 10 },

  emptyWrap: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },

  addrCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 2 },
  addrIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  addrBody: { flex: 1, minWidth: 0 },
  addrLabel: { fontSize: 15, fontFamily: fonts.bold },
  addrLine: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 2 },
  addrDefault: { fontSize: 12, fontFamily: fonts.bold, marginTop: 2 },
  editBtn: { minHeight: 44, justifyContent: 'center' },
  editText: { fontSize: 13, fontFamily: fonts.bold },
  deleteBtn: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -4, marginRight: -4 },

  formCard: { borderRadius: 16, padding: 14, gap: 12 },
  formTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4 },
  labelRow: { flexDirection: 'row', gap: 8 },
  labelPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 10 },
  labelPillText: { fontSize: 13, fontFamily: fonts.bold },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.regular, fontSize: 14 },
  inputLarge: { minHeight: 72 },
  formBtns: { flexDirection: 'row', gap: 10 },

  bottom: { paddingHorizontal: 16, paddingTop: 8 },
});
