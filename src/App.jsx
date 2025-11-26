import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, setDoc, onSnapshot, query, deleteDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Activity, Save, Copy, Printer,
  Trash2, Plus, Layout, User,
  Stethoscope, ChevronRight, X, Menu, Sparkles, Loader2, MessageCircle
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

const appId = getEnv('VITE_APP_ID', typeof __app_id !== 'undefined' ? __app_id : 'sonograph-x');


const TEMPLATES = {
    'Abdomen US': {
        normal: "Liver is appropriate in size with homogeneous echotexture and no focal lesion.\nGallbladder is well-distended without wall thickening, stones, or sludge; common duct is not dilated.\nPancreas and spleen are unremarkable.\nBoth kidneys are normal in size and echogenicity without hydronephrosis or calculus.",
        impression: "Normal abdominal ultrasound."
    },
    'Kidney-Bladder US': {
        normal: "Both kidneys demonstrate preserved corticomedullary differentiation with no calculus or hydronephrosis.\nUreters are not dilated.\nUrinary bladder is smoothly contoured without wall thickening or intraluminal debris; post-void residual is minimal if assessed.",
        impression: "Normal renal and bladder ultrasound."
    },
    'Neonatal Spine US': {
        normal: "Conus medullaris terminates at L1–L2 with a thin, mobile filum.\nNo dorsal dermal sinus, lipoma, or intraspinal mass is identified.\nPosterior elements are intact without evidence of dysraphism.\nNo abnormal fluid collection in the paraspinal soft tissues.",
        impression: "Normal neonatal spinal canal and cord."
    },
    'Pediatric Neck US': {
        normal: "Thyroid lobes are normal in size with homogeneous echotexture.\nVisualized cervical lymph nodes are small with preserved fatty hila and normal vascular pattern.\nNo cystic or vascular neck mass is detected.\nSalivary glands appear unremarkable.",
        impression: "Normal pediatric neck ultrasound."
    },
    'Neonatal Head US': {
        normal: "Lateral ventricles are normal in caliber; third and fourth ventricles are not dilated.\nGerminal matrix at the caudothalamic groove is intact without echogenic focus.\nPeriventricular white matter shows homogeneous echogenicity without cystic change.\nNo evidence of intracranial hemorrhage or ventriculomegaly.",
        impression: "Normal cranial ultrasound for age."
    },
    'Scrotum US': {
        normal: "Both testes are normal in size with homogeneous echogenicity and symmetric intratesticular flow.\nEpididymides are unremarkable.\nNo hydrocele, varicocele, or scrotal wall thickening is present.\nSpermatic cords are intact without twisting.",
        impression: "Normal scrotal ultrasound."
    },
    'Prepubertal Uterus-Ovary US': {
        normal: "Uterus is tubular and age-appropriate with thin endometrial stripe.\nBoth ovaries are normal in volume with small peripheral follicles; vascularity is symmetric.\nNo adnexal mass or ovarian torsion is identified.\nNo free pelvic fluid.",
        impression: "Normal prepubertal pelvic ultrasound."
    },
    'Appendix US': {
        normal: "The appendix is fully visualized, compressible, and measures <6 mm in diameter.\nWall is not thickened; no periappendiceal fat stranding, fluid collection, or appendicolith is seen.\nNo regional lymphadenopathy or free fluid.",
        impression: "Normal appendix without sonographic evidence of appendicitis."
    },
    'Bowel US': {
        normal: "Visualized bowel loops show normal wall thickness and preserved peristalsis.\nNo target/donut sign or intussusception is identified.\nMesentery is unremarkable without edema or lymphadenopathy.\nNo ascites or focal fluid collection.",
        impression: "Normal bowel ultrasound."
    }
};

