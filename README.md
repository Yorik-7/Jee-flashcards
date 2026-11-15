# JEE Recall — Handwritten Flashcard & Revision Platform

A distraction-free, stylus-first handwritten flashcard and active-recall web application for JEE preparation (Mathematics, Chemistry, and Physics), powered by Firebase Authentication, Cloud Firestore, and Firebase Hosting.

## Features

- **3 Subject Workspaces**: Mathematics, Chemistry, and Physics with distinct visual identities, folder management (create, rename, delete, reorder), and one-click Play launch.
- **Stylus-Optimized Handwritten Card Creator**: Dual-canvas (Question & Answer) vector-stroke editor with Pen, Highlighter, Eraser, brush sizes, preset & custom colors, Undo/Redo, Zoom controls, Plain/Grid/Dotted paper, pressure sensitivity, palm-rejection toggle, and automatic draft recovery.
- **Distraction-Free Study Mode**: Active-recall reveal, keyboard shortcuts (`Space` reveal, `←`/`→` navigate, `Esc` exit), non-repeating Randomizer toggle, last-studied position memory, and 3-tier recall feedback (`Didn't Know`, `Difficult`, `Knew It`).
- **Revision Analytics**: Global, per-subject, and per-folder mastery tracking.
- **Cloud Sync & Backups**: Real-time Firestore synchronization, offline persistence, and full JSON export/import backups.

---

## Firebase Configuration & Deployment Guide

### 1. Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/) and click **Add project**.
2. Name your project (e.g., `jee-recall`) and finish creating it.

### 2. Enable Authentication
1. In the left sidebar, open **Build → Authentication** and click **Get started**.
2. Under **Sign-in method**, enable **Email/Password** (and optionally **Google**).

### 3. Create Cloud Firestore Database
1. Open **Build → Firestore Database** and click **Create database**.
2. Choose **Start in production mode** and select a region close to you (e.g., `asia-south1` for Mumbai).
3. Go to the **Rules** tab and paste the contents of `firestore.rules` from this project, then click **Publish**.

### 4. Get Your Web App Config
1. Go to **Project Settings** (gear icon) → **Your apps** → click the Web icon (`</>`).
2. Register the app and copy the `firebaseConfig` object.
   > **Security Note**: Never put private service account keys or Admin SDK credentials in frontend code. The public `firebaseConfig` (apiKey, authDomain, projectId, etc.) is safe for client-side use when protected by `firestore.rules`.
3. Paste your `firebaseConfig` into `js/firebase-config.js` (or paste it directly inside the app's **Firebase Setup** modal in the UI).

### 5. Deploy to Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # Select your project, set public directory to "."
firebase deploy
```

## Firestore Data Structure

```text
users/{userId}/
  subjects/{Mathematics | Chemistry | Physics}/
    folders/{folderId}/
      name: string
      createdAt: timestamp
      updatedAt: timestamp
      position: number
      cardOrder: string[]
      lastStudiedIndex: number
      studySessions: number
      cards/{cardId}/
        questionStrokes: array
        answerStrokes: array
        questionBg: "plain" | "grid" | "dots"
        answerBg: "plain" | "grid" | "dots"
        position: number
        difficulty: "new" | "forgotten" | "difficult" | "knew"
        lastReviewed: timestamp | null
        reviewCount: number
```
