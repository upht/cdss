import os
import csv
import glob

# Data source path
base_path = r""
output_csv = r"OsterporosisUpDataset.csv"

# Classes
classes = ["Normal", "Osteopenia", "Osteoporosis"]

data = []

for cls in classes:
    cls_path = os.path.join(base_path, cls)
    if not os.path.exists(cls_path):
        continue
    
    # Iterate over patient directories
    for patient_id in os.listdir(cls_path):
        patient_path = os.path.join(cls_path, patient_id)
        if os.path.isdir(patient_path):
            # Assume Web Query.png is the main spine image as it's the largest typical output
            # If not found, fallback to any other image
            img_path = os.path.join(patient_path, "Web Query.png")
            if not os.path.exists(img_path):
                img_path = os.path.join(patient_path, "Web Query_2.jpg")
            if not os.path.exists(img_path):
                # Just find the first image
                images = glob.glob(os.path.join(patient_path, "*.*"))
                if images:
                    img_path = images[0]
                else:
                    img_path = None
                    
            if img_path:
                data.append({
                    "patient_id": patient_id,
                    "image_path": img_path,
                    "label": cls
                })

# Write to CSV
with open(output_csv, mode='w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=["patient_id", "image_path", "label"])
    writer.writeheader()
    writer.writerows(data)

print(f"Dataset summary created at {output_csv} with {len(data)} records.")
