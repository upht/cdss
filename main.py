import io
import cv2
import numpy as np
import tempfile
import os
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
# import easyocr (Moved to lazy-loading to avoid startup failure on Cloud)
import re
import uvicorn
import pandas as pd
import base64
import requests
from supabase import create_client, Client
from dotenv import load_dotenv
import subprocess
import sys
import gc
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_CSV = os.path.join(BASE_DIR, "OsterporosisUpDataset.csv")

# Load Envs for Cloud Compatibility (Supabase Integration)
load_dotenv()
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("✅ Supabase Connected (Cloud Mode)")
    except Exception as e:
        print(f"❌ Supabase Connection Failed: {e}")
else:
    print("⚡ Running in Local Mode (CSVs). Set SUPABASE_URL and SUPABASE_KEY to enable Cloud DB.")

app = FastAPI(title="Osteoporosis WHO & Clinical Prediction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global reader variable set to None for lazy loading
_reader = None

def get_reader():
    global _reader
    if _reader is None:
        try:
            import easyocr
            # Load only when needed to save base memory
            _reader = easyocr.Reader(['en'], gpu=False)
        except ImportError:
            print("⚠️ EasyOCR not installed. OCR processing will fail if called.")
            return None
    return _reader

def clear_reader():
    global _reader
    _reader = None
    gc.collect()

def process_table(img_path):
    reader = get_reader()
    if reader is None:
        raise Exception("OCR Engine (EasyOCR) is not available on this server. Please use frontend OCR.")
    result = reader.readtext(img_path, detail=0)
    text_content = " ".join(result)
    
    rows = []
    target_regions = ['L1', 'L2', 'L3', 'L4', 'L1-L2', 'L1-L3', 'L1-L4', 'L2-L3', 'L2-L4', 'L3-L4']
    
    for r in target_regions:
        pattern = r'\b' + r + r'\s+([+-]?\d+\.?\d*)[ \t]*([+-]?\d+\.?\d*)'
        match = re.search(pattern, text_content)
        if match:
            bmd, t_score = match.groups()
            rows.append({
                "Region": r,
                "BMD": float(bmd),
                "T_Score": float(t_score),
                "Z_Score": "N/A"
            })
    return rows

def evaluate_who_criteria(min_t_score, age=None, gender=None, weight=None, height=None):
    status = ""
    desc = ""
    rec = ""
    
    if min_t_score >= -1.0:
        status = "Normal"
        desc = "ความหนาแน่นกระดูกปกติ (Normal)"
        rec = "ควรตรวจติดตามมวลกระดูกทุก 2-5 ปี"
    elif -2.5 < min_t_score < -1.0:
        status = "Osteopenia"
        desc = "ภาวะกระดูกบาง (Osteopenia)"
        rec = "ควรปรึกษาแพทย์เพื่อพิจารณาการรับวิตามินดีและแคลเซียมเสริม"
    else:
        status = "Osteoporosis"
        desc = "ภาวะกระดูกพรุน (Osteoporosis)"
        rec = "มีความเสี่ยงสูงต่อกระดูกหัก ควรเริ่มขั้นตอนการรักษาด้วยยาตามดุลยพินิจของแพทย์"

    clinical_data = None
    clinical_notes = []
    
    if age and weight and height:
        try:
            a = float(age)
            w = float(weight)
            h_m = float(height) / 100.0
            bmi = w / (h_m * h_m)
            
            clinical_data = {
                "age": int(a),
                "gender": gender,
                "weight": round(w, 1),
                "height": round(float(height), 1),
                "bmi": round(bmi, 2)
            }
            
            if a > 65:
                clinical_notes.append("อายุมากกว่า 65 ปี (มีความเสี่ยงสูงตามเกณฑ์อายุ)")
            if bmi < 18.5:
                clinical_notes.append(f"BMI ต่ำกว่าเกณฑ์ ({round(bmi, 1)}) - เพิ่มความเสี่ยงกระดูกหัก")
                
            if status == "Osteopenia" and len(clinical_notes) > 0:
                desc = "ภาวะกระดูกบางร่วมกับปัจจัยเสี่ยงทางคลินิก (Clinical Osteopenia High Risk)"
                rec = "พบปัจจัยเสี่ยงทางคลินิก ควรรับการประเมิน FRAX Score เพิ่มเติมและพิจารณาการให้ยารักษา"
        except:
            pass

    return {
        "status": status,
        "description": desc,
        "recommendation": rec,
        "clinical_data": clinical_data,
        "clinical_notes": clinical_notes
    }

@app.get("/stats")
async def get_stats():
    try:
        if supabase:
            resp = supabase.table("patients").select("*").execute()
            pts = resp.data
            stats = {"Normal": 0, "Osteopenia": 0, "Osteoporosis": 0}
            for p in pts:
                lbl = p.get('label', 'Normal')
                stats[lbl] = stats.get(lbl, 0) + 1
            return {
                "summary": stats,
                "total": len(pts),
                "records": pts
            }
        else:
            if not os.path.exists(DATASET_CSV):
                return {"summary": {"Normal": 0, "Osteopenia": 0, "Osteoporosis": 0}, "total": 0, "records": []}
            df = pd.read_csv(DATASET_CSV)
            stats = df['label'].value_counts().to_dict()
            for label in ["Normal", "Osteopenia", "Osteoporosis"]:
                if label not in stats:
                    stats[label] = 0
            return {"summary": stats, "total": len(df), "records": df.to_dict('records')}
    except Exception as e:
        return {"error": str(e)}

@app.get("/patient/{patient_id}")
async def get_patient_data(patient_id: str):
    try:
        if supabase:
            p_resp = supabase.table("patients").select("*").eq("patient_id", patient_id).execute()
            if not p_resp.data:
                return {"error": "Patient not found in Cloud Database"}
            pt = p_resp.data[0]
            
            e_resp = supabase.table("spine_evaluations").select("*").eq("patient_id", patient_id).execute()
            
            extracted_data = []
            min_t_score = float('inf')
            
            for row in e_resp.data:
                t_score = float(row['t_score'])
                if t_score < min_t_score:
                    min_t_score = t_score
                extracted_data.append({
                    "Region": row['region'],
                    "BMD": float(row['bmd']),
                    "T_Score": t_score,
                    "Z_Score": row.get('z_score', 'N/A')
                })
            
            diagnosis_obj = evaluate_who_criteria(min_t_score if min_t_score != float('inf') else 0)
            
            return {
                "patient_id": patient_id,
                "prediction": pt["label"],
                "full_description": diagnosis_obj["description"],
                "recommendation": diagnosis_obj["recommendation"],
                "min_t_score": min_t_score if min_t_score != float('inf') else 0,
                "extracted_data": extracted_data,
                "clinical_data": None,
                "clinical_notes": diagnosis_obj["clinical_notes"],
                "criteria_used": "Database Record (Cloud Postgres)",
                "preview_image": pt['image_url']
            }
        else:
            if not os.path.exists(DATASET_CSV):
                return {"error": "Local Database not found"}
            df = pd.read_csv(DATASET_CSV)
            patient_rows = df[df['patient_id'].astype(str) == str(patient_id)]
            
            if patient_rows.empty:
                return {"error": "Patient not found in Local CSV"}
                
            img_path = patient_rows.iloc[0]['image_path']
            # If path was saved as absolute Windows path, try to resolve it relatively
            if not os.path.exists(img_path):
                # Fallback: check if it's in the current project structure
                fname = os.path.basename(img_path)
                # Looking for LABEL/ID/fname
                lbl = patient_rows.iloc[0]['label']
                img_path = os.path.join(BASE_DIR, lbl, str(patient_id), fname)

            with open(img_path, "rb") as image_file:
                bg64_str = base64.b64encode(image_file.read()).decode('utf-8')
            mime_type = "image/png" if img_path.lower().endswith(".png") else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{bg64_str}"
            
            bmd_csv = os.path.join(os.path.dirname(img_path), "bmd_spine.csv")
            if os.path.exists(bmd_csv):
                bmd_df = pd.read_csv(bmd_csv)
            else:
                return {"error": "BMD Data file not found for this patient."}
            
            extracted_data = []
            min_t_score = float('inf')
            for _, row in bmd_df.iterrows():
                t_score = float(row['T_Score'])
                if t_score < min_t_score:
                    min_t_score = t_score
                extracted_data.append({
                    "Region": str(row['Region']),
                    "BMD": float(row['BMD']),
                    "T_Score": t_score,
                    "Z_Score": float(row['Z_Score']) if 'Z_Score' in row and str(row['Z_Score']) != 'N/A' else 'N/A'
                })
                
            diagnosis_obj = evaluate_who_criteria(min_t_score)
            
            return {
                "patient_id": patient_id,
                "prediction": diagnosis_obj["status"],
                "full_description": diagnosis_obj["description"],
                "recommendation": diagnosis_obj["recommendation"],
                "min_t_score": min_t_score,
                "extracted_data": extracted_data,
                "clinical_data": None,
                "clinical_notes": diagnosis_obj["clinical_notes"],
                "criteria_used": "Database Record (Local CSV)",
                "preview_image": data_uri
            }
    except Exception as e:
        return {"error": str(e)}

@app.post("/predict")
async def predict_risk(
    file: UploadFile = File(None),
    patient_id: str = Form(None),
    extracted_data: str = Form(None), # New: Optional pre-extracted JSON from frontend
    age: str = Form(None),
    gender: str = Form(None),
    weight: str = Form(None),
    height: str = Form(None)
):
    try:
        filename = "Web Query.png"
        rows = []

        # 1. Use pre-extracted data if available (Saves RAM on Render)
        if extracted_data:
            try:
                rows = json.loads(extracted_data)
                print(f"✅ Using Pre-extracted Data ({len(rows)} rows)")
            except:
                pass

        if file:
            contents = await file.read()
            nparr = np.frombuffer(contents, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return {"error": "Invalid image format"}
            filename = file.filename
        else:
            if not patient_id:
                return {"error": "Please provide an image file or a valid Patient ID."}
            
            if supabase:
                pt_data = supabase.table("patients").select("*").eq("patient_id", patient_id).execute().data
                if not pt_data:
                    return {"error": "Patient ID not found in Cloud Database."}
                img_url = pt_data[0]['image_url']
                resp = requests.get(img_url)
                if resp.status_code != 200:
                    return {"error": "Failed to load existing image from Cloud."}
                nparr = np.frombuffer(resp.content, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            else:
                if not os.path.exists(DATASET_CSV):
                    return {"error": "Local Database not found"}
                main_df = pd.read_csv(DATASET_CSV)
                patient_rows = main_df[main_df['patient_id'].astype(str) == str(patient_id)]
                if patient_rows.empty:
                    return {"error": "Patient ID not found in Local Database."}
                img_path = patient_rows.iloc[0]['image_path']
                # Handle potential Windows absolute paths
                if not os.path.exists(img_path):
                     fname = os.path.basename(img_path)
                     lbl = patient_rows.iloc[0]['label']
                     img_path = os.path.join(BASE_DIR, lbl, str(patient_id), fname)
                img = cv2.imread(img_path)
                if img is None:
                    return {"error": "Failed to load local image."}
                filename = os.path.basename(img_path)
        
        # 2. Perform OCR only if NOT provided and NOT in restricted environment
        if not rows:
            # Temporary file for OCR
            temp_dir = tempfile.gettempdir()
            temp_path = os.path.join(temp_dir, "temp_bmd.png")
            cv2.imwrite(temp_path, img)
            
            try:
                rows = process_table(temp_path)
                # Aggressively clear OCR memory after use
                if supabase: # If in Cloud (likely Render), clear immediately
                    clear_reader() 
            except Exception as e:
                return {"error": f"OCR Engine Failure: {str(e)}. Try using a browser with latest JS enabled."}
            
        if not rows:
            return {"error": "Could not extract standard spine T-scores from image. Please ensure the image contains a clear BMD table."}
            
        min_t_score = min([r["T_Score"] for r in rows])
        diagnosis_obj = evaluate_who_criteria(min_t_score, age, gender, weight, height)
        LABEL = diagnosis_obj["status"]

        if patient_id:
            if supabase:
                # Cloud Storage & Database Insertion
                success, encoded_img = cv2.imencode('.png', img)
                file_bytes = encoded_img.tobytes()
                # Use a more randomized/unique filename in bucket if needed, but path achieves isolation
                storage_path = f"{LABEL}/{patient_id}/{filename}"
                
                try:
                    # Depending on policy, we update or upload. upload might throw if exists, that's fine.
                    supabase.storage.from_("xrays").upload(storage_path, file_bytes, {"content-type": "image/png"})
                except Exception:
                    pass
                
                image_url = supabase.storage.from_("xrays").get_public_url(storage_path)
                
                existing = supabase.table("patients").select("*").eq("patient_id", patient_id).execute().data
                if existing:
                    supabase.table("patients").update({"label": LABEL, "image_url": image_url}).eq("patient_id", patient_id).execute()
                    supabase.table("spine_evaluations").delete().eq("patient_id", patient_id).execute()
                else:
                    supabase.table("patients").insert({"patient_id": patient_id, "label": LABEL, "image_url": image_url}).execute()
                    
                evals = []
                for r in rows:
                    evals.append({
                        "patient_id": patient_id,
                        "region": r["Region"],
                        "bmd": r["BMD"],
                        "t_score": r["T_Score"],
                        "z_score": str(r.get("Z_Score", "N/A"))
                    })
                if evals:
                    supabase.table("spine_evaluations").insert(evals).execute()

            else:
                # Local CSV Fallback
                main_df = pd.read_csv(DATASET_CSV)
                patient_dir = os.path.join(BASE_DIR, LABEL, str(patient_id))
                os.makedirs(patient_dir, exist_ok=True)
                image_dest_path = os.path.join(patient_dir, filename)
                cv2.imwrite(image_dest_path, img)

                bmd_csv_path = os.path.join(patient_dir, "bmd_spine.csv")
                bmd_df = pd.DataFrame(rows)
                if 'Z_Score' not in bmd_df.columns:
                    bmd_df['Z_Score'] = 'N/A'
                bmd_df.to_csv(bmd_csv_path, index=False)

                if str(patient_id) in main_df['patient_id'].astype(str).values:
                    main_df.loc[main_df['patient_id'].astype(str) == str(patient_id), 'label'] = LABEL
                    main_df.loc[main_df['patient_id'].astype(str) == str(patient_id), 'image_path'] = image_dest_path
                else:
                    new_record = pd.DataFrame([{
                        'patient_id': patient_id,
                        'image_path': image_dest_path,
                        'label': LABEL
                    }])
                    main_df = pd.concat([main_df, new_record], ignore_index=True)
                main_df.to_csv(DATASET_CSV, index=False)
        
        return {
            "patient_id": patient_id,
            "prediction": diagnosis_obj["status"],
            "full_description": diagnosis_obj["description"],
            "recommendation": diagnosis_obj["recommendation"],
            "min_t_score": min_t_score,
            "extracted_data": rows,
            "clinical_data": diagnosis_obj["clinical_data"],
            "clinical_notes": diagnosis_obj["clinical_notes"],
            "criteria_used": f"WHO Dynamic Logic ({'Cloud DB' if supabase else 'Local CSV'})"
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

@app.post("/train_model")
async def trigger_retraining():
    if supabase:
        return {"error": "Model Retraining from Web currently handles local folder structure. Data synced in Supabase."}
    try:
        script_path = r"c:\Users\L\Desktop\Normal-20260423T020516Z-3-001\train_model.py"
        result = subprocess.run([sys.executable, script_path], capture_output=True, text=True)
        if result.returncode == 0:
            return {"status": "success", "message": "Model trained successfully.", "logs": result.stdout}
        else:
            return {"error": "Training failed", "details": result.stderr}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
