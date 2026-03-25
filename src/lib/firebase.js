import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, getDocs, deleteDoc, doc } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyComfvyI-NQx1wtJFvjYjGgd0WAHF-X5_0",
  authDomain: "image-transfer-27883.firebaseapp.com",
  projectId: "image-transfer-27883",
  storageBucket: "image-transfer-27883.firebasestorage.app",
  messagingSenderId: "12969401301",
  appId: "1:12969401301:web:b7ef9f3f4542ddcc13fb5c",
  measurementId: "G-3G0HLQLEQ1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;
export const db = getFirestore(app);
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Auth Functions
export const signInWithGoogle = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);

export const saveImageMetadata = async (imageUrl, name, userId, publicId = null) => {
  try {
    const docRef = await addDoc(collection(db, "images"), {
      url: imageUrl,
      name: name,
      userId: userId, // Keep track of who uploaded it
      publicId: publicId, // Ensure it gets populated for deletion
      timestamp: serverTimestamp()
    });
    return docRef;
  } catch (error) {
    console.error("Error adding document: ", error);
    throw error;
  }
};

export const deleteImageMetadata = async (imageId) => {
  try {
    await deleteDoc(doc(db, "images", imageId));
  } catch (error) {
    console.error("Error deleting document: ", error);
    throw error;
  }
};

export const subscribeToImages = (userId, callback) => {
  if (!userId) return () => { };

  // Only fetch images that belong to the current user
  const q = query(
    collection(db, "images"),
    where("userId", "==", userId)
  );

  return onSnapshot(q,
    (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort manually by timestamp (descending)
      data.sort((a, b) => {
        const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp || 0);
        const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp || 0);
        return timeB - timeA;
      });
      callback(data);
    },
    (error) => {
      console.error("Firestore subscription error:", error);
    }
  );
};
