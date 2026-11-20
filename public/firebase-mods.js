// Public mods loader from Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBHuDf1Yrbktjv15mFJtTdLd3YA2XCmDUs",
  authDomain: "casualdavid.com.ng",
  projectId: "casualdavid-site",
  storageBucket: "casualdavid-site.firebasestorage.app",
  messagingSenderId: "884094241084",
  appId: "1:884094241084:web:2ab1c7940ac014450cf639"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.firebaseMods = {
  async list() {
    const snap = await getDocs(collection(db, 'mods'));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => !m.unlisted);
  },
  async get(id) {
    const snap = await getDoc(doc(db, 'mods', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }
};
