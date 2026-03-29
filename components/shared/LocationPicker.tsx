import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '@/constants/theme';

const LOCATION_KEY = '@evinden_user_location';

export type UserLocation = {
  district: string;
  city: string;
  latitude: number;
  longitude: number;
};

const POPULAR_DISTRICTS: { district: string; city: string }[] = [
  { district: 'Kadıköy', city: 'İstanbul' },
  { district: 'Beşiktaş', city: 'İstanbul' },
  { district: 'Üsküdar', city: 'İstanbul' },
  { district: 'Beyoğlu', city: 'İstanbul' },
  { district: 'Çankaya', city: 'Ankara' },
  { district: 'Konak', city: 'İzmir' },
  { district: 'Nilüfer', city: 'Bursa' },
  { district: 'Muratpaşa', city: 'Antalya' },
];

export async function getSavedLocation(): Promise<UserLocation | null> {
  const raw = await AsyncStorage.getItem(LOCATION_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  return null;
}

export async function saveLocation(loc: UserLocation): Promise<void> {
  await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
}

export function LocationPicker({ onDone }: { onDone: (loc: UserLocation) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestLocation = async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Konum izni verilmedi. Aşağıdan manuel seçebilirsiniz.');
        setLoading(false);
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const loc: UserLocation = {
        district: geo?.subregion || geo?.district || geo?.city || 'Bilinmeyen',
        city: geo?.region || geo?.city || 'Bilinmeyen',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      await saveLocation(loc);
      onDone(loc);
    } catch {
      setError('Konum alınamadı. Manuel olarak seçin.');
    }
    setLoading(false);
  };

  const selectManual = async (district: string, city: string) => {
    const loc: UserLocation = { district, city, latitude: 0, longitude: 0 };
    await saveLocation(loc);
    onDone(loc);
  };

  return (
    <View style={s.container}>
      <View style={s.content}>
        {/* Icon */}
        <View style={s.iconWrap}>
          <Ionicons name="location" size={40} color={colors.primary} />
        </View>

        <Text style={s.title}>Konumunuzu Seçin</Text>
        <Text style={s.subtitle}>
          Size yakın ev mutfaklarını gösterebilmemiz için konumunuza ihtiyacımız var
        </Text>

        {/* GPS button */}
        <Pressable style={s.gpsBtn} onPress={requestLocation} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="navigate" size={18} color="#fff" />
              <Text style={s.gpsBtnText}>Mevcut Konumumu Kullan</Text>
            </>
          )}
        </Pressable>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {/* Divider */}
        <View style={s.dividerRow}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>veya</Text>
          <View style={s.dividerLine} />
        </View>

        {/* Popular districts */}
        <Text style={s.sectionLabel}>POPÜLER BÖLGELER</Text>
        <View style={s.districtGrid}>
          {POPULAR_DISTRICTS.map(d => (
            <Pressable
              key={d.district}
              style={s.districtPill}
              onPress={() => selectManual(d.district, d.city)}
            >
              <Ionicons name="location-outline" size={14} color="#6B5E50" />
              <Text style={s.districtText}>{d.district}</Text>
              <Text style={s.districtCity}>{d.city}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FAF7F2',
    justifyContent: 'center',
    zIndex: 100,
  },
  content: {
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF0EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#1A1208', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#A89A8A', textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 16 },

  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  gpsBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  error: {
    marginTop: 10,
    fontSize: 12,
    color: '#C62828',
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 10,
    textAlign: 'center',
    width: '100%',
  },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20, width: '100%' },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#EDE8E2' },
  dividerText: { fontSize: 12, color: '#C4B8AA', fontWeight: '600' },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#A89A8A', letterSpacing: 0.8, marginBottom: 12, alignSelf: 'flex-start' },
  districtGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%' },
  districtPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  districtText: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  districtCity: { fontSize: 11, color: '#A89A8A' },
});
