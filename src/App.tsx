import React, { useState, useEffect, useRef } from 'react';
import { Bot, Smartphone, Copy, Check, Plus, Menu, Settings, Zap, Eye, Hash, Info, ExternalLink, QrCode } from 'lucide-react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'pairing' | 'settings' | 'about' | 'qr-pairing' | 'chat'>('pairing');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [prefix, setPrefix] = useState('.');
  const [autoReact, setAutoReact] = useState(false);
  const [autoStatus, setAutoStatus] = useState(false);
  const [statusEmoji, setStatusEmoji] = useState('🗽');
  
  const [pairingCode, setPairingCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showForce, setShowForce] = useState(false);
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Web Chat State
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'bot', text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        setConnectedCount(data.connectedCount);
      } catch (e) {
        console.error('Failed to fetch stats:', e);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;
    if (activeTab === 'qr-pairing') {
      scanner = new Html5QrcodeScanner(
        "reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      );

      scanner.render((decodedText) => {
        setPhoneNumber(decodedText);
        setActiveTab('pairing');
        if (scanner) scanner.clear();
      }, (error) => {
        // Silently ignore scan errors
      });
    }
    return () => {
      if (scanner) {
        scanner.clear().catch(err => console.error("Scanner clear error:", err));
      }
    };
  }, [activeTab]);

  const handleCopy = () => {
    navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePairing = async (e: React.FormEvent, force = false) => {
    if (e) e.preventDefault();
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (!cleanPhone) return;

    setLoading(true);
    setError('');
    if (!force) setPairingCode('');

    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phoneNumber: cleanPhone, 
          force,
          config: {
            prefix,
            autoreact: autoReact,
            autostatus: autoStatus,
            autostatusEmoji: statusEmoji
          }
        }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to request pairing code');
      
      if (data.code) {
        setPairingCode(data.code);
        setShowForce(false);
      } else {
        setError('The bot is already connected or connecting.');
        setShowForce(true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (!cleanPhone) {
      setError('Please enter your phone number first to save settings.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/config?phone=${cleanPhone}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix,
          autoreact: autoReact,
          autostatus: autoStatus,
          autostatusEmoji: statusEmoji
        }),
      });
      if (res.ok) {
        alert('Settings saved successfully!');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const res = await fetch('/api/web-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await res.json();
      if (data.text) {
        setChatMessages(prev => [...prev, { role: 'bot', text: data.text }]);
      } else {
        throw new Error(data.error || 'Failed to get response');
      }
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: 'bot', text: `❌ Error: ${err.message}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans text-blue-900 selection:bg-blue-100">
      {/* Top Menu Bar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-blue-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 hover:bg-blue-50 rounded-xl transition-colors text-blue-600"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-blue-900">Vortex-MD</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Status</span>
            <span className="text-xs font-semibold text-blue-600">Online</span>
          </div>
          <img 
            src="https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/75rzp86l-1773296762252.jpg" 
            alt="Bot Profile" 
            className="w-10 h-10 rounded-full border-2 border-blue-100 shadow-md object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-40 bg-blue-900/20 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsMenuOpen(false)}>
          <div className="absolute top-0 left-0 h-full w-64 bg-white shadow-2xl p-6 animate-in slide-in-from-left duration-300" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <span className="font-bold text-xl text-blue-900">Vortex-MD</span>
            </div>
            <nav className="space-y-2">
              <button 
                onClick={() => { setActiveTab('pairing'); setIsMenuOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl font-semibold transition-all",
                  activeTab === 'pairing' ? "bg-blue-50 text-blue-600" : "text-blue-400 hover:bg-blue-50 hover:text-blue-600"
                )}
              >
                <Smartphone className="w-5 h-5" /> Pairing
              </button>
              <button 
                onClick={() => { setActiveTab('chat'); setIsMenuOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl font-semibold transition-all",
                  activeTab === 'chat' ? "bg-blue-50 text-blue-600" : "text-blue-400 hover:bg-blue-50 hover:text-blue-600"
                )}
              >
                <Zap className="w-5 h-5" /> Web Chat
              </button>
              <button 
                onClick={() => { setActiveTab('qr-pairing'); setIsMenuOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl font-semibold transition-all",
                  activeTab === 'qr-pairing' ? "bg-blue-50 text-blue-600" : "text-blue-400 hover:bg-blue-50 hover:text-blue-600"
                )}
              >
                <QrCode className="w-5 h-5" /> QR Pairing
              </button>
              <button 
                onClick={() => { setActiveTab('settings'); setIsMenuOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl font-semibold transition-all",
                  activeTab === 'settings' ? "bg-blue-50 text-blue-600" : "text-blue-400 hover:bg-blue-50 hover:text-blue-600"
                )}
              >
                <Settings className="w-5 h-5" /> Settings
              </button>
              <button 
                onClick={() => { setActiveTab('about'); setIsMenuOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl font-semibold transition-all",
                  activeTab === 'about' ? "bg-blue-50 text-blue-600" : "text-blue-400 hover:bg-blue-50 hover:text-blue-600"
                )}
              >
                <Info className="w-5 h-5" /> About
              </button>
              <div className="pt-4 mt-4 border-t border-blue-50">
                <a href="https://github.com" target="_blank" className="flex items-center gap-3 p-3 rounded-xl hover:bg-blue-50 text-blue-400 hover:text-blue-600 transition-all">
                  <ExternalLink className="w-5 h-5" /> GitHub
                </a>
              </div>
            </nav>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-lg mx-auto w-full p-6 space-y-8">
        {activeTab === 'pairing' && (
          <>
            <div className="text-center space-y-2 pt-4">
              <h2 className="text-3xl font-extrabold text-blue-900 tracking-tight">Bot Dashboard</h2>
              <p className="text-blue-400 font-medium">Configure and connect your bot easily.</p>
              {connectedCount !== null && (
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-wider border border-blue-100">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  Connected: {connectedCount}/200
                </div>
              )}
            </div>

            <div className="bg-white rounded-[2.5rem] border border-blue-50 shadow-2xl shadow-blue-100/50 p-8 space-y-8">
              <form onSubmit={handlePairing} className="space-y-8">
                {/* Pairing Number */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-widest ml-1">
                    <Smartphone className="w-4 h-4" /> Pairing Number
                  </label>
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. 33612345678"
                    className="w-full bg-blue-50/50 border border-blue-100 rounded-2xl py-4 px-6 text-blue-900 font-semibold placeholder:text-blue-200 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-300 transition-all"
                    required
                  />
                </div>

                {/* Config Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-widest ml-1">
                      <Hash className="w-4 h-4" /> Prefix
                    </label>
                    <input
                      type="text"
                      value={prefix}
                      onChange={(e) => setPrefix(e.target.value)}
                      className="w-full bg-blue-50/50 border border-blue-100 rounded-2xl py-4 px-6 text-blue-900 font-bold text-center focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                      maxLength={1}
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-widest ml-1">
                      Status Emoji
                    </label>
                    <input
                      type="text"
                      value={statusEmoji}
                      onChange={(e) => setStatusEmoji(e.target.value)}
                      className="w-full bg-blue-50/50 border border-blue-100 rounded-2xl py-4 px-6 text-blue-900 font-bold text-center focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                      maxLength={2}
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div className="grid grid-cols-1 gap-4">
                  <button
                    type="button"
                    onClick={() => setAutoReact(!autoReact)}
                    className={cn(
                      "flex items-center justify-between p-5 rounded-2xl border transition-all group",
                      autoReact 
                        ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200" 
                        : "bg-white border-blue-100 text-blue-900 hover:border-blue-200"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Zap className={cn("w-5 h-5", autoReact ? "text-white" : "text-blue-400")} />
                      <span className="font-bold">Auto React</span>
                    </div>
                    <div className={cn(
                      "w-10 h-6 rounded-full relative transition-all",
                      autoReact ? "bg-white/20" : "bg-blue-100"
                    )}>
                      <div className={cn(
                        "absolute top-1 w-4 h-4 rounded-full transition-all",
                        autoReact ? "right-1 bg-white" : "left-1 bg-blue-400"
                      )} />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAutoStatus(!autoStatus)}
                    className={cn(
                      "flex items-center justify-between p-5 rounded-2xl border transition-all group",
                      autoStatus 
                        ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200" 
                        : "bg-white border-blue-100 text-blue-900 hover:border-blue-200"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Eye className={cn("w-5 h-5", autoStatus ? "text-white" : "text-blue-400")} />
                      <span className="font-bold">Auto Status</span>
                    </div>
                    <div className={cn(
                      "w-10 h-6 rounded-full relative transition-all",
                      autoStatus ? "bg-white/20" : "bg-blue-100"
                    )}>
                      <div className={cn(
                        "absolute top-1 w-4 h-4 rounded-full transition-all",
                        autoStatus ? "right-1 bg-white" : "left-1 bg-blue-400"
                      )} />
                    </div>
                  </button>
                </div>

                {error && (
                  <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold flex flex-col gap-3">
                    <p>{error}</p>
                    {showForce && (
                      <button
                        type="button"
                        onClick={(e) => handlePairing(e, true)}
                        className="w-full bg-red-600 text-white py-3 rounded-xl text-xs font-bold hover:bg-red-700 transition-all"
                      >
                        Force New Connection
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !phoneNumber}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-5 rounded-[1.5rem] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 shadow-xl shadow-blue-200 flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <>
                      <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-6 h-6" />
                      Get Pairing Code
                    </>
                  )}
                </button>
              </form>

              {pairingCode && (
                <div className="p-8 rounded-[2rem] bg-blue-50 border border-blue-100 text-center animate-in zoom-in duration-500 shadow-inner">
                  <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-4">Your Pairing Code</p>
                  <div className="text-4xl sm:text-5xl font-mono font-black tracking-[0.2em] text-blue-600 mb-6 break-all">
                    {pairingCode}
                  </div>
                  <button 
                    onClick={handleCopy}
                    className={cn(
                      "flex items-center justify-center gap-2 w-full py-4 rounded-2xl transition-all font-bold text-sm",
                      copied 
                        ? "bg-blue-600 text-white" 
                        : "bg-white text-blue-600 border border-blue-100 hover:border-blue-200 shadow-sm"
                    )}
                  >
                    {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    {copied ? 'Copied!' : 'Copy Code'}
                  </button>
                  <div className="mt-6 flex items-center justify-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-widest">
                      Waiting for connection...
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'chat' && (
          <div className="flex flex-col h-[calc(100vh-180px)] max-h-[700px] animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2 pt-4 mb-6">
              <h2 className="text-3xl font-extrabold text-blue-900 tracking-tight">Web Chat</h2>
              <p className="text-blue-400 font-medium">Talk to the AI directly from the web.</p>
            </div>
            
            <div className="flex-1 bg-white rounded-[2.5rem] border border-blue-50 shadow-2xl shadow-blue-100/50 flex flex-col overflow-hidden">
              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-blue-100">
                {chatMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                    <Bot className="w-16 h-16 text-blue-200" />
                    <p className="font-bold text-blue-300 uppercase tracking-widest text-xs">No messages yet. Say hello!</p>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={cn(
                    "flex flex-col max-w-[85%]",
                    msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                  )}>
                    <div className={cn(
                      "px-5 py-3 rounded-2xl text-sm font-medium leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-100" 
                        : "bg-blue-50 text-blue-900 rounded-tl-none border border-blue-100"
                    )}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="mr-auto items-start flex flex-col max-w-[85%]">
                    <div className="bg-blue-50 text-blue-900 px-5 py-3 rounded-2xl rounded-tl-none border border-blue-100 flex gap-1">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              <form onSubmit={handleSendMessage} className="p-4 bg-blue-50/30 border-t border-blue-50 flex gap-3">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type your message..."
                  className="flex-1 bg-white border border-blue-100 rounded-2xl py-3 px-5 text-blue-900 font-medium focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all shadow-sm"
                  disabled={isChatLoading}
                />
                <button
                  type="submit"
                  disabled={isChatLoading || !chatInput.trim()}
                  className="bg-blue-600 text-white p-3 rounded-2xl shadow-lg shadow-blue-100 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all"
                >
                  <Zap className="w-6 h-6" />
                </button>
              </form>
            </div>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2 pt-4">
              <h2 className="text-3xl font-extrabold text-blue-900 tracking-tight">Bot Settings</h2>
              <p className="text-blue-400 font-medium">Manage your bot configuration.</p>
            </div>
            
            <div className="bg-white rounded-[2.5rem] border border-blue-50 shadow-2xl shadow-blue-100/50 p-8 space-y-8">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-widest ml-1">
                    Prefix
                  </label>
                  <input
                    type="text"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    className="w-full bg-blue-50/50 border border-blue-100 rounded-2xl py-4 px-6 text-blue-900 font-bold focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                  />
                </div>
                
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-widest ml-1">
                    Status Emoji
                  </label>
                  <input
                    type="text"
                    value={statusEmoji}
                    onChange={(e) => setStatusEmoji(e.target.value)}
                    className="w-full bg-blue-50/50 border border-blue-100 rounded-2xl py-4 px-6 text-blue-900 font-bold focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all"
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-blue-50/50 border border-blue-100">
                  <span className="font-bold text-blue-900">Auto React</span>
                  <button 
                    onClick={() => setAutoReact(!autoReact)}
                    className={cn(
                      "w-12 h-6 rounded-full relative transition-all",
                      autoReact ? "bg-blue-600" : "bg-blue-200"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                      autoReact ? "right-1" : "left-1"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-blue-50/50 border border-blue-100">
                  <span className="font-bold text-blue-900">Auto Status</span>
                  <button 
                    onClick={() => setAutoStatus(!autoStatus)}
                    className={cn(
                      "w-12 h-6 rounded-full relative transition-all",
                      autoStatus ? "bg-blue-600" : "bg-blue-200"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                      autoStatus ? "right-1" : "left-1"
                    )} />
                  </button>
                </div>
              </div>

              <button
                onClick={handleSaveConfig}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-5 rounded-[1.5rem] transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-3"
              >
                {loading ? <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" /> : <Settings className="w-6 h-6" />}
                Save Settings
              </button>
            </div>
          </div>
        )}

        {activeTab === 'qr-pairing' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2 pt-4">
              <h2 className="text-3xl font-extrabold text-blue-900 tracking-tight">QR Scanner</h2>
              <p className="text-blue-400 font-medium">Scan a QR code to quickly input a phone number.</p>
            </div>
            
            <div className="bg-white rounded-[2.5rem] border border-blue-50 shadow-2xl shadow-blue-100/50 p-8 space-y-8 overflow-hidden">
              <div id="reader" className="w-full rounded-2xl overflow-hidden border border-blue-100"></div>
              <p className="text-center text-xs text-blue-300 font-bold uppercase tracking-widest">
                Position the QR code within the frame
              </p>
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2 pt-4">
              <h2 className="text-3xl font-extrabold text-blue-900 tracking-tight">About Vortex-MD</h2>
              <p className="text-blue-400 font-medium">The most powerful WhatsApp bot.</p>
            </div>
            
            <div className="bg-white rounded-[2.5rem] border border-blue-50 shadow-2xl shadow-blue-100/50 p-8 space-y-8 text-center">
              <div className="flex flex-col items-center gap-4">
                <img 
                  src="https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/75rzp86l-1773296762252.jpg" 
                  alt="Vortex-MD" 
                  className="w-24 h-24 rounded-3xl shadow-xl border-4 border-white"
                  referrerPolicy="no-referrer"
                />
                <h3 className="text-2xl font-black text-blue-900">Vortex-MD v2.0</h3>
                <p className="text-blue-400 text-sm leading-relaxed">
                  Vortex-MD is a high-performance WhatsApp bot designed for speed, reliability, and fun. 
                  Created with passion by Samy Charles.
                </p>
              </div>

              <div className="space-y-4 pt-4">
                <p className="text-xs font-bold text-blue-300 uppercase tracking-[0.2em]">Contact Developer</p>
                <div className="flex flex-col gap-3">
                  <a 
                    href="https://wa.me/2250574082069" 
                    target="_blank" 
                    className="flex items-center justify-center gap-3 p-4 rounded-2xl bg-[#25D366] text-white font-bold shadow-lg shadow-green-100 hover:scale-[1.02] transition-all"
                  >
                    <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    Contact via WhatsApp 1
                  </a>
                  <a 
                    href="https://wa.me/22505754411220" 
                    target="_blank" 
                    className="flex items-center justify-center gap-3 p-4 rounded-2xl bg-blue-600 text-white font-bold shadow-lg shadow-blue-100 hover:scale-[1.02] transition-all"
                  >
                    <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    Contact via WhatsApp 2
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="p-8 text-center">
        <p className="text-[10px] font-bold text-blue-200 uppercase tracking-[0.3em]">
          Vortex-MD &copy; 2026 • Powered by Samy Charles
        </p>
      </footer>
    </div>
  );
}

