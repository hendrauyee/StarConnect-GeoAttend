import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check, MapPin, ServerCog, X } from 'lucide-react-native';
import { useSession } from '../auth/session';
import { getServerUrl, loadApiState, ApiRequestError } from '../api/client';
import { Button, Card, Field, PasswordField } from '../components/ui';
import { colors, radius, shadow, spacing } from '../theme';

type Mode = 'login' | 'register';

const MODES: { id: Mode; label: string }[] = [
  { id: 'login', label: 'Masuk' },
  { id: 'register', label: 'Daftar' },
];

/** Ceklis syarat kata sandi — sama dengan halaman register web. */
function passwordChecks(password: string) {
  return [
    { label: 'Minimal 8 karakter', valid: password.length >= 8 },
    { label: 'Mengandung huruf besar', valid: /[A-Z]/.test(password) },
    { label: 'Mengandung angka', valid: /\d/.test(password) },
  ];
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function AuthScreen() {
  const { signIn, signUp } = useSession();

  const [mode, setMode] = useState<Mode>('login');
  const [serverUrl, setServerUrlState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Field bersama login & register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Field khusus register
  const [name, setName] = useState('');
  const [registrationCode, setRegistrationCode] = useState('');

  // Modal pengaturan server (draft terpisah agar bisa dibatalkan)
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [serverDraft, setServerDraft] = useState('');

  useEffect(() => {
    loadApiState().then(() => setServerUrlState(getServerUrl()));
  }, []);

  const checks = useMemo(() => passwordChecks(password), [password]);
  const isPasswordValid = checks.every((c) => c.valid);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword('');
  };

  const openServerModal = () => {
    setServerDraft(serverUrl);
    setServerModalOpen(true);
  };

  const saveServerModal = () => {
    setServerUrlState(serverDraft.trim() || getServerUrl());
    setServerModalOpen(false);
  };

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Isi email dan kata sandi');
      return;
    }
    setLoading(true);
    try {
      await signIn(serverUrl, email.trim(), password);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(
          err.status === 401 || err.status === 400
            ? 'Email atau kata sandi salah'
            : err.message
        );
      } else {
        setError('Terjadi kesalahan. Coba lagi.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Isi nama lengkap Anda');
      return;
    }
    if (!isEmail(email)) {
      setError('Format email tidak valid');
      return;
    }
    if (!isPasswordValid) {
      setError('Kata sandi belum memenuhi persyaratan');
      return;
    }
    if (!registrationCode.trim()) {
      setError('Masukkan kode pendaftaran dari administrator');
      return;
    }

    setLoading(true);
    try {
      await signUp(serverUrl, { name, email, password, registrationCode });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // Kode pendaftaran salah / pendaftaran ditutup sudah berpesan Indonesia
        // dari server; email duplikat dijawab USER_ALREADY_EXISTS_* (422) dlm Inggris.
        setError(
          err.code?.startsWith('USER_ALREADY_EXISTS') || err.status === 422
            ? 'Email sudah terdaftar. Gunakan email lain atau masuk.'
            : err.message
        );
      } else {
        setError('Terjadi kesalahan. Coba lagi.');
      }
    } finally {
      setLoading(false);
    }
  };

  const serverLabel = serverUrl.replace(/^https?:\/\//, '');
  const isRegister = mode === 'register';

  return (
    // Android pun perlu "padding": pada layar edge-to-edge jendelanya tidak
    // menyusut saat papan ketik muncul, jadi kolom sandi tertutup.
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.primary }} behavior="padding">
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.brandIconWrap}>
            <MapPin size={34} color={colors.primary} strokeWidth={2.2} />
          </View>
          <Text style={styles.brandName}>GeoAttend</Text>
          <Text style={styles.brandTagline}>Absensi dengan verifikasi lokasi & foto</Text>
        </View>

        <Card style={{ gap: spacing.lg }}>
          {/* Segmented control Masuk / Daftar */}
          <View style={styles.segmented}>
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => switchMode(m.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={[styles.segment, active && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View>
            <Text style={styles.title}>
              {isRegister ? 'Buat akun' : 'Selamat datang kembali'}
            </Text>
            <Text style={styles.subtitle}>
              {isRegister
                ? 'Daftar sekali, lalu absen cukup dari ponsel'
                : 'Masuk untuk mulai absensi hari ini'}
            </Text>
          </View>

          {isRegister && (
            <Field
              label="Nama Lengkap"
              value={name}
              onChangeText={setName}
              autoComplete="name"
              placeholder="Budi Santoso"
            />
          )}

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="nama@perusahaan.com"
          />

          <View style={{ gap: spacing.sm }}>
            <PasswordField
              label="Kata Sandi"
              value={password}
              onChangeText={setPassword}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              placeholder="••••••••"
            />
            {isRegister && password.length > 0 && (
              <View style={{ gap: 2 }}>
                {checks.map((check) => (
                  <View key={check.label} style={styles.checkRow}>
                    {check.valid ? (
                      <Check size={13} color={colors.success} strokeWidth={2.5} />
                    ) : (
                      <X size={13} color={colors.textSecondary} strokeWidth={2.5} />
                    )}
                    <Text
                      style={[
                        styles.checkText,
                        check.valid && { color: colors.success },
                      ]}
                    >
                      {check.label}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {isRegister && (
            <Field
              label="Kode Pendaftaran"
              value={registrationCode}
              onChangeText={(v) => setRegistrationCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Kode dari administrator"
              hint="Minta kode pendaftaran kepada administrator perusahaan Anda"
              style={{ letterSpacing: 2 }}
            />
          )}

          {error && (
            <View style={styles.errorBox}>
              <Text style={{ color: colors.destructive, fontSize: 14 }}>{error}</Text>
            </View>
          )}

          <Button
            title={loading ? 'Memproses...' : isRegister ? 'Daftar' : 'Masuk'}
            onPress={isRegister ? handleRegister : handleLogin}
            loading={loading}
          />

          <Pressable onPress={openServerModal} style={styles.serverRow}>
            <ServerCog size={15} color={colors.textSecondary} />
            <Text style={styles.serverToggle}>{serverLabel}</Text>
          </Pressable>
        </Card>

        <Text style={styles.footer}>StarConnect</Text>
      </ScrollView>

      {/* Modal pengaturan server — kartu di ATAS layar agar tak tertutup keyboard */}
      <Modal
        visible={serverModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setServerModalOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setServerModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pengaturan Server</Text>
              <Pressable onPress={() => setServerModalOpen(false)} hitSlop={8}>
                <X size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Field
              label="Alamat Server"
              value={serverDraft}
              onChangeText={setServerDraft}
              autoFocus
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://absensi.serayu.id"
              hint="Ubah hanya bila diminta administrator"
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Button
                title="Batal"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setServerModalOpen(false)}
              />
              <Button title="Simpan" style={{ flex: 1 }} onPress={saveServerModal} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xl,
  },
  brand: { alignItems: 'center', gap: 4 },
  brandIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  brandName: { fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  brandTagline: { fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  segmented: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: '#F1F5F9',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  segmentTextActive: { color: colors.primary },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkText: { fontSize: 12, color: colors.textSecondary },
  errorBox: {
    backgroundColor: colors.destructiveSubtle,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  serverToggle: { color: colors.textSecondary, fontSize: 13 },
  footer: { textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
  },
  // Sudut & bayangannya disamakan dengan dialog AppAlert agar sekeluarga
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.lg,
    ...shadow.raised,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
});
