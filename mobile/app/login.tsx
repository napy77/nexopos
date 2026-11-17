import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { api, mensaje } from "@/lib/api";
import { useSesion, type Comercio } from "@/lib/sesion";
import { Boton, Aviso } from "@/components/ui";
import { color, s } from "@/lib/tema";
import * as WebBrowser from "expo-web-browser";

/**
 * Se entra con la cuenta de NexoB2B: no hay alta propia en NexoPOS. El alta
 * se hace en NexoB2B, afuera de la app.
 */
export default function Login() {
  const entrar = useSesion((e) => e.entrar);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function ingresar() {
    setError("");
    setEnviando(true);
    try {
      const r = await api<{ token: string; commerce: Comercio }>("/api/auth/login", {
        body: { email: email.trim(), password },
      });
      await entrar(r.token, { ...r.commerce, id: Number(r.commerce.id) });
    } catch (err) {
      setError(mensaje(err, "No se pudo ingresar"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[s.pantalla, { justifyContent: "center", alignItems: "center", padding: 16 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[s.tarjeta, { width: "100%", maxWidth: 420, gap: 12 }]}>
        <Text style={[s.titulo, { textAlign: "center" }]}>NexoPOS</Text>
        <Text style={[s.apagado, { textAlign: "center" }]}>Ingresá con tu cuenta de NexoB2B</Text>
        <TextInput
          style={s.input} placeholder="Email" value={email} onChangeText={setEmail}
          autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username"
        />
        <TextInput
          style={s.input} placeholder="Contraseña" value={password} onChangeText={setPassword}
          secureTextEntry textContentType="password" onSubmitEditing={ingresar} returnKeyType="go"
        />
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        <Boton onPress={ingresar} cargando={enviando} desactivado={!email || !password}>Ingresar</Boton>
        <Pressable onPress={() => WebBrowser.openBrowserAsync("https://nexob2b.app/comercio/registro")}>
          <Text style={[s.apagado, { textAlign: "center", color: color.primario }]}>
            ¿No tenés cuenta? Se crea gratis en NexoB2B
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
