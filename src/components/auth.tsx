"use client";
import { useState } from "react";
import {
  ArrowRight,
  LockKeyhole,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
export const ADMIN_EMAIL = "admin@roboticlab.internal";
export function Login() {
  const [username, setUsername] = useState("admin"),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-story">
        <img src="/logo.webp" alt="Roboticlab" />
        <div className="login-art">
          <div className="orbit one" />
          <div className="orbit two" />
          <div className="orbit three" />
          <div className="art-core">
            <span>R</span>
          </div>
          <span className="floating f1">Aprender.</span>
          <span className="floating f2">Crear.</span>
          <span className="floating f3">Crecer.</span>
        </div>
        <div>
          <div className="eyebrow">EL ESPACIO DE TU ACADEMIA</div>
          <h1>
            Todo conectado.
            <br />
            Todo bajo control.
          </h1>
          <p>
            Tus clases, tus cuentas y tus facturas.
            <br />
            Más tiempo para lo que de verdad importa.
          </p>
        </div>
        <small>ROBOTICLAB · GESTIÓN</small>
      </div>
      <div className="login-panel">
        <div className="login-form">
          <span className="login-lock">
            <LockKeyhole size={25} />
          </span>
          <h2>Bienvenido de nuevo</h2>
          <p>Accede a tu espacio de gestión.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const { error } = await supabase.auth.signInWithPassword({
                  email:
                    username.trim().toLowerCase() === "admin"
                      ? ADMIN_EMAIL
                      : username.trim(),
                  password,
                });
                if (error) throw error;
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "No se pudo iniciar sesión",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Usuario</span>
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="admin"
              />
            </label>
            <label className="field">
              <span>Contraseña</span>
              <div className="password-input">
                <input
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={
                    visible ? "Ocultar contraseña" : "Mostrar contraseña"
                  }
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {error && (
              <div role="alert" className="alert error">
                {error === "Invalid login credentials"
                  ? "Usuario o contraseña incorrectos. Comprueba que has ejecutado el SQL inicial."
                  : error}
              </div>
            )}
            <button className="primary login-submit" disabled={busy}>
              {busy ? "Entrando…" : "Entrar a Roboticlab"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="login-security">
            <ShieldCheck size={16} /> Acceso privado y datos protegidos
          </div>
        </div>
        <small>Tu espacio de trabajo, a tu ritmo.</small>
      </div>
    </div>
  );
}
