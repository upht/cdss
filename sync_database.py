import pandas as pd
import os
import shutil
import re

BASE_DIR = r"c:\Users\L\Desktop\Normal-20260423T020516Z-3-001"
DATASET_CSV = os.path.join(BASE_DIR, "OsterporosisUpDataset.csv")

def evaluate_who(min_t):
    if min_t >= -1.0: return "Normal"
    if -2.5 < min_t < -1.0: return "Osteopenia"
    return "Osteoporosis"

def sync():
    print("Starting Database Synchronization...")
    df = pd.read_csv(DATASET_CSV)
    
    updated_rows = []
    changes_count = 0
    
    for idx, row in df.iterrows():
        pid = str(row['patient_id'])
        current_label = str(row['label'])
        current_path = str(row['image_path'])
        
        # Robust path resolution
        filename = re.split(r'[\\/]', current_path)[-1]
        
        # Try to find current actual location
        actual_folder = os.path.join(BASE_DIR, current_label, pid)
        if not os.path.exists(actual_folder):
            # Try searching in other possible labels if it was moved partially
            for l in ["Normal", "Osteopenia", "Osteoporosis"]:
                test_folder = os.path.join(BASE_DIR, l, pid)
                if os.path.exists(test_folder):
                    actual_folder = test_folder
                    current_label = l
                    break
        
        bmd_csv = os.path.join(actual_folder, "bmd_spine.csv")
        
        if os.path.exists(bmd_csv):
            try:
                bmd_df = pd.read_csv(bmd_csv)
                if not bmd_df.empty and 'T_Score' in bmd_df.columns:
                    min_t = bmd_df['T_Score'].min()
                    correct_label = evaluate_who(min_t)
                    
                    if current_label.lower() != correct_label.lower():
                        print(f"Syncing PID {pid}: {current_label} -> {correct_label} (MinT: {min_t})")
                        
                        new_folder = os.path.join(BASE_DIR, correct_label, pid)
                        os.makedirs(os.path.join(BASE_DIR, correct_label), exist_ok=True)
                        
                        # Move folder if destination doesn't exist
                        if not os.path.exists(new_folder):
                            shutil.move(actual_folder, new_folder)
                        else:
                            print(f"  Destination {new_folder} already exists. Merging/Updating CSV only.")
                            # To be safe, we don't delete actual_folder if it exists, just update CSV
                        
                        # Update CSV Row
                        new_img_path = os.path.join(new_folder, filename)
                        row['label'] = correct_label
                        row['image_path'] = new_img_path
                        changes_count += 1
            except Exception as e:
                print(f"  Error processing {pid}: {e}")
        
        updated_rows.append(row)
        
    # Save updated CSV
    new_df = pd.DataFrame(updated_rows)
    new_df.to_csv(DATASET_CSV, index=False)
    print(f"Successfully updated {changes_count} records.")

if __name__ == "__main__":
    sync()
