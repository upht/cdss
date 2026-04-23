import pandas as pd
import numpy as np
import cv2
import os
import joblib
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score, classification_report
from sklearn.preprocessing import LabelEncoder
from skimage.feature import graycomatrix, graycoprops

def load_data(csv_path):
    df = pd.read_csv(csv_path)
    return df

def extract_features_part_a(img):
    # Base Image: simple resize to 64x64 and color histogram
    img_resized = cv2.resize(img, (64, 64))
    hist = cv2.calcHist([img_resized], [0], None, [64], [0, 256]).flatten()
    return hist / (hist.sum() + 1e-7)

def extract_features_part_b(img):
    # ROI Extraction: crop center
    h, w = img.shape[:2]
    roi = img[int(h*0.25):int(h*0.75), int(w*0.25):int(w*0.75)]
    if len(roi.shape) == 3:
        roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    else:
        roi_gray = roi
        
    # Feature extraction (GLCM)
    glcm = graycomatrix(roi_gray, distances=[1], angles=[0], levels=256, symmetric=True, normed=True)
    contrast = graycoprops(glcm, 'contrast')[0, 0]
    dissimilarity = graycoprops(glcm, 'dissimilarity')[0, 0]
    homogeneity = graycoprops(glcm, 'homogeneity')[0, 0]
    energy = graycoprops(glcm, 'energy')[0, 0]
    correlation = graycoprops(glcm, 'correlation')[0, 0]
    
    return np.array([contrast, dissimilarity, homogeneity, energy, correlation])

def get_combined_features(img_path):
    img = cv2.imread(img_path)
    if img is None:
        return np.zeros(64 + 5)
    
    feat_a = extract_features_part_a(img)
    feat_b = extract_features_part_b(img)
    return np.concatenate([feat_a, feat_b])

def main():
    print("Loading data...")
    dataset_path = r"c:\Users\L\Desktop\Normal-20260423T020516Z-3-001\OsterporosisUpDataset.csv"
    df = load_data(dataset_path)
    
    print(f"Total samples: {len(df)}")
    
    X = []
    y = []
    
    # Label encoding
    le = LabelEncoder()
    df['label_enc'] = le.fit_transform(df['label'])
    
    for _, row in df.iterrows():
        feat = get_combined_features(row['image_path'])
        X.append(feat)
        y.append(row['label_enc'])
        
    X = np.array(X)
    y = np.array(y)
    
    # Train/Test Split (ensuring no leakage since 1 row = 1 patient here)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    
    # Handling Class Imbalance with class_weight
    clf = RandomForestClassifier(n_estimators=100, class_weight='balanced', random_state=42)
    
    # Cross Validation
    print("Performing Cross-Validation...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(clf, X_train, y_train, cv=cv, scoring='f1_macro')
    print(f"CV F1 Macro Mean: {np.mean(cv_scores):.4f}")
    
    # Train final model
    clf.fit(X_train, y_train)
    
    # Prediction and Evaluation
    y_pred = clf.predict(X_test)
    y_prob = clf.predict_proba(X_test)
    
    acc = accuracy_score(y_test, y_pred)
    f1 = f1_score(y_test, y_pred, average='macro')
    # AUC might need multi-class handling
    auc = roc_auc_score(y_test, y_prob, multi_class='ovr')
    
    print(f"Test Accuracy: {acc:.4f}")
    print(f"Test F1-score (macro): {f1:.4f}")
    print(f"Test AUC (OVR): {auc:.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=le.classes_))
    
    # Save the model and label encoder
    model_path = r"c:\Users\L\Desktop\Normal-20260423T020516Z-3-001\osteo_model.pkl"
    joblib.dump({"model": clf, "le": le}, model_path)
    print(f"Model saved to {model_path}")

if __name__ == "__main__":
    main()
