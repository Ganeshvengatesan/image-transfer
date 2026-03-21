import React, { useState, useEffect } from "react";
import { Download, ExternalLink, Copy, Search, Grid, List as ListIcon, Loader2, Image as ImageIcon, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { subscribeToImages, deleteImageMetadata } from "../lib/firebase";


const Gallery = ({ user }) => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("grid");

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToImages(user.uid, (data) => {
      setImages(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);



  const filteredImages = images.filter((img) =>
    img.name.toLowerCase().includes(search.toLowerCase())
  );

  const copyToClipboard = (url) => {
    navigator.clipboard.writeText(url);
    // You could add a toast notification here
  };

  const downloadImage = (url, name) => {
    fetch(url)
      .then((res) => res.blob())
      .then((blob) => {
        const urlBlob = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = urlBlob;
        a.download = name || "downloaded-image";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
  };

  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to delete this image?")) {
      try {
        await deleteImageMetadata(id);
      } catch (error) {
        console.error("Error deleting image:", error);
      }
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
            Receive images in near real-time across devices 
            <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-xs text-indigo-400">
              {images.length} Live
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-indigo-400 transition-colors" />
            <input
              type="text"
              placeholder="Search images..."
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
        ) : filteredImages.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-32 space-y-6 glass rounded-[3rem] border-dashed border-2 border-white/10"
          >
            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center text-zinc-600">
              <ImageIcon size={40} />
            </div>
            <div className="text-center space-y-2">
              <p className="text-2xl font-semibold text-zinc-300">No images found</p>
              <p className="text-zinc-500">Wait for a mobile upload to appear here</p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            layout
            className={`grid gap-6 ${view === "grid" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"}`}
          >
            {filteredImages.map((img) => (
              <motion.div
                key={img.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`group glass rounded-3xl overflow-hidden shadow-2xl transition-all duration-300 hover:translate-y-[-4px] hover:border-white/20 hover:shadow-indigo-500/10 ${view === "list" ? "flex gap-6 h-48" : ""}`}
              >
                <div className={`relative overflow-hidden ${view === "list" ? "w-64 h-full flex-shrink-0" : "aspect-square"}`}>
                  <img
                    src={img.url}
                    alt={img.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-end p-4">
                    <p className="text-xs text-white/70 line-clamp-1">
                      {img.timestamp?.toDate 
                        ? img.timestamp.toDate().toLocaleString() 
                        : img.timestamp 
                          ? new Date(img.timestamp).toLocaleString()
                          : "Just now..."}
                    </p>
                  </div>
                </div>

                <div className="p-5 space-y-4 flex-grow flex flex-col justify-between">
                  <div className="space-y-1">
                    <h3 className="font-bold text-zinc-100 line-clamp-1 group-hover:text-indigo-400 transition-colors">
                      {img.name}
                    </h3>
                    <p className="text-xs text-zinc-500 font-mono tracking-tighter">ID: {img.id.slice(0, 8)}...</p>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => downloadImage(img.url, img.name)}
                      className="flex-1 p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-all flex items-center justify-center gap-2 text-sm font-medium border border-white/5 active:scale-95"
                      title="Download"
                    >
                      <Download size={18} />
                      {view === "list" && "Download"}
                    </button>
                    <button
                      onClick={() => copyToClipboard(img.url)}
                      className="p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-all border border-white/5 active:scale-95"
                      title="Copy URL"
                    >
                      <Copy size={18} />
                    </button>
                    <a
                      href={img.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-all border border-white/5 active:scale-95"
                      title="Open Original"
                    >
                      <ExternalLink size={18} />
                    </a>
                    <button
                      onClick={() => handleDelete(img.id)}
                      className="p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl transition-all border border-red-500/10 active:scale-95"
                      title="Delete Image"
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
