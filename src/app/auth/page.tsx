"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { getSupabaseSessionSafe } from "@/lib/supabase/client";
import {
  ensureTenantInitialization,
  getAuthClient,
  hasTenantMembership,
  hasTenantContext,
  signIn,
  signUpAndInitialize,
} from "@/features/auth/repository";

type AuthMode = "login" | "register";

interface AuthFormState {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  password: string;
}

const EMPTY_FORM: AuthFormState = {
  companyName: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  password: "",
};

export default function AuthPage() {
  const router = useRouter();
  const supabase = useMemo(() => getAuthClient(), []);
  const [mode, setMode] = useState<AuthMode>("login");
  const [formValues, setFormValues] = useState<AuthFormState>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isLoggedInWithoutTenant, setIsLoggedInWithoutTenant] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });

  const waitForTenantReady = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const tenantExists = await hasTenantContext();
      if (tenantExists) {
        return true;
      }

      await wait(350);
    }

    return false;
  };

  const waitForTenantMembershipReady = async (tenantId: string) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const membershipExists = await hasTenantMembership(tenantId);
      if (membershipExists) {
        return true;
      }

      await wait(500);
    }

    return false;
  };

  const navigateToApp = () => {
    router.replace("/dashboard");

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (window.location.pathname.startsWith("/auth")) {
          window.location.assign("/dashboard");
        }
      }, 150);
    }
  };

  useEffect(() => {
    const setupMode = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mode") : null;
    if (setupMode === "setup") {
      setMode("register");
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const resolveState = async (sessionOverride?: { user: { email?: string | null } } | null) => {
      try {
        const session =
          sessionOverride === undefined
            ? (await getSupabaseSessionSafe(supabase)).data.session
            : sessionOverride;
        if (!isMounted) {
          return;
        }

        if (!session) {
          setIsLoggedInWithoutTenant(false);
          return;
        }

        const tenantExists = await hasTenantContext();
        if (!isMounted) {
          return;
        }

        if (tenantExists) {
          navigateToApp();
          return;
        }

        const userEmail = session.user.email ?? "";
        setFormValues((prev) => ({
          ...prev,
          email: prev.email || userEmail,
        }));
        setIsLoggedInWithoutTenant(true);
      } catch {
        if (!isMounted) {
          return;
        }
        setIsLoggedInWithoutTenant(false);
      } finally {
        if (isMounted) {
          setIsChecking(false);
        }
      }
    };

    resolveState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        if (!isMounted) {
          return;
        }

        void resolveState(session).catch(() => {
          if (isMounted) {
            setIsLoggedInWithoutTenant(false);
            setIsChecking(false);
          }
        });
      }, 0);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await signIn(formValues.email, formValues.password);
      const tenantExists = await hasTenantContext();
      if (tenantExists) {
        navigateToApp();
      } else {
        setIsLoggedInWithoutTenant(true);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const tenantId = await signUpAndInitialize({
        companyName: formValues.companyName,
        contactPerson: formValues.contactPerson,
        email: formValues.email,
        phone: formValues.phone,
        address: formValues.address,
        password: formValues.password,
      });
      const tenantMembershipReady = await waitForTenantMembershipReady(tenantId);
      if (!tenantMembershipReady) {
        throw new Error("Tenant-Membership wurde nach der Registrierung noch nicht verfügbar.");
      }
      navigateToApp();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Registrierung fehlgeschlagen.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (formValues.companyName.trim().length === 0) {
      setErrorMessage("Firmenname ist erforderlich.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const tenantId = await ensureTenantInitialization({
        companyName: formValues.companyName,
        contactPerson: formValues.contactPerson,
        email: formValues.email || undefined,
        phone: formValues.phone,
        address: formValues.address,
      });

      const tenantMembershipReady = await waitForTenantMembershipReady(tenantId);
      if (!tenantMembershipReady) {
        throw new Error("Tenant-Membership wurde nach dem Setup noch nicht verfügbar.");
      }

      setIsLoggedInWithoutTenant(false);
      navigateToApp();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Setup fehlgeschlagen.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isChecking) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-5 text-sm text-slate-600">Lade Anmeldung...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-800">Sicherheitsangebote</h1>
          <p className="text-sm text-slate-500">
            {isLoggedInWithoutTenant
              ? "Bitte Firmendaten abschließen, um das Tool freizuschalten."
              : mode === "login"
                ? "Mit Ihrem Konto anmelden."
                : "Neues Konto und Firma anlegen."}
          </p>
        </div>

        {!isLoggedInWithoutTenant && (
          <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
            <button
              type="button"
              className={`px-3 py-2 text-sm ${mode === "login" ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}
              onClick={() => setMode("login")}
            >
              Anmelden
            </button>
            <button
              type="button"
              className={`px-3 py-2 text-sm ${mode === "register" ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}
              onClick={() => setMode("register")}
            >
              Registrieren
            </button>
          </div>
        )}

        {isLoggedInWithoutTenant ? (
          <form className="space-y-4" onSubmit={handleCompleteSetup}>
            <div>
              <label htmlFor="setup-companyName" className="block text-sm font-medium text-slate-700 mb-1">
                Firmenname *
              </label>
              <input
                id="setup-companyName"
                type="text"
                value={formValues.companyName}
                onChange={(event) => setFormValues((prev) => ({ ...prev, companyName: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="setup-contactPerson" className="block text-sm font-medium text-slate-700 mb-1">
                  Ansprechpartner
                </label>
                <input
                  id="setup-contactPerson"
                  type="text"
                  value={formValues.contactPerson}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, contactPerson: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="setup-phone" className="block text-sm font-medium text-slate-700 mb-1">
                  Telefon
                </label>
                <input
                  id="setup-phone"
                  type="text"
                  value={formValues.phone}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, phone: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="setup-address" className="block text-sm font-medium text-slate-700 mb-1">
                Adresse
              </label>
              <textarea
                id="setup-address"
                rows={3}
                value={formValues.address}
                onChange={(event) => setFormValues((prev) => ({ ...prev, address: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Speichere..." : "Setup abschließen"}
            </Button>
          </form>
        ) : mode === "login" ? (
          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">
                E-Mail *
              </label>
              <input
                id="login-email"
                type="email"
                value={formValues.email}
                onChange={(event) => setFormValues((prev) => ({ ...prev, email: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1">
                Passwort *
              </label>
              <input
                id="login-password"
                type="password"
                value={formValues.password}
                onChange={(event) => setFormValues((prev) => ({ ...prev, password: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Anmeldung..." : "Anmelden"}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={handleRegister}>
            <div>
              <label htmlFor="register-companyName" className="block text-sm font-medium text-slate-700 mb-1">
                Firmenname *
              </label>
              <input
                id="register-companyName"
                type="text"
                value={formValues.companyName}
                onChange={(event) => setFormValues((prev) => ({ ...prev, companyName: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="register-contactPerson" className="block text-sm font-medium text-slate-700 mb-1">
                  Ansprechpartner
                </label>
                <input
                  id="register-contactPerson"
                  type="text"
                  value={formValues.contactPerson}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, contactPerson: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="register-phone" className="block text-sm font-medium text-slate-700 mb-1">
                  Telefon
                </label>
                <input
                  id="register-phone"
                  type="text"
                  value={formValues.phone}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, phone: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="register-email" className="block text-sm font-medium text-slate-700 mb-1">
                E-Mail *
              </label>
              <input
                id="register-email"
                type="email"
                value={formValues.email}
                onChange={(event) => setFormValues((prev) => ({ ...prev, email: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-slate-700 mb-1">
                Passwort *
              </label>
              <input
                id="register-password"
                type="password"
                value={formValues.password}
                onChange={(event) => setFormValues((prev) => ({ ...prev, password: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                minLength={8}
                required
              />
            </div>

            <div>
              <label htmlFor="register-address" className="block text-sm font-medium text-slate-700 mb-1">
                Adresse
              </label>
              <textarea
                id="register-address"
                rows={3}
                value={formValues.address}
                onChange={(event) => setFormValues((prev) => ({ ...prev, address: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Registrierung..." : "Registrieren"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
