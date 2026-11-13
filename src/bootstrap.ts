/// <reference types="node" />
import dotenv from 'dotenv';

/**
 * Bootstrap environment loader for ScholarCore server processes.
 *
 * Evaluation Invariants:
 * 1. Must be imported as the very first import in server entry points so it executes
 *    before any subsequent modules access process.env.
 * 2. In non-production environments (NODE_ENV !== 'production'):
 *    - Loads .env.local first (without override).
 *    - Loads .env second (without override).
 *    - Because dotenv default behavior never overwrites pre-existing keys, host-provided
 *      environment variables always take highest precedence, followed by .env.local,
 *      followed by .env.
 * 3. In production environments (NODE_ENV === 'production'):
 *    - Does NOT load .env.local or .env from disk.
 *    - Requires all production configuration to be supplied exclusively by the hosting platform.
 */
export function initEnvironment(): void {
  if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: '.env.local' });
    dotenv.config();
  }
}

// Automatically initialize when imported
initEnvironment();