const COMMON_ABNORMAL = {
    general: [
        { label: 'Free fluid', text: 'Small volume simple free fluid noted in the dependent pelvis without septation or debris.' },
        { label: 'Lymphadenopathy', text: 'Mildly enlarged lymph nodes with preserved hilum and cortical thickness <3 mm, likely reactive.' }
    ],
    'Abdomen US': [
        { label: 'Cholecystitis', text: 'Gallbladder wall thickening with mural hyperemia and a positive sonographic Murphy sign; layering sludge without calculi. Common duct caliber is within normal limits.' },
        { label: 'Hepatomegaly', text: 'Liver is enlarged with mildly increased echogenicity, compatible with diffuse parenchymal disease. No focal lesion or intrahepatic biliary dilatation.' },
        { label: 'Splenomegaly', text: 'Spleen is enlarged for age with homogeneous echotexture and no focal lesion.' }
    ],
    'Kidney-Bladder US': [
        { label: 'Hydronephrosis', text: 'Pelvicalyceal dilatation with cortical thickness preserved; no visible obstructing calculus. Ureter is not dilated.' },
        { label: 'Pyelonephritis', text: 'Patchy areas of reduced corticomedullary differentiation with focal parenchymal hyperemia; no abscess or perinephric collection.' },
        { label: 'Cystitis', text: 'Urinary bladder shows diffuse wall thickening with mild mucosal irregularity; no intraluminal mass. No perivesical collection.' }
    ],
    'Neonatal Spine US': [
        { label: 'Low-lying conus', text: 'Conus medullaris terminates below L2–L3 with a thickened filum; cord motion is limited, raising concern for tethered cord.' },
        { label: 'Dermal sinus tract', text: 'Echogenic tract extending from the dermal dimple toward the dorsal spinal canal; no associated collection.' }
    ],
    'Pediatric Neck US': [
        { label: 'Reactive nodes', text: 'Multiple cervical lymph nodes are mildly enlarged with preserved fatty hila and central vascularity, favor reactive change.' },
        { label: 'Thyroglossal duct cyst', text: 'Well-defined midline cystic lesion superior to the thyroid isthmus without internal vascularity.' },
        { label: 'Branchial cleft cyst', text: 'Thin-walled cystic structure along the anterior border of the sternocleidomastoid muscle without solid component.' }
    ],
    'Neonatal Head US': [
        { label: 'Germinal matrix hemorrhage', text: 'Echogenic focus at the caudothalamic groove measuring ___ cm, consistent with germinal matrix hemorrhage (Grade I). Ventricular size is preserved.' },
        { label: 'Ventriculomegaly', text: 'Lateral ventricles are enlarged with atrial width ___ mm; no echogenic intraventricular clot.' },
        { label: 'Periventricular leukomalacia', text: 'Areas of increased periventricular echogenicity without cystic change, suspicious for early white matter injury.' }
    ],
    'Scrotum US': [
        { label: 'Torsion', text: 'Affected testis is enlarged and heterogeneous with absent intratesticular flow; spermatic cord shows whirlpool sign. Contralateral testis is normal.' },
        { label: 'Epididymo-orchitis', text: 'Testis and epididymis are enlarged with heterogeneous echogenicity and markedly increased vascularity; small reactive hydrocele present.' },
        { label: 'Hydrocele', text: 'Anechoic fluid collection surrounds the testis without septation; testes and epididymides are otherwise normal.' }
    ],
    'Prepubertal Uterus-Ovary US': [
        { label: 'Ovarian torsion', text: 'Affected ovary is enlarged with peripheral follicles and absent central flow; twisted vascular pedicle is suggested by the whirlpool sign.' },
        { label: 'Hemorrhagic cyst', text: 'Complex ovarian cyst with lace-like internal echoes and no internal vascularity, consistent with hemorrhagic cyst.' }
    ],
    'Appendix US': [
        { label: 'Appendicitis', text: 'Appendix is noncompressible measuring >6 mm with wall hyperemia and periappendiceal fat stranding; no focal abscess.' },
        { label: 'Perforation', text: 'Appendiceal wall discontinuity with periappendiceal fluid and phlegmon; echogenic foci compatible with appendicolith.' },
        { label: 'Mesenteric adenitis', text: 'Multiple enlarged mesenteric lymph nodes with preserved fatty hilum; appendix is compressible and normal in caliber.' }
    ],
    'Bowel US': [
        { label: 'Intussusception', text: 'Target-shaped mass with layered concentric rings in the right abdomen; transient peristalsis noted; no free fluid or pneumoperitoneum sonographically.' },
        { label: 'Inflammatory bowel change', text: 'Segmental bowel wall thickening with stratified mural hyperemia and adjacent mesenteric fat echogenicity; no focal collection.' }
    ]
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

    const abnormalOptions = COMMON_ABNORMAL[form.type] || COMMON_ABNORMAL.general;

    // Refs
    const dbRef = useRef(null);
    const authRef = useRef(null);
    const functionsRef = useRef(null);

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
                    functionsRef.current = getFunctions(fbApp);

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

    const addAbnormalSnippet = (text) => {
        setForm(prev => ({
            ...prev,
            findings: prev.findings ? `${prev.findings}\n\n${text}` : text
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
        const text = `Patient: ${form.name} (${form.id})\nRRN: ${form.rrn}\nAge/Sex: ${ageSex.age} / ${ageSex.sex}\nDate: ${form.date}\nExam: ${form.type}\nClinical history: ${form.indication}\n\n[Findings]\n${form.findings}\n\n[Impression]\n${form.impression}`;
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert("Copied to clipboard.");
    };

    // --- 5. Firebase Functions AI Bridge ---
    const callAiFunction = async (mode, payload) => {
        if (!functionsRef.current) {
            alert("AI service unavailable. Check Firebase Functions configuration.");
            return null;
        }

        try {
            const fn = httpsCallable(functionsRef.current, 'generateReportText');
            const res = await fn({ mode, ...payload });
            return res.data?.text || '';
        } catch (e) {
            console.error(e);
            alert("AI Service Error: " + (e.message || 'Unknown error'));
            return null;
        }
    };

    const handleAiPolish = async () => {
        if (!form.findings) return alert("Please enter findings first.");
        setAiLoading('polish');
        const result = await callAiFunction('polish', { findings: form.findings });
        if (result) setForm(prev => ({ ...prev, findings: result }));
        setAiLoading(false);
    };

    const handleAiImpression = async () => {
        if (!form.findings) return alert("Please enter findings first.");
        setAiLoading('impression');
        const result = await callAiFunction('impression', { findings: form.findings });
        if (result) setForm(prev => ({ ...prev, impression: result }));
        setAiLoading(false);
    };

    const handleAiExplain = async () => {
        if (!form.findings && !form.impression) return alert("Report is empty.");
        setExplainModalOpen(true);
        setAiExplanation('Generating explanation...');
        setAiLoading('explain');

        const result = await callAiFunction('explain', { findings: form.findings, impression: form.impression });
        setAiExplanation(result || "Failed to generate explanation.");
        setAiLoading(false);
    };

    // --- Render ---
    if (loading) return <div className="h-screen bg-gradient-to-br from-[#060b17] via-[#0b1528] to-[#03060d] flex items-center justify-center text-teal-400"><Activity className="w-10 h-10 animate-spin"/></div>;

    return (
        <div className="relative flex h-screen bg-gradient-to-br from-[#060b17] via-[#0b1528] to-[#03060d] text-slate-200 font-sans overflow-hidden selection:bg-teal-500 selection:text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.08),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(129,140,248,0.12),transparent_35%),radial-gradient(circle_at_50%_80%,rgba(236,72,153,0.07),transparent_30%)] pointer-events-none" aria-hidden="true" />
            
            {/* Styles for Print */}
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Serif+KR:wght@400;700&display=swap');
                
                ::-webkit-scrollbar { width: 8px; height: 8px; }
                ::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
                ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }

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
                    <div className="bg-[#0c1223]/90 text-slate-100 rounded-2xl shadow-[0_25px_80px_rgba(0,0,0,0.6)] w-full max-w-lg overflow-hidden transform transition-all scale-100 border border-white/10 backdrop-blur-2xl">
                        <div className="p-5 bg-gradient-to-r from-indigo-500/80 via-purple-600/80 to-teal-500/60 flex justify-between items-center text-white">
                            <h3 className="font-bold flex items-center gap-2">
                                <Sparkles className="w-5 h-5" /> 환자 안내 리포트
                            </h3>
                            <button onClick={() => setExplainModalOpen(false)} className="hover:bg-white/20 rounded p-1"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-6 max-h-[60vh] overflow-y-auto">
                            {aiLoading === 'explain' ? (
                                <div className="flex flex-col items-center justify-center py-8 text-indigo-200 gap-3">
                                    <Loader2 className="w-8 h-8 animate-spin" />
                                    <span className="text-sm font-medium">한글 설명을 준비 중입니다...</span>
                                </div>
                            ) : (
                                <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-100">{aiExplanation}</p>
                            )}
                        </div>
                        <div className="p-4 bg-white/5 flex justify-end border-t border-white/10 backdrop-blur-xl">
                            <button onClick={() => setExplainModalOpen(false)} className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 font-medium text-sm transition-colors border border-white/10">닫기</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Sidebar Toggle Overlay */}
            {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)}></div>}

            {/* 1. Sidebar (History) */}
            <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:relative z-30 w-72 bg-white/10 backdrop-blur-2xl border-r border-white/10 flex flex-col transition-transform duration-300 shadow-[0_20px_80px_rgba(0,0,0,0.35)]`}>
                <div className="p-6 flex items-center gap-3 border-b border-white/10">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
                        <Activity className="text-white w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="font-bold text-white text-lg tracking-tight">SonoGraph X</h1>
                        <p className="text-xs text-slate-400">AI-Powered Reporting</p>
                    </div>
                </div>

                <div className="p-4">
                    <button onClick={handleNew} className="w-full py-3 px-4 bg-gradient-to-r from-teal-500 to-indigo-500 hover:from-teal-400 hover:to-indigo-400 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 shadow-[0_15px_40px_rgba(16,185,129,0.3)] group">
                        <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" /> New Report
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
                    <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 pl-2">History ({reports.length})</div>
                    {reports.map(r => (
                        <div key={r.id} onClick={() => handleLoad(r)} 
                             className={`group relative p-3 rounded-lg cursor-pointer transition-all border ${currentId === r.id ? 'bg-white/10 border-teal-400/60 shadow-lg shadow-teal-500/10' : 'bg-white/5 border-transparent hover:bg-white/10'}`}>
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
                <header className="h-16 bg-white/10 backdrop-blur-2xl border-b border-white/10 flex items-center justify-between px-6 z-10 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
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
                            <MessageCircle className="w-4 h-4" />
                            <span>환자 안내 AI</span>
                        </button>

                        <button onClick={handleSave} className="p-2 text-slate-300 hover:text-teal-300 hover:bg-white/10 rounded-lg transition-colors" title="Save">
                            <Save className="w-5 h-5" />
                        </button>
                        <button onClick={handleCopy} className="p-2 text-slate-300 hover:text-blue-300 hover:bg-white/10 rounded-lg transition-colors" title="Copy Text">
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
                            <div className="bg-white/10 border border-white/10 backdrop-blur-xl rounded-2xl p-6 shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
                                <div className="flex items-center gap-2 mb-6 text-teal-300 border-b border-white/10 pb-2">
                                    <User className="w-5 h-5" />
                                    <h2 className="font-bold text-lg">Patient Information</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Name</label>
                                        <input name="name" value={form.name} onChange={handleChange} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/60 focus:border-transparent outline-none transition-all backdrop-blur-sm" placeholder="Jane Doe" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Patient ID</label>
                                        <input name="id" value={form.id} onChange={handleChange} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/60 outline-none backdrop-blur-sm" placeholder="12345678" />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">RRN</label>
                                        <input name="rrn" value={form.rrn} onChange={handleChange} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/60 outline-none backdrop-blur-sm" placeholder="000000-0000000" />
                                    </div>

                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Age (auto)</label>
                                        <input value={ageSex.age} readOnly className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-slate-200 backdrop-blur-sm" placeholder="" />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Sex (auto)</label>
                                        <input value={ageSex.sex} readOnly className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-slate-200 backdrop-blur-sm" placeholder="" />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Exam Date</label>
                                        <input type="date" name="date" value={form.date} onChange={handleChange} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-teal-500/60 outline-none backdrop-blur-sm" />
                                    </div>
                                </div>
                            </div>

                            {/* Section: Findings */}
                            <div className="bg-white/10 border border-white/10 backdrop-blur-xl rounded-2xl p-6 shadow-[0_20px_70px_rgba(0,0,0,0.35)] relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-teal-400 to-indigo-500"></div>
                                
                                <div className="flex justify-between items-start mb-6">
                                    <div className="flex items-center gap-2 text-teal-200">
                                        <Stethoscope className="w-5 h-5" />
                                        <h2 className="font-bold text-lg">Scan Findings</h2>
                                    </div>
                                    
                                    <div className="relative group">
                                        <select name="type" value={form.type} onChange={handleTemplate}
                                            className="appearance-none bg-white/5 text-white border border-white/10 rounded-lg pl-4 pr-10 py-2 text-sm font-medium focus:ring-2 focus:ring-teal-500/60 outline-none cursor-pointer hover:bg-white/10 transition-colors backdrop-blur-sm">
                                            <option value="" disabled>Select Template...</option>
                                            {Object.keys(TEMPLATES).map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                        <div className="absolute right-3 top-2.5 pointer-events-none text-slate-300 group-hover:text-teal-300">
                                            <ChevronRight className="w-4 h-4 rotate-90" />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Clinical History</label>
                                        <input name="indication" value={form.indication} onChange={handleChange} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/60 outline-none backdrop-blur-sm" placeholder="Chief complaint or reason for study" />
                                    </div>

                                    {/* Abnormal Quick Picks */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="block text-xs font-bold text-slate-500 uppercase">Common abnormal findings</label>
                                            <span className="text-[10px] text-slate-400">클릭하면 Findings에 추가됩니다</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {abnormalOptions?.map((item) => (
                                                <button
                                                    key={item.label}
                                                    type="button"
                                                    onClick={() => addAbnormalSnippet(item.text)}
                                                    className="px-3 py-1.5 bg-white/5 border border-white/10 text-slate-100 rounded-full text-xs hover:border-teal-400 hover:text-teal-200 transition-colors backdrop-blur-sm"
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                            {(!abnormalOptions || abnormalOptions.length === 0) && (
                                                <span className="text-xs text-slate-500">Select an exam type to load presets.</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Findings Editor */}
                                    <div>
                                        <div className="flex justify-between items-end mb-2">
                                            <label className="block text-xs font-bold text-slate-400 uppercase">Detailed Findings</label>
                                            <div className="flex items-center gap-3">
                                                {form.findings && <span className="text-[10px] text-teal-500 font-mono">{form.findings.length} chars</span>}
                                                <button onClick={handleAiPolish} disabled={aiLoading} className="text-xs flex items-center gap-1 bg-indigo-500/20 text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/30 px-2 py-1 rounded transition-colors disabled:opacity-50">
                                                    {aiLoading === 'polish' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3"/>} Polish
                                                </button>
                                            </div>
                                        </div>
                                        <textarea name="findings" value={form.findings} onChange={handleChange} rows="12" className="w-full bg-white/5 border border-white/10 rounded-lg p-4 text-white font-mono text-sm leading-relaxed focus:ring-2 focus:ring-teal-500/60 outline-none resize-none backdrop-blur-sm placeholder:text-slate-400" placeholder="Select a template or start typing..." />
                                    </div>

                                    {/* Impression Editor */}
                                    <div>
                                        <div className="flex justify-between items-end mb-2">
                                            <label className="block text-xs font-bold text-slate-400 uppercase">Conclusion / Impression</label>
                                            <button onClick={handleAiImpression} disabled={aiLoading} className="text-xs flex items-center gap-1 bg-indigo-500/20 text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/30 px-2 py-1 rounded transition-colors disabled:opacity-50">
                                                {aiLoading === 'impression' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3"/>} Suggest
                                            </button>
                                        </div>
                                        <textarea name="impression" value={form.impression} onChange={handleChange} rows="3" className="w-full bg-white/5 border border-white/10 rounded-lg p-4 text-teal-200 font-medium text-sm focus:ring-2 focus:ring-teal-500/60 outline-none resize-none backdrop-blur-sm placeholder:text-slate-400" placeholder="Summary of findings..." />
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* Live Preview (Desktop Only) */}
                    <div className="hidden xl:block w-[400px] bg-white/5 border-l border-white/10 p-8 overflow-y-auto relative backdrop-blur-2xl">
                        <div className="sticky top-0 mb-6 flex items-center justify-between bg-[#0c1223]/80 z-10 pb-4 border-b border-white/10 backdrop-blur-2xl">
                            <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Live Preview</span>
                            <Layout className="w-4 h-4 text-slate-400" />
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
                                <div><span className="font-bold">Age/Sex:</span> {ageSex.age} / {ageSex.sex}</div>
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