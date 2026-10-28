import type { SessionData } from '../types/session';

export const STORAGE_SCHEMA_VERSION = 1;
export const DB_NAME = 'bicycle_calibration_db';
export const SESSIONS_STORE = 'sessions';
export const META_STORE = 'meta';

export interface StorageMetadata {
  schemaVersion: number;
  lastPersistedAt: string;
  sessionCount: number;
}

export type StorageHealthStatus = 'ready' | 'degraded' | 'unavailable';

export interface StorageStatus {
  health: StorageHealthStatus;
  persistedCount: number;
  lastPersistedAt: string | null;
  lastError: string | null;
}

function getIndexedDB(): IDBFactory | null {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB) {
    return (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB;
  }
  return null;
}

function openDatabase(): Promise<IDBDatabase> {
  const idb = getIndexedDB();
  if (!idb) {
    return Promise.reject(new Error('IndexedDB is not available in this runtime environment.'));
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, STORAGE_SCHEMA_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'reference' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

/**
 * Validates the minimum shape of a SessionData record before accepting it from storage.
 * Malformed or corrupt records are rejected gracefully without crashing the app.
 */
export function isValidSessionRecord(item: unknown): item is SessionData {
  if (!item || typeof item !== 'object') return false;
  const s = item as Partial<SessionData>;
  return (
    typeof s.reference === 'string' &&
    s.reference.trim().length > 0 &&
    typeof s.operator === 'string' &&
    typeof s.courseLength === 'string' &&
    Array.isArray(s.pre) &&
    Array.isArray(s.post) &&
    typeof s.distStart === 'string' &&
    typeof s.distFinish === 'string' &&
    Array.isArray(s.audit)
  );
}

/**
 * Persists an array of sessions to IndexedDB in an atomic transaction.
 */
export async function saveSessionsToStorage(sessions: SessionData[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([SESSIONS_STORE, META_STORE], 'readwrite');
      const sessionStore = tx.objectStore(SESSIONS_STORE);
      const metaStore = tx.objectStore(META_STORE);

      // Clear existing records to mirror current state without ghosts
      sessionStore.clear();

      for (const s of sessions) {
        sessionStore.put(s);
      }

      const meta: StorageMetadata = {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        lastPersistedAt: new Date().toISOString(),
        sessionCount: sessions.length
      };
      metaStore.put({ key: 'metadata', ...meta });

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const err = tx.error || new Error('Transaction error while saving sessions');
        db.close();
        reject(err);
      };
      tx.onabort = () => {
        const err = tx.error || new Error('Transaction aborted while saving sessions');
        db.close();
        reject(err);
      };
    } catch (e) {
      db.close();
      reject(e);
    }
  });
}

/**
 * Loads all valid sessions from IndexedDB. Corrupt records are discarded with a warning.
 */
export async function loadSessionsFromStorage(): Promise<{
  sessions: SessionData[];
  metadata: StorageMetadata | null;
  corruptCount: number;
}> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([SESSIONS_STORE, META_STORE], 'readonly');
      const sessionStore = tx.objectStore(SESSIONS_STORE);
      const metaStore = tx.objectStore(META_STORE);

      const sessionsRequest = sessionStore.getAll();
      const metaRequest = metaStore.get('metadata');

      tx.oncomplete = () => {
        db.close();
        const rawSessions: unknown[] = sessionsRequest.result || [];
        const validSessions: SessionData[] = [];
        let corruptCount = 0;

        for (const item of rawSessions) {
          if (isValidSessionRecord(item)) {
            validSessions.push(item);
          } else {
            corruptCount++;
          }
        }

        const rawMeta = metaRequest.result;
        const metadata: StorageMetadata | null = rawMeta
          ? {
              schemaVersion: rawMeta.schemaVersion ?? STORAGE_SCHEMA_VERSION,
              lastPersistedAt: rawMeta.lastPersistedAt ?? '',
              sessionCount: rawMeta.sessionCount ?? validSessions.length
            }
          : null;

        resolve({ sessions: validSessions, metadata, corruptCount });
      };

      tx.onerror = () => {
        const err = tx.error || new Error('Error loading records from IndexedDB');
        db.close();
        reject(err);
      };
    } catch (e) {
      db.close();
      reject(e);
    }
  });
}

/**
 * Clears the storage database entirely (used in tests or manual reset).
 */
export async function clearStorage(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([SESSIONS_STORE, META_STORE], 'readwrite');
      tx.objectStore(SESSIONS_STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    } catch (e) {
      db.close();
      reject(e);
    }
  });
}
