import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, getDocs, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously } from "firebase/auth";

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
export const signInUserAnonymously = () => signInAnonymously(auth);
export const logout = () => signOut(auth);

export const saveFileMetadata = async (fileUrl, name, userId, publicId = null, fileType = "image", code = null) => {
  try {
    const docRef = await addDoc(collection(db, "images"), {
      url: fileUrl,
      name: name,
      userId: userId, // Keep track of who uploaded it (can be null/anonymous)
      publicId: publicId, // Ensure it gets populated for deletion
      fileType: fileType, // "image", "video", "raw"
      code: code ? code.toUpperCase() : null, // Unique code if shared anonymously
      timestamp: serverTimestamp()
    });
    return docRef;
  } catch (error) {
    console.error("Error adding document: ", error);
    throw error;
  }
};

// Deprecated alias for backward compatibility
export const saveImageMetadata = (imageUrl, name, userId, publicId = null) => {
  return saveFileMetadata(imageUrl, name, userId, publicId, "image");
};

export const getFileByCode = async (code) => {
  if (!code) return null;
  try {
    const q = query(
      collection(db, "images"),
      where("code", "==", code.toUpperCase())
    );
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return null;
    
    const docSnap = querySnapshot.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  } catch (error) {
    console.error("Error fetching file by code: ", error);
    throw error;
  }
};

export const saveFileToUserGallery = async (fileData, userId) => {
  try {
    // Check if user already has this file URL in their gallery to prevent duplicates
    const q = query(
      collection(db, "images"),
      where("userId", "==", userId),
      where("url", "==", fileData.url)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return snapshot.docs[0]; // Already saved
    }

    const docRef = await addDoc(collection(db, "images"), {
      url: fileData.url,
      name: fileData.name,
      userId: userId,
      publicId: fileData.publicId || null,
      fileType: fileData.fileType || "image",
      timestamp: serverTimestamp()
    });
    return docRef;
  } catch (error) {
    console.error("Error saving file to user gallery: ", error);
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

export const createP2PTransfer = async (name, fileType, fileSize, code) => {
  try {
    const docRef = await addDoc(collection(db, "images"), {
      name,
      fileType,
      fileSize,
      isP2P: true,
      code: code.toUpperCase(),
      status: "waiting",
      timestamp: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    console.error("Error creating P2P transfer:", error);
    throw error;
  }
};

export const updateP2PTransfer = async (docId, data) => {
  try {
    const docRef = doc(db, "images", docId);
    await updateDoc(docRef, data);
  } catch (error) {
    console.error("Error updating P2P transfer:", error);
    throw error;
  }
};

export const subscribeToP2PTransfer = (docId, callback) => {
  return onSnapshot(doc(db, "images", docId), (snapshot) => {
    if (snapshot.exists()) {
      callback({ id: snapshot.id, ...snapshot.data() });
    }
  });
};
