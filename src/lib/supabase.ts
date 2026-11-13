/// <reference types="vite/client" />

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * ScholarCore browser Supabase client.
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from environment variables.
 * Never put a Supabase service-role or secret key in this file.
 */

const getClientEnv = (key: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return String(import.meta.env[key]).trim();
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return String(process.env[key]).trim();
  }
  return '';
};

const supabaseUrl = getClientEnv('VITE_SUPABASE_URL');
const supabaseAnonKey =
  getClientEnv('VITE_SUPABASE_ANON_KEY') || getClientEnv('SUPABASE_ANON_KEY');

const isPlaceholder = (value: string | undefined): boolean => {
  if (!value || typeof value !== 'string') return true;
  const trimmed = value.trim();
  return (
    trimmed === '' ||
    /placeholder|your-project|your-anon-key|paste_the_matching_demo_publishable_key_here|configuration-required/i.test(
      trimmed
    )
  );
};

export const isLocalhostUrl = (parsedUrl: URL): boolean => {
  const hostname = parsedUrl.hostname.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
};

export const isValidSupabaseUrl = (urlStr: string | undefined): boolean => {
  if (!urlStr || isPlaceholder(urlStr)) return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === 'https:') {
      return true;
    }
    if (parsed.protocol === 'http:') {
      return isLocalhostUrl(parsed);
    }
    return false;
  } catch {
    return false;
  }
};

export const isValidSupabaseKey = (keyStr: string | undefined): boolean => {
  if (!keyStr || isPlaceholder(keyStr)) return false;
  return keyStr.trim().length > 20;
};

export const isSupabaseConfigured = (): boolean => {
  return isValidSupabaseUrl(supabaseUrl) && isValidSupabaseKey(supabaseAnonKey);
};

export const getSupabaseConfigStatus = () => {
  let configuredHost = 'unconfigured';

  if (isValidSupabaseUrl(supabaseUrl)) {
    try {
      configuredHost = new URL(supabaseUrl).host;
    } catch {
      configuredHost = 'invalid-url';
    }
  }

  return {
    isConfigured: isSupabaseConfigured(),
    urlConfigured: isValidSupabaseUrl(supabaseUrl),
    keyConfigured: isValidSupabaseKey(supabaseAnonKey),
    configuredHost,
  };
};

/**
 * Creates a safe unconfigured client that fails immediately with a descriptive
 * error if invoked, avoiding silent network requests to non-existent or fake hostnames.
 */
export const createUnconfiguredClient = (): SupabaseClient => {
  const unconfiguredError = new Error(
    'Supabase client is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.'
  );

  const chainableQuery: any = {
    select: () => chainableQuery,
    insert: () => chainableQuery,
    update: () => chainableQuery,
    delete: () => chainableQuery,
    eq: () => chainableQuery,
    neq: () => chainableQuery,
    in: () => chainableQuery,
    order: () => chainableQuery,
    limit: () => chainableQuery,
    single: () => Promise.resolve({ data: null, error: unconfiguredError }),
    maybeSingle: () => Promise.resolve({ data: null, error: unconfiguredError }),
    then: (resolve: any, reject: any) =>
      Promise.resolve({ data: null, error: unconfiguredError }).then(resolve, reject),
    catch: (reject: any) =>
      Promise.resolve({ data: null, error: unconfiguredError }).catch(reject),
  };

  const dummyClient: any = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: unconfiguredError }),
      getUser: async () => ({ data: { user: null }, error: unconfiguredError }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: unconfiguredError,
      }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe: () => {},
          },
        },
      }),
    },
    from: () => chainableQuery,
    rpc: async () => ({ data: null, error: unconfiguredError }),
  };

  return dummyClient as SupabaseClient;
};

export const supabase: SupabaseClient = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : createUnconfiguredClient();