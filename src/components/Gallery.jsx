import React, { useState, useEffect } from "react";
import { Download, ExternalLink, Copy, Search, Grid, List as ListIcon, Loader2, Image as ImageIcon, Trash2, Film, FileText, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { subscribeToImages, deleteImageMetadata } from "../lib/firebase";

const Gallery = ({ user }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("grid");
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToImages(user.uid, (data) => {
      setFiles(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(search.toLowerCase())
  );

  const copyToClipboard = (url, id) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const downloadFile = (url, name) => {
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
      })
      .catch((err) => {
        console.warn("CORS download blocked. Opening in new tab instead.", err);
        window.open(url, "_blank");
      });
  };

  const generateSignature = async (publicId, timestamp, apiSecret) => {
    const str = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const deleteFromCloudinary = async (publicId, fileType = "image") => {
    try {
      const apiKey = import.meta.env.VITE_CLOUDINARY_API_KEY;
      const apiSecret = import.meta.env.VITE_CLOUDINARY_API_SECRET;
      const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "dn3jogpb9";

      if (!apiKey || !apiSecret) {
        console.warn("Cloudinary credentials not set in .env. Skipping Cloudinary deletion.");
        return true;
      }

      const timestamp = Math.round(new Date().getTime() / 1000);
      const signature = await generateSignature(publicId, timestamp, apiSecret);

      const formData = new FormData();
      formData.append("public_id", publicId);
      formData.append("api_key", apiKey);
      formData.append("timestamp", timestamp);
      formData.append("signature", signature);

      const resourceType = fileType === "raw" ? "raw" : (fileType === "video" ? "video" : "image");

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();
      if (data.result !== "ok" && data.result !== "not found") {
        console.warn("Failed to delete from Cloudinary:", data);
        return false;
      }
      return true;
    } catch (e) {
      console.error("Error deleting from Cloudinary:", e);
      return false;
    }
  };

  const handleDelete = async (fileItem) => {
    if (window.confirm(`Are you sure you want to delete this ${fileItem.fileType || "file"}?`)) {
      try {
        let publicId = fileItem.publicId;

        // Fallback for older files without publicId explicitly saved
        if (!publicId && fileItem.url) {
          try {
            const parts = fileItem.url.split('/upload/');
            if (parts.length > 1) {
              publicId = parts[1].replace(/^v\d+\//, '').replace(/\.[^/.]+$/, '');
            }
          } catch(err) {
            // ignore
          }
        }

        if (publicId) {
          await deleteFromCloudinary(publicId, fileItem.fileType || "image");
        }

        await deleteImageMetadata(fileItem.id);
      } catch (error) {
        console.error("Error deleting file:", error);
      }
    }
  };

  const renderThumbnail = (fileItem) => {
    const type = fileItem.fileType || "image";

    if (type === "image") {
      return (
        <img
          src={fileItem.url}
          alt={fileItem.name}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          loading="lazy"
        />
      );
    } else if (type === "video") {
      return (
        <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
          <video
            src={fileItem.url}
            className="w-full h-full object-cover"
            muted
            playsInline
            loop
            onMouseEnter={(e) => e.target.play().catch(() => {})}
            onMouseLeave={(e) => { 
              e.target.pause(); 
              e.target.currentTime = 0; 
            }}
          />
          <div className="absolute inset-0 bg-black/45 group-hover:opacity-0 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 bg-white/10 border border-white/20 rounded-full flex items-center justify-center backdrop-blur-md">
              <Film size={22} className="text-white ml-0.5" />
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="w-full h-full bg-gradient-to-br from-indigo-950/40 to-slate-900/60 flex flex-col items-center justify-center p-6 border-b border-white/5 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl pointer-events-none"></div>
          <FileText size={48} className="text-indigo-400 mb-2 drop-shadow-md" />
          <span className="text-[10px] font-bold font-mono text-zinc-500 uppercase tracking-widest bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
            Document
          </span>
        </div>
      );
    }
  };

  return (
    <div className="space-y-12 animate-fade-in px-4 lg:px-0">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h2 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-emerald-400 bg-clip-text text-transparent">
            Desktop Feed
          </h2>
          <p className="text-zinc-400 font-medium tracking-wide prose-sm flex items-center gap-2">
            Receive files in near real-time across devices 
            <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-xs text-indigo-400">
              {files.length} Live
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-indigo-400 transition-colors" />
            <input
              type="text"
              placeholder="Search files by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-2xl focus:outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all w-full md:w-64 backdrop-blur-md"
            />
          </div>
          <div className="flex bg-white/5 rounded-2xl p-1 border border-white/10 backdrop-blur-md">
            <button
              onClick={() => setView("grid")}
              className={`p-2 rounded-xl transition-all ${view === "grid" ? "bg-indigo-500 text-white shadow-lg" : "text-zinc-500 hover:text-white"}`}
            >
              <Grid size={20} />
            </button>
            <button
              onClick={() => setView("list")}
              className={`p-2 rounded-xl transition-all ${view === "list" ? "bg-indigo-500 text-white shadow-lg" : "text-zinc-500 hover:text-white"}`}
            >
              <ListIcon size={20} />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-32 space-y-4"
          >
            <Loader2 size={48} className="text-indigo-500 animate-spin" />
            <p className="text-zinc-500 font-medium">Fetching secure feed...</p>
          </motion.div>
        ) : filteredFiles.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-32 space-y-6 glass rounded-[3rem] border-dashed border-2 border-white/10"
          >
            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center text-zinc-600">
              <ImageIcon size={40} />
            </div>
            <div className="text-center space-y-2">
              <p className="text-2xl font-semibold text-zinc-300">No files found</p>
              <p className="text-zinc-500">Wait for an upload to appear here</p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            layout
            className={`grid gap-6 ${view === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"}`}
          >
            {filteredFiles.map((fileItem) => (
              <motion.div
                key={fileItem.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`group glass rounded-3xl overflow-hidden shadow-2xl transition-all duration-300 hover:translate-y-[-4px] hover:border-white/20 hover:shadow-indigo-500/10 ${view === "list" ? "flex gap-6 h-48" : ""}`}
              >
                <div className={`relative overflow-hidden ${view === "list" ? "w-64 h-full flex-shrink-0" : "aspect-square"}`}>
                  {renderThumbnail(fileItem)}
                  
                  {/* Share code badge */}
                  {fileItem.code && (
                    <span className="absolute top-3 left-3 px-2 py-1 bg-indigo-500/80 backdrop-blur-md text-white text-[10px] font-black rounded-lg shadow-md border border-white/10 uppercase tracking-wider font-mono">
                      Code: {fileItem.code}
                    </span>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end p-4">
                    <p className="text-xs text-white/70 line-clamp-1">
                      {fileItem.timestamp?.toDate 
                        ? fileItem.timestamp.toDate().toLocaleString() 
                        : fileItem.timestamp 
                          ? new Date(fileItem.timestamp).toLocaleString()
                          : "Just now..."}
                    </p>
                  </div>
                </div>

                <div className="p-5 space-y-4 flex-grow flex flex-col justify-between">
                  <div className="space-y-1">
                    <h3 className="font-bold text-zinc-100 line-clamp-1 group-hover:text-indigo-400 transition-colors" title={fileItem.name}>
                      {fileItem.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400 capitalize">
                        {fileItem.fileType || "image"}
                      </span>
                      <p className="text-[10px] text-zinc-500 font-mono tracking-tighter">ID: {fileItem.id.slice(0, 8)}...</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => downloadFile(fileItem.url, fileItem.name)}
                      className="flex-1 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all flex items-center justify-center gap-2 text-sm font-medium active:scale-95"
                      title="Download"
                    >
                      <Download size={18} />
                      {view === "list" && "Download"}
                    </button>
                    <button
                      onClick={() => copyToClipboard(fileItem.url, fileItem.id)}
                      className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all active:scale-95 text-zinc-400 hover:text-white"
                      title="Copy URL"
                    >
                      {copiedId === fileItem.id ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} />}
                    </button>
                    <a
                      href={fileItem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all active:scale-95 text-zinc-400 hover:text-white"
                      title="Open Original"
                    >
                      <ExternalLink size={18} />
                    </a>
                    <button
                      onClick={() => handleDelete(fileItem)}
                      className="p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl transition-all border border-red-500/10 active:scale-95"
                      title="Delete File"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Gallery;
