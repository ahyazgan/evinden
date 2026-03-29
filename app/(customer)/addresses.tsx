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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { useAddresses, type SavedAddress } from '@/lib/address-context';

const LABEL_OPTIONS = ['🏠 Ev', '🏢 İş', '📍 Diğer'];

export default function AddressesScreen() {
  const router = useRouter();
  const { addresses, addAddress, updateAddress, removeAddress, setDefault } = useAddresses();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState(LABEL_OPTIONS[0]);
  const [addressLine, setAddressLine] = useState('');
  const [floor, setFloor] = useState('');

  const resetForm = () => {
    setLabel(LABEL_OPTIONS[0]);
    setAddressLine('');
    setFloor('');
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (addr: SavedAddress) => {
    setEditingId(addr.id);
    setLabel(addr.label);
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
    Alert.alert('Adres Sil', `"${addr.label}" silinsin mi?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeAddress(addr.id) },
    ]);
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.navBar}>
        <Pressable style={st.navBack} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color="#1A1208" />
        </Pressable>
        <Text style={st.navTitle}>Adreslerim</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {addresses.length === 0 && !showForm ? (
          <View style={st.emptyWrap}>
            <Ionicons name="location-outline" size={52} color="#E8E2DA" />
            <Text style={st.emptyTitle}>Kayıtlı adres yok</Text>
            <Text style={st.emptySub}>Hızlı sipariş vermek için adres ekleyin</Text>
          </View>
        ) : (
          addresses.map((addr) => (
            <Pressable
              key={addr.id}
              style={[st.addrCard, addr.isDefault && st.addrCardDefault]}
              onPress={() => setDefault(addr.id)}
            >
              <View style={st.addrIcon}>
                <Ionicons
                  name={addr.label.includes('Ev') ? 'home' : addr.label.includes('İş') ? 'briefcase' : 'location'}
                  size={20}
                  color={addr.isDefault ? colors.primary : '#6B5E50'}
                />
              </View>
              <View style={st.addrLeft}>
                <Text style={st.addrLabel}>{addr.label}</Text>
                <Text style={st.addrLine} numberOfLines={2}>{addr.addressLine}</Text>
                {addr.floor ? <Text style={st.addrFloor}>Kat/Daire: {addr.floor}</Text> : null}
              </View>
              <View style={st.addrRight}>
                {addr.isDefault ? (
                  <View style={st.defaultBadge}>
                    <Ionicons name="checkmark-circle" size={14} color="#fff" />
                    <Text style={st.defaultBadgeText}>Varsayılan</Text>
                  </View>
                ) : (
                  <View style={st.radioDot} />
                )}
                <View style={st.addrActions}>
                  <Pressable onPress={() => startEdit(addr)} hitSlop={8}>
                    <Ionicons name="create-outline" size={18} color="#6B5E50" />
                  </Pressable>
                  <Pressable onPress={() => handleDelete(addr)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color="#C62828" />
                  </Pressable>
                </View>
              </View>
            </Pressable>
          ))
        )}

        {showForm ? (
          <View style={st.formCard}>
            <Text style={st.formTitle}>
              {editingId ? 'Adresi Düzenle' : 'Yeni Adres Ekle'}
            </Text>

            <View style={st.labelRow}>
              {LABEL_OPTIONS.map((opt) => (
                <Pressable
                  key={opt}
                  style={[st.labelPill, label === opt && st.labelPillActive]}
                  onPress={() => setLabel(opt)}
                >
                  <Text style={[st.labelPillText, label === opt && st.labelPillTextActive]}>
                    {opt}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={st.input}
              value={addressLine}
              onChangeText={setAddressLine}
              placeholder="Mahalle, sokak, bina no..."
              placeholderTextColor="#B8AFA4"
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            <TextInput
              style={st.inputSmall}
              value={floor}
              onChangeText={setFloor}
              placeholder="Kat / Daire no (isteğe bağlı)"
              placeholderTextColor="#B8AFA4"
            />

            <View style={st.formBtns}>
              <Pressable style={st.cancelBtn} onPress={resetForm}>
                <Text style={st.cancelBtnText}>İptal</Text>
              </Pressable>
              <Pressable style={st.saveBtn} onPress={handleSave}>
                <Text style={st.saveBtnText}>{editingId ? 'Güncelle' : 'Kaydet'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={st.addBtn} onPress={() => { resetForm(); setShowForm(true); }}>
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={st.addBtnText}>Yeni Adres Ekle</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F0ECE6',
  },
  navBack: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },

  scroll: { padding: 16, paddingBottom: 40 },

  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A', textAlign: 'center' },

  addrCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10,
    borderWidth: 1.5, borderColor: '#F0ECE6', flexDirection: 'row', gap: 12, alignItems: 'flex-start',
  },
  addrCardDefault: { borderColor: colors.primary, backgroundColor: '#FFF8F6' },
  addrIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#FAF7F2',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  addrLeft: { flex: 1, gap: 4 },
  addrLabel: { fontSize: 14, fontWeight: '700', color: '#1A1208' },
  addrLine: { fontSize: 13, color: '#6B5E50', lineHeight: 18 },
  addrFloor: { fontSize: 12, color: '#A89A8A' },
  addrRight: { alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  defaultBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  defaultBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  radioDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D0C8BC' },
  addrActions: { flexDirection: 'row', gap: 12 },

  formCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#F0ECE6', gap: 12,
  },
  formTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  labelRow: { flexDirection: 'row', gap: 8 },
  labelPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F7F3EE', borderWidth: 1, borderColor: '#F0ECE6' },
  labelPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  labelPillText: { fontSize: 13, fontWeight: '600', color: '#6B5E50' },
  labelPillTextActive: { color: '#fff' },
  input: { backgroundColor: '#FAF7F2', borderRadius: 12, padding: 14, fontSize: 14, color: '#1A1208', minHeight: 60, borderWidth: 1, borderColor: '#F0ECE6' },
  inputSmall: { backgroundColor: '#FAF7F2', borderRadius: 12, padding: 14, fontSize: 14, color: '#1A1208', borderWidth: 1, borderColor: '#F0ECE6' },
  formBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#EDE8E2' },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#6B5E50' },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary,
    borderStyle: 'dashed', marginTop: 4,
  },
  addBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
});
