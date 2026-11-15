// Cloud Firestore Data Layer + IndexedDB Offline Cache
// Hierarchy: users/{userId}/subjects/{subject}/folders/{folderId}/cards/{cardId}

export const SUBJECTS = ["Mathematics", "Chemistry", "Physics"];

const IDB_NAME = "jee_recall_cache";
const IDB_VERSION = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("folders")) {
        db.createObjectStore("folders", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("cards")) {
        db.createObjectStore("cards", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  try {
    const db = await openIDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return [];
  }
}

async function idbPut(storeName, item) {
  try {
    const db = await openIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {}
}

async function idbDelete(storeName, id) {
  try {
    const db = await openIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {}
}

async function idbClearAll() {
  try {
    const db = await openIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["folders", "cards"], "readwrite");
      tx.objectStore("folders").clear();
      tx.objectStore("cards").clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {}
}

export function generateId(prefix = "id") {
  if (crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class FlashcardRepository {
  constructor() {
    this.db = null;
    this.userId = null;
    this.fs = null;
    this.onSyncChange = null;
  }

  async attachFirebase(db, userId) {
    this.db = db;
    this.userId = userId;
    if (db && !this.fs) {
      this.fs = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
    }
  }

  detachFirebase() {
    this.db = null;
    this.userId = null;
  }

  isCloudActive() {
    return Boolean(this.db && this.userId && this.fs);
  }

  _setSync(status) {
    if (this.onSyncChange) this.onSyncChange(status);
  }

  async loadAllData() {
    if (!this.isCloudActive()) {
      const [folders, cards] = await Promise.all([idbGetAll("folders"), idbGetAll("cards")]);
      return { folders, cards };
    }

    this._setSync("syncing");
    const { collection, getDocs, doc, setDoc } = this.fs;
    const folders = [];
    const cards = [];

    try {
      for (const subject of SUBJECTS) {
        const subjectRef = doc(this.db, "users", this.userId, "subjects", subject);
        await setDoc(subjectRef, { name: subject }, { merge: true });

        const foldersCol = collection(this.db, "users", this.userId, "subjects", subject, "folders");
        const folderSnap = await getDocs(foldersCol);

        for (const fDoc of folderSnap.docs) {
          const fData = fDoc.data();
          const folder = {
            id: fDoc.id,
            subject,
            name: fData.name || "Untitled Folder",
            createdAt: fData.createdAt || Date.now(),
            updatedAt: fData.updatedAt || Date.now(),
            position: typeof fData.position === "number" ? fData.position : 0,
            cardOrder: Array.isArray(fData.cardOrder) ? fData.cardOrder : [],
            lastStudiedIndex: typeof fData.lastStudiedIndex === "number" ? fData.lastStudiedIndex : 0,
            studySessions: typeof fData.studySessions === "number" ? fData.studySessions : 0
          };
          folders.push(folder);
          await idbPut("folders", folder);

          const cardsCol = collection(
            this.db,
            "users",
            this.userId,
            "subjects",
            subject,
            "folders",
            fDoc.id,
            "cards"
          );
          const cardSnap = await getDocs(cardsCol);
          for (const cDoc of cardSnap.docs) {
            const cData = cDoc.data();
            const card = {
              id: cDoc.id,
              folderId: fDoc.id,
              subject,
              questionStrokes: Array.isArray(cData.questionStrokes) ? cData.questionStrokes : [],
              answerStrokes: Array.isArray(cData.answerStrokes) ? cData.answerStrokes : [],
              questionBg: cData.questionBg || "plain",
              answerBg: cData.answerBg || "plain",
              position: typeof cData.position === "number" ? cData.position : 0,
              difficulty: cData.difficulty || "new",
              lastReviewed: cData.lastReviewed || null,
              reviewCount: typeof cData.reviewCount === "number" ? cData.reviewCount : 0,
              createdAt: cData.createdAt || Date.now(),
              updatedAt: cData.updatedAt || Date.now()
            };
            cards.push(card);
            await idbPut("cards", card);
          }
        }
      }
      this._setSync("synced");
      return { folders, cards };
    } catch (err) {
      this._setSync("offline");
      const [cachedFolders, cachedCards] = await Promise.all([idbGetAll("folders"), idbGetAll("cards")]);
      return { folders: cachedFolders, cards: cachedCards, error: err.message };
    }
  }

  async saveFolder(folder) {
    await idbPut("folders", folder);
    if (!this.isCloudActive()) return;
    this._setSync("syncing");
    try {
      const { doc, setDoc } = this.fs;
      const ref = doc(this.db, "users", this.userId, "subjects", folder.subject, "folders", folder.id);
      await setDoc(ref, {
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        position: folder.position,
        cardOrder: folder.cardOrder || [],
        lastStudiedIndex: folder.lastStudiedIndex || 0,
        studySessions: folder.studySessions || 0
      }, { merge: true });
      this._setSync("synced");
    } catch (err) {
      this._setSync("offline");
      throw err;
    }
  }

  async deleteFolder(folder, cardIds = []) {
    await idbDelete("folders", folder.id);
    for (const cid of cardIds) await idbDelete("cards", cid);
    if (!this.isCloudActive()) return;
    this._setSync("syncing");
    try {
      const { doc, deleteDoc } = this.fs;
      for (const cid of cardIds) {
        await deleteDoc(doc(this.db, "users", this.userId, "subjects", folder.subject, "folders", folder.id, "cards", cid));
      }
      await deleteDoc(doc(this.db, "users", this.userId, "subjects", folder.subject, "folders", folder.id));
      this._setSync("synced");
    } catch (err) {
      this._setSync("offline");
      throw err;
    }
  }

  async saveCard(card) {
    await idbPut("cards", card);
    if (!this.isCloudActive()) return;
    this._setSync("syncing");
    try {
      const { doc, setDoc } = this.fs;
      const ref = doc(
        this.db,
        "users",
        this.userId,
        "subjects",
        card.subject,
        "folders",
        card.folderId,
        "cards",
        card.id
      );
      await setDoc(ref, {
        questionStrokes: card.questionStrokes,
        answerStrokes: card.answerStrokes,
        questionBg: card.questionBg || "plain",
        answerBg: card.answerBg || "plain",
        position: card.position,
        difficulty: card.difficulty || "new",
        lastReviewed: card.lastReviewed || null,
        reviewCount: card.reviewCount || 0,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt
      }, { merge: true });
      this._setSync("synced");
    } catch (err) {
      this._setSync("offline");
      throw err;
    }
  }

  async deleteCard(card) {
    await idbDelete("cards", card.id);
    if (!this.isCloudActive()) return;
    this._setSync("syncing");
    try {
      const { doc, deleteDoc } = this.fs;
      await deleteDoc(
        doc(this.db, "users", this.userId, "subjects", card.subject, "folders", card.folderId, "cards", card.id)
      );
      this._setSync("synced");
    } catch (err) {
      this._setSync("offline");
      throw err;
    }
  }

  async replaceAllFromBackup(folders, cards) {
    await idbClearAll();
    for (const f of folders) await this.saveFolder(f);
    for (const c of cards) await this.saveCard(c);
  }
}
