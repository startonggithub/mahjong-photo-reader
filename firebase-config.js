// Firebase Web app configuration.
// This file must not import or initialize Firebase.
export const firebaseConfig = {
  apiKey: "AIzaSyCzV1GkYtV1ia_OL6UNCXyZWXxTWfKXEv4",
  authDomain: "taiwanmj.firebaseapp.com",
  databaseURL: "https://taiwanmj.firebaseio.com",
  projectId: "taiwanmj",
  storageBucket: "taiwanmj.firebasestorage.app",
  messagingSenderId: "135650885845",
  appId: "1:135650885845:web:464b3c9ccc259eb0e5225c"
};

// Replace this with your reCAPTCHA Enterprise site key.
// It is NOT the apiKey shown above.
export const appCheckSiteKey =
  "6Le2pr8tAAAAAJok_ANlypsAU9A8OuMvOyfRG4xl";

export const useAppCheckDebugToken =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1";

export const geminiModelName = "gemini-3.5-flash-lite";
