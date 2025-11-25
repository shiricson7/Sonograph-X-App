import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, setDoc, onSnapshot, query, deleteDoc } from 'firebase/firestore';
import { 
  Activity, Save, Copy, Printer, FileText, History, 
  Trash2, Plus, CheckCircle2, Layout, User, Calendar, 
  Stethoscope, FileOutput, ChevronRight, X, Menu, Sparkles, Loader2, MessageCircle
} from 'lucide-react';

// --- 1. Configuration & Templates ---
const getEnv = (key, globalVar) => {
    // 캔버스 환경이 아닐 때 (Vite 로컬/Vercel 빌드 환경)
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
        return import.meta.env[key];
    }
    // 캔버스 환경일 때 (글로벌 변수)
    return typeof globalVar !== 'undefined' ? globalVar : null;
};

// API Key를 명확히 로드합니다.
// Canvas 환경: globalVar가 사용됨
// Vercel 환경: import.meta.env['VITE_GEMINI_API_KEY']가 사용됨
const apiKey = getEnv('VITE_GEMINI_API_KEY', '') || ""; 
const appId = getEnv('VITE_APP_ID', typeof __app_id !== 'undefined' ? __app_id : 'sonograph-x');


const TEMPLATES = {
    'Abdomen US': {
        normal: "The liver is normal in size and echotexture. No focal liver lesion is seen.\nThe gallbladder is well-distended without wall thickening or stones.\nThe pancreas and spleen are unremarkable.\nBoth kidneys show normal size and echogenicity without hydronephrosis.",
        impression: "Normal abdominal ultrasound."
    },
    'Thyroid US': {
        normal: "The thyroid gland is of normal size and homogeneous echotexture.\nNo nodules, cysts, or calcifications are identified.\nIsthmus thickness is normal.\nNo abnormal cervical lymphadenopathy is observed.",
        impression: "Normal thyroid ultrasound."
    },
    'KUB (Kidney, Ureter, Bladder) US': {
        normal: "Both kidneys are normal in size, position, and echotexture.\nCorticomedullary differentiation is well-preserved.\nNo renal calculi or hydronephrosis is seen.\nThe urinary bladder is well-distended with smooth walls.",
        impression: "Normal urinary tract ultrasound."
    },
    'Carotid Doppler US': {
        normal: "Common, internal, and external carotid arteries show normal caliber and flow velocities.\nIntima-media thickness (IMT) is within normal limits.\nNo hemodynamically significant stenosis or plaque is identified.",
        impression: "Normal carotid Doppler study."
    },
    'Breast US': {
        normal: "Bilateral breasts show normal fibroglandular tissue echotexture.\nNo solid or cystic mass is identified.\nNo ductal dilatation or architectural distortion.\nAxillary lymph nodes are unremarkable.",
        impression: "BI-RADS Category 1: Negative."
    },
    'Musculoskeletal US': {
        normal: "Examined tendons and ligaments show normal fibrillar pattern and echogenicity.\nNo effusion or synovial thickening in the joint.\nNo muscle tear or mass lesion identified.",
        impression: "Normal musculoskeletal ultrasound."
    },
    'Appendix US': {
        normal: "The appendix is visualized with a diameter of less than 6mm.\nIt is compressible and shows no surrounding fat stranding or fluid collection.",
        impression: "Normal appendix. No signs of appendicitis."
    }
};

