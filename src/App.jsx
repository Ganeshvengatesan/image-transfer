import React, { useState, useEffect } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { db, auth, signInWithGoogle, logout } from "./lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import Upload from "./components/Upload";
import Gallery from "./components/Gallery";
import { Laptop, Smartphone, LogOut, LogIn, Share2, Sparkles, Send, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const App = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeView, setActiveView] = useState("auto");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    
    return () => {
      unsubscribe();
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const currentView = activeView === "auto" ? (isMobile ? "upload" : "gallery") : activeView;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="text-indigo-500">
          <Share2 size={40} />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center space-y-8 overflow-hidden relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full"></div>
          <div className="absolute -bottom-[10%] right-[10%] w-[40%] h-[40%] bg-pink-600/5 blur-[120px] rounded-full"></div>
        </div>

        <motion.div 
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-gradient-to-tr from-indigo-500 to-pink-500 rounded-3xl flex items-center justify-center shadow-2xl rotate-6 mb-4"
        >
          <Share2 size={48} className="text-white" />
        </motion.div>

        <div className="space-y-4 relative z-10">
          <h1 className="text-5xl font-black tracking-tighter uppercase italic">
            Aero<span className="text-indigo-400 not-italic">Drop</span>
          </h1>
          <p className="text-zinc-400 max-w-sm mx-auto font-medium">
            Your personal, ultra-secure real-time image transfer cloud. Login with Google to start.
          </p>
        </div>

        <button 
          onClick={signInWithGoogle}
          className="flex items-center gap-3 px-8 py-4 bg-white text-black rounded-2xl font-bold hover:bg-zinc-200 transition-all active:scale-95 shadow-xl relative z-10 group"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-5" />
          Join AeroDrop with Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-zinc-100 font-sans selection:bg-indigo-500/30 overflow-x-hidden">
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
            <div className="hidden sm:block">
              <h1 className="text-xl font-black tracking-tighter uppercase italic">
                Aero<span className="text-indigo-400 not-italic">Drop</span>
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-[8px] px-1 bg-indigo-500/20 text-indigo-400 rounded-sm font-mono whitespace-nowrap flex items-center gap-1">
                  <ShieldCheck size={8} /> SECURE FEED
                </span>
                <span className="text-[8px] text-zinc-500 uppercase font-black">{user.displayName.split(' ')[0]}</span>
              </div>
            </div>
          </div>

          <div className="flex bg-white/5 rounded-2xl p-1 border border-white/10 backdrop-blur-md">
            <button
              onClick={() => setActiveView("upload")}
              className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-sm font-bold ${
                currentView === "upload" ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-zinc-500 hover:text-white"
              }`}
            >
              <Smartphone size={16} />
              <span className="hidden sm:inline">Upload</span>
            </button>
            <button
              onClick={() => setActiveView("gallery")}
              className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-sm font-bold ${
                currentView === "gallery" ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-zinc-500 hover:text-white"
              }`}
            >
              <Laptop size={16} />
              <span className="hidden sm:inline">Gallery</span>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={logout}
              className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-400/10 transition-all"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 lg:py-20 min-h-[calc(100vh-80px)]">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -10 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="w-full"
          >
            {currentView === "upload" ? <Upload user={user} /> : <Gallery user={user} />}
          </motion.div>
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
            <p className="text-[10px] text-zinc-700 font-bold uppercase tracking-[0.3em] mt-8">&copy; 2024 AeroDrop Private Cloud</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;