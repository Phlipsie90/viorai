import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;
let authReadQueue: Promise<void> = Promise.resolve();

const BROWSER_CLIENT_KEY = "__crmToolSupabaseBrowserClient";

interface BrowserGlobalScope {
  [BROWSER_CLIENT_KEY]?: SupabaseClient;
}

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase environment variables are missing.");
  }

  return { url, anonKey };
}

function createConfiguredClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export function createSupabaseServerClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseEnv();
  return createConfiguredClient(url, anonKey);
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    const globalScope = window as Window & BrowserGlobalScope;
    if (globalScope[BROWSER_CLIENT_KEY]) {
      browserClient = globalScope[BROWSER_CLIENT_KEY] ?? browserClient;
      if (browserClient) {
        return browserClient;
      }
    }
  }

  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = getSupabaseEnv();
  browserClient = createConfiguredClient(url, anonKey);

  if (typeof window !== "undefined") {
    const globalScope = window as Window & BrowserGlobalScope;
    globalScope[BROWSER_CLIENT_KEY] = browserClient;
  }

  return browserClient;
}

export function getSupabaseClient(): SupabaseClient {
  return getSupabaseBrowserClient();
}

function runSerializedAuthRead<T>(operation: () => Promise<T>): Promise<T> {
  const run = authReadQueue.then(operation, operation);
  authReadQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function getSupabaseSessionSafe(client: SupabaseClient) {
  return runSerializedAuthRead(() => client.auth.getSession());
}

export function getSupabaseUserSafe(client: SupabaseClient) {
  return runSerializedAuthRead(() => client.auth.getUser());
}

