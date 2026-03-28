import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCLNikbk5_3XpP4NbOWH73spg0Nk3Gfh88",
  authDomain: "mourish-ai.firebaseapp.com",
  databaseURL: "https://mourish-ai-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mourish-ai",
  storageBucket: "mourish-ai.firebasestorage.app",
  messagingSenderId: "459592931538",
  appId: "1:459592931538:web:a7a176014606133ee1750b",
  measurementId: "G-MJRRGQ2QCJ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const googleProvider = new GoogleAuthProvider();
