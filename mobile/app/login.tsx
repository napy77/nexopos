import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { api, ApiError, mensaje } from "@/lib/api";
import * as Bio from "@/lib/biometria";
import { useSesion, type Comercio } from "@/lib/sesion";
import { Boton, Aviso } from "@/components/ui";
import { color, s } from "@/lib/tema";
import * as WebBrowser from "expo-web-browser";

// La huella se pide sola una vez por arranque de la app. Después de "Cerrar
// sesión" el login vuelve a montarse, y pedirla ahí de nuevo sería un estorbo.
let yaSePidio = false;

/** Alert con promesa, para esperar la respuesta antes de entrar. */
const preguntar = (titulo: string, texto: string, si: string, no: string) =>
  new Promise<boolean>((ok) => Alert.alert(titulo, texto, [
    { text: no, style: "cancel", onPress: () => ok(false) },
    { text: si, onPress: () => ok(true) },
  ], { cancelable: false }));

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
  const [bio, setBio] = useState<Bio.Biometria | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);

  useEffect(() => {
    const pedirSola = !yaSePidio;
    yaSePidio = true;
    (async () => {
      const [b, g] = await Promise.all([Bio.biometria(), Bio.emailGuardado()]);
      setBio(b);
      if (!b.disponible || !g) return;
      setGuardado(g);
      setEmail(g);
      if (pedirSola) conHuella(b.nombre);
    })().catch(() => { /* sin biometría queda la contraseña */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(mail: string, clave: string) {
    const r = await api<{ token: string; commerce: Comercio }>("/api/auth/login", {
      body: { email: mail, password: clave },
    });
    return { token: r.token, comercio: { ...r.commerce, id: Number(r.commerce.id) } };
  }

  async function conHuella(nombre: string) {
    setError("");
    let datos: { email: string; password: string } | null;
    try {
      datos = await Bio.leer(nombre);
    } catch {
      return; // canceló: queda la contraseña a mano
    }
    if (!datos) {
      setGuardado(null);
      setError(`Cambiaron los datos de ${nombre} del teléfono. Ingresá con la contraseña para volver a activarlo.`);
      return;
    }
    setEnviando(true);
    try {
      const r = await login(datos.email, datos.password);
      await entrar(r.token, r.comercio);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // La contraseña cambió en NexoB2B: la guardada ya no sirve
        await Bio.olvidar();
        setGuardado(null);
        setError("La contraseña cambió. Ingresá con la nueva.");
      } else {
        setError(mensaje(err, "No se pudo ingresar"));
      }
    } finally {
      setEnviando(false);
    }
  }

  async function ingresar() {
    setError("");
    setEnviando(true);
    try {
      const mail = email.trim();
      const r = await login(mail, password);
      // Se ofrece antes de entrar: al entrar se desmonta esta pantalla
      if (bio?.disponible && guardado !== mail && !(await Bio.rechazado())) {
        const si = await preguntar(
          `¿Ingresar con ${bio.nombre}?`,
          `La próxima vez entrás con ${bio.nombre} en lugar de escribir la contraseña.`,
          "Activar", "Ahora no",
        );
        if (si) await Bio.guardar(mail, password, bio.nombre).catch(() => { /* canceló la huella */ });
        else await Bio.rechazar();
      }
      await entrar(r.token, r.comercio);
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
        {bio?.disponible && guardado ? (
          <Boton variante="secundario" onPress={() => conHuella(bio.nombre)} desactivado={enviando}>
            {`Ingresar con ${bio.nombre}`}
          </Boton>
        ) : null}
        <Pressable onPress={() => WebBrowser.openBrowserAsync("https://nexob2b.app/comercio/registro")}>
          <Text style={[s.apagado, { textAlign: "center", color: color.primario }]}>
            ¿No tenés cuenta? Se crea gratis en NexoB2B
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
