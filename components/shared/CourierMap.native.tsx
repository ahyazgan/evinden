import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import MapView, { Marker } from 'react-native-maps';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { CourierLocationCard } from './CourierLocationCard';
import type { CourierMapProps } from './CourierMap';

const SIDE_PADDING = 56;
const REGION_DELTA = 0.012;
/** Kullanıcı haritayı kaydırdıysa kamera bu süre onu rahat bırakır. */
const DRAG_HOLD_MS = 30000;
/** Özel işaret görünümü çizilene kadar izlenir; sonrasında sürekli izlemek pili tüketir. */
const MARKER_TRACK_MS = 800;

/**
 * Android'de Google Maps anahtarı olmadan MapView uygulamayı yerel tarafta düşürür ve bunu ErrorBoundary
 * yakalayamaz. Anahtarın kendisi çalışma anında okunamaz (expoConfig android.config'i siler), bu yüzden
 * app.json'daki extra.androidGoogleMapsReady bakılır. Expo Go kendi anahtarıyla gelir.
 */
function canRenderMap(): boolean {
  if (Platform.OS !== 'android') return true;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return true;
  return Constants.expoConfig?.extra?.androidGoogleMapsReady === true;
}

export function CourierMap({ courier, destination, line, topInset }: CourierMapProps) {
  const { colors: t } = useTheme();
  const mapRef = useRef<MapView>(null);
  const readyRef = useRef(false);
  const lastDragRef = useRef(0);
  const [trackMarkers, setTrackMarkers] = useState(true);

  const frame = useCallback(() => {
    if (!readyRef.current || Date.now() - lastDragRef.current < DRAG_HOLD_MS) return;
    if (destination) {
      mapRef.current?.fitToCoordinates([courier, destination], {
        edgePadding: { top: topInset + 72, right: SIDE_PADDING, bottom: SIDE_PADDING, left: SIDE_PADDING },
        animated: true,
      });
    } else {
      mapRef.current?.animateToRegion({ ...courier, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA });
    }
    // Yalnızca koordinatlar değişince yeniden kadrajlanır.
  }, [courier.latitude, courier.longitude, destination?.latitude, destination?.longitude, topInset]);

  useEffect(frame, [frame]);

  useEffect(() => {
    setTrackMarkers(true);
    const timer = setTimeout(() => setTrackMarkers(false), MARKER_TRACK_MS);
    return () => clearTimeout(timer);
  }, [destination?.latitude, destination?.longitude]);

  if (!canRenderMap()) {
    return (
      <View style={[s.fallback, { paddingTop: topInset }]}>
        <CourierLocationCard line={line} courier={courier} />
      </View>
    );
  }

  return (
    <View style={s.fill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...courier, latitudeDelta: REGION_DELTA, longitudeDelta: REGION_DELTA }}
        onMapReady={() => { readyRef.current = true; frame(); }}
        onPanDrag={() => { lastDragRef.current = Date.now(); }}
        userInterfaceStyle="light"
        showsPointsOfInterests={false}
        showsUserLocation={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        loadingEnabled
        loadingBackgroundColor={t.background}
        loadingIndicatorColor={t.primary}
        accessibilityLabel="Kuryenin ve teslimat adresinin haritası"
      >
        <Marker coordinate={courier} title="Kurye" anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={trackMarkers}>
          <View style={[s.pin, { backgroundColor: t.brand, borderColor: t.accent }]}>
            <Ionicons name="bicycle" size={20} color={t.onBrand} />
          </View>
        </Marker>
        {destination ? (
          <Marker coordinate={destination} title="Teslimat adresin" anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={trackMarkers}>
            <View style={[s.pin, { backgroundColor: t.surface, borderColor: t.brand }]}>
              <Ionicons name="home" size={18} color={t.brand} />
            </View>
          </Marker>
        ) : null}
      </MapView>
      <View style={[s.lineCard, { top: topInset, backgroundColor: t.surface }]}>
        <Ionicons name="bicycle-outline" size={18} color={t.text} />
        <Text style={[s.lineText, { color: t.text }]} accessibilityLiveRegion="polite">{line}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  pin: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  lineCard: { position: 'absolute', left: 16, right: 16, minHeight: 44, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineText: { flex: 1, fontSize: 14, lineHeight: 19, fontFamily: fonts.bold },
});
