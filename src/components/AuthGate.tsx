import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";

type AuthContextValue = {
  user: User;
  session: Session;
  signOut: () => Promise<void>;
  isPaused?: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_ACCESS_PAUSED = true;
const pausedUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@artficha.local",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {
    role: "admin",
  },
  aud: "authenticated",
  created_at: new Date(0).toISOString(),
} as User;
const pausedSession = {
  access_token: "auth-paused",
  refresh_token: "auth-paused",
  expires_in: 3600,
  token_type: "bearer",
  user: pausedUser,
} as Session;
const pausedAuthContext: AuthContextValue = {
  user: pausedUser,
  session: pausedSession,
  isPaused: true,
  signOut: async () => undefined,
};

export function useAuthSession() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuthSession debe usarse dentro de AuthGate.");
  }

  return context;
}

function AuthForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsBusy(true);

    try {
      const credentials = {
        email: email.trim(),
        password,
      };
      const { error } =
        mode === "signin"
          ? await supabase.auth.signInWithPassword(credentials)
          : await supabase.auth.signUp(credentials);

      if (error) throw error;

      toast({
        title: mode === "signin" ? "Sesion iniciada" : "Usuario creado",
        description:
          mode === "signup"
            ? "Si Supabase requiere confirmacion por email, revisa tu correo antes de entrar."
            : "Tus fichas quedan aisladas por usuario.",
      });
    } catch (error) {
      toast({
        title: "No se pudo autenticar",
        description:
          error instanceof Error
            ? error.message
            : "Revisa email y contrasena.",
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(42,90,160,0.16),transparent_35%),linear-gradient(180deg,#f9fbff,#eef3f9)] px-4 py-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-5xl items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white/70 px-3 py-1 text-xs font-medium text-primary shadow-sm">
            <ShieldCheck className="h-3.5 w-3.5" />
            Modo profesional seguro
          </div>
          <div className="space-y-3">
            <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              ArtFicha ahora trabaja con fichas privadas por usuario.
            </h1>
            <p className="max-w-xl text-sm leading-6 text-slate-600">
              Inicia sesion para generar, revisar y publicar sin mezclar datos
              entre escritorios. Esta barrera es la base para subir el proyecto
              a nivel SaaS serio.
            </p>
          </div>
        </section>

        <Card className="border-primary/10 bg-white/90 shadow-[0_30px_90px_-55px_rgba(20,35,70,0.7)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <LockKeyhole className="h-5 w-5 text-primary" />
              {mode === "signin" ? "Entrar en ArtFicha" : "Crear cuenta"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="auth-password">Contrasena</Label>
                <Input
                  id="auth-password"
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <Button className="w-full" type="submit" disabled={isBusy}>
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "signin" ? "Iniciar sesion" : "Crear usuario"}
              </Button>
            </form>
            <Button
              className="mt-3 w-full"
              type="button"
              variant="ghost"
              onClick={() =>
                setMode((current) =>
                  current === "signin" ? "signup" : "signin",
                )
              }
            >
              {mode === "signin"
                ? "No tengo cuenta, crear una"
                : "Ya tengo cuenta, entrar"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue | null>(() => {
    if (!session?.user) return null;

    return {
      user: session.user,
      session,
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    };
  }, [session]);

  if (AUTH_ACCESS_PAUSED) {
    return (
      <AuthContext.Provider value={pausedAuthContext}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!value) {
    return <AuthForm />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function SignOutButton() {
  const { isPaused, signOut } = useAuthSession();

  if (isPaused) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        Registro pausado
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void signOut()}
    >
      <LogOut className="h-4 w-4" />
      Salir
    </Button>
  );
}
