// Firebase Configuration & Initialization
// Replace the placeholder values below with your Firebase Web App config,
// OR paste your config JSON directly inside the app's "Firebase Setup" modal.
// Never put private service account credentials in frontend code.

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDjr-3V0dBoUUv4ihFMwtcBbQixzXp8pVQ",
  authDomain: "jee-cards.firebaseapp.com",
  projectId: "jee-cards",
  storageBucket: "jee-cards.firebasestorage.app",
  messagingSenderId: "631106715527",
  appId: "1:631106715527:web:1c14cee3612a95552b1d22",
  measurementId: "G-SBLMCEGJJP"
};

const CONFIG_STORAGE_KEY = "jee_recall_firebase_config";

export function getSavedFirebaseConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.apiKey && parsed.projectId) {
        return parsed;
      }
    }
  } catch (_) {}
  if (DEFAULT_FIREBASE_CONFIG.apiKey && DEFAULT_FIREBASE_CONFIG.projectId) {
    return DEFAULT_FIREBASE_CONFIG;
  }
  return null;
}

export function saveFirebaseConfig(configObj) {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configObj));
  } catch (_) {}
}

export function clearFirebaseConfig() {
  try {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
  } catch (_) {}
}

export async function initFirebaseServices() {
  const config = getSavedFirebaseConfig();
  if (!config) {
    return { ready: false, mode: "local-preview", app: null, auth: null, db: null };
  }

  try {
    const [
      { initializeApp, getApps },
      { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult },
      { getFirestore }
    ] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")
    ]);

    const app = getApps().length ? getApps()[0] : initializeApp(config);
    const auth = getAuth(app);
    const db = getFirestore(app);

    return {
      ready: true,
      mode: "firebase",
      app,
      auth,
      db,
      authApi: {
        onAuthStateChanged,
        signInWithEmailAndPassword,
        createUserWithEmailAndPassword,
        signOut,
        GoogleAuthProvider,
        signInWithPopup,
        signInWithRedirect,
        getRedirectResult
      }
    };
  } catch (err) {
    return { ready: false, mode: "error", error: err.message, app: null, auth: null, db: null };
  }
}