// --- 2. React Application ---
export default function App() {
    // State
    const [user, setUser] = useState(null);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentId, setCurrentId] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    
    // AI States
    const [aiLoading, setAiLoading] = useState(false); // 'polish' | 'impression' | 'explain' | false
    const [explainModalOpen, setExplainModalOpen] = useState(false);
    const [aiExplanation, setAiExplanation] = useState('');

    // Form Data
    const [form, setForm] = useState({
        name: '', id: '', rrn: '', date: new Date().toISOString().split('T')[0],
        type: '', indication: '', findings: '', impression: ''
    });
    
    // Calculated
    const [ageSex, setAgeSex] = useState({ age: '', sex: '' });

    // Refs
    const dbRef = useRef(null);
    const authRef = useRef(null);

    // --- 3. Initialization & Effects ---
    useEffect(() => {
        const initApp = async () => {
            try {
                const configStr = typeof __firebase_config !== 'undefined' ? __firebase_config : null;
                if (configStr) {
                    const config = JSON.parse(configStr);
                    const fbApp = initializeApp(config);
                    authRef.current = getAuth(fbApp);
                    dbRef.current = getFirestore(fbApp);

                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(authRef.current, __initial_auth_token);
                    } else {
                        await signInAnonymously(authRef.current);
                    }

                    onAuthStateChanged(authRef.current, (u) => {
                        setUser(u);
                        setLoading(false);
                    });
                } else {
                    console.warn("No Firebase Config. Local Mode.");
                    setUser({ uid: 'local' });
                    setLoading(false);
                }
            } catch (e) {
                console.error(e);
                setLoading(false);
            }
        };
        initApp();
    }, []);

    // Load History
    useEffect(() => {
        if (!user || !dbRef.current) return;
        const q = query(collection(dbRef.current, `artifacts/${appId}/users/${user.uid}/reports`));
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            setReports(list);
        });
        return () => unsub();
    }, [user]);

    // RRN Calculation
    useEffect(() => {
        const rrn = form.rrn.replace(/-/g, '');
        if (rrn.length < 7) {
            setAgeSex({ age: '', sex: '' });
            return;
        }
        const digit = parseInt(rrn.charAt(6));
        const yearPrefix = (digit === 1 || digit === 2 || digit === 5 || digit === 6) ? 1900 : 2000;
        const year = yearPrefix + parseInt(rrn.substring(0, 2));
        const month = parseInt(rrn.substring(2, 4)) - 1;
        const day = parseInt(rrn.substring(4, 6));
        
        const today = new Date();
        let age = today.getFullYear() - year;
        if (today.getMonth() < month || (today.getMonth() === month && today.getDate() < day)) age--;
        
        const sex = (digit % 2 !== 0) ? 'Male' : 'Female';
        setAgeSex({ age, sex });
    }, [form.rrn]);

    // --- 4. Actions ---
    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleTemplate = (e) => {
        const type = e.target.value;
        setForm(prev => ({
            ...prev,
            type,
            findings: TEMPLATES[type]?.normal || '',
            impression: TEMPLATES[type]?.impression || ''
        }));
    };

    const handleSave = async () => {
        if (!user || !dbRef.current) return;
        if (!form.name) return alert("Patient Name is required.");
        
        const data = { ...form, updatedAt: new Date().toISOString() };
        try {
            if (currentId) {
                await setDoc(doc(dbRef.current, `artifacts/${appId}/users/${user.uid}/reports`, currentId), data, { merge: true });
            } else {
                const ref = await addDoc(collection(dbRef.current, `artifacts/${appId}/users/${user.uid}/reports`), data);
                setCurrentId(ref.id);
            }
            alert("Report saved successfully.");
        } catch (e) {
            console.error("Save failed", e);
        }
    };

    const handleLoad = (item) => {
        setCurrentId(item.id);
        setForm({
            name: item.name || '', id: item.id_num || item.id || '', rrn: item.rrn || '', 
            date: item.date || '', type: item.type || '', 
            indication: item.indication || '', findings: item.findings || '', impression: item.impression || ''
        });
        if(window.innerWidth < 768) setSidebarOpen(false);
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!confirm("Delete this report?")) return;
        if (dbRef.current) await deleteDoc(doc(dbRef.current, `artifacts/${appId}/users/${user.uid}/reports`, id));
        if (currentId === id) handleNew();
    };

    const handleNew = () => {
        setCurrentId(null);
        setForm({
            name: '', id: '', rrn: '', date: new Date().toISOString().split('T')[0],
            type: '', indication: '', findings: '', impression: ''
        });
    };

    const handleCopy = () => {
        const text = `Patient: ${form.name} (${form.id})\nDate: ${form.date}\n\n[Findings]\n${form.findings}\n\n[Conclusion]\n${form.impression}`;
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert("Copied to clipboard.");
    };

    // --- 5. Gemini AI Integration ---
    const callGemini = async (prompt) => {
        const MAX_RETRIES = 3;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
        
        for (let i = 0; i < MAX_RETRIES; i++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await response.json();
                if (response.ok) return data.candidates[0].content.parts[0].text.trim();
                if (response.status !== 429) throw new Error(data.error?.message);
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
            } catch (e) {
                console.error(e);
                if (i === MAX_RETRIES - 1) alert("AI Service Error: " + e.message);
            }
        }
        return null;
    };

    const handleAiPolish = async () => {
        if (!form.findings) return alert("Please enter findings first.");
        setAiLoading('polish');
        const prompt = `You are a professional radiologist. Rewrite the following ultrasound findings to be more professional, concise, and use standard medical English. Do not add new information.\n\nFindings:\n${form.findings}`;
        const result = await callGemini(prompt);
        if (result) setForm(prev => ({ ...prev, findings: result }));
        setAiLoading(false);
    };

    const handleAiImpression = async () => {
        if (!form.findings) return alert("Please enter findings first.");
        setAiLoading('impression');
        const prompt = `You are a professional radiologist. Based ONLY on the following ultrasound findings, generate a concise Conclusion/Impression. Use standard medical terminology.\n\nFindings:\n${form.findings}`;
        const result = await callGemini(prompt);
        if (result) setForm(prev => ({ ...prev, impression: result }));
        setAiLoading(false);
    };

    const handleAiExplain = async () => {
        if (!form.findings && !form.impression) return alert("Report is empty.");
        setExplainModalOpen(true);
        setAiExplanation('Generating explanation...');
        setAiLoading('explain');
        
        const prompt = `Explain the following ultrasound report for a patient in simple, reassuring language (in English). Avoid medical jargon where possible or explain it clearly. Structure it with a Summary and Key Details.\n\nFindings: ${form.findings}\nImpression: ${form.impression}`;
        
        const result = await callGemini(prompt);
        setAiExplanation(result || "Failed to generate explanation.");
        setAiLoading(false);
    };

    // --- Render ---
    if (loading) return <div className="h-screen bg-gray-900 flex items-center justify-center text-teal-500"><Activity className="w-10 h-10 animate-spin"/></div>;

    return (
        <div className="flex h-screen bg-[#0f172a] text-slate-300 font-sans overflow-hidden selection:bg-teal-500 selection:text-white">
            
            {/* Styles for Print */}
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Serif+KR:wght@400;700&display=swap');
                
                ::-webkit-scrollbar { width: 8px; height: 8px; }
                ::-webkit-scrollbar-track { background: #1e293b; }
                ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
                ::-webkit-scrollbar-thumb:hover { background: #475569; }

                @media print {
                    @page { margin: 0; size: A4; }
                    body { background: white !important; color: black !important; }
                    .no-print { display: none !important; }
                    #print-layer { 
                        display: block !important; 
                        position: fixed; 
                        top: 0; left: 0; width: 100%; height: 100%; 
                        background: white; z-index: 9999; 
                        padding: 20mm;
                        font-family: 'Noto Serif KR', serif;
                    }
                    .print-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
                    .print-title { font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; color: #000; }
                    .print-subtitle { font-size: 14px; color: #555; margin-top: 5px; }
                    
                    .print-grid { display: grid; grid-template-columns: 100px 1fr 100px 1fr; gap: 10px; border: 1px solid #ccc; padding: 15px; margin-bottom: 30px; font-size: 14px; }
                    .print-label { font-weight: bold; color: #333; }
                    
                    .print-section { margin-bottom: 30px; }
                    .print-sec-title { font-size: 16px; font-weight: bold; border-bottom: 1px solid #000; display: inline-block; margin-bottom: 10px; padding-bottom: 2px; text-transform: uppercase; }
                    .print-content { font-size: 14px; line-height: 1.6; white-space: pre-wrap; text-align: justify; }
                    
                    .print-footer { position: fixed; bottom: 20mm; right: 20mm; text-align: right; }
                    .print-sign { font-size: 16px; font-weight: bold; margin-top: 50px; border-top: 1px solid #aaa; padding-top: 10px; display: inline-block; min-width: 200px; text-align: center; }
                }
            `}</style>

            {/* AI Explanation Modal */}
            {explainModalOpen && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden transform transition-all scale-100">
                        <div className="p-5 bg-gradient-to-r from-indigo-600 to-purple-600 flex justify-between items-center text-white">
                            <h3 className="font-bold flex items-center gap-2">
                                <Sparkles className="w-5 h-5" /> Patient Explanation
                            </h3>
                            <button onClick={() => setExplainModalOpen(false)} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-6 max-h-[60vh] overflow-y-auto">
                            {aiLoading === 'explain' ? (
                                <div className="flex flex-col items-center justify-center py-8 text-indigo-600 gap-3">
                                    <Loader2 className="w-8 h-8 animate-spin" />
                                    <span className="text-sm font-medium">Generating friendly explanation...</span>
                                </div>
                            ) : (
                                <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">{aiExplanation}</p>
                            )}
                        </div>
                        <div className="p-4 bg-slate-50 flex justify-end border-t border-slate-200">
                            <button onClick={() => setExplainModalOpen(false)} className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 font-medium text-sm transition-colors">Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Sidebar Toggle Overlay */}
            {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)}></div>}

            {/* 1. Sidebar (History) */}
            <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:relative z-30 w-72 bg-[#1e293b] border-r border-slate-700 flex flex-col transition-transform duration-300 shadow-2xl`}>
                <div className="p-6 flex items-center gap-3 border-b border-slate-700/50">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
                        <Activity className="text-white w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="font-bold text-white text-lg tracking-tight">SonoGraph X</h1>
                        <p className="text-xs text-slate-400">AI-Powered Reporting</p>
                    </div>
                </div>

                <div className="p-4">
                    <button onClick={handleNew} className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-teal-900/20 group">
                        <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" /> New Report
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 pl-2">History ({reports.length})</div>
                    {reports.map(r => (
                        <div key={r.id} onClick={() => handleLoad(r)} 
                             className={`group relative p-3 rounded-lg cursor-pointer transition-all border ${currentId === r.id ? 'bg-slate-700/50 border-teal-500/50' : 'bg-slate-800/50 border-transparent hover:bg-slate-800'}`}>
                            <div className="flex justify-between items-start">
                                <span className="font-medium text-slate-200 truncate">{r.name || 'No Name'}</span>
                                <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded">{r.date}</span>
                            </div>
                            <div className="text-xs text-slate-400 mt-1 truncate">{r.type || 'General US'}</div>
                            <button onClick={(e) => handleDelete(r.id, e)} className="absolute right-2 bottom-2 p-1.5 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            </aside>

            {/* 2. Main Workspace */}
            <main className="flex-1 flex flex-col min-w-0 relative">
                
                {/* Top Bar */}
                <header className="h-16 bg-[#1e293b]/80 backdrop-blur-md border-b border-slate-700 flex items-center justify-between px-6 z-10">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden text-slate-400 hover:text-white"><Menu /></button>
                        <div className="hidden md:flex items-center gap-2 text-sm text-slate-400">
                            <User className="w-4 h-4" />
                            <span className="text-slate-200 font-medium">{form.name || 'New Patient'}</span>
                            {ageSex.age && <span className="bg-slate-700 px-2 py-0.5 rounded text-xs text-teal-400">{ageSex.age} / {ageSex.sex}</span>}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* AI Explain Button */}
                        <button onClick={handleAiExplain} className="hidden md:flex items-center gap-1.5 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-sm font-medium transition-all mr-2">
                            <Sparkles className="w-4 h-4" /> 
                            <span>Patient Explain</span>
                        </button>

                        <button onClick={handleSave} className="p-2 text-slate-400 hover:text-teal-400 hover:bg-slate-800 rounded-lg transition-colors" title="Save">
                            <Save className="w-5 h-5" />
                        </button>
                        <button onClick={handleCopy} className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition-colors" title="Copy Text">
                            <Copy className="w-5 h-5" />
                        </button>
                        <div className="w-px h-6 bg-slate-700 mx-2"></div>
                        <button onClick={() => window.print()} className="flex items-center gap-2 bg-slate-100 text-slate-900 hover:bg-white px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-white/5">
                            <Printer className="w-4 h-4" /> Print
                        </button>
                    </div>
                </header>

                {/* Work Area */}
                <div className="flex-1 flex overflow-hidden">
                    
                    {/* Editor Panel */}
                    <div className="flex-1 overflow-y-auto p-6 md:p-10 scroll-smooth">
                        <div className="max-w-4xl mx-auto space-y-8">
                            
                            {/* Section: Patient Info */}
                            <div className="bg-[#1e293b] border border-slate-700 rounded-2xl p-6 shadow-xl">
                                <div className="flex items-center gap-2 mb-6 text-teal-400 border-b border-slate-700 pb-2">
                                    <User className="w-5 h-5" />
                                    <h2 className="font-bold text-lg">Patient Information</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Name</label>
                                        <input name="name" value={form.name} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all" placeholder="Jane Doe" />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Patient ID</label>
                                        <input name="id" value={form.id} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="12345678" />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">RRN</label>
                                        <input name="rrn" value={form.rrn} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="000000-0000000" />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Exam Date</label>
                                        <input type="date" name="date" value={form.date} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-teal-500 outline-none" />
                                    </div>
                                </div>
                            </div>

                            {/* Section: Findings */}
                            <div className="bg-[#1e293b] border border-slate-700 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-teal-500 to-blue-600"></div>
                                
                                <div className="flex justify-between items-start mb-6">
                                    <div className="flex items-center gap-2 text-teal-400">
                                        <Stethoscope className="w-5 h-5" />
                                        <h2 className="font-bold text-lg">Scan Findings</h2>
                                    </div>
                                    
                                    <div className="relative group">
                                        <select name="type" value={form.type} onChange={handleTemplate} 
                                            className="appearance-none bg-slate-800 text-slate-200 border border-slate-600 rounded-lg pl-4 pr-10 py-2 text-sm font-medium focus:ring-2 focus:ring-teal-500 outline-none cursor-pointer hover:bg-slate-750 transition-colors">
                                            <option value="" disabled>Select Template...</option>
                                            {Object.keys(TEMPLATES).map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                        <div className="absolute right-3 top-2.5 pointer-events-none text-slate-400 group-hover:text-teal-400">
                                            <ChevronRight className="w-4 h-4 rotate-90" />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Indication</label>
                                        <input name="indication" value={form.indication} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="Clinical symptoms or history..." />
                                    </div>

                                    {/* Findings Editor */}
                                    <div>
                                        <div className="flex justify-between items-end mb-2">
                                            <label className="block text-xs font-bold text-slate-500 uppercase">Detailed Findings</label>
                                            <div className="flex items-center gap-3">
                                                {form.findings && <span className="text-[10px] text-teal-500 font-mono">{form.findings.length} chars</span>}
                                                <button onClick={handleAiPolish} disabled={aiLoading} className="text-xs flex items-center gap-1 bg-indigo-500/20 text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/30 px-2 py-1 rounded transition-colors disabled:opacity-50">
                                                    {aiLoading === 'polish' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3"/>} Polish
                                                </button>
                                            </div>
                                        </div>
                                        <textarea name="findings" value={form.findings} onChange={handleChange} rows="12" className="w-full bg-slate-800 border border-slate-600 rounded-lg p-4 text-slate-100 font-mono text-sm leading-relaxed focus:ring-2 focus:ring-teal-500 outline-none resize-none" placeholder="Select a template or start typing..." />
                                    </div>

                                    {/* Impression Editor */}
                                    <div>
                                        <div className="flex justify-between items-end mb-2">
                                            <label className="block text-xs font-bold text-slate-500 uppercase">Conclusion / Impression</label>
                                            <button onClick={handleAiImpression} disabled={aiLoading} className="text-xs flex items-center gap-1 bg-indigo-500/20 text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/30 px-2 py-1 rounded transition-colors disabled:opacity-50">
                                                {aiLoading === 'impression' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3"/>} Suggest
                                            </button>
                                        </div>
                                        <textarea name="impression" value={form.impression} onChange={handleChange} rows="3" className="w-full bg-slate-800 border border-slate-600 rounded-lg p-4 text-teal-300 font-medium text-sm focus:ring-2 focus:ring-teal-500 outline-none resize-none" placeholder="Summary of findings..." />
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* Live Preview (Desktop Only) */}
                    <div className="hidden xl:block w-[400px] bg-[#0f172a] border-l border-slate-700 p-8 overflow-y-auto relative">
                        <div className="sticky top-0 mb-6 flex items-center justify-between bg-[#0f172a] z-10 pb-4 border-b border-slate-800">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Live Preview</span>
                            <Layout className="w-4 h-4 text-slate-600" />
                        </div>
                        
                        {/* A4 Paper Simulation */}
                        <div className="bg-white text-black p-6 text-[10px] shadow-2xl min-h-[500px] opacity-90 origin-top transform scale-[0.85]">
                            <div className="text-center border-b border-black pb-2 mb-4">
                                <h1 className="text-lg font-bold uppercase">Ultrasound Report</h1>
                                <p className="text-[8px] text-gray-600">Shiricson Pediatric Clinic</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 border-b border-gray-200 pb-2 mb-4">
                                <div><span className="font-bold">Name:</span> {form.name}</div>
                                <div><span className="font-bold">ID:</span> {form.id}</div>
                                <div><span className="font-bold">Date:</span> {form.date}</div>
                                <div><span className="font-bold">Type:</span> {form.type}</div>
                            </div>
                            <div className="mb-4">
                                <div className="font-bold uppercase border-b border-black mb-1">Findings</div>
                                <div className="whitespace-pre-wrap leading-snug">{form.findings || '...'}</div>
                            </div>
                            <div>
                                <div className="font-bold uppercase border-b border-black mb-1">Conclusion</div>
                                <div className="font-semibold whitespace-pre-wrap">{form.impression || '...'}</div>
                            </div>
                        </div>
                    </div>

                </div>
            </main>

            {/* --- PRINT LAYER (Hidden from screen, visible on print) --- */}
            <div id="print-layer" className="hidden">
                <div className="print-header">
                    <div className="print-title">Ultrasound Report</div>
                    <div className="print-subtitle">Shiricson Pediatric Clinic</div>
                </div>

                <div className="print-grid">
                    <div className="print-label">Patient Name</div>
                    <div>{form.name}</div>
                    <div className="print-label">Patient ID</div>
                    <div>{form.id}</div>
                    
                    <div className="print-label">Age / Sex</div>
                    <div>{ageSex.age} / {ageSex.sex}</div>
                    <div className="print-label">Exam Date</div>
                    <div>{form.date}</div>
                    
                    <div className="print-label">Exam Type</div>
                    <div style={{gridColumn: 'span 3'}}>{form.type}</div>
                </div>

                <div className="print-section">
                    <div className="print-sec-title">Clinical Indication</div>
                    <div className="print-content">{form.indication}</div>
                </div>

                <div className="print-section">
                    <div className="print-sec-title">Findings</div>
                    <div className="print-content">{form.findings}</div>
                </div>

                <div className="print-section">
                    <div className="print-sec-title">Conclusion</div>
                    <div className="print-content" style={{fontWeight: 'bold'}}>{form.impression}</div>
                </div>

                <div className="print-footer">
                    <div className="print-sign">
                        Iksoon Shin, MD (96013)<br/>
                        <span style={{fontSize: '12px', fontWeight: 'normal', color: '#888'}}>Radiologist Signature</span>
                    </div>
                </div>
            </div>

        </div>
    );
}