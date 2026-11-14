import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// Konfigurasi Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBMva1IHop4D_zF3NmNxHGNHk_nLEyuvPk",
  authDomain: "absensi-qr-online-dde8c.firebaseapp.com",
  projectId: "absensi-qr-online-dde8c",
  storageBucket: "absensi-qr-online-dde8c.firebasestorage.app",
  messagingSenderId: "120675745126",
  appId: "1:120675745126:web:d2cb5865bcef253be3dca7",
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);

// Authentication
export const auth = getAuth(app);

// Firestore
export const db = getFirestore(app);

// Persistence
export const authPersistence = setPersistence(auth, browserLocalPersistence);
