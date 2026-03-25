import React, { useState, useRef } from "react";
import { Upload as UploadIcon, X, CheckCircle, Loader2, Image as ImageIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { saveImageMetadata } from "../lib/firebase";


const Upload = ({ user }) => {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const handleFile = (files) => {
    const selectedFile = files[0];
    if (selectedFile && selectedFile.type.startsWith("image/")) {
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      setError("");
      setSuccess(false);
    } else {
      setError("Please select a valid image file.");
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
    setFile(null);
    setPreview(null);
    setError("");
    setSuccess(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const [progress, setProgress] = useState(0);

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
      xhr.open("POST", "https://api.cloudinary.com/v1_1/dn3jogpb9/image/upload", true);

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
            await saveImageMetadata(data.secure_url, file.name, user.uid, data.public_id);
            setUploading(false);
            setSuccess(true);
            setProgress(100);
            setTimeout(() => clearFile(), 3000);
          } catch (dbErr) {
            console.error("Database sync failed:", dbErr);
            setError("Cloud upload was successful, but saving to Firebase failed. Check your Firestore rules!");
            setUploading(false);
          }
        } else {
          setError("Upload failed. Please check your Cloudinary settings.");
          setUploading(false);
        }
      };

      xhr.onerror = () => {
        setError("Network error occurred.");
        setUploading(false);
      };

      xhr.send(formData);
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred.");
      setUploading(false);
    }
  };



  return (
    <div className="max-w-xl mx-auto space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">
          Share Your Image
        </h2>
        <p className="text-zinc-400">Upload on mobile, view instantly on desktop</p>
      </div>

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
          accept="image/*"
          onChange={(e) => handleFile(e.target.files)}
        />

        <AnimatePresence mode="wait">
          {!preview ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => inputRef.current?.click()}
              className="flex flex-col items-center justify-center space-y-4 cursor-pointer py-12"
            >
              <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                <UploadIcon size={32} />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium">Click or drag image to upload</p>
                <p className="text-sm text-zinc-500 mt-1">PNG, JPG, HEIC up to 10MB</p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative aspect-video rounded-2xl overflow-hidden group"
            >
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                <button
                  onClick={clearFile}
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

      <div className="flex flex-col gap-4">
        {preview && !success && (
          <div className="space-y-3">
            {uploading && (
              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  className="bg-indigo-500 h-full shadow-[0_0_15px_rgba(99,102,241,0.5)]"
                />
              </div>
            )}
            <button
              onClick={uploadToCloudinary}
              disabled={uploading}
              className={`btn-primary w-full flex items-center justify-center gap-3 text-lg py-4 transition-all duration-300 relative overflow-hidden ${
                uploading ? "opacity-90 cursor-not-allowed bg-indigo-500/50" : ""
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  <span>{progress}% Uploading...</span>
                </>
              ) : (
                <>
                  <UploadIcon size={20} />
                  <span>Transfer Image</span>
                </>
              )}
            </button>
          </div>
        )}


        <AnimatePresence>
          {success && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center gap-3 text-emerald-400 font-medium"
            >
              <CheckCircle size={20} />
              Transfer Complete!
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Upload;
