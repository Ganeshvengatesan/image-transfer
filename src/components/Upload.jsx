import React, { useState, useRef, useEffect } from "react";
import { Upload as UploadIcon, X, CheckCircle, Loader2, Image as ImageIcon, FileText, Film, QrCode, Copy, Check, ExternalLink, Share2, HelpCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { saveFileMetadata, getFileByCode, createP2PTransfer, updateP2PTransfer, subscribeToP2PTransfer } from "../lib/firebase";

const generateShareCode = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const getFileTypeCategory = (file) => {
  if (!file) return "raw";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "raw";
};

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const Upload = ({ user }) => {
  const isGuest = !user || user.isAnonymous;
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // url for images/videos, or "document"
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);

  // Sharing states
  const [shareCode, setShareCode] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareOption, setShareOption] = useState(true); // For logged-in users to toggle code generation

  // WebRTC P2P states
  const [p2pStatus, setP2PStatus] = useState(null); // null | "waiting" | "connecting" | "transferring" | "completed"

  const inputRef = useRef(null);
  const peerRef = useRef(null);
  const connRef = useRef(null);

  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  const handleFile = (files) => {
    const selectedFile = files[0];
    if (selectedFile) {
      setFile(selectedFile);
      const category = getFileTypeCategory(selectedFile);
      if (category === "image" || category === "video") {
        setPreview(URL.createObjectURL(selectedFile));
      } else {
        setPreview("document");
      }
      setError("");
      setSuccess(false);
      setShareCode("");
      setShareUrl("");
      setP2PStatus(null);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files);
    }
  };

  const clearFile = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (connRef.current) {
      connRef.current.close();
      connRef.current = null;
    }
    setFile(null);
    setPreview(null);
    setError("");
    setSuccess(false);
    setShareCode("");
    setShareUrl("");
    setP2PStatus(null);
    setCopiedCode(false);
    setCopiedLink(false);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  // P2P direct WebRTC sharing method via PeerJS (completely offline/signal-less from Firebase)
  const startP2PTransfer = async () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setError("");
    setP2PStatus("waiting");

    const code = generateShareCode();
    setShareCode(code);
    setShareUrl(`${window.location.origin}?code=${code}`);

    try {
      if (peerRef.current) {
        peerRef.current.destroy();
      }

      const peer = new window.Peer('AEROTRF-' + code, {
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
      peerRef.current = peer;

      peer.on('open', () => {
        setP2PStatus("waiting");
      });

      peer.on('connection', (conn) => {
        connRef.current = conn;
        setP2PStatus("connecting");

        conn.on('open', () => {
          setP2PStatus("transferring");
          sendFilePeerJS(file, conn);
        });

        conn.on('error', (err) => {
          console.error("Connection error:", err);
          setError("P2P connection error: " + err.message);
          setUploading(false);
        });
      });

      peer.on('error', (err) => {
        console.error("Peer error:", err);
        if (err.type === 'unavailable-id') {
          // Retry with a new code if collision occurs
          startP2PTransfer();
        } else {
          setError("Direct transfer setup failed: " + err.message);
          setUploading(false);
        }
      });

    } catch (err) {
      console.error(err);
      setError("Failed to initialize direct P2P link: " + (err.message || err));
      setUploading(false);
    }
  };

  const sendFilePeerJS = (fileObj, conn) => {
    // Send initial header message with file name, type, and size
    conn.send(JSON.stringify({
      type: "header",
      name: fileObj.name,
      size: fileObj.size,
      mimeType: fileObj.type
    }));

    const chunkSize = 131072; // 128KB chunks for high performance
    const reader = new FileReader();

    reader.onload = (e) => {
      const arrayBuffer = e.target.result;
      let offset = 0;

      const sendNextChunk = () => {
        const channel = conn.dataChannel;

        while (offset < arrayBuffer.byteLength) {
          if (conn.open === false || !channel) {
            console.warn("Peer connection closed. Stopping stream.");
            return;
          }

          // Manage buffer backpressure (1MB limit)
          if (channel.bufferedAmount > 1048576) {
            channel.onbufferedamountlow = () => {
              channel.onbufferedamountlow = null;
              sendNextChunk();
            };
            return; // Yield control back to wait for buffer empty event
          }

          const end = Math.min(offset + chunkSize, arrayBuffer.byteLength);
          const chunk = arrayBuffer.slice(offset, end);
          conn.send(chunk);
          offset = end;

          const percent = Math.round((offset / arrayBuffer.byteLength) * 100);
          setProgress(percent);
        }

        // Send completion EOF message
        conn.send(JSON.stringify({ type: "eof" }));
        
        setUploading(false);
        setSuccess(true);
        setP2PStatus("completed");

        // Cleanup Peer
        setTimeout(() => {
          if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
          }
        }, 3000);
      };

      sendNextChunk();
    };

    reader.onerror = (err) => {
      console.error("FileReader error:", err);
      setError("Failed to read file.");
      setUploading(false);
    };

    reader.readAsArrayBuffer(fileObj);
  };

  // Upload to Cloudinary (ONLY for logged-in users who choose to store permanently in cloud)
  const uploadToCloudinary = async () => {
    if (!file) return;

    setUploading(true);
    setProgress(0);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", "image_upload");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "https://api.cloudinary.com/v1_1/dn3jogpb9/auto/upload", true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setProgress(percentComplete);
        }
      };

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText);
          
          try {
            const detectedType = data.resource_type || getFileTypeCategory(file);
            
            let generatedCode = null;
            if (shareOption) {
              let isUnique = false;
              let attempts = 0;
              while (!isUnique && attempts < 10) {
                const candidate = generateShareCode();
                const existing = await getFileByCode(candidate);
                if (!existing) {
                  generatedCode = candidate;
                  isUnique = true;
                }
                attempts++;
              }
              if (!generatedCode) generatedCode = generateShareCode();
            }

            const uid = user.uid;
            await saveFileMetadata(data.secure_url, file.name, uid, data.public_id, detectedType, generatedCode);
            
            setUploading(false);
            setSuccess(true);
            setProgress(100);

            if (generatedCode) {
              setShareCode(generatedCode);
              setShareUrl(`${window.location.origin}?code=${generatedCode}`);
            } else {
              setTimeout(() => clearFile(), 3000);
            }
          } catch (dbErr) {
            console.error("Database sync failed:", dbErr);
            setError("Cloud upload was successful, but database sync failed.");
            setUploading(false);
          }
        } else {
          setError("Upload failed. Check Cloudinary settings.");
          setUploading(false);
        }
      };

      xhr.onerror = () => {
        setError("Network error during transfer.");
        setUploading(false);
      };

      xhr.send(formData);
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred.");
      setUploading(false);
    }
  };

  const handleStartTransfer = () => {
    if (isGuest) {
      // Guest mode requires P2P direct share
      startP2PTransfer();
    } else {
      // Logged in users can choose between cloud and code-generation
      uploadToCloudinary();
    }
  };

  const copyToClipboard = (text, setCopied) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderFilePreviewIcon = () => {
    const cat = getFileTypeCategory(file);
    if (cat === "video") {
      return <Film size={48} className="text-pink-400" />;
    }
    return <FileText size={48} className="text-indigo-400" />;
  };

  return (
    <div className="max-w-xl mx-auto space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">
          {!isGuest ? "Cloud File Transfer" : "Instant Direct Send"}
        </h2>
        <p className="text-zinc-400 text-sm">
          {!isGuest 
            ? "Upload photos, videos, or documents to your permanent feed." 
            : "Direct P2P share (no cloud uploads). Keeps files in local cache; keep page open to share!"}
        </p>
      </div>

      <AnimatePresence mode="wait">
        {!shareCode ? (
          <motion.div
            key="dropzone-area"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative glass rounded-3xl p-8 border-2 border-dashed transition-all duration-300 ${
                dragActive ? "border-indigo-500 bg-indigo-500/10 scale-[1.02]" : "border-white/10"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
                onChange={(e) => handleFile(e.target.files)}
              />

              <AnimatePresence mode="wait">
                {!preview ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => inputRef.current?.click()}
                    className="flex flex-col items-center justify-center space-y-4 cursor-pointer py-12 group"
                  >
                    <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                      <UploadIcon size={32} />
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium">Click or drag file here to transfer</p>
                      <p className="text-sm text-zinc-500 mt-1">Images, Videos, PDFs, Documents up to 25MB</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="relative aspect-video rounded-2xl overflow-hidden group flex items-center justify-center bg-black/40 border border-white/5"
                  >
                    {getFileTypeCategory(file) === "image" ? (
                      <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                    ) : getFileTypeCategory(file) === "video" ? (
                      <video src={preview} className="w-full h-full object-cover" muted loop autoPlay />
                    ) : (
                      <div className="flex flex-col items-center justify-center space-y-3">
                        {renderFilePreviewIcon()}
                        <p className="text-sm font-semibold max-w-[250px] truncate text-center text-zinc-200">
                          {file.name}
                        </p>
                        <p className="text-xs text-zinc-500">{formatBytes(file.size)}</p>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                      <button
                        onClick={clearFile}
                        disabled={uploading}
                        className="p-3 bg-red-500 rounded-full text-white shadow-xl hover:bg-red-600 transition-colors"
                      >
                        <X size={24} />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 text-sm">
                  <X size={16} />
                  {error}
                </div>
              )}
            </div>

            {!isGuest && preview && !success && (
              <div className="flex items-center gap-3 p-4 bg-white/5 rounded-2xl border border-white/10">
                <input
                  type="checkbox"
                  id="share-code-opt"
                  checked={shareOption}
                  onChange={(e) => setShareOption(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 border-zinc-700 bg-zinc-800 focus:ring-indigo-500"
                />
                <label htmlFor="share-code-opt" className="text-sm text-zinc-300 font-medium cursor-pointer">
                  Generate Share Code & QR Code (allows others to retrieve this file instantly)
                </label>
              </div>
            )}

            {isGuest && preview && !success && (
              <div className="flex items-start gap-3 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-300 text-xs leading-relaxed">
                <HelpCircle size={20} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold mb-1">Direct Peer-to-Peer Transfer (Privacy-first)</p>
                  <p>Your file is stored securely in your browser cache and streamed directly to the receiver. It is never uploaded to the cloud database or storage. You must keep this webpage open during transfer.</p>
                </div>
              </div>
            )}

            {preview && !success && (
              <div className="space-y-3">
                {uploading && !p2pStatus && (
                  <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      className="bg-indigo-500 h-full shadow-[0_0_15px_rgba(99,102,241,0.5)]"
                    />
                  </div>
                )}
                <button
                  onClick={handleStartTransfer}
                  disabled={uploading}
                  className={`btn-primary w-full flex items-center justify-center gap-3 text-lg py-4 transition-all duration-300 relative overflow-hidden ${
                    uploading ? "opacity-90 cursor-not-allowed bg-indigo-500/50" : ""
                  }`}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      <span>Streaming setup...</span>
                    </>
                  ) : (
                    <>
                      <UploadIcon size={20} />
                      <span>Transfer File</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="share-info-area"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass p-6 rounded-[2rem] border border-white/10 space-y-6 animate-slide-up"
          >
            {success ? (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center gap-3 text-emerald-400 font-medium">
                <CheckCircle size={20} />
                {p2pStatus ? "Direct Transfer Complete!" : "Transfer Complete!"}
              </div>
            ) : p2pStatus ? (
              <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/25 flex flex-col items-center gap-3">
                <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
                  <Loader2 className="animate-spin" size={16} />
                  <span>
                    {p2pStatus === "waiting" && "Waiting for receiver to connect..."}
                    {p2pStatus === "connecting" && "Establishing direct P2P link..."}
                    {p2pStatus === "transferring" && `Streaming data... ${progress}%`}
                  </span>
                </div>
                {p2pStatus === "transferring" && (
                  <div className="w-full bg-white/15 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-full transition-all duration-200" 
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider text-center">
                  Please keep this webpage open. The connection is direct browser-to-browser.
                </p>
              </div>
            ) : null}

            <div className="text-center space-y-2">
              <p className="text-xs uppercase tracking-widest text-zinc-500 font-bold">Your Share Code</p>
              <div className="flex items-center justify-center gap-4">
                <span className="text-4xl font-black font-mono tracking-wider bg-white/5 border border-white/10 px-6 py-3 rounded-2xl text-indigo-400">
                  {shareCode}
                </span>
                <button
                  onClick={() => copyToClipboard(shareCode, setCopiedCode)}
                  className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all"
                >
                  {copiedCode ? <Check size={20} className="text-emerald-400" /> : <Copy size={20} className="text-zinc-400" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center py-4 bg-black/20 rounded-2xl border border-white/5">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`} 
                alt="QR Code" 
                className="w-44 h-44 rounded-xl border-4 border-white bg-white"
              />
              <p className="text-[10px] text-zinc-500 font-medium mt-3 uppercase tracking-wider">Scan QR code to access on another device</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-500 uppercase font-black tracking-wider">Share Link</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-300 focus:outline-none"
                />
                <button
                  onClick={() => copyToClipboard(shareUrl, setCopiedLink)}
                  className="px-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  {copiedLink ? <Check size={18} /> : <Copy size={18} />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={clearFile}
                className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-zinc-300 hover:text-white font-bold transition-all text-sm"
              >
                Share Another File
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Upload;
