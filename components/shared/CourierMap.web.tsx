import { StyleSheet, View } from 'react-native';
import { CourierLocationCard } from './CourierLocationCard';
import type { CourierMapProps } from './CourierMap';

/** react-native-maps web paketine girmez: webde konum yazıyla ve harita bağlantısıyla gösterilir. */
export function CourierMap({ courier, line, topInset }: CourierMapProps) {
  return (
    <View style={[s.fill, { paddingTop: topInset }]}>
      <CourierLocationCard line={line} courier={courier} />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
