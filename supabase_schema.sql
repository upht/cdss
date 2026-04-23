-- ==============================================
-- SUPABASE POSTGRESQL SCHEMA FOR OSTEOVISION AI
-- ==============================================

-- 1. Create the `patients` table
CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    patient_id VARCHAR(50) UNIQUE NOT NULL,
    label VARCHAR(50) DEFAULT 'Normal',
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Create the `spine_evaluations` table to hold the detailed BMD values per region
CREATE TABLE spine_evaluations (
    id SERIAL PRIMARY KEY,
    patient_id VARCHAR(50) REFERENCES patients(patient_id) ON DELETE CASCADE,
    region VARCHAR(20) NOT NULL,
    bmd FLOAT,
    t_score FLOAT,
    z_score VARCHAR(20) DEFAULT 'N/A',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Create the Storage Bucket for X-Ray Images
-- NOTE: Please execute this part manually in the Supabase Dashboard -> "Storage" -> "New bucket" -> name it "xrays".
-- Ensure this bucket is set to "Public" so the React app can display the image natively.

-- ==============================================
-- RLS (Row Level Security) Policies
-- If you want absolute public accessibility without auth for now (For testing):
-- ==============================================
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE spine_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access for patients" ON patients FOR SELECT USING (true);
CREATE POLICY "Allow public insert access for patients" ON patients FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access for patients" ON patients FOR UPDATE USING (true);

CREATE POLICY "Allow public read access for evaluations" ON spine_evaluations FOR SELECT USING (true);
CREATE POLICY "Allow public insert access for evaluations" ON spine_evaluations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete access for evaluations" ON spine_evaluations FOR DELETE USING (true);
