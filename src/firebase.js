import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBwdUakOfITwhMti9hHkWrGtpchnilIF2I",
  authDomain: "cargo-tracker-86e56.firebaseapp.com",
  projectId: "cargo-tracker-86e56",
  storageBucket: "cargo-tracker-86e56.firebasestorage.app",
  messagingSenderId: "1075108948681",
  appId: "1:1075108948681:web:02a808e02937454d6e7b18"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);