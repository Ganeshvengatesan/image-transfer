import React, { useState, useEffect, useRef } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { db, auth, signInWithGoogle, signInUserAnonymously, logout, getFileByCode, saveFileToUserGallery, updateP2PTransfer, subscribeToP2PTransfer, deleteImageMetadata, deleteFileFromCloudinary } from "./lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import Upload from "./components/Upload";
import Gallery from "./components/Gallery";
import { Laptop, Smartphone, LogOut, LogIn, Share2, Sparkles, Send, ShieldCheck, Download, FileText, Film, HelpCircle, Loader2, QrCode, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Html5Qrcode } from "html5-qrcode";

const App = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeView, setActiveView] = useState("auto"); // "auto", "upload", "gallery", "receive"
  const [isMobile, setIsMobile] = useState(false);

  // Retrieval states
  const [retrievalCode, setRetrievalCode] = useState("");
  const [retrievalLoading, setRetrievalLoading] = useState(false);
  const [retrievedFile, setRetrievedFile] = useState(null);
  const [retrievalError, setRetrievalError] = useState("");
  const [savedToGallery, setSavedToGallery] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // WebRTC P2P Receiver states
  const [p2pReceiverStatus, setP2PReceiverStatus] = useState(null); // null | "connecting" | "transferring" | "completed"
  const [p2pProgress, setP2PProgress] = useState(0);
  const [lightboxFile, setLightboxFile] = useState(null);

  const pcRef = useRef(null);
  const docListenerRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        try {
          await signInUserAnonymously();
        } catch (err) {
          console.warn("Anonymous sign-in not enabled in console, using guest state:", err);
          setUser(null);
          setAuthLoading(false);
        }
      } else {
        setUser(currentUser);
        setAuthLoading(false);
      }
    });

    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    
    // Check URL params for auto-retrieval (e.g. ?code=X8Y9Z2)
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get("code");
    if (urlCode) {
      setActiveView("receive");
      setRetrievalCode(urlCode.toUpperCase());
      handleRetrieveCode(urlCode.toUpperCase());
    }

    return () => {
      unsubscribe();
      window.removeEventListener("resize", checkMobile);
      if (pcRef.current) pcRef.current.close();
      if (docListenerRef.current) docListenerRef.current();
    };
  }, []);

  const handleScanSuccess = async (decodedText, scannerInstance) => {
    let code = decodedText.trim();
    try {
      if (decodedText.startsWith("http://") || decodedText.startsWith("https://")) {
        const urlObj = new URL(decodedText);
        const urlCode = urlObj.searchParams.get("code");
        if (urlCode) {
          code = urlCode.toUpperCase();
        }
      }
    } catch (err) {
      console.warn("QR URL parse error:", err);
    }

    if (code && code.length === 6) {
      setRetrievalCode(code);
      setShowScanner(false);
      if (scannerInstance && scannerInstance.isScanning) {
        try {
          await scannerInstance.stop();
          scannerInstance.clear();
        } catch (stopErr) {
          console.error("Error stopping scanner on success:", stopErr);
        }
      }
      handleRetrieveCode(code);
    } else {
      toast.error("Invalid QR code format. Please scan an AeroTransfer QR code.");
    }
  };

  useEffect(() => {
    let html5QrCode = null;

    if (showScanner) {
      const timer = setTimeout(() => {
        try {
          html5QrCode = new Html5Qrcode("qr-reader");
          html5QrCode.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: (width, height) => {
                const minEdge = Math.min(width, height);
                const qrboxSize = Math.floor(minEdge * 0.7);
                return { width: qrboxSize, height: qrboxSize };
              }
            },
            (decodedText) => {
              handleScanSuccess(decodedText, html5QrCode);
            },
            (errorMessage) => {
              // Ignore scanning errors to prevent console spam
            }
          ).catch(err => {
            console.error("Camera start error:", err);
            toast.error("Failed to start camera scanner. Please check permissions.");
            setShowScanner(false);
          });
        } catch (initErr) {
          console.error("Scanner init error:", initErr);
          setShowScanner(false);
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        if (html5QrCode) {
          if (html5QrCode.isScanning) {
            html5QrCode.stop().then(() => {
              html5QrCode.clear();
            }).catch(stopErr => console.error("Error stopping scanner on cleanup:", stopErr));
          }
        }
      };
    }
  }, [showScanner]);

  const isGuest = !user || user.isAnonymous;

  const currentView = activeView === "auto" 
    ? (!isGuest ? (isMobile ? "upload" : "gallery") : "upload") 
    : activeView;

  const cleanupTemporaryFile = async (file) => {
    if (!file || !file.isTemporary) return;
    try {
      // 1. Delete from Firestore
      if (file.id) {
        await deleteImageMetadata(file.id);
      }
      // 2. Delete from Cloudinary
      if (file.publicId) {
        await deleteFileFromCloudinary(file.publicId, file.fileType || "image");
      }
    } catch (err) {
      console.error("Error during temporary file cleanup:", err);
    }
  };

  const handleRetrieveCode = async (codeToFetch) => {
    const code = (codeToFetch || retrievalCode).trim().toUpperCase();
    if (!code || code.length !== 6) {
      setRetrievalError("Please enter a valid 6-character code.");
      return;
    }

    // Cleanup previous connection
    if (pcRef.current) {
      pcRef.current.destroy();
      pcRef.current = null;
    }

    setRetrievalLoading(true);
    setRetrievalError("");
    setRetrievedFile(null);
    setSavedToGallery(false);
    setP2PReceiverStatus(null);
    setP2PProgress(0);

    try {
      // 1. Try to find the file metadata in Firestore first
      const fileData = await getFileByCode(code);
      if (fileData) {
        if (fileData.isP2P) {
          // If P2P direct share, run receiver
          startP2PReceiver(code);
        } else {
          // If cloud file, load immediately
          setRetrievedFile(fileData);
          setRetrievalLoading(false);
        }
      } else {
        // 2. Fallback to PeerJS direct search
        startP2PReceiver(code);
      }
    } catch (err) {
      console.warn("Firestore check failed, using direct search fallback...", err);
      startP2PReceiver(code);
    }
  };

  const lookupFirestoreFile = async (code) => {
    try {
      const fileData = await getFileByCode(code);
      if (fileData) {
        if (fileData.isP2P) {
          setRetrievalError("P2P sender is offline. Keep the sender's tab open.");
        } else {
          setRetrievedFile(fileData);
        }
      } else {
        setRetrievalError("No file found with this code. Check code and try again.");
      }
    } catch (err) {
      console.error(err);
      if (err.code === "permission-denied" || err.message?.toLowerCase().includes("permission")) {
        setRetrievalError("Database Permission Denied. To allow file retrieval, please check your Firebase Firestore rules.");
      } else {
        setRetrievalError("Failed to retrieve file details: " + (err.message || err));
      }
    } finally {
      setRetrievalLoading(false);
    }
  };

  // Receiver-side WebRTC logic via PeerJS
  const startP2PReceiver = async (code) => {
    setP2PReceiverStatus("connecting");
    setRetrievalLoading(true);

    try {
      const peer = new window.Peer({
        debug: 3,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
          ]
        }
      });
      pcRef.current = peer;

      let connected = false;
      let conn = null;

      // Fallback to Firestore lookup if peer doesn't connect within 15 seconds
      const timeout = setTimeout(() => {
        if (!connected) {
          console.log("P2P connection timed out, fallback to Firestore...");
          if (conn) conn.close();
          peer.destroy();
          pcRef.current = null;
          lookupFirestoreFile(code);
        }
      }, 15000);

      peer.on('open', (id) => {
        console.log("Receiver peer registered with ID:", id);
        conn = peer.connect('AEROTRF-' + code);

        conn.on('open', () => {
          connected = true;
          clearTimeout(timeout);
          setP2PReceiverStatus("transferring");
        });

        let chunks = [];
        let receivedBytes = 0;
        let fileMeta = null;

        conn.on('data', (data) => {
          if (typeof data === "string") {
            const msg = JSON.parse(data);
            if (msg.type === "header") {
              fileMeta = msg;
              chunks = [];
              receivedBytes = 0;
            } else if (msg.type === "eof") {
              // Reconstruct binary file
              const fileBlob = new Blob(chunks, { type: fileMeta.mimeType || "application/octet-stream" });
              const url = URL.createObjectURL(fileBlob);

              setRetrievedFile({
                name: fileMeta.name,
                fileType: fileMeta.mimeType?.startsWith("image/") ? "image" : (fileMeta.mimeType?.startsWith("video/") ? "video" : "raw"),
                isP2P: true,
                url: url,
                blob: fileBlob,
                code: code
              });

              setP2PReceiverStatus("completed");
              setRetrievalLoading(false);
              toast.success("Direct P2P transfer completed!");
              
              peer.destroy();
              pcRef.current = null;
            }
          } else {
            chunks.push(data);
            receivedBytes += data.byteLength;
            if (fileMeta) {
              const percent = Math.round((receivedBytes / fileMeta.size) * 100);
              setP2PProgress(percent);
            }
          }
        });

        conn.on('error', (err) => {
          console.error("PeerJS connection error:", err);
          if (!connected) {
            clearTimeout(timeout);
            peer.destroy();
            pcRef.current = null;
            lookupFirestoreFile(code);
          } else {
            setRetrievalError("Connection lost: " + err.message);
            setRetrievalLoading(false);
            setP2PReceiverStatus(null);
          }
        });
      });

      peer.on('error', (err) => {
        console.error("PeerJS error:", err);
        if (!connected) {
          clearTimeout(timeout);
          peer.destroy();
          pcRef.current = null;
          lookupFirestoreFile(code);
        }
      });

    } catch (err) {
      console.error(err);
      lookupFirestoreFile(code);
    }
  };

  const handleSaveToGallery = async () => {
    if (!retrievedFile) return;

    // Check if user is authenticated (if not, trigger login)
    let currentUser = user;
    if (!currentUser) {
      try {
        const result = await signInWithGoogle();
        if (result.user) {
          currentUser = result.user;
          setUser(result.user);
        } else {
          return;
        }
      } catch (err) {
        console.error(err);
        toast.error("Google Sign-In failed.");
        return;
      }
    }

    setRetrievalLoading(true);

    try {
      if (retrievedFile.isP2P || retrievedFile.isTemporary) {
        // Since it's a P2P or temporary transfer, we upload the file to Cloudinary
        // on behalf of the saving user so it exists in their feed permanently.
        toast.info("Uploading file to cloud...");
        let blob = retrievedFile.blob;
        if (!blob) {
          const res = await fetch(retrievedFile.url);
          blob = await res.blob();
        }

        const formData = new FormData();
        formData.append("file", blob, retrievedFile.name);
        formData.append("upload_preset", "image_upload");

        const response = await fetch("https://api.cloudinary.com/v1_1/dn3jogpb9/auto/upload", {
          method: "POST",
          body: formData
        });

        if (!response.ok) throw new Error("Cloud upload failed");
        
        const data = await response.json();
        
        await saveFileToUserGallery({
          url: data.secure_url,
          name: retrievedFile.name,
          publicId: data.public_id,
          fileType: data.resource_type || retrievedFile.fileType
        }, currentUser.uid);

      } else {
        // Standard resolved file metadata, copy directly
        await saveFileToUserGallery(retrievedFile, currentUser.uid);
      }

      toast.success("Saved file to your permanent feed!");
      setSavedToGallery(true);

      // Clean up temporary guest file from cloud after successful copy
      if (retrievedFile.isTemporary) {
        cleanupTemporaryFile(retrievedFile);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to save file to gallery.");
    } finally {
      setRetrievalLoading(false);
    }
  };

  const downloadRetrievedFile = (url, name) => {
    fetch(url, { mode: 'cors' })
      .then((res) => res.blob())
      .then((blob) => {
        const urlBlob = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = urlBlob;
        a.download = name || "download-file";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Clean up temporary file from cloud after download
        if (retrievedFile && retrievedFile.isTemporary) {
          cleanupTemporaryFile(retrievedFile);
        }
      })
      .catch((err) => {
        window.open(url, "_blank");

        // Clean up temporary file from cloud after download redirect fallback
        if (retrievedFile && retrievedFile.isTemporary) {
          cleanupTemporaryFile(retrievedFile);
        }
      });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="text-indigo-500">
          <Share2 size={40} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-zinc-100 font-sans selection:bg-indigo-500/30 overflow-x-hidden flex flex-col justify-between">
      {/* Background Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full animate-pulse-slow"></div>
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-emerald-600/5 blur-[100px] rounded-full animate-pulse-slow"></div>
        <div className="absolute -bottom-[10%] left-[20%] w-[40%] h-[40%] bg-pink-600/5 blur-[120px] rounded-full animate-pulse-slow"></div>
      </div>

      <ToastContainer position="bottom-right" theme="dark" />

      {/* Modern Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-2xl border-b border-white/5 bg-black/20">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-indigo-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 transform rotate-3 hover:rotate-0 transition-transform">
              <Share2 size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase italic">
                Aero<span className="text-indigo-400 not-italic">Transfer</span>
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-[8px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 rounded-sm font-mono whitespace-nowrap flex items-center gap-1">
                  <ShieldCheck size={8} /> SECURE FEED
                </span>
                {user && !user.isAnonymous && (
                  <span className="text-[8px] text-zinc-500 uppercase font-black">{user.displayName ? user.displayName.split(' ')[0] : 'User'}</span>
                )}
                {user && user.isAnonymous && (
                  <span className="text-[8px] text-zinc-500 uppercase font-black">GUEST</span>
                )}
              </div>
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="flex bg-white/5 rounded-2xl p-1 border border-white/10 backdrop-blur-md">
            <button
              onClick={() => setActiveView("upload")}
              className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-sm font-bold ${
                currentView === "upload" ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-zinc-500 hover:text-white"
              }`}
            >
              <Smartphone size={16} />
              <span className="hidden sm:inline">Send File</span>
            </button>

            <button
              onClick={() => setActiveView("receive")}
              className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-sm font-bold ${
                currentView === "receive" ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-zinc-500 hover:text-white"
              }`}
            >
              <Send size={16} />
              <span className="hidden sm:inline">Receive File</span>
            </button>

            {user && !user.isAnonymous && (
              <button
                onClick={() => setActiveView("gallery")}
                className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-sm font-bold ${
                  currentView === "gallery" ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-zinc-500 hover:text-white"
                }`}
              >
                <Laptop size={16} />
                <span className="hidden sm:inline">My Cloud Feed</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            {user && !user.isAnonymous ? (
              <button 
                onClick={logout}
                className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-400/10 transition-all"
                title="Logout"
              >
                <LogOut size={18} />
              </button>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-xl font-bold hover:bg-zinc-200 active:scale-95 transition-all text-xs sm:text-sm"
              >
                <LogIn size={14} />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="relative z-10 max-w-7xl mx-auto w-full px-6 py-12 lg:py-20 flex-grow">
        
        {/* Guest Mode Hero Banner if not signed in and on upload/receive view */}
        {isGuest && currentView !== "receive" && (
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-4">
            <h2 className="text-3xl font-black uppercase tracking-tight">
              Instant File Sharing, <span className="text-indigo-400">Zero Friction</span>
            </h2>
            <p className="text-zinc-400 text-sm font-medium leading-relaxed">
              Upload photos, documents, and videos anonymously without an account. Access them instantly with a unique code or QR. Or <span className="text-indigo-400 cursor-pointer underline hover:text-indigo-300" onClick={signInWithGoogle}>Sign In with Google</span> to save files permanently.
            </p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {currentView === "upload" && (
            <motion.div
              key="upload-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
            >
              <Upload user={user} />
            </motion.div>
          )}

          {currentView === "gallery" && user && !user.isAnonymous && (
            <motion.div
              key="gallery-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
            >
              <Gallery user={user} onViewFile={setLightboxFile} />
            </motion.div>
          )}

          {currentView === "receive" && (
            <motion.div
              key="receive-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="max-w-5xl mx-auto"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Left Column (Grid width 5/12): Code Input Card */}
                <div className="lg:col-span-5 space-y-6 min-w-0">
                  <div className="text-center lg:text-left space-y-2">
                    <h2 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">
                      Retrieve Shared File
                    </h2>
                    <p className="text-zinc-400 text-sm">Enter a 6-character code to retrieve shared files</p>
                  </div>

                  <div className="glass p-6 rounded-3xl border border-white/10 space-y-4">
                    <div className="flex flex-col sm:flex-row lg:flex-col gap-3">
                      <input
                        type="text"
                        placeholder="ENTER 6-DIGIT CODE"
                        maxLength={6}
                        value={retrievalCode}
                        onChange={(e) => setRetrievalCode(e.target.value.toUpperCase())}
                        className="flex-1 bg-white/5 border border-white/10 focus:border-indigo-500/50 rounded-2xl px-6 py-4 text-center font-mono font-black text-2xl tracking-widest focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all uppercase placeholder:text-zinc-600 placeholder:text-sm placeholder:font-sans placeholder:tracking-normal"
                      />
                      <button
                        onClick={() => handleRetrieveCode()}
                        disabled={retrievalLoading}
                        className="px-8 py-4 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                        {retrievalLoading && !p2pReceiverStatus ? (
                          <Loader2 className="animate-spin" size={20} />
                        ) : (
                          "Retrieve"
                        )}
                      </button>
                    </div>

                    <div className="flex justify-center pt-2">
                      <button
                        onClick={() => setShowScanner(!showScanner)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-indigo-400 hover:text-indigo-300 rounded-xl text-xs font-bold transition-all active:scale-95"
                      >
                        <QrCode size={16} />
                        <span>{showScanner ? "Close Camera" : "Scan Share QR Code"}</span>
                      </button>
                    </div>

                    <AnimatePresence>
                      {showScanner && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden space-y-4 flex flex-col items-center justify-center pt-2"
                        >
                          <div 
                            id="qr-reader" 
                            className="w-full aspect-square max-w-sm rounded-2xl border border-white/10 overflow-hidden bg-black/40 relative shadow-inner"
                          />
                          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black text-center">
                            Align the AeroTransfer QR code inside the box to scan automatically
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {retrievalError && (
                      <p className="text-red-400 text-sm font-medium text-center">{retrievalError}</p>
                    )}

                    {/* Direct P2P negotiation and stream state */}
                    {p2pReceiverStatus && p2pReceiverStatus !== "completed" && (
                      <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/25 flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
                          <Loader2 className="animate-spin" size={16} />
                          <span>
                            {p2pReceiverStatus === "connecting" && "Establishing direct P2P link..."}
                            {p2pReceiverStatus === "transferring" && `Streaming data... ${p2pProgress}%`}
                          </span>
                        </div>
                        {p2pReceiverStatus === "transferring" && (
                          <div className="w-full bg-white/15 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="bg-indigo-500 h-full transition-all duration-200" 
                              style={{ width: `${p2pProgress}%` }}
                            />
                          </div>
                        )}
                        <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider text-center">
                          The sender must keep their AeroTransfer tab open to complete the transfer.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column (Grid width 7/12): Retrieved File Display Card or Placeholder */}
                <div className="lg:col-span-7 w-full min-w-0">
                  <AnimatePresence mode="wait">
                    {retrievedFile ? (
                      <motion.div
                        key="retrieved-file-display"
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="glass p-6 rounded-[2rem] border border-white/10 space-y-6"
                      >
                        <div className="text-center space-y-2">
                          <span className="px-3 py-1 bg-indigo-500/20 text-indigo-400 text-xs font-black rounded-full uppercase tracking-wider">
                            {retrievedFile.isP2P ? "P2P Direct File Resolved" : "File Details"}
                          </span>
                          <h3 className="text-xl font-bold text-zinc-100 truncate max-w-full px-2" title={retrievedFile.name}>
                            {retrievedFile.name}
                          </h3>
                          <p className="text-xs text-zinc-500 font-mono">Code: {retrievedFile.code}</p>
                        </div>

                        {/* File Preview */}
                        <div 
                          className={`aspect-video w-full rounded-2xl bg-black/40 border border-white/5 overflow-hidden flex items-center justify-center relative group ${
                            (retrievedFile.fileType === "image" || retrievedFile.fileType === "video") ? "cursor-zoom-in" : ""
                          }`}
                          onClick={() => {
                            if (retrievedFile.fileType === "image" || retrievedFile.fileType === "video") {
                              setLightboxFile(retrievedFile);
                            }
                          }}
                        >
                          {retrievedFile.fileType === "image" ? (
                            <>
                              <img src={retrievedFile.url} alt={retrievedFile.name} className="w-full h-full object-contain hover:scale-[1.02] transition-transform duration-300" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                <span className="text-xs font-bold text-white px-3 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/10">Click to View Full</span>
                              </div>
                            </>
                          ) : retrievedFile.fileType === "video" ? (
                            <>
                              <video src={retrievedFile.url} className="w-full h-full object-contain hover:scale-[1.02] transition-transform duration-300" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                <span className="text-xs font-bold text-white px-3 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/10">Click to Play Full Screen</span>
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col items-center justify-center space-y-3 p-8">
                              <FileText size={64} className="text-indigo-400 drop-shadow-md" />
                              <span className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-widest bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
                                Document
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Actions Panel */}
                        <div className="flex flex-col sm:flex-row gap-3 pt-2">
                          <button
                            onClick={() => downloadRetrievedFile(retrievedFile.url, retrievedFile.name)}
                            className="flex-1 py-4 bg-white/10 hover:bg-white/20 border border-white/5 rounded-2xl text-white font-bold transition-all flex items-center justify-center gap-2 active:scale-95"
                          >
                            <Download size={20} />
                            <span>Download File</span>
                          </button>

                          <button
                            onClick={handleSaveToGallery}
                            disabled={savedToGallery || retrievalLoading}
                            className={`flex-1 py-4 font-bold rounded-2xl transition-all flex items-center justify-center gap-2 active:scale-95 ${
                              savedToGallery
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 cursor-not-allowed"
                                : "bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                            }`}
                          >
                            {retrievalLoading && p2pReceiverStatus === "completed" ? (
                              <Loader2 className="animate-spin" size={20} />
                            ) : savedToGallery ? (
                              <span>Saved to Gallery</span>
                            ) : (
                              <>
                                <Sparkles size={20} />
                                <span>{!isGuest ? "Save to my Gallery" : "Sign In & Save to Gallery"}</span>
                              </>
                            )}
                          </button>
                        </div>

                        {isGuest && !savedToGallery && (
                          <p className="text-[10px] text-zinc-500 text-center font-medium uppercase tracking-wider">
                            💡 Tip: You can save this file directly to your personal gallery by signing in!
                          </p>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="retrieved-file-placeholder"
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="glass p-8 rounded-[2rem] border-dashed border-2 border-white/15 flex flex-col items-center justify-center text-center space-y-4 min-h-[380px]"
                      >
                        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center text-zinc-500">
                          <Download size={28} />
                        </div>
                        <div className="space-y-2">
                          <p className="text-xl font-semibold text-zinc-300">Ready to Receive</p>
                          <p className="text-zinc-500 text-sm max-w-xs mx-auto">
                            Enter a 6-digit share code or scan the QR code on the left to resolve and preview the shared file instantly.
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Sub-footer Stats */}
      <footer className="relative z-10 border-t border-white/5 bg-black/10 backdrop-blur-lg py-12 mt-auto">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-12 text-center md:text-left">
          <div className="space-y-4">
            <div className="flex items-center gap-2 justify-center md:justify-start">
              <div className="w-2 h-8 bg-indigo-500 rounded-full"></div>
              <h4 className="text-sm font-black uppercase tracking-[0.2em]">NextGen Transfer</h4>
            </div>
            <p className="text-sm text-zinc-500 leading-relaxed font-medium">
              Encrypted real-time synchronization across your private cloud.
            </p>
          </div>
          
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-2">
              <p className="text-2xl font-black text-indigo-400 tabular-nums">AES</p>
              <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Encryption</p>
            </div>
            <div className="space-y-2">
              <p className="text-2xl font-black text-emerald-400 tabular-nums">Auto</p>
              <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Sync</p>
            </div>
          </div>

          <div className="flex flex-col items-center md:items-end justify-between">
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-zinc-500 border border-white/5">
                <ShieldCheck size={18} />
              </div>
            </div>
            <p className="text-[10px] text-zinc-700 font-bold uppercase tracking-[0.3em] mt-8">&copy; 2024 AeroTransfer Private Cloud</p>
          </div>
        </div>
      </footer>
      <AnimatePresence>
        {lightboxFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 sm:p-8"
            onClick={() => setLightboxFile(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative max-w-5xl max-h-[85vh] w-full flex flex-col items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button
                onClick={() => setLightboxFile(null)}
                className="absolute -top-14 right-0 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-[101]"
              >
                <X size={24} />
              </button>

              {/* Lightbox Content */}
              <div className="w-full h-full flex items-center justify-center rounded-3xl overflow-hidden bg-black/40 border border-white/10 shadow-2xl">
                {lightboxFile.fileType === "image" ? (
                  <img
                    src={lightboxFile.url}
                    alt={lightboxFile.name}
                    className="max-w-full max-h-[75vh] object-contain select-none rounded-2xl"
                  />
                ) : lightboxFile.fileType === "video" ? (
                  <video
                    src={lightboxFile.url}
                    className="max-w-full max-h-[75vh] object-contain rounded-2xl"
                    controls
                    autoPlay
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-12 space-y-4">
                    <FileText size={80} className="text-indigo-400" />
                    <p className="text-lg font-bold text-zinc-100">{lightboxFile.name}</p>
                  </div>
                )}
              </div>

              {/* Title & Download Button */}
              <div className="mt-4 w-full flex items-center justify-between text-zinc-300 px-2">
                <span className="text-sm font-semibold truncate max-w-[70%]" title={lightboxFile.name}>
                  {lightboxFile.name}
                </span>
                <button
                  onClick={() => downloadRetrievedFile(lightboxFile.url, lightboxFile.name)}
                  className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold rounded-xl flex items-center gap-2 transition-all active:scale-95 shadow-md shadow-indigo-500/10"
                >
                  <Download size={14} />
                  <span>Download</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;