import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { 
  PieChart, Pie, Cell, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import Tesseract from 'tesseract.js';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'https://cdss-w8s6.onrender.com';

const TScoreBar = ({ tScore }) => {
  const boundedScore = Math.min(Math.max(tScore, -5), 2);
  const percent = ((boundedScore + 5) / 7) * 100;
  
  return (
    <div style={{ marginTop: '20px', padding: '20px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', textAlign: 'left' }}>
      <h3 style={{ margin: '0 0 25px 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>Diagnostic Visualization (Target T-Score)</h3>
      
      <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
        <div style={{ height: '24px', borderRadius: '12px', display: 'flex', overflow: 'hidden', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' }}>
          <div style={{ width: '35.7%', background: 'linear-gradient(90deg, #991b1b, var(--danger))' }} title="Osteoporosis (<= -2.5)" />
          <div style={{ width: '21.4%', background: 'linear-gradient(90deg, #ca8a04, var(--warning))' }} title="Osteopenia (-2.5 to -1.0)" />
          <div style={{ width: '42.9%', background: 'linear-gradient(90deg, #047857, var(--success))' }} title="Normal (>= -1.0)" />
        </div>
        
        <div style={{ 
          position: 'absolute', 
          left: `${percent}%`, 
          top: '-10px', 
          transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          transition: 'left 1s ease-out'
        }}>
          <div style={{ 
            width: '4px', height: '44px', background: '#fff', 
            borderRadius: '2px', boxShadow: '0 0 6px rgba(0,0,0,0.8)',
            zIndex: 10
          }}></div>
          <div style={{ 
            fontWeight: 'bold', 
            marginTop: '8px', 
            fontSize: '1.2rem', 
            color: '#fff',
            background: 'var(--bg-tertiary)',
            padding: '2px 8px',
            borderRadius: '4px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
          }}>
            {tScore.toFixed(2)}
          </div>
        </div>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '35px' }}>
        <span style={{ width: '35.7%', textAlign: 'center' }}>Osteoporosis</span>
        <span style={{ width: '21.4%', textAlign: 'center' }}>Osteopenia</span>
        <span style={{ width: '42.9%', textAlign: 'center' }}>Normal</span>
      </div>
    </div>
  );
};

const processBmdTable = async (imageFile) => {
  try {
    const { data: { text } } = await Tesseract.recognize(imageFile, 'eng');
    const textContent = text.replace(/\n/g, ' ');
    
    const rows = [];
    const targetRegions = ['L1', 'L2', 'L3', 'L4', 'L1-L2', 'L1-L3', 'L1-L4', 'L2-L3', 'L2-L4', 'L3-L4'];
    
    targetRegions.forEach(region => {
      // Regex equivalent to Python: r'\b' + region + r'\s+([+-]?\d+\.?\d*)[ \t]*([+-]?\d+\.?\d*)'
      const regex = new RegExp(`\\b${region}\\s+([+-]?\\d+\\.?\\d*)[ \\t]*([+-]?\\d+\\.?\\d*)`);
      const match = textContent.match(regex);
      if (match) {
        rows.push({
          Region: region,
          BMD: parseFloat(match[1]),
          T_Score: parseFloat(match[2]),
          Z_Score: 'N/A'
        });
      }
    });
    return rows;
  } catch (err) {
    console.error("OCR Error:", err);
    return null;
  }
};

function App() {
  const [view, setView] = useState('doctor'); // 'doctor' or 'executive'
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [filterStatus, setFilterStatus] = useState('All');
  
  // Retraining state
  const [isRetraining, setIsRetraining] = useState(false);
  const [trainingLog, setTrainingLog] = useState(null);

  // Clinical Inputs
  const [patientIdInput, setPatientIdInput] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');

  const onDrop = useCallback(acceptedFiles => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0];
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      setResult(null);
      setError(null);
    }
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/stats`);
      setStats(res.data);
    } catch (err) {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  const toggleView = () => {
    const nextView = view === 'doctor' ? 'executive' : 'doctor';
    setView(nextView);
    if (nextView === 'executive') {
      loadStats();
      setFilterStatus('All');
      setTrainingLog(null);
    }
  };

  const viewPatientScan = async (patientId) => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API_URL}/patient/${patientId}`);
      if (res.data.error) {
        setError(res.data.error);
      } else {
        setResult(res.data);
        setPreview(res.data.preview_image);
        setPatientIdInput(res.data.patient_id || patientId);
        setView('doctor'); // switch view automatically to see the loaded scan
      }
    } catch (err) {
      setError("Failed to fetch patient data.");
    } finally {
      setLoading(false);
    }
  };

  const triggerRetraining = async () => {
    if(!window.confirm("Are you sure you want to trigger a full retraining of the AI image model across all uploaded data? This may take a minute.")) return;
    
    setIsRetraining(true);
    setTrainingLog(null);
    try {
       const res = await axios.post(`${API_URL}/train_model`);
       if (res.data.error) {
         setTrainingLog(`ERROR: ${res.data.error}\n\n${res.data.details}`);
       } else {
         setTrainingLog(res.data.logs);
         alert("Model trained successfully!");
       }
    } catch(err) {
       setTrainingLog(`ERROR: Failed to connect or command failed.\n${err.message}`);
    } finally {
       setIsRetraining(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg']
    },
    multiple: false
  });

  const analyzeImage = async (e) => {
    e.preventDefault();
    if (!file && !result?.preview_image && !patientIdInput) {
      setError("Please upload a Spine BMD X-ray image or supply Patient ID.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const data = new FormData();
    if(file) {
      data.append('file', file);
    } else if (!patientIdInput) {
      setError("Please select a file or enter a Patient ID.");
      setLoading(false);
      return;
    }
    
    if (patientIdInput) data.append('patient_id', patientIdInput);
    if (age) data.append('age', age);
    if (gender) data.append('gender', gender);
    if (weight) data.append('weight', weight);
    if (height) data.append('height', height);

    // Perform Local OCR if file is provided
    if (file) {
      setLoading(true); // Ensure loading is on for OCR phase
      const extracted = await processBmdTable(file);
      if (extracted && extracted.length > 0) {
        data.append('extracted_data', JSON.stringify(extracted));
      } else {
        // If local OCR fails, we can either alert or let the backend try (but backend might OOM)
        console.warn("Local OCR could not find standard table data. Backend will try to assist.");
      }
    }

    try {
      const response = await axios.post(`${API_URL}/predict`, data, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (response.data.error) {
        setError(response.data.error);
      } else {
        setResult(response.data);
      }
    } catch (err) {
      setError("Failed to connect to the prediction server.");
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (prediction) => {
    if (prediction === 'Osteoporosis') return 'var(--danger)';
    if (prediction === 'Osteopenia') return 'var(--warning)';
    return 'var(--success)';
  };

  const getChartData = () => {
    if (!stats) return [];
    return [
      { name: 'Normal', value: stats.summary['Normal'] || 0, color: 'var(--success)' },
      { name: 'Osteopenia', value: stats.summary['Osteopenia'] || 0, color: 'var(--warning)' },
      { name: 'Osteoporosis', value: stats.summary['Osteoporosis'] || 0, color: 'var(--danger)' }
    ];
  };

  const chartData = getChartData();
  const filteredRecords = stats?.records ? (filterStatus === 'All' ? stats.records : stats.records.filter(r => r.label === filterStatus)) : [];

  return (
    <div className="App">
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem' }}>Clinical Decision Support System For Osteoporosis Screening</h1>
          <p>Automated WHO Criteria Diagnostic Tool & Management System</p>
        </div>
        <button className="btn-secondary" onClick={toggleView} style={{ width: 'auto', padding: '0.8rem 1.5rem' }}>
          {view === 'doctor' ? '📈 Executive Dashboard' : '🏥 Diagnostic Mode'}
        </button>
      </header>

      {view === 'doctor' ? (
        <div className="dashboard-container">
          {/* Left Column - Input File */}
          <div className="card">
            <h2>📊 Patient Spine Scan</h2>
            <form onSubmit={analyzeImage}>
              <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
                <input {...getInputProps()} />
                {isDragActive ? (
                  <p>Drop the X-ray here ...</p>
                ) : (
                  <p>Drag 'n' drop a Spine BMD X-ray here, or click to select file</p>
                )}
              </div>

              {preview && (
                <div className="file-preview">
                  <img src={preview} alt="X-ray preview" />
                </div>
              )}

              {/* Demographic Inputs */}
              <div style={{ marginTop: '1.5rem', textAlign: 'left', background: 'rgba(0,0,0,0.15)', padding: '15px', borderRadius: '8px' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Clinical Data (Optional for advanced analysis)
                </h3>
                
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Patient ID</label>
                  <input type="text" value={patientIdInput} onChange={e => setPatientIdInput(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'white' }} placeholder="e.g. 650080000" />
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Age (Years)</label>
                    <input type="number" value={age} onChange={e => setAge(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'white' }} placeholder="e.g. 68" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Gender</label>
                    <select value={gender} onChange={e => setGender(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'white' }}>
                      <option value="">Select...</option>
                      <option value="F">Female</option>
                      <option value="M">Male</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Weight (kg)</label>
                    <input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'white' }} placeholder="e.g. 55" />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px' }}>Height (cm)</label>
                    <input type="number" step="0.1" value={height} onChange={e => setHeight(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'white' }} placeholder="e.g. 158" />
                  </div>
                </div>
              </div>

              {error && <div style={{ color: 'var(--danger)', margin: '1rem 0', textAlign: 'left' }}>⚠️ {error}</div>}

              <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '1.5rem' }}>
                {loading ? <span className="loader"></span> : "Extract Values & Analyze Risk"}
              </button>
            </form>
          </div>

          {/* Right Column - Results */}
          <div className="card">
            <h2>🔬 WHO Diagnostic Result</h2>
            {!result && !loading && (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '3rem 0' }}>
                <p>Upload a spine scan or select a patient to view WHO screening results.</p>
              </div>
            )}

            {loading && (
              <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                <div className="loader" style={{ width: '40px', height: '40px', borderWidth: '4px', borderColor: 'var(--accent) transparent var(--accent) transparent' }}></div>
                <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Processing request...</p>
              </div>
            )}

            {result && (
              <div className="result-container" style={{ width: '100%' }}>
                
                {result.patient_id && (
                  <div style={{ 
                    display: 'inline-block',
                    background: 'var(--bg-tertiary)', 
                    padding: '8px 24px', 
                    borderRadius: '20px', 
                    marginBottom: '1rem',
                    border: '1px solid var(--border-color)',
                    fontSize: '1.1rem'
                  }}>
                    👤 Patient ID: <strong style={{color: 'white'}}>{result.patient_id}</strong>
                  </div>
                )}
                
                <div style={{ 
                  background: 'rgba(0,0,0,0.3)', 
                  padding: '2rem', 
                  borderRadius: '12px', 
                  width: '100%', 
                  marginBottom: '1rem',
                  border: `2px solid ${getStatusColor(result.prediction)}`,
                  boxShadow: `0 0 20px -5px ${getStatusColor(result.prediction)}`
                }}>
                  <h3 style={{ margin: '0 0 5px 0', fontSize: '1rem', color: 'var(--text-secondary)' }}>Diagnosis</h3>
                  <div style={{ 
                    fontSize: '2.5rem', 
                    fontWeight: '800', 
                    color: getStatusColor(result.prediction),
                    textTransform: 'uppercase',
                    letterSpacing: '2px'
                  }}>
                    {result.prediction}
                  </div>
                  {result.full_description && (
                     <div style={{ marginTop: '10px', fontSize: '1rem', color: 'var(--text-primary)' }}>
                       {result.full_description}
                     </div>
                  )}
                  {result.recommendation && (
                     <div style={{ marginTop: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                       ℹ️ {result.recommendation}
                     </div>
                  )}
                </div>
                
                {/* Clinical Notes Box */}
                {result.clinical_data && (
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'left' }}>
                    <h3 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>📋 Clinical Profile</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '10px', fontSize: '0.9rem', marginBottom: '10px' }}>
                      <div><span style={{color:'var(--text-secondary)'}}>Age:</span> {result.clinical_data.age}</div>
                      <div><span style={{color:'var(--text-secondary)'}}>Gender:</span> {result.clinical_data.gender}</div>
                      <div><span style={{color:'var(--text-secondary)'}}>Weight:</span> {result.clinical_data.weight}</div>
                      <div><span style={{color:'var(--text-secondary)'}}>Height:</span> {result.clinical_data.height}</div>
                      <div><span style={{color:'var(--text-secondary)'}}>BMI:</span> <strong style={{color: result.clinical_data.bmi < 18.5 ? 'var(--warning)' : 'inherit'}}>{result.clinical_data.bmi}</strong></div>
                    </div>
                    {result.clinical_notes && result.clinical_notes.length > 0 && (
                      <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)'}}>
                        {result.clinical_notes.map((note, i) => (
                          <div key={i} style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>⚠️ {note}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="prediction-details" style={{ textAlign: 'left', width: '100%', padding: '0', background: 'transparent' }}>
                  <TScoreBar tScore={result.min_t_score} />
                  
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '8px', marginTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem' }}>Extracted Table Details</h3>
                      {result.criteria_used && result.criteria_used.includes("Database Record") && (
                        <span style={{ fontSize: '0.7rem', background: 'var(--accent)', color: 'white', padding: '2px 8px', borderRadius: '10px' }}>Loaded from Database</span>
                      )}
                    </div>
                    
                    <div style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '10px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-tertiary)', zIndex: 1 }}>
                          <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                            <th style={{ textAlign: 'left', padding: '0.8rem 0.5rem' }}>Region</th>
                            <th style={{ textAlign: 'right', padding: '0.8rem 0.5rem' }}>BMD</th>
                            <th style={{ textAlign: 'right', padding: '0.8rem 0.5rem' }}>T-Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.extracted_data.map((row, idx) => (
                            <tr key={idx} style={{ 
                              borderBottom: '1px solid rgba(255,255,255,0.05)',
                              background: row.T_Score === result.min_t_score ? 'rgba(255,255,255,0.05)' : 'transparent'
                            }}>
                              <td style={{ padding: '0.8rem 0.5rem', fontWeight: '500' }}>
                                {row.Region} {row.T_Score === result.min_t_score && '🔴'}
                              </td>
                              <td style={{ padding: '0.8rem 0.5rem', textAlign: 'right' }}>{row.BMD}</td>
                              <td style={{ 
                                padding: '0.8rem 0.5rem', 
                                textAlign: 'right', 
                                fontWeight: 'bold',
                                color: row.T_Score <= -2.5 ? 'var(--danger)' : (row.T_Score < -1.0 ? 'var(--warning)' : 'var(--success)') 
                              }}>
                                {row.T_Score}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="executive-view">
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>💼 Executive Overview</h2>
            <button 
              className="btn-primary" 
              onClick={triggerRetraining} 
              disabled={isRetraining}
              style={{ background: 'var(--accent)', border: 'none', padding: '0.6rem 1.2rem', margin: 0, width: 'auto' }}>
              {isRetraining ? '⏳ Retraining...' : '⚙️ Sync Database & Retrain AI'}
            </button>
          </div>
          
          {trainingLog && (
            <div className="card" style={{ marginBottom: '2rem', textAlign: 'left', border: '1px solid var(--accent)' }}>
              <h3 style={{ color: 'var(--success)', marginBottom: '1rem' }}>✅ Model Retraining Log</h3>
              <pre style={{ background: 'rgba(0,0,0,0.5)', padding: '1rem', borderRadius: '8px', overflowX: 'auto', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {trainingLog}
              </pre>
            </div>
          )}

          {/* STATS CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
            <div className="card" style={{ animationDelay: '0s', opacity: 1, textAlign: 'left' }}>
              <h3 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Total Patients</h3>
              <div style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>{stats?.total || 0}</div>
            </div>
            {['Normal', 'Osteopenia', 'Osteoporosis'].map((label, idx) => (
              <div key={label} className="card" style={{ animationDelay: `${(idx+1)*0.1}s`, opacity: 1, textAlign: 'left' }}>
                <h3 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{label} Cases</h3>
                <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: getStatusColor(label) }}>
                  {stats?.summary[label] || 0}
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                  {stats?.total ? ((stats.summary[label] / stats.total) * 100).toFixed(1) : 0}% of population
                </div>
              </div>
            ))}
          </div>

          {/* VISUALIZATION CHARTS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
            
            {/* Donut Chart */}
            <div className="card" style={{ height: '380px', textAlign: 'left' }}>
              <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>Population Distribution</h3>
              <ResponsiveContainer width="100%" height="85%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                     contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                     itemStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Bar Chart */}
            <div className="card" style={{ height: '380px', textAlign: 'left' }}>
              <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>Case Counts Comparison</h3>
              <ResponsiveContainer width="100%" height="85%">
                <BarChart
                  data={chartData}
                  margin={{ top: 20, right: 30, left: -20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{fill: 'var(--text-secondary)'}} axisLine={{stroke: 'var(--border-color)'}} />
                  <YAxis stroke="var(--text-secondary)" allowDecimals={false} tick={{fill: 'var(--text-secondary)'}} axisLine={{stroke: 'var(--border-color)'}} />
                  <Tooltip 
                     cursor={{fill: 'rgba(255,255,255,0.05)'}}
                     contentStyle={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={60}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            
          </div>

          {/* PATIENT TABLE */}
          <div className="card" style={{ opacity: 1, textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>📋 Central Patient Database</h2>
              
              {/* Filter Buttons */}
              <div style={{ display: 'flex', gap: '0.4rem', background: 'rgba(0,0,0,0.2)', padding: '0.4rem', borderRadius: '8px' }}>
                {['All', 'Normal', 'Osteopenia', 'Osteoporosis'].map(status => (
                  <button 
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    style={{
                      background: filterStatus === status ? (status === 'All' ? 'var(--accent)' : getStatusColor(status)) : 'transparent',
                      color: filterStatus === status ? 'white' : 'var(--text-secondary)',
                      border: 'none',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: filterStatus === status ? 'bold' : 'normal',
                      transition: 'all 0.2s',
                      fontSize: '0.85rem'
                    }}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
            
            {loading ? (
              <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                <div className="loader" style={{ width: '40px', height: '40px', borderWidth: '4px', borderColor: 'var(--accent) transparent var(--accent) transparent' }}></div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '1rem', textAlign: 'left' }}>Patient ID</th>
                      <th style={{ padding: '1rem', textAlign: 'left' }}>Current Status</th>
                      <th style={{ padding: '1rem', textAlign: 'center' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.length > 0 ? filteredRecords.map((record, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '1rem' }}>{record.patient_id}</td>
                        <td style={{ padding: '1rem' }}>
                          <span style={{ 
                            padding: '4px 12px', 
                            borderRadius: '20px', 
                            fontSize: '0.8rem', 
                            fontWeight: 'bold',
                            background: `${getStatusColor(record.label)}22`,
                            color: getStatusColor(record.label),
                            border: `1px solid ${getStatusColor(record.label)}44`
                          }}>
                            {record.label}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <button 
                            className="btn-secondary" 
                            style={{ margin: '0 auto', padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                            onClick={() => viewPatientScan(record.patient_id)}
                          >
                            👁️ View Scan
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="3" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                          No patients found with status "{filterStatus}".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
