import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '@/constants/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const STORAGE_KEY = '@evinden_onboarding_done';

type Slide = { id: string; emoji: string; title: string; subtitle: string; bg: string };

const SLIDES: Slide[] = [
  {
    id: '1',
    emoji: '🍲',
    title: 'Ev Yapımı Lezzetler',
    subtitle: 'Mahallenizdeki ev aşçılarının elinden çıkan birbirinden lezzetli yemekleri keşfedin.',
    bg: '#FFF3E0',
  },
  {
    id: '2',
    emoji: '📍',
    title: 'Yakınındaki Mutfaklar',
    subtitle: 'Size en yakın ev mutfaklarını bulun, menülerini inceleyin ve kolayca sipariş verin.',
    bg: '#E3F2FD',
  },
  {
    id: '3',
    emoji: '🚀',
    title: 'Hızlı ve Güvenli Teslimat',
    subtitle: 'Siparişinizi anlık takip edin, kapınıza sıcacık gelsin.',
    bg: '#E8F5E9',
  },
  {
    id: '4',
    emoji: '🧑‍🍳',
    title: 'Sen de Satıcı Ol!',
    subtitle: 'Ev yemeklerini satmak mı istiyorsun? Hemen mağazanı aç ve kazanmaya başla.',
    bg: '#FCE4EC',
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const goNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
      setCurrentIndex(currentIndex + 1);
    } else {
      finish();
    }
  };

  const finish = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'true');
    Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(onDone);
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={[st.slide, { width: SCREEN_W }]}>
      <View style={[st.emojiCircle, { backgroundColor: item.bg }]}>
        <Text style={st.emoji}>{item.emoji}</Text>
      </View>
      <Text style={st.title}>{item.title}</Text>
      <Text style={st.subtitle}>{item.subtitle}</Text>
    </View>
  );

  return (
    <Animated.View style={[st.container, { opacity: fadeAnim }]}>
      <View style={st.skipRow}>
        <Pressable onPress={finish} hitSlop={12}>
          <Text style={st.skipText}>Atla</Text>
        </Pressable>
      </View>

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s) => s.id}
        renderItem={renderSlide}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
          setCurrentIndex(idx);
        }}
        scrollEventThrottle={16}
      />

      {/* Dots */}
      <View style={st.dotsRow}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[st.dot, i === currentIndex && st.dotActive]} />
        ))}
      </View>

      {/* Button */}
      <View style={st.btnWrap}>
        <Pressable style={st.btn} onPress={goNext}>
          <Text style={st.btnText}>
            {currentIndex === SLIDES.length - 1 ? 'Başlayalım!' : 'Devam'}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export async function shouldShowOnboarding(): Promise<boolean> {
  const done = await AsyncStorage.getItem(STORAGE_KEY);
  return done !== 'true';
}

const st = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FAF7F2',
    zIndex: 100,
  },
  skipRow: {
    alignItems: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 10,
  },
  skipText: { fontSize: 15, fontWeight: '600', color: '#A89A8A' },

  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emojiCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  emoji: { fontSize: 64 },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#1A1208',
    textAlign: 'center',
    marginBottom: 14,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B5E50',
    textAlign: 'center',
    lineHeight: 22,
  },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E8E2DA',
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },

  btnWrap: { paddingHorizontal: 24, paddingBottom: 50 },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
