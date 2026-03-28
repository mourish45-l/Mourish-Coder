import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  Send, 
  Code, 
  Eye, 
  RefreshCw, 
  ArrowRight, 
  CheckCircle2, 
  Layers,
  Terminal,
  Copy,
  Check,
  Download,
  Upload,
  Trash2,
  LogIn,
  LogOut,
  User as UserIcon,
  AlertCircle
} from 'lucide-react';
import { getClarifyingQuestions, generateVibeCode, refineVibeCode, getRefinementSuggestions, GeneratedCode } from '../lib/gemini';
import { auth, db, googleProvider } from '../firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { ref, set, onValue, off } from 'firebase/database';

type Step = 'prompt' | 'questions' | 'generating' | 'result';

interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  step: Step;
  prompt: string;
  questions: string[];
  answers: Record<string, string>;
  currentQuestionIndex: number;
  generatedResult: GeneratedCode | null;
  chatHistory: { role: 'user' | 'model', text: string }[];
  previewContent: string;
}

export default function VibeCraft() {
  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const [step, setStep] = useState<Step>('prompt');
  const [prompt, setPrompt] = useState('');
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [generatedResult, setGeneratedResult] = useState<GeneratedCode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [refineRequest, setRefineRequest] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [showRefinePanel, setShowRefinePanel] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const [previewContent, setPreviewContent] = useState('');
  const [previewKey, setPreviewKey] = useState(0);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // Persistence Logic
  useEffect(() => {
    if (user) {
      // Load from Firebase
      const userSessionsRef = ref(db, `users/${user.uid}/sessions`);
      const currentIdRef = ref(db, `users/${user.uid}/currentSessionId`);

      onValue(userSessionsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const sessionList = Object.values(data) as ChatSession[];
          setSessions(sessionList.sort((a, b) => b.timestamp - a.timestamp));
        }
      });

      onValue(currentIdRef, (snapshot) => {
        const id = snapshot.val();
        if (id) setCurrentSessionId(id);
      });

      return () => {
        off(userSessionsRef);
        off(currentIdRef);
      };
    } else {
      // Fallback to localStorage
      const savedSessions = localStorage.getItem('vibecraft_sessions');
      const savedCurrentId = localStorage.getItem('vibecraft_current_id');
      const legacyState = localStorage.getItem('vibecraft_state');
      
      let parsedSessions: ChatSession[] = [];
      
      if (savedSessions) {
        try {
          parsedSessions = JSON.parse(savedSessions);
        } catch (e) {
          console.error("Failed to load sessions from localStorage", e);
        }
      }

      // Migration logic: if no sessions but legacy state exists, migrate it
      if (parsedSessions.length === 0 && legacyState) {
        try {
          const oldState = JSON.parse(legacyState);
          const migratedId = Math.random().toString(36).substring(7);
          const migratedSession: ChatSession = {
            id: migratedId,
            title: oldState.prompt || 'Migrated Project',
            timestamp: Date.now(),
            step: oldState.step || 'prompt',
            prompt: oldState.prompt || '',
            questions: oldState.questions || [],
            answers: oldState.answers || {},
            currentQuestionIndex: oldState.currentQuestionIndex || 0,
            generatedResult: oldState.generatedResult || null,
            chatHistory: oldState.chatHistory || [],
            previewContent: oldState.previewContent || ''
          };
          parsedSessions = [migratedSession];
          setSessions(parsedSessions);
          setCurrentSessionId(migratedId);
          
          // Apply state immediately
          setStep(migratedSession.step);
          setPrompt(migratedSession.prompt);
          setQuestions(migratedSession.questions);
          setAnswers(migratedSession.answers);
          setCurrentQuestionIndex(migratedSession.currentQuestionIndex);
          setGeneratedResult(migratedSession.generatedResult);
          setChatHistory(migratedSession.chatHistory);
          setPreviewContent(migratedSession.previewContent);
          
          // Clean up legacy state
          localStorage.removeItem('vibecraft_state');
          return;
        } catch (e) {
          console.error("Failed to migrate legacy state", e);
        }
      }

      if (parsedSessions.length > 0) {
        setSessions(parsedSessions);
        
        const targetId = savedCurrentId || parsedSessions[0].id;
        const current = parsedSessions.find((s: ChatSession) => s.id === targetId) || parsedSessions[0];
        
        if (current) {
          setCurrentSessionId(current.id);
          setStep(current.step);
          setPrompt(current.prompt);
          setQuestions(current.questions);
          setAnswers(current.answers);
          setCurrentQuestionIndex(current.currentQuestionIndex);
          setGeneratedResult(current.generatedResult);
          setChatHistory(current.chatHistory);
          setPreviewContent(current.previewContent);
        }
      }
    }
  }, [user]);

  // Sync current state to sessions array
  useEffect(() => {
    if (!currentSessionId) return;

    setSessions(prev => {
      const updated = prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            step,
            prompt,
            questions,
            answers,
            currentQuestionIndex,
            generatedResult,
            chatHistory,
            previewContent,
            title: prompt || s.title || 'Untitled Project'
          };
        }
        return s;
      });
      return updated;
    });
  }, [step, prompt, questions, answers, currentQuestionIndex, generatedResult, chatHistory, previewContent]);

  // Save to Persistence Layer
  useEffect(() => {
    if (user) {
      // Save to Firebase
      const sessionsMap = sessions.reduce((acc, s) => ({ ...acc, [s.id]: s }), {});
      set(ref(db, `users/${user.uid}/sessions`), sessionsMap);
      if (currentSessionId) {
        set(ref(db, `users/${user.uid}/currentSessionId`), currentSessionId);
      }
    } else {
      // Save to localStorage
      localStorage.setItem('vibecraft_sessions', JSON.stringify(sessions));
      if (currentSessionId) {
        localStorage.setItem('vibecraft_current_id', currentSessionId);
      }
    }
  }, [sessions, currentSessionId, user]);

  const createNewSession = () => {
    const newId = Math.random().toString(36).substring(7);
    const newSession: ChatSession = {
      id: newId,
      title: 'New Project',
      timestamp: Date.now(),
      step: 'prompt',
      prompt: '',
      questions: [],
      answers: {},
      currentQuestionIndex: 0,
      generatedResult: null,
      chatHistory: [],
      previewContent: ''
    };
    
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newId);
    
    // Reset local state
    setStep('prompt');
    setPrompt('');
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setGeneratedResult(null);
    setChatHistory([]);
    setPreviewContent('');
    setIsHistoryOpen(false);
  };

  const switchSession = (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    setCurrentSessionId(id);
    setStep(session.step);
    setPrompt(session.prompt);
    setQuestions(session.questions);
    setAnswers(session.answers);
    setCurrentQuestionIndex(session.currentQuestionIndex);
    setGeneratedResult(session.generatedResult);
    setChatHistory(session.chatHistory);
    setPreviewContent(session.previewContent);
    setIsHistoryOpen(false);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (currentSessionId === id) {
      setCurrentSessionId(null);
      handleReset();
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(sessions, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `vibecraft_history_${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (Array.isArray(imported)) {
          // Basic validation
          const isValid = imported.every(s => s.id && s.title && s.step);
          if (isValid) {
            setSessions(prev => {
              // Merge sessions, avoiding duplicates by ID
              const existingIds = new Set(prev.map(s => s.id));
              const newSessions = imported.filter(s => !existingIds.has(s.id));
              const merged = [...newSessions, ...prev];
              
              // If logged in, sync to Firebase
              if (user) {
                const sessionsMap = merged.reduce((acc, s) => ({ ...acc, [s.id]: s }), {});
                set(ref(db, `users/${user.uid}/sessions`), sessionsMap);
              }
              
              return merged;
            });
            alert(`Successfully imported ${imported.length} projects!`);
          } else {
            alert("Invalid file format. Please use a file exported from VibeCraft.");
          }
        }
      } catch (err) {
        console.error("Import failed", err);
        alert("Failed to import file. Make sure it's a valid JSON file.");
      }
    };
    reader.readAsText(file);
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      handleReset();
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const getFullHtml = (result: GeneratedCode) => {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
          <style>
            ${result.css || ''}
            body { font-family: 'Inter', sans-serif; margin: 0; padding: 0; }
            h1, h2, h3, h4, h5, h6 { font-family: 'Space Grotesk', sans-serif; }
          </style>
        </head>
        <body>
          ${result.html}
        </body>
      </html>
    `;
  };

  const handleStart = async () => {
    if (!prompt.trim()) return;
    
    // Create session if none exists
    if (!currentSessionId) {
      const newId = Math.random().toString(36).substring(7);
      const newSession: ChatSession = {
        id: newId,
        title: prompt,
        timestamp: Date.now(),
        step: 'prompt',
        prompt: prompt,
        questions: [],
        answers: {},
        currentQuestionIndex: 0,
        generatedResult: null,
        chatHistory: [],
        previewContent: ''
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newId);
    }

    setIsLoading(true);
    setError(null);
    try {
      const qs = await getClarifyingQuestions(prompt);
      setQuestions(qs);
      setStep('questions');
    } catch (err) {
      console.error(err);
      setError('Failed to get clarifying questions. Please check your API key or try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswer = (answer: string) => {
    const q = questions[currentQuestionIndex];
    setAnswers(prev => ({ ...prev, [q]: answer }));
    
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      handleGenerate();
    }
  };

  const handleGenerate = async () => {
    setStep('generating');
    setIsLoading(true);
    setError(null);
    try {
      const result = await generateVibeCode(prompt, answers);
      setGeneratedResult(result);
      setChatHistory([{ role: 'user', text: prompt }, { role: 'model', text: result.explanation }]);
      
      setPreviewContent(getFullHtml(result));
      setPreviewKey(prev => prev + 1);
      setStep('result');
      
      // Fetch suggestions
      const sugs = await getRefinementSuggestions(result);
      setSuggestions(sugs);
    } catch (err) {
      console.error(err);
      setError('Generation failed. The AI might be busy or there was a connection issue.');
      setStep('prompt'); // Go back to prompt on failure
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefine = async () => {
    if (!refineRequest.trim() || !generatedResult) return;
    setIsRefining(true);
    const newHistory = [...chatHistory, { role: 'user' as const, text: refineRequest }];
    setChatHistory(newHistory);
    
    try {
      const result = await refineVibeCode(generatedResult, refineRequest, newHistory);
      setGeneratedResult(result);
      setChatHistory(prev => [...prev, { role: 'model' as const, text: result.explanation }]);
      
      setPreviewContent(getFullHtml(result));
      setPreviewKey(prev => prev + 1);
      setRefineRequest('');

      // Fetch new suggestions
      const sugs = await getRefinementSuggestions(result);
      setSuggestions(sugs);
    } catch (error) {
      console.error(error);
    } finally {
      setIsRefining(false);
    }
  };

  const copyToClipboard = () => {
    if (!generatedResult) return;
    navigator.clipboard.writeText(generatedResult.html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    // Cleanup preview content on reset
    if (step === 'prompt') {
      setPreviewContent('');
    }
  }, [step]);

  const handleReset = () => {
    setStep('prompt');
    setPrompt('');
    setAnswers({});
    setCurrentQuestionIndex(0);
    setGeneratedResult(null);
    setChatHistory([]);
    setPreviewContent('');
    setCurrentSessionId(null);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isHistoryOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHistoryOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              className="fixed left-0 top-0 bottom-0 w-80 bg-white z-[70] shadow-2xl flex flex-col p-6"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold">History</h2>
                <button 
                  onClick={() => setIsHistoryOpen(false)}
                  className="p-2 hover:bg-md-surface-variant rounded-full"
                >
                  <ArrowRight className="rotate-180" size={20} />
                </button>
              </div>

              <button 
                onClick={createNewSession}
                className="md-button-primary w-full py-4 mb-6 flex items-center justify-center gap-2"
              >
                <RefreshCw size={18} /> New Chat
              </button>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-thin">
                {sessions.length === 0 ? (
                  <div className="text-center py-10 text-md-outline text-sm italic">
                    No history yet.
                  </div>
                ) : (
                  sessions.map(s => (
                    <div 
                      key={s.id}
                      onClick={() => switchSession(s.id)}
                      className={`p-4 rounded-2xl cursor-pointer transition-all group relative ${
                        currentSessionId === s.id 
                          ? 'bg-md-primary/10 border-md-primary/20 border' 
                          : 'hover:bg-md-surface-variant'
                      }`}
                    >
                      <div className="font-medium text-sm line-clamp-1 pr-6">{s.title || 'Untitled'}</div>
                      <div className="text-[10px] text-md-outline mt-1">
                        {new Date(s.timestamp).toLocaleDateString()}
                      </div>
                      <button 
                        onClick={(e) => deleteSession(e, s.id)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-50 text-red-400 rounded-lg transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-md-outline/10 grid grid-cols-2 gap-3">
                <button 
                  onClick={handleExport}
                  disabled={sessions.length === 0}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl border border-md-outline/20 text-xs font-bold uppercase tracking-widest hover:bg-md-surface-variant disabled:opacity-30 transition-all"
                >
                  <Download size={14} /> Export
                </button>
                <label className="flex items-center justify-center gap-2 py-3 rounded-xl border border-md-outline/20 text-xs font-bold uppercase tracking-widest hover:bg-md-surface-variant cursor-pointer transition-all">
                  <Upload size={14} /> Import
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Background Decor */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-md-primary/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-md-tertiary/10 blur-[120px] rounded-full" />
      </div>

      {!process.env.GEMINI_API_KEY && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-sm flex items-center gap-3 shadow-xl">
            <AlertCircle size={20} className="shrink-0" />
            <div>
              <p className="font-bold">Gemini API Key Missing</p>
              <p className="opacity-80">Please add your GEMINI_API_KEY to the environment variables to enable AI generation.</p>
            </div>
          </div>
        </div>
      )}

      <header className="fixed top-0 left-0 right-0 p-6 flex justify-between items-center z-50">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className="p-3 bg-white/50 backdrop-blur-md border border-md-outline/10 rounded-2xl hover:bg-white transition-colors shadow-sm"
          >
            <Layers size={20} className="text-md-primary" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-md-primary rounded-xl flex items-center justify-center text-white shadow-lg">
              <Sparkles size={20} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Mourish <span className="text-md-primary">Coder</span></h1>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-xs font-bold text-md-primary">{user.displayName}</span>
                <button onClick={handleLogout} className="text-[10px] text-md-outline hover:text-red-500 transition-colors uppercase font-bold tracking-widest">Sign Out</button>
              </div>
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-10 h-10 rounded-xl border border-md-outline/10 shadow-sm" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 bg-md-surface-variant rounded-xl flex items-center justify-center text-md-primary">
                  <UserIcon size={20} />
                </div>
              )}
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="md-button-tonal py-2 px-4 text-sm flex items-center gap-2"
            >
              <LogIn size={16} /> Sign In
            </button>
          )}
          {step !== 'prompt' && (
            <button 
              onClick={createNewSession}
              className="md-button-tonal py-2 text-sm flex items-center gap-2"
            >
              <RefreshCw size={14} /> New Chat
            </button>
          )}
        </div>
      </header>

      <main className="w-full max-w-4xl mt-20">
        <AnimatePresence mode="wait">
          {step === 'prompt' && (
            <motion.div 
              key="prompt"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center text-center gap-8"
            >
              <div className="space-y-4">
                <h2 className="text-4xl md:text-6xl font-bold max-w-2xl leading-tight">
                  What are we <span className="text-md-primary italic">vibe-coding</span> today?
                </h2>
                <p className="text-md-on-surface-variant text-lg">
                  Describe your dream app or website. We'll handle the rest.
                </p>
              </div>

              <div className="w-full relative group">
                <textarea
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setError(null);
                  }}
                  placeholder="A futuristic dashboard for a space station with neon accents and real-time data..."
                  className={`md-input h-40 text-xl resize-none pr-16 pt-6 ${error ? 'border-red-500' : ''}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) handleStart();
                  }}
                />
                <button 
                  onClick={handleStart}
                  disabled={isLoading || !prompt.trim()}
                  className="absolute bottom-4 right-4 md-button-primary p-4 rounded-2xl disabled:opacity-50"
                >
                  {isLoading ? <RefreshCw className="animate-spin" /> : <ArrowRight />}
                </button>
                <div className="absolute top-2 right-4 text-[10px] text-md-outline uppercase font-bold tracking-widest opacity-50">
                  CMD + ENTER to start
                </div>
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm flex items-center gap-3 animate-shake">
                  <RefreshCw size={16} className="shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex flex-wrap justify-center gap-3">
                {['SaaS Landing Page', 'Crypto Dashboard', 'Portfolio Gallery', 'Music Player'].map(tag => (
                  <button 
                    key={tag}
                    onClick={() => setPrompt(tag)}
                    className="px-4 py-2 rounded-full border border-md-outline/20 text-sm hover:bg-md-primary/5 transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>

              {sessions.length > 0 && step === 'prompt' && (
                <button 
                  onClick={() => setIsHistoryOpen(true)}
                  className="text-xs text-md-outline hover:text-md-primary transition-colors flex items-center gap-2 mt-4"
                >
                  <Layers size={12} /> View Chat History ({sessions.length})
                </button>
              )}
            </motion.div>
          )}

          {step === 'questions' && (
            <motion.div 
              key="questions"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="md-card max-w-2xl mx-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="flex gap-1">
                  {questions.map((_, i) => (
                    <div 
                      key={i} 
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        i === currentQuestionIndex ? 'w-8 bg-md-primary' : 
                        i < currentQuestionIndex ? 'w-4 bg-md-primary/40' : 'w-4 bg-md-outline/20'
                      }`} 
                    />
                  ))}
                </div>
                <span className="text-xs font-bold text-md-outline uppercase tracking-widest">
                  Question {currentQuestionIndex + 1} of {questions.length}
                </span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentQuestionIndex}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <h3 className="text-2xl font-medium leading-snug">
                    {questions[currentQuestionIndex]}
                  </h3>
                  
                  <div className="space-y-4">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Type your answer..."
                      className="md-input text-lg"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAnswer((e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                    />
                    <p className="text-xs text-md-outline">Press Enter to continue</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}

          {step === 'generating' && (
            <motion.div 
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-8 py-20"
            >
              <div className="relative">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                  className="w-32 h-32 border-4 border-md-primary/10 border-t-md-primary rounded-full"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="text-md-primary animate-pulse" size={32} />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold">Crafting your vibe...</h3>
                <p className="text-md-on-surface-variant">Applying Material Design 3 principles and Tailwind magic.</p>
              </div>
            </motion.div>
          )}

          {step === 'result' && generatedResult && (
            <motion.div 
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex-1">
                  <h3 className="text-2xl font-bold">Generation Complete</h3>
                  <p className="text-sm text-md-on-surface-variant line-clamp-2">{generatedResult.explanation}</p>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="flex bg-md-surface-variant/50 p-1 rounded-2xl border border-md-outline/10">
                    <button 
                      onClick={() => setViewMode('preview')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        viewMode === 'preview' ? 'bg-white shadow-sm text-md-primary' : 'text-md-on-surface-variant'
                      }`}
                    >
                      <Eye size={16} /> Preview
                    </button>
                    <button 
                      onClick={() => setViewMode('code')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        viewMode === 'code' ? 'bg-white shadow-sm text-md-primary' : 'text-md-on-surface-variant'
                      }`}
                    >
                      <Code size={16} /> Code
                    </button>
                  </div>

                  <button 
                    onClick={() => setShowRefinePanel(!showRefinePanel)}
                    className={`md-button-tonal p-3 rounded-2xl transition-all ${showRefinePanel ? 'bg-md-primary/10 text-md-primary' : ''}`}
                    title="AI Refinement"
                  >
                    <Sparkles size={20} />
                  </button>

                  <button 
                    onClick={() => setIsFullscreen(true)}
                    className="md-button-tonal p-3 rounded-2xl"
                    title="Fullscreen Preview"
                  >
                    <Eye size={20} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className={`lg:col-span-2 space-y-6 transition-all duration-500 ${!showRefinePanel ? 'lg:col-span-3' : ''}`}>
                  <div className="md-card p-0 overflow-hidden h-[600px] flex flex-col relative">
                    {viewMode === 'preview' ? (
                      <iframe 
                        key={previewKey}
                        srcDoc={previewContent}
                        className="w-full h-full border-none bg-white"
                        title="Generated Preview"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#1e1e1e] p-6 overflow-auto font-mono text-sm text-gray-300">
                        <pre><code>{generatedResult.html}</code></pre>
                      </div>
                    )}

                    <div className="absolute bottom-6 right-6 flex gap-3">
                      <button 
                        onClick={copyToClipboard}
                        className="md-button-primary flex items-center gap-2 shadow-2xl"
                      >
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                        {copied ? 'Copied!' : 'Copy Code'}
                      </button>
                    </div>
                  </div>
                </div>

                <AnimatePresence>
                  {showRefinePanel && (
                    <motion.div 
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="lg:col-span-1 flex flex-col gap-4"
                    >
                      <div className="md-card flex-1 flex flex-col h-[600px]">
                        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-md-outline/10">
                          <Sparkles className="text-md-primary" size={18} />
                          <h4 className="font-bold">AI Assistant</h4>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-thin mb-4">
                          {chatHistory.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[90%] p-3 rounded-2xl text-sm ${
                                msg.role === 'user' 
                                  ? 'bg-md-primary text-white rounded-tr-none' 
                                  : 'bg-md-surface-variant text-md-on-surface-variant rounded-tl-none'
                              }`}>
                                {msg.text}
                              </div>
                            </div>
                          ))}
                          {isRefining && (
                            <div className="flex justify-start">
                              <div className="bg-md-surface-variant p-3 rounded-2xl rounded-tl-none flex gap-1">
                                <div className="w-1.5 h-1.5 bg-md-primary rounded-full animate-bounce" />
                                <div className="w-1.5 h-1.5 bg-md-primary rounded-full animate-bounce [animation-delay:0.2s]" />
                                <div className="w-1.5 h-1.5 bg-md-primary rounded-full animate-bounce [animation-delay:0.4s]" />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {(suggestions.length > 0 ? suggestions : ['Dark Mode', 'More Modern', 'Add Animations', 'Mobile Fix']).map(tag => (
                              <button 
                                key={tag}
                                onClick={() => {
                                  setRefineRequest(tag);
                                  // Optionally auto-trigger
                                }}
                                className="px-2 py-1 rounded-lg bg-md-primary/5 text-[10px] font-bold text-md-primary uppercase tracking-wider hover:bg-md-primary/10 transition-colors text-left"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                          
                          <div className="relative">
                            <textarea 
                              value={refineRequest}
                              onChange={(e) => setRefineRequest(e.target.value)}
                              placeholder="Describe changes..."
                              className="md-input min-h-[80px] py-3 pr-12 text-sm resize-none"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleRefine();
                                }
                              }}
                              disabled={isRefining}
                            />
                            <button 
                              onClick={handleRefine}
                              disabled={isRefining || !refineRequest.trim()}
                              className="absolute right-3 bottom-3 p-2 text-md-primary disabled:opacity-30"
                            >
                              <Send size={18} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Fullscreen Preview Modal */}
      <AnimatePresence>
        {isFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col"
          >
            <div className="p-4 flex justify-between items-center bg-zinc-900 text-white">
              <h4 className="font-bold">Fullscreen Preview</h4>
              <button 
                onClick={() => setIsFullscreen(false)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
              >
                Close Preview
              </button>
            </div>
            <iframe 
              key={`fs-${previewKey}`}
              srcDoc={previewContent}
              className="flex-1 w-full border-none bg-white"
              title="Fullscreen Preview"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="fixed bottom-0 left-0 right-0 p-6 flex justify-center pointer-events-none">
        <div className="bg-md-surface/80 backdrop-blur-md border border-md-outline/10 px-6 py-3 rounded-full flex items-center gap-6 pointer-events-auto shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold text-md-outline uppercase tracking-widest">
            <Layers size={14} /> Material Design 3
          </div>
          <div className="w-px h-4 bg-md-outline/20" />
          <div className="flex items-center gap-2 text-xs font-bold text-md-outline uppercase tracking-widest">
            <Terminal size={14} /> Tailwind CSS
          </div>
        </div>
      </footer>
    </div>
  );
}
