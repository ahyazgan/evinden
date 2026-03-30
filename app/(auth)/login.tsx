import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function LoginScreen() {
  const { signInWithEmail, signInWithGoogle, signInWithApple } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim()) {
      setError('Lutfen e-posta adresinizi girin.');
      return;
    }
    if (!password) {
      setError('Lutfen sifrenizi girin.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await signInWithEmail(email.trim(), password);
    setLoading(false);
    if (err) {
      if (err.includes('Invalid login')) {
        setError('E-posta veya sifre hatali.');
      } else {
        setError(err);
      }
    } else {
      router.replace('/(customer)' as any);
    }
  };

  const handleGoogle = async () => {
    setSocialLoading('google');
    setError(null);
    const { error: err } = await signInWithGoogle();
    setSocialLoading(null);
    if (err && !err.includes('iptal')) {
      setError(err);
    }
  };

  const handleApple = async () => {
    setSocialLoading('apple');
    setError(null);
    const { error: err } = await signInWithApple();
    setSocialLoading(null);
    if (err && !err.includes('iptal')) {
      setError(err);
    }
  };

  const isLoading = loading || !!socialLoading;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={styles.logoWrap}>
            <Text style={styles.logoEmoji}>🍽️</Text>
            <Text style={styles.logoText}>evinden</Text>
          </View>

          <Text style={styles.title}>Giris Yap</Text>
          <Text style={styles.subtitle}>Hesabiniza giris yapin</Text>

          {/* Social Login Buttons */}
          <View style={styles.socialRow}>
            <Pressable
              style={[styles.socialBtn, styles.googleBtn]}
              onPress={handleGoogle}
              disabled={isLoading}
            >
              {socialLoading === 'google' ? (
                <ActivityIndicator size="small" color="#1A1208" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={20} color="#DB4437" />
                  <Text style={styles.socialBtnText}>Google</Text>
                </>
              )}
            </Pressable>

            {Platform.OS === 'ios' ? (
              <Pressable
                style={[styles.socialBtn, styles.appleBtn]}
                onPress={handleApple}
                disabled={isLoading}
              >
                {socialLoading === 'apple' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="logo-apple" size={20} color="#fff" />
                    <Text style={[styles.socialBtnText, { color: '#fff' }]}>Apple</Text>
                  </>
                )}
              </Pressable>
            ) : (
              <Pressable
                style={[styles.socialBtn, styles.appleBtn]}
                onPress={handleApple}
                disabled={isLoading}
              >
                {socialLoading === 'apple' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="logo-apple" size={20} color="#fff" />
                    <Text style={[styles.socialBtnText, { color: '#fff' }]}>Apple</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>veya</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Email */}
          <Text style={styles.label}>E-posta</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(t) => { setEmail(t); setError(null); }}
            placeholder="ornek@email.com"
            placeholderTextColor="#B8AFA4"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!isLoading}
          />

          {/* Password */}
          <Text style={[styles.label, { marginTop: 16 }]}>Sifre</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              placeholder="Sifreniz"
              placeholderTextColor="#B8AFA4"
              secureTextEntry={!showPassword}
              editable={!isLoading}
            />
            <Pressable style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#A89A8A" />
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Giris Yap</Text>
            )}
          </Pressable>

          <View style={styles.footerRow}>
            <Text style={styles.muted}>Hesabiniz yok mu? </Text>
            <Link href="/(auth)/register" asChild>
              <Pressable>
                <Text style={styles.link}>Kayit ol</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 48,
  },
  logoWrap: { alignItems: 'center', marginBottom: 32 },
  logoEmoji: { fontSize: 56 },
  logoText: { fontSize: 28, fontWeight: '900', color: '#1A1208', marginTop: 8, letterSpacing: -0.5 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A1208',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#8A7E72',
    marginBottom: 24,
  },

  /* Social buttons */
  socialRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  socialBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  googleBtn: {
    backgroundColor: '#fff',
    borderColor: '#EDE8E2',
  },
  appleBtn: {
    backgroundColor: '#1A1208',
    borderColor: '#1A1208',
  },
  socialBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1208',
  },

  /* Divider */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#EDE8E2',
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 13,
    color: '#A89A8A',
    fontWeight: '600',
  },

  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B5E50',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
    color: '#1A1208',
    fontWeight: '600',
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#1A1208',
    fontWeight: '600',
  },
  eyeBtn: {
    paddingHorizontal: 14,
  },
  error: {
    color: '#C62828',
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 10,
  },
  primaryBtn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
    flexWrap: 'wrap',
  },
  muted: { color: '#8A7E72', fontSize: 15 },
  link: { color: colors.primary, fontSize: 15, fontWeight: '700' },
});
